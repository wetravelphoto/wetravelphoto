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
-- comes when it is, the interface to replace is the three functions below.
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
-- ── NOBODY WRITES TO THIS TABLE DIRECTLY ────────────────────────────────────
--
-- The queue's own columns are its integrity. `status`, `attempts`,
-- `max_attempts`, `run_after`, `locked_by`, `lease_until` and `finished_at`
-- are the machinery of notes 1 to 4, and a caller who can choose them can turn
-- all four off: enqueue a row already `running` with a lease into next year and
-- it is never picked up and never fails; enqueue one with `max_attempts` at a
-- million and a crash loop runs for ever; write `locked_by` and take a job
-- another worker holds.
--
-- Row-level security does not help with any of that. It decides WHICH ROWS a
-- caller may touch, not WHAT THEY MAY PUT IN THEM — a policy of
-- `tenant_id = current_tenant_id()` is perfectly satisfied by a malformed job
-- on your own site.
--
-- So the table grants no INSERT, UPDATE or DELETE to anybody. Three functions
-- are the whole interface, and each is SECURITY DEFINER so that it, and not
-- the caller, holds the rights to the table:
--
--   · enqueue_jobs — for a signed-in photographer. Names four columns and
--     leaves the other eleven to their defaults, so the machinery cannot be
--     dictated. Checks the site the same way the table's policy would.
--   · claim_jobs, finish_job — for the worker. Granted to service_role alone.
--
-- ── Why SECURITY DEFINER, and not INVOKER plus a grant ──────────────────────
--
-- The first draft of this migration made the two worker functions INVOKER and
-- granted nothing to service_role, on the assumption that Supabase's default
-- privileges would have given it what it needed. Checked instead of assumed:
--
--     select grantee, privilege_type from information_schema.role_table_grants
--      where table_name = 'jobs';
--     → authenticated: INSERT, SELECT.  postgres: ALL.  service_role: NOTHING.
--
-- The drain would have failed in production with "permission denied for table
-- jobs", or worked only by accident on a default this file never stated. The
-- same check found the other half of it: a `grant` is additive, so
-- `grant select, insert to authenticated` on a database whose default
-- privileges hand out ALL would have left `authenticated` holding UPDATE and
-- DELETE as well, with nothing here saying so.
--
-- Both are fixed the same way, and it is the reason the grants below start by
-- revoking: this file states the whole privilege set rather than adding to
-- whatever was already there. Run it against a database with Supabase's
-- default privileges or against one with none, and the result is the same.
--
-- DEFINER also makes the worker's rights exactly its job. service_role gets
-- EXECUTE on two functions and nothing else: it cannot read the queue, cannot
-- empty it, and cannot finish a job it does not hold. Every DEFINER function
-- here sets `search_path = public`, which is what stops a caller redirecting
-- the names inside it.
--
-- ── Tenancy from the first row ──────────────────────────────────────────────
--
-- `tenant_id` is NOT NULL with NO DEFAULT, the rule 2026-09-24_no_guessing
-- established: a forgotten tenant is a hard error rather than a silent write
-- into the oldest site. `apply_tenant_policy` governs what a photographer can
-- READ. What they can QUEUE is governed by `enqueue_jobs`, which restates the
-- same rule — because a definer function runs as the table's owner and is
-- therefore not subject to the policy at all.
--
-- Nothing deletes jobs. `tenant_id references tenants(id) on delete cascade`
-- means deleting a site takes its queue with it, which is why `jobs` is not in
-- `TENANT_TABLES` in app/actions/sites.ts and why service_role needs no DELETE.
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists jobs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,

  -- What to do. Allow-listed by `enqueue_jobs` and matched against the handler
  -- registry in lib/jobs/handlers.ts; a kind with no handler fails PERMANENTLY
  -- rather than retrying, because a typo does not get better on the fifth
  -- attempt. The column is `text` rather than an enum so that a deploy which
  -- retires a kind does not make rows already in the table unreadable.
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
  dedupe_key   text check (dedupe_key is null or length(dedupe_key) <= 200),

  status       text not null default 'queued'
               check (status in ('queued', 'running', 'done', 'failed')),

  -- Incremented BY THE CLAIM. See note 2 at the top.
  attempts     integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),

  -- Not before this. Backoff moves it forward.
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

-- A PAYLOAD IS AN OBJECT, and this is a constraint rather than a line in
-- enqueue_jobs so that it holds for every writer — the worker, a future
-- function, and anything that reaches the table by a route nobody has thought
-- of yet. A constraint is the only rule that cannot be gone round. Stated as
-- its own statement rather than inline in the table, because `create table if
-- not exists` skips the whole definition on a re-run and this file has to be
-- safe to run twice.
alter table jobs drop constraint if exists jobs_payload_object;
alter table jobs add  constraint jobs_payload_object
  check (jsonb_typeof(payload) = 'object');

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


