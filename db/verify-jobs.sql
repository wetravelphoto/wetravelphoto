-- Proof that the queue behaves. Run AFTER db/migrations/2026-09-29_jobs.sql.
--
-- ── It cannot leave anything behind ─────────────────────────────────────────
--
-- Everything happens inside one transaction that ALWAYS ends by raising an
-- exception, which aborts it. The report is the exception message. There is no
-- path through this file that commits, so the jobs it invents are rolled back
-- whether it passes, fails, or falls over halfway. Same shape as
-- db/verify-tenant-isolation.sql, for the same reason.
--
-- ── What is NOT tested here ─────────────────────────────────────────────────
--
-- That two workers running at the same instant take different jobs. That needs
-- two connections and cannot be done inside one transaction — the whole point
-- of `for update skip locked` is what one session does while another holds a
-- lock. It is in scripts/jobs-concurrency.sh, which is the other half of this
-- file and should be run with it.

begin;

create temp table job_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

create temp view t as
  select 'aaaaaaaa-0000-0000-0000-000000000001'::uuid as a,
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid as b;


-- ── 1. A claim takes the job, counts the attempt, and leases it ─────────────

do $$
declare
  v_id     uuid;
  v_got    jobs;
  v_future uuid;
  n_got    int;
begin
  insert into jobs (tenant_id, kind, payload)
  values ((select a from t), 'test.ok', '{"n":1}'::jsonb)
  returning id into v_id;

  -- And one that is not due yet. It must be left alone.
  insert into jobs (tenant_id, kind, run_after)
  values ((select a from t), 'test.later', now() + interval '1 hour')
  returning id into v_future;

  select * into v_got from public.claim_jobs('worker-1', 10, interval '10 minutes');

  select count(*) into n_got from jobs
   where status = 'running' and locked_by = 'worker-1';

  insert into job_res (step, expected, actual, pass) values
    ('a claim returns the queued job', v_id::text, coalesce(v_got.id::text, 'nothing'), v_got.id = v_id),
    ('it is marked running',           'running',  v_got.status,                        v_got.status = 'running'),
    ('the attempt is counted at claim time', '1',  v_got.attempts::text,                v_got.attempts = 1),
    ('it is leased to this worker',    'worker-1', coalesce(v_got.locked_by, 'nobody'), v_got.locked_by = 'worker-1'),
    ('the lease is in the future',     'yes',
       case when v_got.lease_until > now() then 'yes' else 'no' end,                    v_got.lease_until > now()),
    ('locked_at is set',               'yes',
       case when v_got.locked_at is not null then 'yes' else 'no' end,                  v_got.locked_at is not null),
    ('a job that is not due yet is left alone', '1 claimed', n_got || ' claimed',       n_got = 1);

  perform set_config('job.ok', v_id::text, true);
  perform set_config('job.future', v_future::text, true);
end $$;


-- ── 2. Finishing it ─────────────────────────────────────────────────────────

do $$
declare
  v_id  uuid := current_setting('job.ok')::uuid;
  v_out jobs;
begin
  select * into v_out from public.finish_job(v_id, 'worker-1');

  insert into job_res (step, expected, actual, pass) values
    ('a finished job is done',        'done',    v_out.status,                        v_out.status = 'done'),
    ('its lease is released',         'null',    coalesce(v_out.locked_by, 'null'),   v_out.locked_by is null),
    ('finished_at is set',            'yes',
       case when v_out.finished_at is not null then 'yes' else 'no' end,              v_out.finished_at is not null);
end $$;


-- ── 3. A failure comes back later, and later again ──────────────────────────

do $$
declare
  v_id    uuid;
  v_job   jobs;
  d1      interval;
  d2      interval;
