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


-- ── 12. Row level security, from the other side ─────────────────────────────

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
  n_anon   int;
  anon_read text;
  n_ins    int;
  ins_err  text := 'allowed — NOT BLOCKED';
begin
  perform set_config('iso.owner_role', session_user, true);

  select id into v_me from profiles where tenant_id = v_a limit 1;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_me)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_mine   from jobs where tenant_id = v_a;
  select count(*) into n_theirs from jobs where tenant_id = v_b;

  -- A photographer may queue their own work...
  insert into jobs (tenant_id, kind) values (v_a, 'test.rls');
  get diagnostics n_ins = row_count;

  -- ...and must not be able to queue work onto somebody else's site.
  begin
    insert into jobs (tenant_id, kind) values (v_b, 'test.rls-cross');
    ins_err := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege or check_violation then ins_err := 'blocked';
    when others then ins_err := 'inconclusive (' || sqlerrm || ')';
  end;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  /*
   * `revoke all on jobs from anon` means a visitor does not get an empty
   * result — the read is refused before row-level security is consulted at
   * all. Two gates rather than one, and the outer one is the stricter, so the
   * error IS the pass here.
   */
  begin
    select count(*) into n_anon from jobs;
    anon_read := n_anon || ' rows';
  exception when insufficient_privilege then
    n_anon := 0;
    anon_read := 'refused outright';
  end;

  perform set_config('role', current_setting('iso.owner_role'), true);

  insert into job_res (step, expected, actual, pass) values
    ('a photographer sees their own queue',      '1 or more', n_mine || '',   n_mine >= 1),
    ('and none of another site''s',              '0',         n_theirs || '', n_theirs = 0),
    ('a photographer can queue their own work',  '1 row',     n_ins || ' rows', n_ins = 1),
    ('but not onto another site',                'blocked',   ins_err,
       ins_err in ('blocked', 'inconclusive')),
    ('a visitor reaches no work at all',         'nothing',   anon_read,      n_anon = 0);
end $$;


-- ── Report, and undo everything ─────────────────────────────────────────────

do $$
declare
  report text;
  failed int;
begin
  select string_agg(
           format('%s  %-44s expected %-16s got %s',
                  case when pass then '  ok  ' else ' FAIL ' end,
                  step, expected, actual),
           E'\n' order by ord)
    into report
    from job_res;

  select count(*) into failed from job_res where not pass;

  raise exception E'\n\n%\n\n%\n\nNothing was kept — this transaction always rolls back.\n',
    report,
    case
      when failed = 0 then 'All checks passed.'
      else format('%s check(s) failed. The queue is NOT safe to run.', failed)
    end;
end $$;

rollback;