-- ── Grants: the whole privilege set, stated ─────────────────────────────────
--
-- Revoke first. See the long note at the top: a `grant` is additive, and this
-- file must produce the same result on a database whose default privileges
-- hand out ALL to anon, authenticated and service_role as on one that hands
-- out nothing.

revoke all on table jobs from public;
revoke all on table jobs from anon;
revoke all on table jobs from authenticated;
revoke all on table jobs from service_role;

-- A photographer may LOOK at their own queue — the admin shows what is waiting
-- and what gave up — and the table's policy narrows that to their own site, so
-- the read is scoped by the database rather than by the code that asks. They
-- may not write to it by any route but `enqueue_jobs`.
grant select on table jobs to authenticated;

-- A visitor has no business knowing work exists, and the worker reaches the
-- table only through its two functions. Neither gets a table privilege here,
-- and that is the whole point rather than an omission.



-- ── Enqueueing: the only way a photographer adds work ───────────────────────
--
-- ── WHY `search_path = ''` AND NOT `= public` ───────────────────────────────
--
-- All three functions here are SECURITY DEFINER, so they run with the table
-- owner's rights. `set search_path = public` pins the schema and stops a
-- caller pointing `jobs` at a table of their own — but it leaves `public`
-- itself as an unqualified namespace the function trusts, and anyone able to
-- create an object there could shadow a name these bodies use. An empty search
-- path removes the question: nothing resolves unqualified, so every relation
-- and every application function below is written out in full.
--
-- `pg_catalog` is the one exception, and it is PostgreSQL's rather than ours:
-- it is always searched implicitly, ahead of anything in `search_path`, unless
-- it is named explicitly somewhere in it. So `now()`, `count()`, `coalesce`,
-- `least`, `power`, `random`, `jsonb_typeof`, `jsonb_array_elements`, the
-- regex and jsonb operators, and every built-in type name still resolve.
-- Nothing of ours does, which is the point — including the COMPOSITE TYPE of
-- our own table, hence `public.jobs` in the return types and the declarations.