begin
  insert into jobs (tenant_id, kind) values ((select a from t), 'test.flaky')
  returning id into v_id;

  -- First attempt fails.
  perform public.claim_jobs('worker-1', 1, interval '10 minutes', (select a from t));
  select * into v_job from public.finish_job(v_id, 'worker-1', 'the service said no');
  d1 := v_job.run_after - now();

  insert into job_res (step, expected, actual, pass) values
    ('a failure goes back in the queue', 'queued', v_job.status, v_job.status = 'queued'),
    ('the error is kept',  'the service said no', coalesce(v_job.last_error, 'nothing'),
       v_job.last_error = 'the service said no'),
    ('the attempt is not un-counted',    '1', v_job.attempts::text, v_job.attempts = 1),
    ('it waits about 10 seconds',        '7.5s to 12.5s', d1::text,
       d1 between interval '7.5 seconds' and interval '12.5 seconds');

  -- It is not due yet, so a drain right now must not pick it up.
  insert into job_res (step, expected, actual, pass)
  select 'and it is not claimable until then', '0 claimed', count(*) || ' claimed', count(*) = 0
    from public.claim_jobs('worker-2', 5, interval '1 minute', (select a from t));

  -- Second attempt fails: four times the wait.
  update jobs set run_after = now() where id = v_id;
  perform public.claim_jobs('worker-1', 1, interval '10 minutes', (select a from t));
  select * into v_job from public.finish_job(v_id, 'worker-1', 'again');
  d2 := v_job.run_after - now();

  insert into job_res (step, expected, actual, pass) values
    ('the second wait is about 40 seconds', '30s to 50s', d2::text,
       d2 between interval '30 seconds' and interval '50 seconds'),
    ('backoff grows rather than repeating', 'longer', d1::text || ' then ' || d2::text, d2 > d1);

  perform set_config('job.flaky', v_id::text, true);
end $$;


-- ── 4. Attempts are bounded, and the end of them is visible ─────────────────

do $$
declare
  v_id  uuid := current_setting('job.flaky')::uuid;
  v_job jobs;
  n     int := 0;
  n_vis int;
begin
  -- It has already used two of five. Keep failing it until it stops coming back.
  for i in 1..10 loop
    update jobs set run_after = now() where id = v_id and status = 'queued';
    if (select status from jobs where id = v_id) <> 'queued' then exit; end if;
    perform public.claim_jobs('worker-1', 1, interval '10 minutes', (select a from t));
    select * into v_job from public.finish_job(v_id, 'worker-1', 'still no');
    n := n + 1;
  end loop;

  select * into v_job from jobs where id = v_id;

  -- "Visible" means findable by a plain query, not by reading a log.
  select count(*) into n_vis from jobs
   where tenant_id = (select a from t) and status = 'failed';

  insert into job_res (step, expected, actual, pass) values
    ('a job runs out of attempts',      'failed', v_job.status,          v_job.status = 'failed'),
    ('it stops at max_attempts',        '5',      v_job.attempts::text,  v_job.attempts = 5),
    ('it does not overshoot',           '5 or fewer', v_job.attempts::text, v_job.attempts <= v_job.max_attempts),
    ('the last error is kept',          'still no', coalesce(v_job.last_error, 'nothing'),
       v_job.last_error = 'still no'),
    ('a terminal failure is visible in a query', '1 or more', n_vis || '', n_vis >= 1);

  update jobs set run_after = now() where id = v_id;
  insert into job_res (step, expected, actual, pass)
  select 'a failed job is never claimed again', '0 claimed', count(*) || ' claimed', count(*) = 0
    from public.claim_jobs('worker-9', 5, interval '1 minute', (select a from t))
   where id = v_id;
end $$;


-- ── 5. A worker that never came back ────────────────────────────────────────

do $$
declare
  v_id  uuid;
  v_job jobs;
begin
  insert into jobs (tenant_id, kind) values ((select a from t), 'test.abandoned')
  returning id into v_id;

  perform public.claim_jobs('worker-gone', 1, interval '10 minutes', (select a from t));
  -- The instance is killed. Nothing writes anything. Time passes.
  update jobs set lease_until = now() - interval '1 second' where id = v_id;

  select * into v_job from public.claim_jobs('worker-new', 5, interval '10 minutes', (select a from t));

  insert into job_res (step, expected, actual, pass) values
    ('an expired lease is picked up again', v_id::text,
       coalesce(v_job.id::text, 'nothing'), v_job.id = v_id),
    ('by the new worker',   'worker-new', coalesce(v_job.locked_by, 'nobody'), v_job.locked_by = 'worker-new'),
    ('and the attempt is counted', '2', v_job.attempts::text, v_job.attempts = 2);

  perform set_config('job.abandoned', v_id::text, true);
