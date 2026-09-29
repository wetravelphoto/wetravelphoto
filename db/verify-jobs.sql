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


-- ── A CLEAN QUEUE, AND PROOF OF IT ──────────────────────────────────────────
--
-- Every count in this file is taken over `jobs`, and several blocks call
-- `claim_jobs` without naming a site — so one committed row left behind by
-- anything else makes the whole suite report nonsense. It used to rely on the
-- database happening to be tidy, and that failed the first time a stray row
-- from another harness was committed: block 1's "a job that is not due yet is
-- left alone" reported `6 claimed`.
--
-- Inside the transaction that always rolls back, so it destroys nothing that
-- outlives the run.

delete from jobs;

/*
 * AND THE PLANNER IS TOLD THE TABLE IS EMPTY, WHICH IS THE DANGEROUS CASE.
 *
 * Not housekeeping — it is what makes block 1b deterministic. The over-claim
 * bug it guards against is PLAN-DEPENDENT: the `where id in (select … limit N
 * for update skip locked)` form only over-claims when the planner puts that
 * subquery on the inner side of a Nested Loop Semi Join, which it does when it
 * believes the table is small. Measured against the buggy form:
 *
 *     stats say the table is empty  → p_limit 1 claimed 5
 *     stats say it holds 500 rows   → p_limit 1 claimed 1
 *
 * So without this line the assertion below passes against the bug about half
 * the time, which is worse than not having it. Empty is also the honest case:
 * a queue that is keeping up is a queue with almost nothing in it.
 *
 * Rolled back with everything else, so production statistics are untouched.
 */
analyze jobs;

do $$
declare n int;
begin
  select count(*) into n from jobs;
  insert into job_res (step, expected, actual, pass) values
    ('the queue starts empty', '0 rows', n || ' rows', n = 0);
end $$;


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


-- ── 1b. p_limit MEANS AT MOST p_limit ───────────────────────────────────────
--
-- The assertion that would have caught the bug this file's sibling suites found
-- by accident, and the reason `claim_jobs` uses a CTE rather than
-- `where id in (select … limit N for update skip locked)`.
--
-- That form reads as "take at most N" and is not what it does: the planner puts
-- the LIMIT/LockRows subquery on the inner side of a Nested Loop Semi Join, so
-- it is re-executed once per candidate row and `skip locked` hands back a new
-- row each time. One call with `p_limit => 1` against five queued jobs claimed
-- all five and burned an attempt on each. The drain runs only the first, so the
-- other four sit `running` under a ten-minute lease having never been run —
-- and after five such rounds each is failed as "the worker did not report
-- back".
--
-- Deterministic, so this belongs here rather than in a suite that races.

do $$
declare
  v_a    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  n_one  int;
  n_left int;
  n_three int;
  n_left3 int;
  n_burn int;
begin
  -- Its own rows only. Block 1's job is `running` under a live lease and its
  -- other is not due yet, so neither is claimable and neither needs removing —
  -- and removing them would pull the ground from under block 2.
  insert into jobs (tenant_id, kind) select v_a, 'test.limit' from generate_series(1, 5);

  select count(*) into n_one
    from public.claim_jobs('limit-worker', 1, interval '5 minutes', v_a);
  select count(*) into n_left from jobs
   where tenant_id = v_a and kind = 'test.limit' and status = 'queued';

  select count(*) into n_three
    from public.claim_jobs('limit-worker-2', 3, interval '5 minutes', v_a);
  select count(*) into n_left3 from jobs
   where tenant_id = v_a and kind = 'test.limit' and status = 'queued';

  -- And nothing that was not claimed had an attempt spent on it.
  select count(*) into n_burn
    from jobs
   where tenant_id = v_a and kind = 'test.limit' and status = 'queued' and attempts > 0;

  insert into job_res (step, expected, actual, pass) values
    ('p_limit 1 claims exactly one of five',  '1', n_one || '',   n_one = 1),
    ('and leaves the other four queued',      '4', n_left || '',  n_left = 4),
    ('p_limit 3 claims exactly three',        '3', n_three || '', n_three = 3),
    ('and leaves the last one queued',        '1', n_left3 || '', n_left3 = 1),
    ('a job still queued has no attempt spent on it', '0', n_burn || '', n_burn = 0);

  delete from jobs where tenant_id = v_a and kind = 'test.limit';
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