create or replace function public.enqueue_jobs(
  p_tenant uuid,
  p_kind   text,
  p_items  jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Deliberately small. A photographer's library is a few hundred
  -- photographs, and the trusted caller (lib/jobs/queue.ts) splits anything
  -- longer into runs of this size. The bound is here rather than only there
  -- because `enqueue_jobs` is reachable from a browser: without it, one
  -- request could hand PostgREST a JSON array of any length and make the
  -- database walk all of it.
  c_max_items constant int := 200;

  v_ids       uuid[];
  v_requested int;
  v_owned     int;
  v_bad_item  int;
  v_bad_keys  int;
  v_bad_id    int;
  n           int;
begin
  if p_tenant is null then
    raise exception 'A job has to say which site it is for.' using errcode = '23502';
  end if;

  /*
   * THE SAME RULE THE TABLE'S OWN POLICY STATES, RESTATED.
   *
   * Not a belt-and-braces duplicate: a SECURITY DEFINER function runs with the
   * table owner's rights and row-level security does not apply to it at all.
   * Without this line the function would be a way for any signed-in account to
   * queue work onto any site on the platform — a bigger hole than the direct
   * INSERT grant it replaces.
   *
   * `is_platform_admin()` is here because an admin working on somebody else's
   * address legitimately acts as that site (lib/auth.ts: "you edit the site you
   * are on"), and for them `current_tenant_id()` is their OWN profile's tenant,
   * not the one on screen. Deriving the tenant here instead of accepting it
   * would therefore file an admin's work under the wrong site.
   */
  if not (p_tenant = public.current_tenant_id() or public.is_platform_admin()) then
    raise exception 'That is not your site.' using errcode = '42501';
  end if;

  /*
   * AN ALLOW-LIST, IN SQL, ON PURPOSE.
   *
   * lib/jobs/types.ts has the same list, and .mk/jobs.ts asserts the two agree
   * — but the TypeScript one is a convenience for the caller and this one is
   * the boundary. Allowing a new kind of work to be queued by a browser is
   * exactly the sort of change that should cost a migration somebody reads,
   * rather than a line in a file that ships with the front end.
   */
  if p_kind is null or p_kind not in ('photo.derivatives') then
    raise exception 'There is no job kind called "%".', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'The work has to arrive as a list.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > c_max_items then
    raise exception 'A queue request carries at most % jobs; that one had %.',
      c_max_items, jsonb_array_length(p_items) using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) = 0 then
    return 0;
  end if;

  /*
   * ── THE RESOURCE, NOT ONLY THE SITE ───────────────────────────────────────
   *
   * Checking the tenant and the kind leaves the interesting half open: a
   * photographer calling this function by hand could queue a thousand jobs on
   * their own site pointing at photographs that are not theirs, or at ids that
   * are not photographs at all. The handler would refuse them one by one —
   * lib/jobs/derive.ts reads the photograph WITH its tenant and treats a miss
   * as permanent — but "the worker declines it later" is a different thing
   * from "it never entered the queue", and only one of them is a boundary.
   *
   * So for this kind the payload is CONSTRUCTED here rather than copied:
   * everything the caller sends is reduced to a list of photograph ids, each
   * checked for shape and for ownership, and the row that lands carries
   * `{"photoId": "<that id>"}` and nothing else. A payload built by the
   * database cannot carry anything the database did not put in it.
   *
   * ── The shape a caller may send ───────────────────────────────────────────
   *
   *   [ { "payload": { "photoId": "<uuid>" } }, … ]
   *
   * Exactly one key inside `payload`. An extra key is refused rather than
   * dropped: a hint somebody adds and never sees stored is worse than an error
   * on the line that added it.
   *
   * ── And the dedupe key is NOT the caller's to choose ──────────────────────
   *
   * It is the photograph's id, derived from the id that was just validated.
   * A caller-supplied key could disagree with the resource — two jobs on one
   * photograph under different keys, or one key blocking a different
   * photograph's work — which makes "the same work is not queued twice" a
   * promise about a string the caller picked rather than about the work.
   */
  if p_kind <> 'photo.derivatives' then
    -- Unreachable while the allow-list above holds one member. Here so that
    -- widening that list without also writing a validation rule fails loudly
    -- at the boundary rather than queueing an unchecked payload.
    raise exception 'No validation rule for job kind "%".', p_kind using errcode = '22023';
  end if;

  -- Shape, in one pass. Counted rather than short-circuited so the message can
  -- say WHICH thing was wrong across the whole batch; the two later filters
  -- both guard on the payload being an object, so a malformed item is reported
  -- once rather than three times.
  select
    count(*) filter (
      where jsonb_typeof(item) <> 'object'
         or jsonb_typeof(item -> 'payload') <> 'object'
         -- `payload` and nothing beside it. An item carrying its own
         -- `dedupe_key`, `status` or `run_after` is refused rather than
         -- ignored: a caller who thinks they set one should find out here.
         or (select count(*) from jsonb_object_keys(item)) <> 1),
    count(*) filter (
      where jsonb_typeof(item -> 'payload') = 'object'
        and (select count(*) from jsonb_object_keys(item -> 'payload')) <> 1),
    count(*) filter (
      where jsonb_typeof(item -> 'payload') = 'object'
        and coalesce(item -> 'payload' ->> 'photoId', '') !~
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    into v_bad_item, v_bad_keys, v_bad_id
    from jsonb_array_elements(p_items) as item;

  if v_bad_item > 0 then
    raise exception
      'Each piece of work is an object holding a payload and nothing else (% was not).',
      v_bad_item
      using errcode = '22023';
  end if;

  if v_bad_keys > 0 then
    -- Refused rather than dropped: a key somebody adds and never sees stored
    -- is worse than an error on the line that added it.
    raise exception
      'A photo.derivatives payload holds photoId and nothing else (% did not).', v_bad_keys
      using errcode = '22023';
  end if;

  if v_bad_id > 0 then
    raise exception 'That is not a photograph id (% of them were not).', v_bad_id
      using errcode = '22023';
  end if;

  select array_agg(distinct (item -> 'payload' ->> 'photoId')::uuid)
    into v_ids
    from jsonb_array_elements(p_items) as item;

  v_requested := coalesce(array_length(v_ids, 1), 0);

  /*
   * OWNERSHIP, ASKED OF THE DATABASE.
   *
   * Read as the function's owner, so row-level security is not what decides
   * it — the comparison is explicit. One count out, no rows: a caller learns
   * only that at least one id in their list is not a photograph of theirs, and
   * "does not exist" and "belongs to somebody else" give the same answer, so
   * this cannot be used to ask whether a given id exists on another site.
   */
  select count(*)
    into v_owned
    from public.photos p
   where p.id = any(v_ids)
     and p.tenant_id = p_tenant;

  if v_owned <> v_requested then
    raise exception
      'One or more of those photographs is not in this site''s library.'
      using errcode = '42501';
  end if;

  /*
   * FOUR COLUMNS NAMED, ELEVEN LEFT TO THEIR DEFAULTS.
   *
   * This is where the integrity lives, and it lives in what is ABSENT from the
   * column list. `status` is 'queued', `attempts` is 0, `max_attempts` is 5,
   * `run_after` is now(), and `locked_at`, `locked_by`, `lease_until`,
   * `last_error` and `finished_at` are null — none of them reachable by the
   * caller, because none of them is written here at all.
   */
  insert into public.jobs (tenant_id, kind, payload, dedupe_key)
  select p_tenant, p_kind, jsonb_build_object('photoId', id::text), id::text
    from unnest(v_ids) as id
  on conflict do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.enqueue_jobs(uuid, text, jsonb) is
  'The only way work is added. Validates the site, the kind AND the resource '
  'the payload names, then BUILDS the payload and the dedupe key from what it '
  'validated rather than copying what it was sent. Names four columns and '
  'leaves the machinery — status, attempts, the lock and the lease — to its '
  'defaults, so a caller cannot enqueue a job that is already running, already '
  'out of attempts, or due in a decade.';


-- ── Claiming ────────────────────────────────────────────────────────────────
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
returns setof public.jobs
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_worker is null or length(p_worker) = 0 then
    raise exception 'A worker has to say who it is.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Between one and a hundred jobs at a time.' using errcode = '22023';
  end if;

  /*
   * FIRST, RETIRE THE CRASH LOOPS.
   *
   * A job whose lease has run out is claimable again — but if it has already
   * used every attempt, claiming it again would start the loop over. This is
   * where "the worker never came back" becomes a visible terminal failure
   * instead of an endless one, and it runs before the claim so that a job in
   * this state can never be picked up.
   */
  update public.jobs
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
  update public.jobs j
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
       from public.jobs c
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
  'attempts left. The only way a worker reaches the jobs table.';


-- ── Finishing ───────────────────────────────────────────────────────────────

create or replace function public.finish_job(
  p_id        uuid,
  p_worker    text,
  p_error     text    default null,
  p_permanent boolean default false
)
returns public.jobs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job   public.jobs;
  v_delay interval;
begin
  -- Still holding the lease? See note 4 at the top. A worker that lost its job
  -- to a reclaim gets nothing back and must not pretend otherwise.
  select * into v_job from public.jobs
   where id = p_id and locked_by = p_worker and status = 'running'
   for update;

  if not found then
    return null;
  end if;

  if p_error is null then
    update public.jobs
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
    update public.jobs
       set status = 'failed', finished_at = now(),
           lease_until = null, locked_by = null, last_error = p_error
     where id = p_id
     returning * into v_job;
    return v_job;
  end if;

  /*
   * EXPONENTIAL BACKOFF, FACTOR OF 4, WITH JITTER.
   *
   * 10s, 40s, 160s, 640s, then capped at an hour — each wait four times the
   * one before it rather than twice, because the failures this is for (a rate
   * limit, a service having a bad minute) are not fixed by trying again in
   * eleven seconds. The ±25% jitter matters once there is more than one job: a
   * hundred jobs that all failed against the same outage would otherwise all
   * come back at the same instant and reproduce it.
   */
  v_delay := least(
    interval '1 hour',
    interval '10 seconds' * power(4, greatest(v_job.attempts - 1, 0)) * (0.75 + random() * 0.5)
  );

  update public.jobs
     set status = 'queued', run_after = now() + v_delay,
         lease_until = null, locked_by = null, last_error = p_error
   where id = p_id
   returning * into v_job;

  return v_job;
end $$;

comment on function public.finish_job(uuid, text, text, boolean) is
  'Marks a job done, or re-queues it with exponential backoff, or fails it '
  'when the attempts are spent. Returns null if the caller no longer holds '
  'the lease.';


-- ── Function grants, stated the same way as the table's ─────────────────────

revoke all on function public.enqueue_jobs(uuid, text, jsonb)            from public, anon, authenticated, service_role;
revoke all on function public.claim_jobs(text, int, interval, uuid)      from public, anon, authenticated, service_role;
revoke all on function public.finish_job(uuid, text, text, boolean)      from public, anon, authenticated, service_role;

-- The photographer's door. Runs as the owner, so the checks inside it are what
-- stands between a signed-in account and another site's queue.
grant execute on function public.enqueue_jobs(uuid, text, jsonb) to authenticated;

-- The worker's two. service_role has no privilege on the table itself, so this
-- is the whole of what the drain can do.
grant execute on function public.claim_jobs(text, int, interval, uuid) to service_role;
grant execute on function public.finish_job(uuid, text, text, boolean) to service_role;

commit;