end $$;


-- ── 6. And the worker that lost it cannot write over the new one ────────────

do $$
declare
  v_id  uuid := current_setting('job.abandoned')::uuid;
  v_out jobs;
  v_now jobs;
begin
  -- worker-gone wakes up and reports success on a job it no longer holds.
  select * into v_out from public.finish_job(v_id, 'worker-gone');
  select * into v_now from jobs where id = v_id;

  insert into job_res (step, expected, actual, pass) values
    ('a stale worker is told it finished nothing', 'null',
       coalesce(v_out.id::text, 'null'), v_out.id is null),
    ('and the job is still the new worker''s', 'running / worker-new',
       v_now.status || ' / ' || coalesce(v_now.locked_by, 'nobody'),
       v_now.status = 'running' and v_now.locked_by = 'worker-new');
end $$;


-- ── 7. A crash loop terminates rather than running for ever ─────────────────

do $$
declare
  v_id  uuid;
  v_job jobs;
  n     int;
begin
  insert into jobs (tenant_id, kind, max_attempts)
  values ((select a from t), 'test.killer', 2)
  returning id into v_id;

  -- Every worker that touches it is killed before it can report. Nothing is
  -- ever written by the job itself — this is the case where counting attempts
  -- in the failure path would loop for ever.
  for i in 1..6 loop
    perform public.claim_jobs('worker-' || i, 5, interval '5 minutes', (select a from t));
    update jobs set lease_until = now() - interval '1 second'
     where id = v_id and status = 'running';
  end loop;

  select * into v_job from jobs where id = v_id;

  insert into job_res (step, expected, actual, pass) values
    ('a job that kills every worker still stops', 'failed', v_job.status, v_job.status = 'failed'),
    ('at its own max_attempts',                   '2',      v_job.attempts::text, v_job.attempts = 2),
    ('and says why',  'the worker did not report back', coalesce(v_job.last_error, 'nothing'),
       v_job.last_error like '%did not report back%');

  select count(*) into n from public.claim_jobs('worker-x', 5, interval '1 minute', (select a from t));
  insert into job_res (step, expected, actual, pass) values
    ('and is not picked up again', '0 claimed', n || ' claimed', n = 0);
end $$;


-- ── 8. A failure nothing can fix does not get five goes ─────────────────────

do $$
declare
  v_id  uuid;
  v_out jobs;
begin
  insert into jobs (tenant_id, kind) values ((select a from t), 'test.nosuchkind')
  returning id into v_id;

  perform public.claim_jobs('worker-1', 1, interval '10 minutes', (select a from t));
  select * into v_out from public.finish_job(v_id, 'worker-1', 'no handler for "test.nosuchkind"', true);

  insert into job_res (step, expected, actual, pass) values
    ('a permanent failure fails at once', 'failed', v_out.status, v_out.status = 'failed'),
    ('on the first attempt',              '1',      v_out.attempts::text, v_out.attempts = 1);
end $$;


-- ── 9. The same work is not queued twice ────────────────────────────────────

do $$
declare
  v_id     uuid;
  again    text := 'allowed — NOT BLOCKED';
  after_ok text := 'refused';
  n_null   int;