-- ── 12b. Two real photographs to point jobs at ─────────────────────────────
--
-- `enqueue_jobs` no longer takes a payload on trust: for photo.derivatives it
-- checks that the id names a photograph OF THIS SITE before anything is
-- queued. So the blocks below need one photograph on each site rather than an
-- invented string.

do $$
declare
  v_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_b uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  v_p uuid;
  v_q uuid;
begin
  select id into v_p from photos where tenant_id = v_a order by id limit 1;

  -- Site two has an album in the fixture but no photographs, so this one is
  -- made here. It goes with the rest of the transaction.
  insert into photos (tenant_id, album_id, storage_path)
  select v_b, a.id, 't/two/photos/x/1/2400.webp'
    from albums a where a.tenant_id = v_b order by a.id limit 1
  returning id into v_q;

  perform set_config('jb.photo',   v_p::text, true);
  perform set_config('jb.photo_b', v_q::text, true);

  insert into job_res (step, expected, actual, pass) values
    ('the fixture has a photograph on each site', 'two ids',
     coalesce(v_p::text, 'none') || ' / ' || coalesce(v_q::text, 'none'),
     v_p is not null and v_q is not null);
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

  -- MAY enqueue, through the one door. `v_photo` is a real photograph of this
  -- site's, set up by the caller of this block.
  select public.enqueue_jobs(v_a, 'photo.derivatives',
           jsonb_build_array(jsonb_build_object(
             'payload', jsonb_build_object('photoId', current_setting('jb.photo'))))) into n;

  -- ...but not onto another site...
  begin
    -- A WELL-FORMED request for another site: the payload names a real
    -- photograph, so the only thing that can refuse this is the site check.
    perform public.enqueue_jobs(v_b, 'photo.derivatives',
      jsonb_build_array(jsonb_build_object(
        'payload', jsonb_build_object('photoId', current_setting('jb.photo_b')))));
    cross_err := 'allowed — NOT BLOCKED';
  exception when others then cross_err := 'blocked (' || sqlstate || ')';
  end;

  -- ...and not a kind the database has not been told about.
  begin
    perform public.enqueue_jobs(v_a, 'shell.exec',
      jsonb_build_array(jsonb_build_object(
        'payload', jsonb_build_object('photoId', current_setting('jb.photo')))));
    kind_err := 'allowed — NOT BLOCKED';
  exception when others then kind_err := 'blocked (' || sqlstate || ')';
  end;

  perform set_config('role', current_setting('jb.owner_role'), true);

  select * into v_job from jobs
   where tenant_id = v_a and dedupe_key = current_setting('jb.photo');

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
    ('the payload is the one the database built', 'the photograph''s id',
       v_job.payload::text,
       v_job.payload = jsonb_build_object('photoId', current_setting('jb.photo'))),
    ('and the dedupe key is that same id, not a caller''s choice',
       'the photograph''s id', coalesce(v_job.dedupe_key, 'null'),
       v_job.dedupe_key = current_setting('jb.photo'));
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


-- ── 17. THE RESOURCE, NOT ONLY THE SITE ────────────────────────────────────
--
-- Blocks 13 to 15 prove that a signed-in account cannot write to the queue by
-- any route but `enqueue_jobs`, and cannot use that function on another site.
-- This is the half that leaves open: what the payload may NAME.
--
-- Without it, a photographer calling the function by hand could queue a
-- thousand jobs on their own site pointing at photographs belonging to
-- somebody else, or at ids that are not photographs at all. The handler would
-- decline them one by one — lib/jobs/derive.ts reads the photograph WITH its
-- tenant and treats a miss as permanent — but "the worker declines it later"
-- is not the same thing as "it never entered the queue", and only one of the
-- two is a boundary.
--
-- Run as the photographer, because that is who would be doing it.

