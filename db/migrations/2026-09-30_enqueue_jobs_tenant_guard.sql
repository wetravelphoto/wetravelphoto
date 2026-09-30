-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-30 — S3 HOTFIX: enqueue_jobs refuses a caller with no profile
--
-- The deployed enqueue_jobs (db/migrations/2026-09-29_jobs.sql, Supabase
-- 20260929212635) guards the site with
--
--     if not (p_tenant = public.current_tenant_id() or public.is_platform_admin()) then
--       raise exception 'That is not your site.' using errcode = '42501';
--
-- SQL is three-valued. For a signed-in account that has NO profiles row,
-- current_tenant_id() is NULL and is_platform_admin() is false, so the
-- predicate is NULL, `not NULL` is NULL, and the IF does not raise. Such an
-- account — `authenticated` holds EXECUTE on this function — could queue work
-- on any site. Found by P2's suite (db/verify-photo-ingest.sql tests the same
-- shape), measured against the fixture, and confirmed against production.
--
-- THE ONLY CHANGE is that one condition, now written
--
--     if (p_tenant = public.current_tenant_id() or public.is_platform_admin()) is not true then
--
-- which refuses NULL as well as false. Everything else below is copied
-- verbatim from db/migrations/2026-09-29_jobs.sql by a script that refused to
-- run unless the guard line appeared exactly once: the same signature, return
-- type, SECURITY DEFINER, `search_path = ''`, allow-list, payload validation,
-- ownership check, batch cap and insert. `create or replace` keeps the
-- function's owner, comment and EXECUTE grants; they are restated at the end
-- anyway — identical to the deployed set — so this file states its own
-- privileges rather than relying on what was there.
--
-- Deliberately NOT bundled into the P2 migration: a security fix to a
-- deployed function deserves its own review, its own version, and its own
-- rollback.
--
-- Safe to run twice. db/verify-jobs.sql proves the gate, including the case
-- this fixes.
-- ════════════════════════════════════════════════════════════════════════════

begin;

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
  --
  -- 2026-09-30 HOTFIX: `(…) is not true`, not `not (…)`. For a signed-in
  -- caller with NO profiles row, current_tenant_id() is NULL, so the
  -- comparison is NULL, `NULL or false` is NULL, and `if not (NULL)` did
  -- not raise — the gate silently let them through. `is not true` refuses
  -- NULL as well as false. This line is the whole of the hotfix.
  if (p_tenant = public.current_tenant_id() or public.is_platform_admin()) is not true then
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

-- The deployed privilege set, restated: revoke first, then the one grant.
revoke all on function public.enqueue_jobs(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_jobs(uuid, text, jsonb) to authenticated;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Re-run the enqueue_jobs definition from db/migrations/2026-09-29_jobs.sql,
-- which restores the previous (NULL-blind) guard. Not recommended.
