-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-29 — Work that does not fit in a request
--
-- Three things in this codebase already want a queue and each invented its own
-- half of one:
--
--   · backfillDerivatives runs in a `do…while` loop IN THE BROWSER. Closing the
--     tab stops it. Nothing remembers where it got to, nothing retries a
--     photograph that failed, and a photograph that fails every time is
--     invisible.
--   · the newsletter sync makes up to 300 serial HTTP calls inside one server
--     action.
--   · the Instagram refresh loops every site inside one cron request.
--
-- This is the one queue. It is a table rather than a service on purpose: the
-- database is already here, already backed up, already scoped by site, and a
-- second system to run and pay for is not yet earning its keep. If the day
-- comes when it is, the interface to replace is `claim_jobs` and `finish_job`.
--
-- ── THE FOUR THINGS THAT MAKE IT SAFE ───────────────────────────────────────
--
-- 1. ONE WORKER PER JOB. `claim_jobs` selects `for update skip locked`, so two
--    drains running on two Vercel instances at the same moment take different
--    rows rather than the same one. The lock is a row lock in Postgres, not a
--    flag in a process's memory — there is no shared memory between two Vercel
--    invocations, so anything in-process would be no lock at all.
--
-- 2. ATTEMPTS ARE COUNTED WHEN A JOB IS CLAIMED, not when it fails. A worker
--    killed mid-job — a function timeout, an instance recycled — never gets to
--    write "that failed". If the count lived in the failure path, a job that
--    kills its worker every time would be retried for ever. Counting at claim
--    time is the only count that survives a hard kill, so a crash loop always
--    terminates.
--
-- 3. A LEASE, NOT A LOCK. A claimed job is `running` until `lease_until`. Past
--    that it is claimable again, so a worker that never came back cannot leave
--    a job stuck for ever — the recovery is the ordinary claim query, not a
--    second mechanism that has to be scheduled and can itself fail. The lease
--    is deliberately longer than the platform's own function timeout, so a
--    worker that is merely slow is never overtaken by a second one.
--
-- 4. FINISHING REQUIRES STILL HOLDING THE LEASE. `finish_job` matches on
--    `locked_by`. A worker that stalled past its lease, had its job taken by
--    somebody else, and then woke up cannot overwrite the new holder's result.
--    It gets zero rows back and says so.
--
-- ── Tenancy from the first row ──────────────────────────────────────────────
-- `tenant_id` is NOT NULL with NO DEFAULT, the rule 2026-09-24_no_guessing
-- established: a forgotten tenant is a hard error rather than a silent write
-- into the oldest site. `apply_tenant_policy` means a photographer can only
-- ever see and enqueue their own work, enforced by the database — the drain
-- runs as the service role and passes the tenant explicitly.
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists jobs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,

  -- What to do. Matched against the handler registry in lib/jobs/handlers.ts;
  -- a kind with no handler fails PERMANENTLY rather than retrying, because a
  -- typo does not get better on the fifth attempt.
  kind         text not null,

  -- What to do it to. Small and specific — an id, not a batch — so a failure
  -- isolates one thing and a retry repeats exactly that thing.
  payload      jsonb not null default '{}'::jsonb,

  /*
   * ENQUEUEING THE SAME WORK TWICE IS A NO-OP.
   *
   * Pressing "Process photographs" twice must not queue every photograph
   * twice. The partial unique index below covers only jobs that have not
   * finished, so the same key can be queued again later — which is what makes
   * "re-run this" work without a second table of what has been run.
   *
   * Null means "do not deduplicate this one". A compound unique index over a
   * nullable column does not constrain (NULLS DISTINCT), which here is the
   * behaviour we want rather than a trap — but it is the reason the index is
   * spelled out with its own `where` clause rather than declared as a table
   * constraint.
   */
  dedupe_key   text,

  status       text not null default 'queued'
               check (status in ('queued', 'running', 'done', 'failed')),

  -- Incremented BY THE CLAIM. See note 2 at the top.
  attempts     integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts >= 1),

  -- Not before this. Backoff moves it forward; a job queued for later sets it.
  run_after    timestamptz not null default now(),

  -- Who holds it and until when. Both null unless `status = 'running'`.
  locked_at    timestamptz,
  locked_by    text,
  lease_until  timestamptz,

  -- The last thing that went wrong, kept on a job that later succeeded too —
  -- "it worked on the third try" is worth being able to see.
  last_error   text,

  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

-- The claim query's index. Partial, because `done` and `failed` rows
-- accumulate and none of them is ever a candidate.
create index if not exists jobs_ready
  on jobs (run_after)
  where status = 'queued';

-- The other half of the claim query: leases that have run out.
create index if not exists jobs_stale
  on jobs (lease_until)
  where status = 'running';

-- "How is my backfill going" — counts per site, for the admin.
create index if not exists jobs_tenant_status
  on jobs (tenant_id, status, created_at desc);