do $$
declare
  v_a       uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_me      uuid;
  v_mine    text := current_setting('jb.photo');
  v_theirs  text := current_setting('jb.photo_b');
  n_ok      int;
  n_same    int;
  n_big     int;
  v_job     jobs;

  e_theirs  text := 'allowed — NOT BLOCKED';
  e_ghost   text := 'allowed — NOT BLOCKED';
  e_junkid  text := 'allowed — NOT BLOCKED';
  e_noid    text := 'allowed — NOT BLOCKED';
  e_nulled  text := 'allowed — NOT BLOCKED';
  e_number  text := 'allowed — NOT BLOCKED';
  e_nopay   text := 'allowed — NOT BLOCKED';
  e_notobj  text := 'allowed — NOT BLOCKED';
  e_extra   text := 'allowed — NOT BLOCKED';
  e_dedupe  text := 'allowed — NOT BLOCKED';
  e_mixed   text := 'allowed — NOT BLOCKED';
  e_over    text := 'allowed — NOT BLOCKED';
  e_over_msg text := '';
begin
  perform set_config('jb.owner_role', session_user, true);
  select id into v_me from profiles where tenant_id = v_a limit 1;

  -- A clean queue for this photograph. Block 13 already put one there, and a
  -- second enqueue of the same work is correctly a no-op — which would make
  -- every count below zero and say nothing about validation.
  delete from jobs where tenant_id = v_a and kind = 'photo.derivatives';

  perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ── It works for a photograph that really is theirs ──────────────────────
  select public.enqueue_jobs(v_a, 'photo.derivatives',
    jsonb_build_array(jsonb_build_object('payload', jsonb_build_object('photoId', v_mine))))
    into n_ok;

  -- ── Somebody else's photograph, queued onto their OWN site ───────────────
  -- The tenant on the job would be right. The photograph would not be.
  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives',
      jsonb_build_array(jsonb_build_object('payload', jsonb_build_object('photoId', v_theirs))));
  exception when others then e_theirs := 'blocked (' || sqlstate || ')';
  end;

  -- ── A well-formed id that is not a photograph at all ─────────────────────
  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives',
      jsonb_build_array(jsonb_build_object('payload',
        jsonb_build_object('photoId', '00000000-0000-0000-0000-000000000000'))));
  exception when others then e_ghost := 'blocked (' || sqlstate || ')';
  end;

  -- ── Malformed identifiers ────────────────────────────────────────────────
  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives',
      jsonb_build_array(jsonb_build_object('payload', jsonb_build_object('photoId', 'not-a-uuid'))));
  exception when others then e_junkid := 'blocked (' || sqlstate || ')';
  end;

  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives',
      jsonb_build_array(jsonb_build_object('payload', jsonb_build_object('nope', v_mine))));
  exception when others then e_noid := 'blocked (' || sqlstate || ')';
  end;

  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives',
      '[{"payload":{"photoId":null}}]'::jsonb);
  exception when others then e_nulled := 'blocked (' || sqlstate || ')';
  end;

  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives',
      '[{"payload":{"photoId":42}}]'::jsonb);
  exception when others then e_number := 'blocked (' || sqlstate || ')';
  end;

  -- ── Malformed items ──────────────────────────────────────────────────────
  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives', '[{}]'::jsonb);
  exception when others then e_nopay := 'blocked (' || sqlstate || ')';
  end;

  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives', '["just a string"]'::jsonb);
  exception when others then e_notobj := 'blocked (' || sqlstate || ')';
  end;

  -- ── An extra key is REFUSED, not dropped ─────────────────────────────────
  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives',
      jsonb_build_array(jsonb_build_object('payload',
        jsonb_build_object('photoId', v_mine, 'quality', 'huge'))));
  exception when others then e_extra := 'blocked (' || sqlstate || ')';
  end;

  -- ── AND THE DEDUPE IDENTITY IS NOT THE CALLER'S TO CHOOSE ────────────────
  -- Sending one at item level used to be how it was set. It is now refused,
  -- so nobody can believe they set one and find the queue disagreeing.
  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives',
      jsonb_build_array(jsonb_build_object(
        'payload', jsonb_build_object('photoId', v_mine),
        'dedupe_key', 'something-else')));
  exception when others then e_dedupe := 'blocked (' || sqlstate || ')';
  end;

  -- ── One bad apple refuses the whole batch ────────────────────────────────
  -- Not "queue the good ones and drop the rest": a partial success that
  -- reports a number is how a caller comes to believe work is waiting when it
  -- is not.
  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives',
      jsonb_build_array(
        jsonb_build_object('payload', jsonb_build_object('photoId', v_mine)),
        jsonb_build_object('payload', jsonb_build_object('photoId', v_theirs))));
  exception when others then e_mixed := 'blocked (' || sqlstate || ')';
  end;

  -- ── The batch bound ──────────────────────────────────────────────────────
  --
  -- 200 of the same photograph: past the bound, through the shape check, and
  -- collapsed to one job by the derived dedupe key. The queue is cleared first
  -- for the same reason as above — the one queued a moment ago would make this
  -- return zero for a reason that has nothing to do with the bound.
  perform set_config('role', current_setting('jb.owner_role'), true);
  delete from jobs where tenant_id = v_a and kind = 'photo.derivatives';
  perform set_config('role', 'authenticated', true);

  select public.enqueue_jobs(v_a, 'photo.derivatives',
    (select jsonb_agg(jsonb_build_object('payload', jsonb_build_object('photoId', v_mine)))
       from generate_series(1, 200)))
    into n_same;

  -- 201 is refused, and refused BEFORE any of the resource work is done.
  begin
    perform public.enqueue_jobs(v_a, 'photo.derivatives',
      (select jsonb_agg(jsonb_build_object('payload', jsonb_build_object('photoId', v_mine)))
         from generate_series(1, 201)));
  exception when others then
    e_over := 'blocked (' || sqlstate || ')';
    e_over_msg := sqlerrm;
  end;

  perform set_config('role', current_setting('jb.owner_role'), true);

  select count(*) into n_big from jobs
   where tenant_id = v_a and kind = 'photo.derivatives' and dedupe_key = v_mine;

  select * into v_job from jobs
   where tenant_id = v_a and kind = 'photo.derivatives' and dedupe_key = v_mine;

  insert into job_res (step, expected, actual, pass) values
    ('a photograph of their own is queued',        '1',       n_ok || '',   n_ok = 1),
    ('another site''s photograph is refused',      'blocked', e_theirs,  e_theirs like 'blocked%'),
    ('an id that is no photograph is refused',     'blocked', e_ghost,   e_ghost like 'blocked%'),
    ('"not-a-uuid" is refused',                    'blocked', e_junkid,  e_junkid like 'blocked%'),
    ('a payload with no photoId is refused',       'blocked', e_noid,    e_noid like 'blocked%'),
    ('a null photoId is refused',                  'blocked', e_nulled,  e_nulled like 'blocked%'),
    ('a numeric photoId is refused',               'blocked', e_number,  e_number like 'blocked%'),
    ('an item with no payload is refused',         'blocked', e_nopay,   e_nopay like 'blocked%'),
    ('an item that is not an object is refused',   'blocked', e_notobj,  e_notobj like 'blocked%'),
    ('an extra payload key is refused, not dropped','blocked', e_extra,  e_extra like 'blocked%'),
    ('a caller-chosen dedupe key is refused',      'blocked', e_dedupe,  e_dedupe like 'blocked%'),
    ('one bad item refuses the whole batch',       'blocked', e_mixed,   e_mixed like 'blocked%'),
    ('200 items are accepted',                     '1 job',   n_same || ' job(s)', n_same = 1),
    ('and collapse to one job per photograph',     '1',       n_big || '',  n_big = 1),
    ('201 items are refused',                      'blocked', e_over,    e_over like 'blocked%'),
    ('and the refusal names the bound',            'says 200',
       left(e_over_msg, 60), e_over_msg like '%200%'),
    ('the stored payload is the database''s own',  'photoId only',
       coalesce(v_job.payload::text, 'no row'),
       v_job.payload = jsonb_build_object('photoId', v_mine)),
    ('and the dedupe key is the photograph',       'the id',
       coalesce(v_job.dedupe_key, 'null'), v_job.dedupe_key = v_mine);