begin
  insert into jobs (tenant_id, kind, dedupe_key)
  values ((select a from t), 'test.dedupe', 'photo-1')
  returning id into v_id;

  begin
    insert into jobs (tenant_id, kind, dedupe_key)
    values ((select a from t), 'test.dedupe', 'photo-1');
  exception when unique_violation then
    again := 'blocked';
  end;

  -- Two jobs with NO dedupe key are two different jobs, not a clash.
  insert into jobs (tenant_id, kind) values ((select a from t), 'test.nodedupe');
  insert into jobs (tenant_id, kind) values ((select a from t), 'test.nodedupe');
  select count(*) into n_null from jobs
   where tenant_id = (select a from t) and kind = 'test.nodedupe';

  -- Once it has finished, the same work may be queued again.
  update jobs set status = 'done', finished_at = now() where id = v_id;
  begin
    insert into jobs (tenant_id, kind, dedupe_key)
    values ((select a from t), 'test.dedupe', 'photo-1');
    after_ok := 'allowed';
  exception when unique_violation then
    after_ok := 'still refused';
  end;

  insert into job_res (step, expected, actual, pass) values
    ('the same work is not queued twice',      'blocked', again,    again = 'blocked'),
    ('a job with no dedupe key never clashes', '2',       n_null || '', n_null = 2),
    ('and it can be queued again once done',   'allowed', after_ok, after_ok = 'allowed');

  -- Another site queueing "photo-1" is not the same work.
  begin
    insert into jobs (tenant_id, kind, dedupe_key)
    values ((select b from t), 'test.dedupe', 'photo-1');
    insert into job_res (step, expected, actual, pass) values
      ('another site may queue the same key', 'allowed', 'allowed', true);
  exception when unique_violation then
    insert into job_res (step, expected, actual, pass) values
      ('another site may queue the same key', 'allowed', 'BLOCKED — the key is not per site', false);
  end;
end $$;


-- ── 10. One site's drain never spends its time on another's work ────────────

do $$
declare
  n_a   int;
  n_b   int;
  n_all int;
begin
  -- Clear the decks: everything still queued from the blocks above.
  update jobs set status = 'done', finished_at = now() where status <> 'done';

  insert into jobs (tenant_id, kind) values ((select a from t), 'test.scope');
  insert into jobs (tenant_id, kind) values ((select a from t), 'test.scope');
  insert into jobs (tenant_id, kind) values ((select b from t), 'test.scope');

  select count(*) into n_b from public.claim_jobs('w-b', 10, interval '1 minute', (select b from t));
  select count(*) into n_a from public.claim_jobs('w-a', 10, interval '1 minute', (select a from t));

  update jobs set status = 'queued', locked_by = null, lease_until = null, attempts = 0
   where kind = 'test.scope';

  select count(*) into n_all from public.claim_jobs('w-all', 10, interval '1 minute');

  insert into job_res (step, expected, actual, pass) values
    ('a drain for one site takes only its own', '1', n_b || '', n_b = 1),
    ('and the other site gets its own two',     '2', n_a || '', n_a = 2),
    ('a drain with no site takes everything',   '3', n_all || '', n_all = 3);
end $$;


-- ── 11. A forgotten tenant is a hard error, not a silent write ──────────────

do $$
declare
  err text := 'allowed — NOT BLOCKED';
begin
  begin
    insert into jobs (kind) values ('test.notenant');
    err := 'allowed — NOT BLOCKED';
  exception
    when not_null_violation then err := 'blocked';
    when others then err := 'blocked (' || sqlstate || ')';
  end;

  insert into job_res (step, expected, actual, pass) values
    ('a job with no site is refused', 'blocked', err, err like 'blocked%');
end $$;


-- ── 12. Row level security narrows what a photographer can SEE ─────────────
--
-- The write half of this used to live here and has moved to block 13, because
-- `authenticated` no longer has any way to write to this table at all — which
-- is the point of the change and is asserted there rather than assumed here.

do $$
declare
  -- The two sites spelled out rather than read from the temp view above: the
  -- rest of this block runs as `authenticated`, which has no rights on a temp
  -- view owned by the test's own role, and the failure reads as an RLS problem
  -- when it is nothing of the kind.
  v_a      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_b      uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  v_me     uuid;
  n_mine   int;
  n_theirs int;
  n_all    int;