create unique index if not exists jobs_pending_dedupe
  on jobs (tenant_id, kind, dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');

select public.apply_tenant_policy('jobs');

-- A visitor has no business knowing work exists. A photographer may read their
-- own queue (the admin shows what is waiting and what failed) and enqueue into
-- it; RLS narrows both to their own site. Nobody but the worker may change a
-- job, and the worker is the service role, which is not in this list at all —
-- it reaches the table through the two functions below.
revoke all on jobs from anon;
grant select, insert on jobs to authenticated;


-- ── Claiming ────────────────────────────────────────────────────────────────
--
-- SECURITY INVOKER on purpose. The only caller is the service role, which
-- already bypasses row-level security, so DEFINER would hand out rights nobody
-- needs — and a definer function that anybody could execute would be a way to
-- reach every site's queue. Execute is granted to service_role alone.
--
-- `p_tenant` narrows it to one site: the nightly cron passes null and drains
-- everybody, while the "Process photographs" button passes the tenant from the
-- signed-in session and can only ever spend time on its own work.

create or replace function public.claim_jobs(
  p_worker text,
  p_limit  int      default 1,
  p_lease  interval default interval '10 minutes',
  p_tenant uuid     default null
)
returns setof jobs
language plpgsql
volatile
as $$
begin
  /*
   * FIRST, RETIRE THE CRASH LOOPS.
   *
   * A job whose lease has run out is claimable again — but if it has already
   * used every attempt, claiming it again would start the loop over. This is
   * where "the worker never came back" becomes a visible terminal failure
   * instead of an endless one, and it runs before the claim so that a job in
   * this state can never be picked up.
   */
  update jobs
     set status      = 'failed',
         finished_at = now(),
         lease_until = null,
         last_error  = coalesce(last_error || ' / ', '')
                       || 'the worker did not report back'
   where status = 'running'
     and lease_until < now()
     and attempts >= max_attempts
     and (p_tenant is null or tenant_id = p_tenant);

  return query
  update jobs j
     set status      = 'running',
         attempts    = j.attempts + 1,
         locked_at   = now(),
         locked_by   = p_worker,
         lease_until = now() + p_lease
   where j.id in (
     /*
      * `for update skip locked` is the whole concurrency story. Two workers
      * running this at the same instant each lock a different set of rows and
      * neither waits for the other; a row already locked is passed over rather
      * than queued behind. Without `skip locked` the second worker would block
      * and then claim the SAME rows the first had just taken.
      */
     select c.id
       from jobs c
      where (p_tenant is null or c.tenant_id = p_tenant)
        and (
              (c.status = 'queued'  and c.run_after <= now())
           or (c.status = 'running' and c.lease_until < now())
        )
      order by c.run_after, c.created_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end $$;

comment on function public.claim_jobs(text, int, interval, uuid) is
  'Takes up to p_limit jobs for p_worker, counting the attempt as it goes. '
  'Also reclaims jobs whose lease ran out, and fails the ones that have no '
  'attempts left. The only way a worker should reach the jobs table.';


-- ── Finishing ───────────────────────────────────────────────────────────────

create or replace function public.finish_job(
  p_id        uuid,
  p_worker    text,
  p_error     text    default null,
  p_permanent boolean default false
)
returns jobs
language plpgsql
volatile
as $$
declare
  v_job   jobs;
  v_delay interval;
begin
  -- Still holding the lease? See note 4 at the top. A worker that lost its job
  -- to a reclaim gets nothing back and must not pretend otherwise.
  select * into v_job from jobs
   where id = p_id and locked_by = p_worker and status = 'running'
   for update;

  if not found then
    return null;
  end if;

  if p_error is null then
    update jobs
       set status = 'done', finished_at = now(),
           lease_until = null, locked_by = null
     where id = p_id
     returning * into v_job;
    return v_job;
  end if;

  /*
   * OUT OF ATTEMPTS — OR NOT WORTH ANY.
   *
   * `p_permanent` is for a failure repeating cannot fix: a job kind with no
   * handler, a payload that names a photograph that no longer exists. Five
   * attempts at a spelling mistake is five times the noise and none of the
   * information.
   */
  if p_permanent or v_job.attempts >= v_job.max_attempts then
    update jobs
       set status = 'failed', finished_at = now(),
           lease_until = null, locked_by = null, last_error = p_error
     where id = p_id
     returning * into v_job;
    return v_job;
  end if;

  /*
   * BACKOFF, WITH JITTER.
   *
   * 10s, 40s, 160s, 640s, then capped at an hour — quadratic rather than
   * doubling, because the failures this is for (a rate limit, a service
   * having a bad minute) are not fixed by trying again in eleven seconds.
   * The ±25% jitter matters once there is more than one job: a hundred jobs
   * that all failed against the same outage would otherwise all come back at
   * the same instant and reproduce it.
   */
  v_delay := least(
    interval '1 hour',
    interval '10 seconds' * power(4, greatest(v_job.attempts - 1, 0)) * (0.75 + random() * 0.5)
  );

  update jobs
     set status = 'queued', run_after = now() + v_delay,
         lease_until = null, locked_by = null, last_error = p_error
   where id = p_id
   returning * into v_job;

  return v_job;
end $$;

comment on function public.finish_job(uuid, text, text, boolean) is
  'Marks a job done, or re-queues it with backoff, or fails it when the '
  'attempts are spent. Returns null if the caller no longer holds the lease.';

revoke all on function public.claim_jobs(text, int, interval, uuid) from public, anon, authenticated;
revoke all on function public.finish_job(uuid, text, text, boolean)  from public, anon, authenticated;
grant execute on function public.claim_jobs(text, int, interval, uuid) to service_role;
grant execute on function public.finish_job(uuid, text, text, boolean)  to service_role;

commit;