end $$;


-- ── 18. And the worker still runs what came through that door ──────────────

do $$
declare
  v_a    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_job  jobs;
  v_out  jobs;
  v_mine text := current_setting('jb.photo');
begin
  perform set_config('jb.owner_role', session_user, true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);

  select * into v_job from public.claim_jobs('after-hardening', 5, interval '10 minutes', v_a);
  if v_job.id is not null then
    select * into v_out from public.finish_job(v_job.id, 'after-hardening');
  end if;

  perform set_config('role', current_setting('jb.owner_role'), true);

  insert into job_res (step, expected, actual, pass) values
    ('the worker claims a job enqueued through the door', 'a job',
       coalesce(v_job.id::text, 'nothing'), v_job.id is not null),
    ('and the payload reaches it intact', 'photoId',
       coalesce(v_job.payload ->> 'photoId', 'null'), v_job.payload ->> 'photoId' = v_mine),
    ('and it can finish it', 'done',
       coalesce(v_out.status, 'nothing'), v_out.status = 'done');
end $$;


-- ── 19. THE FUNCTIONS DO NOT READ THE CALLER'S search_path ─────────────────
--
-- All three are SECURITY DEFINER with `set search_path = ''`, and every
-- relation and application function in them is written out in full. This is
-- the assertion that says so rather than trusting that it was done everywhere:
-- a decoy schema is put in front of the caller's path holding a `jobs` table
-- and a `current_tenant_id()` of its own, and the functions must reach neither.
--
-- `pg_catalog` is the deliberate exception — PostgreSQL always searches it
-- first unless it is named elsewhere in the path — which is what lets `now()`,
-- `coalesce`, `jsonb_typeof` and the built-in types still resolve inside a
-- function whose search_path is empty.