begin
  perform set_config('iso.owner_role', session_user, true);

  -- Something on each site to look for.
  insert into jobs (tenant_id, kind) values (v_a, 'test.visible'), (v_b, 'test.visible');
  select count(*) into n_all from jobs;

  select id into v_me from profiles where tenant_id = v_a limit 1;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_me)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_mine   from jobs where tenant_id = v_a;
  select count(*) into n_theirs from jobs where tenant_id = v_b;

  perform set_config('role', current_setting('iso.owner_role'), true);

  insert into job_res (step, expected, actual, pass) values
    ('a photographer sees their own queue', '1 or more', n_mine || '',   n_mine >= 1),
    ('and none of another site''s',         '0',         n_theirs || '', n_theirs = 0),
    ('while the owner sees both',           'more than one site''s',
       n_all || ' in total', n_all > n_mine);
end $$;


-- ── 13. THE PRIVILEGE BOUNDARY, exercised as the real roles ─────────────────
--
-- Everything above this point runs as the table's OWNER, which is nobody in
-- production: the owner bypasses row-level security AND holds every table
-- privilege, so a suite that only ever runs as the owner proves nothing about
-- what `authenticated` or `service_role` can actually do.
--
-- That is not hypothetical. The first version of this migration left the two
-- worker functions SECURITY INVOKER and granted service_role nothing, and
-- every assertion above passed — because none of them was service_role. On
-- production the drain would have failed with "permission denied for table
-- jobs", or worked by accident on a Supabase default this file never stated.
--
-- So these run `set role` and ask the question from where it matters.

do $$
declare
  v_a       uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_b       uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  v_me      uuid;
  v_id      uuid;
  v_job     jobs;
  n         int;
  wrote     text;
  updated   text;
  deleted   text;
  cross_err text;
  kind_err  text;
  claim_err text;
  finish_err text;
  read_err  text;
begin
  perform set_config('jb.owner_role', session_user, true);
  select id into v_me from profiles where tenant_id = v_a limit 1;

  -- ── As a signed-in photographer ──────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);
  perform set_config('role', 'authenticated', true);

  -- May look at their own queue.
  begin
    select count(*) into n from jobs where tenant_id = v_a;
    read_err := 'allowed';
  exception when insufficient_privilege then
    read_err := 'REFUSED';
  end;

  -- May NOT write to the table by any direct route.
  begin
    insert into jobs (tenant_id, kind) values (v_a, 'photo.derivatives');
    wrote := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then wrote := 'blocked';
    when others then wrote := 'blocked (' || sqlstate || ')';
  end;

  begin
    update jobs set max_attempts = 999 where tenant_id = v_a;
    updated := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then updated := 'blocked';
    when others then updated := 'blocked (' || sqlstate || ')';
  end;

  begin
    delete from jobs where tenant_id = v_a;
    deleted := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then deleted := 'blocked';
    when others then deleted := 'blocked (' || sqlstate || ')';
  end;

  -- May NOT drive the worker's half of the queue.
  begin
    perform public.claim_jobs('impostor', 1, interval '1 minute', v_a);
    claim_err := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then claim_err := 'blocked';
    when others then claim_err := 'blocked (' || sqlstate || ')';
  end;

  begin
    perform public.finish_job(gen_random_uuid(), 'impostor');
    finish_err := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then finish_err := 'blocked';
    when others then finish_err := 'blocked (' || sqlstate || ')';
  end;

  -- MAY enqueue, through the one door.
  select public.enqueue_jobs(v_a, 'photo.derivatives',
           jsonb_build_array(jsonb_build_object(
             'payload', jsonb_build_object('photoId', 'p1'),
             'dedupe_key', 'p1'))) into n;

  -- ...but not onto another site...
  begin
    perform public.enqueue_jobs(v_b, 'photo.derivatives', '[{}]'::jsonb);
    cross_err := 'allowed — NOT BLOCKED';
  exception when others then cross_err := 'blocked (' || sqlstate || ')';
  end;

  -- ...and not a kind the database has not been told about.
  begin
    perform public.enqueue_jobs(v_a, 'shell.exec', '[{}]'::jsonb);
    kind_err := 'allowed — NOT BLOCKED';
  exception when others then kind_err := 'blocked (' || sqlstate || ')';
  end;

  perform set_config('role', current_setting('jb.owner_role'), true);

  select * into v_job from jobs where tenant_id = v_a and dedupe_key = 'p1';

  insert into job_res (step, expected, actual, pass) values
    ('photographer may read their own queue',  'allowed', read_err,  read_err = 'allowed'),
    ('photographer cannot INSERT directly',    'blocked', wrote,     wrote like 'blocked%'),
    ('photographer cannot UPDATE directly',    'blocked', updated,   updated like 'blocked%'),
    ('photographer cannot DELETE directly',    'blocked', deleted,   deleted like 'blocked%'),
    ('photographer cannot claim jobs',         'blocked', claim_err, claim_err like 'blocked%'),
    ('photographer cannot finish jobs',        'blocked', finish_err, finish_err like 'blocked%'),
    ('photographer CAN enqueue their own work','1',       n || '',   n = 1),
    ('but not onto another site',              'blocked', cross_err, cross_err like 'blocked%'),
    ('and not an unknown kind',                'blocked', kind_err,  kind_err like 'blocked%');

  -- ── And the queued row carries none of the caller's choosing ─────────────
  insert into job_res (step, expected, actual, pass) values
    ('an enqueued job starts queued',       'queued', v_job.status, v_job.status = 'queued'),
    ('with no attempts used',               '0', v_job.attempts::text, v_job.attempts = 0),
    ('the standard attempt limit',          '5', v_job.max_attempts::text, v_job.max_attempts = 5),
    ('due now, not at some chosen time',    'yes',
       case when v_job.run_after <= now() then 'yes' else 'no' end, v_job.run_after <= now()),
    ('holding no lock',                     'null',
       coalesce(v_job.locked_by, 'null') || '/' || coalesce(v_job.lease_until::text, 'null') ||
       '/' || coalesce(v_job.locked_at::text, 'null'),
       v_job.locked_by is null and v_job.lease_until is null and v_job.locked_at is null),
    ('and not already finished',            'null', coalesce(v_job.finished_at::text, 'null'),
       v_job.finished_at is null),
    ('the payload arrived intact',          '{"photoId": "p1"}', v_job.payload::text,
       v_job.payload = '{"photoId":"p1"}'::jsonb);
end $$;


-- ── 14. The worker's own privileges, as service_role ────────────────────────

do $$
declare
  v_a       uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_job     jobs;
  v_out     jobs;
  n         int;
  read_err  text;
  ins_err   text;
  del_err   text;
  enq_err   text;
  claim_fail  text;
  finish_fail text;
begin
  perform set_config('jb.owner_role', session_user, true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);

  /*
   * THE ONE THAT WOULD HAVE BROKEN IN PRODUCTION.
   *
   * Caught rather than allowed to abort: with the first version of this
   * migration — SECURITY INVOKER functions and no table grant for
   * service_role — this raises `permission denied for table jobs`, and a
   * suite that dies on the first surprise reports nothing about the rest.
   */
  begin
    select * into v_job from public.claim_jobs('the-drain', 1, interval '10 minutes', v_a);
  exception when others then
    claim_fail := sqlerrm;
  end;

  -- It can finish what it holds.
  if v_job.id is not null then
    begin
      select * into v_out from public.finish_job(v_job.id, 'the-drain');
    exception when others then
      finish_fail := sqlerrm;
    end;
  end if;

  -- It cannot read, insert into, or empty the table.
  begin
    select count(*) into n from jobs;
    read_err := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then read_err := 'blocked';
    when others then read_err := 'blocked (' || sqlstate || ')';
  end;

  begin
    insert into jobs (tenant_id, kind, status, attempts)
    values (v_a, 'photo.derivatives', 'done', 99);
    ins_err := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then ins_err := 'blocked';
    when others then ins_err := 'blocked (' || sqlstate || ')';
  end;

  begin
    delete from jobs;
    del_err := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then del_err := 'blocked';
    when others then del_err := 'blocked (' || sqlstate || ')';
  end;

  -- And enqueueing is not its door either.
  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives', '[{}]'::jsonb);
    enq_err := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then enq_err := 'blocked';
    when others then enq_err := 'blocked (' || sqlstate || ')';
  end;

  perform set_config('role', current_setting('jb.owner_role'), true);

  insert into job_res (step, expected, actual, pass) values
    ('THE WORKER CAN CLAIM',            'a job',
       coalesce(v_job.id::text, coalesce(claim_fail, 'nothing')), v_job.id is not null),
    ('and the claim really took it',    'running/the-drain',
       coalesce(v_job.status, '?') || '/' || coalesce(v_job.locked_by, '?'),
       v_job.status = 'running' and v_job.locked_by = 'the-drain'),
    ('THE WORKER CAN FINISH',           'done',
       coalesce(v_out.status, coalesce(finish_fail, 'nothing')), v_out.status = 'done'),
    ('the worker cannot read the table', 'blocked', read_err, read_err like 'blocked%'),
    ('the worker cannot insert rows',    'blocked', ins_err,  ins_err like 'blocked%'),
    ('the worker cannot empty the queue','blocked', del_err,  del_err like 'blocked%'),
    ('the worker cannot enqueue',        'blocked', enq_err,  enq_err like 'blocked%');