do $$
declare
  v_a      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_me     uuid;
  v_mine   text := current_setting('jb.photo');
  n_ok     int;
  n_decoy  int;
  n_public int;
  v_job    jobs;
  v_out    jobs;
  v_why    text := '';
begin
  perform set_config('jb.owner_role', session_user, true);
  select id into v_me from profiles where tenant_id = v_a limit 1;

  delete from jobs where tenant_id = v_a and kind = 'photo.derivatives';

  create schema decoy;
  create table decoy.jobs (like public.jobs including defaults);
  -- A tenant nobody owns. If enqueue_jobs resolved this one, its site check
  -- would compare against the wrong answer and refuse a legitimate request.
  create function decoy.current_tenant_id() returns uuid
    language sql immutable as $d$ select '99999999-9999-9999-9999-999999999999'::uuid $d$;
  grant usage on schema decoy to authenticated, service_role;
  grant all on decoy.jobs to authenticated, service_role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);
  perform set_config('role', 'authenticated', true);
  perform set_config('search_path', 'decoy, pg_temp', true);

  /*
   * Caught rather than allowed to abort. Unqualify one name in
   * `enqueue_jobs` — `current_tenant_id()` instead of
   * `public.current_tenant_id()` — and the decoy answers with a tenant nobody
   * owns, so this legitimate request is refused with "That is not your site."
   * A suite that dies at that point reports nothing about the rest.
   */
  begin
    select public.enqueue_jobs(v_a, 'photo.derivatives',
      jsonb_build_array(jsonb_build_object('payload', jsonb_build_object('photoId', v_mine))))
      into n_ok;
  exception when others then
    n_ok := -1;
    v_why := sqlerrm;
  end;

  perform set_config('search_path', 'public', true);
  perform set_config('role', current_setting('jb.owner_role'), true);

  select count(*) into n_decoy  from decoy.jobs;
  select count(*) into n_public from public.jobs
   where tenant_id = v_a and kind = 'photo.derivatives';

  -- And the worker's two, from the same poisoned path.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
  perform set_config('search_path', 'decoy, pg_temp', true);

  begin
    select * into v_job from public.claim_jobs('path-test', 1, interval '5 minutes', v_a);
    if v_job.id is not null then
      select * into v_out from public.finish_job(v_job.id, 'path-test');
    end if;
  exception when others then
    v_why := sqlerrm;
  end;

  perform set_config('search_path', 'public', true);
  perform set_config('role', current_setting('jb.owner_role'), true);

  insert into job_res (step, expected, actual, pass) values
    ('enqueue works with a decoy schema in front', '1',
       case when n_ok = -1 then v_why else n_ok || '' end, n_ok = 1),
    ('and it wrote to public.jobs',                '1', n_public || '', n_public = 1),
    ('not to the decoy table',                     '0', n_decoy || '',  n_decoy = 0),
    ('so it used public.current_tenant_id()',      'yes',
       case when n_ok = 1 then 'yes' else 'no — the decoy answered' end, n_ok = 1),
    ('claim works from the same poisoned path',    'a job',
       coalesce(v_job.id::text, nullif(v_why, ''), 'nothing'), v_job.id is not null),
    ('and finish does too',                        'done',
       coalesce(v_out.status, 'nothing'), v_out.status = 'done');

  drop schema decoy cascade;
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