end $$;


-- ── 15. A visitor reaches none of it ────────────────────────────────────────

do $$
declare
  v_a      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  read_err text;
  enq_err  text;
  claim_err text;
begin
  perform set_config('jb.owner_role', session_user, true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);

  begin
    perform count(*) from jobs;
    read_err := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then read_err := 'blocked';
    when others then read_err := 'blocked (' || sqlstate || ')';
  end;

  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives', '[{}]'::jsonb);
    enq_err := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then enq_err := 'blocked';
    when others then enq_err := 'blocked (' || sqlstate || ')';
  end;

  begin
    perform public.claim_jobs('visitor', 1, interval '1 minute');
    claim_err := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege then claim_err := 'blocked';
    when others then claim_err := 'blocked (' || sqlstate || ')';
  end;

  perform set_config('role', current_setting('jb.owner_role'), true);

  insert into job_res (step, expected, actual, pass) values
    ('a visitor cannot read the queue',    'blocked', read_err,  read_err like 'blocked%'),
    ('a visitor cannot enqueue',           'blocked', enq_err,   enq_err like 'blocked%'),
    ('a visitor cannot claim',             'blocked', claim_err, claim_err like 'blocked%');
end $$;


-- ── 16. Deleting a site takes its queue with it ─────────────────────────────
--
-- Which is why `jobs` is NOT in TENANT_TABLES in app/actions/sites.ts, and why
-- service_role needs no DELETE on it.

do $$
declare
  v_t uuid;
  n   int;
begin
  insert into tenants (name, domain) values ('Queue cascade test', 'queue-cascade.invalid')
  returning id into v_t;

  insert into jobs (tenant_id, kind) values (v_t, 'photo.derivatives'), (v_t, 'photo.derivatives');
  delete from tenants where id = v_t;
  select count(*) into n from jobs where tenant_id = v_t;

  insert into job_res (step, expected, actual, pass) values
    ('deleting a site removes its queue', '0', n || '', n = 0);
end $$;


-- ── Report, and undo everything ─────────────────────────────────────────────

do $$
declare
  report text;
  failed int;
begin
  select string_agg(
           format('%s  %-44s expected %-16s got %s',
                  -- COALESCE, because a comparison against a null is neither
                  -- true nor false. `v_out.status = 'done'` where nothing came
                  -- back is UNKNOWN, and an unknown result printed as FAIL but
                  -- counted as neither is a report that disagrees with itself —
                  -- which is how 4 failures were once summarised as 2.
                  case when coalesce(pass, false) then '  ok  ' else ' FAIL ' end,
                  step, expected, actual),
           E'\n' order by ord)
    into report
    from job_res;

  select count(*) into failed from job_res where not coalesce(pass, false);

  raise exception E'\n\n%\n\n%\n\nNothing was kept — this transaction always rolls back.\n',
    report,
    case
      when failed = 0 then 'All checks passed.'
      else format('%s check(s) failed. The queue is NOT safe to run.', failed)
    end;
end $$;

rollback;
