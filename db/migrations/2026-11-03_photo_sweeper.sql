-- ════════════════════════════════════════════════════════════════════════════
-- P6 — THE SWEEPER'S PRIVILEGES AND ITS OWN LIFECYCLE COLUMNS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Safe to run twice. Additive: no column is dropped, renamed or repurposed,
-- no policy is replaced, no existing grant is narrowed.
--
-- Why this migration exists, having been told P6 would need none: the first
-- design wrote `photo_assets.deleted_at` from the removal actions and read
-- candidates with the service-role client. Codex's review of 2026-11-03
-- measured the live privileges and both halves were inoperative. P1
-- (`2026-09-29_photo_assets.sql`, lines 354-365) revoked everything from all
-- four roles and granted exactly `select` on both tables to `authenticated`:
--
--     authenticated   select only          -> the clock could not be written
--     service_role    nothing whatsoever   -> candidates could not be read
--
-- BYPASSRLS is not a table privilege. That is the same lesson S3 and S4 each
-- paid for once — "a grant is additive", and "test as the real roles" — and
-- the reason this file states privileges rather than assuming them.
--
-- ── AND WHY THE SWEEPER NOW DISCOVERS ITS OWN WORK ──────────────────────────
--
-- The second finding was the one that changed the design. `deleted_at` is
-- ALREADY a visibility verdict in production: the reader deployed in
-- `2026-10-08_photo_render_record_fix.sql` returns unavailable for any
-- non-null value, and `lib/photos/library.ts` filters on it. So writing it to
-- start a thirty-day clock would have hidden the photograph on the spot — and
-- an asset named only by frozen history was eligible for that marking, which
-- made the sweeper's history-awareness protect the bytes of an image the
-- renderer had already stopped serving. A thirty-day storage grace period
-- that is not a thirty-day no-impact window is not what was reviewed.
--
-- So nothing in a photographer's request writes a lifecycle column any more.
-- The sweeper observes, in its own columns, which nothing else reads:
--
--     unreferenced_since  when it FIRST saw this asset referenced by nothing
--     sweep_checked_at    when it last examined it — forward progress
--     swept_at            its files have been purged
--
-- `deleted_at`, `archived_at` and `original_purged_at` are left exactly as
-- they are, unwritten by this phase. `swept_at` exists because reusing
-- `original_purged_at` to mean "every file purged" was a stretch of what the
-- column says, and a migration was required anyway.
--
-- Discovery rather than marking also catches an asset orphaned by any path —
-- a section edited, a draft discarded, an upload forgotten — and not only by
-- the two removal actions.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. The sweeper's own clock ─────────────────────────────────────────────
--
-- All three nullable with no default: an existing asset has not been examined,
-- which is different from having been examined and found referenced. A default
-- of now() would have claimed 74 assets were all observed unreferenced the
-- moment this ran.

alter table public.photo_assets
  add column if not exists unreferenced_since timestamptz,
  add column if not exists sweep_checked_at   timestamptz,
  add column if not exists swept_at           timestamptz;

comment on column public.photo_assets.unreferenced_since is
  'P6 sweeper: when the sweeper first observed this asset referenced by none of '
  'the ten canonical and history sources. Cleared the moment a reference is seen '
  'again. The grace period is measured from here. Read by the sweeper only — '
  'NOT a visibility flag, unlike deleted_at.';

comment on column public.photo_assets.sweep_checked_at is
  'P6 sweeper: when the sweeper last examined this asset. Oldest-checked first '
  'is what stops a batch of permanently-referenced assets starving every asset '
  'behind them.';

comment on column public.photo_assets.swept_at is
  'P6 sweeper: every file this asset had has been deleted from storage. Set only '
  'after a removal in which the bucket refused nothing.';

-- A sweep cannot have happened before the asset was seen to be unreferenced.
-- Stated as a constraint because the sweeper writes both and a future caller
-- might write one.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'photo_assets_swept_after_unreferenced'
      and conrelid = 'public.photo_assets'::regclass
  ) then
    alter table public.photo_assets
      add constraint photo_assets_swept_after_unreferenced
      check (swept_at is null or unreferenced_since is not null);
  end if;
end $$;

-- ── 2. The candidate index ─────────────────────────────────────────────────
--
-- The sweeper's one query is: assets not yet swept, least recently examined
-- first. Partial on `swept_at is null` because a swept asset is never a
-- candidate again, and that is the larger set over time.
--
-- Justified rather than assumed: at 74 assets the planner will prefer a
-- sequential scan and should. This earns its place at the volume where it
-- matters, costs one small index now, and keeps the query shape honest — which
-- is what a wrong column order would get wrong. (S4's lesson: assert that an
-- index CAN serve the shape, not that today's planner picks it.)

create index if not exists photo_assets_sweep_queue
  on public.photo_assets (sweep_checked_at nulls first, unreferenced_since)
  where swept_at is null;

-- ── 3. Privileges ──────────────────────────────────────────────────────────
--
-- Stated, not added to. Every grant below is re-stated on a second run, which
-- is idempotent; nothing is revoked, so no existing caller loses anything.
--
-- WHAT THE SWEEPER NEEDS, AND NOTHING ELSE:
--
--   select on photo_assets   to find candidates and read their file paths
--   select on photo_usages   the extra veto (never a permission on its own)
--   update on photo_assets   THREE COLUMNS ONLY
--
-- Column-level UPDATE rather than table-level is the whole point. The
-- sweeper's job is to write three timestamps; granting it the table would also
-- let a bug in it rewrite `display_path`, `alt_text` or `derivatives`, and the
-- grant is where that is cheapest to prevent.
--
-- `authenticated` is deliberately UNCHANGED — still `select` only on both
-- tables. The first design needed an UPDATE here and this file does not: no
-- photographer's request writes a lifecycle column. Had it needed one, the
-- right shape would have been a SECURITY DEFINER function restating the tenant
-- rule, as `enqueue_jobs` does, not a broad grant.
--
-- `anon` and `public` are named so this file is a complete statement of who
-- may touch these tables, rather than a list of additions to something
-- unstated elsewhere. Section 4 then reads the whole privilege set back and
-- compares it, so that statement is checked rather than asserted.

revoke all on table public.photo_assets from anon;
revoke all on table public.photo_assets from public;
revoke all on table public.photo_usages from anon;
revoke all on table public.photo_usages from public;

grant select on table public.photo_assets to authenticated;
grant select on table public.photo_usages to authenticated;

grant select on table public.photo_assets to service_role;
grant select on table public.photo_usages to service_role;
grant update (unreferenced_since, sweep_checked_at, swept_at)
  on table public.photo_assets to service_role;

-- ── 4. Prove it landed ─────────────────────────────────────────────────────
--
-- The header above is prose and the statements are the truth, and S4 learned
-- the hard way that those two drift. This reads the privileges back out and
-- raises if the migration did not do what it says, so a half-applied run is a
-- failed run rather than a quiet one.
--
-- EXHAUSTIVE ON PURPOSE, and it was not on the first attempt. That version
-- checked two columns it had deliberately omitted — `display_path` and
-- `deleted_at` — and called that an omissions check. It is not: those two
-- prove only that nobody holds TABLE-wide UPDATE. A grant naming one extra
-- column, say `update (unreferenced_since, …, alt_text)`, passes it happily,
-- which Codex demonstrated against the fixture on 2026-11-03.
--
-- So the set is compared rather than sampled: every column of the table is
-- asked, and the answer must be exactly the three. That also means a column
-- added to this table later cannot quietly become writable by the sweeper
-- without this failing.

do $$
declare
  -- Sorted by the DATABASE below, not by hand: `array_agg(… order by …)` uses
  -- the server's collation, and a collation that treats '_' differently from
  -- the way this file was typed would make a correct grant look wrong.
  expected text[];
  granted  text[];
  wrong    text := '';
begin
  select array_agg(x order by x) into expected
  from unnest(array['unreferenced_since', 'sweep_checked_at', 'swept_at']) x;

  -- ── service_role: UPDATE on exactly those three columns, and no others ──
  select coalesce(array_agg(c.column_name order by c.column_name), '{}'::text[])
    into granted
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'photo_assets'
    and has_column_privilege('service_role', 'public.photo_assets', c.column_name, 'update');

  if granted is distinct from expected then
    wrong := wrong || format(
      ' service_role may update [%s] on photo_assets, expected exactly [%s];',
      array_to_string(granted, ','), array_to_string(expected, ','));
  end if;

  -- ── authenticated: no UPDATE on any column of either table ──────────────
  select coalesce(array_agg(c.column_name order by c.column_name), '{}'::text[])
    into granted
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'photo_assets'
    and has_column_privilege('authenticated', 'public.photo_assets', c.column_name, 'update');

  if granted <> '{}'::text[] then
    wrong := wrong || format(
      ' authenticated may update [%s] on photo_assets, expected none;',
      array_to_string(granted, ','));
  end if;

  select coalesce(array_agg(c.column_name order by c.column_name), '{}'::text[])
    into granted
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'photo_usages'
    and has_column_privilege('authenticated', 'public.photo_usages', c.column_name, 'update');

  if granted <> '{}'::text[] then
    wrong := wrong || format(
      ' authenticated may update [%s] on photo_usages, expected none;',
      array_to_string(granted, ','));
  end if;

  -- ── The reads the sweeper and the application each need ─────────────────
  if not has_table_privilege('service_role', 'public.photo_assets', 'select') then
    wrong := wrong || ' service_role cannot select photo_assets;';
  end if;
  if not has_table_privilege('service_role', 'public.photo_usages', 'select') then
    wrong := wrong || ' service_role cannot select photo_usages;';
  end if;
  if not has_table_privilege('authenticated', 'public.photo_assets', 'select') then
    wrong := wrong || ' authenticated cannot select photo_assets;';
  end if;
  if not has_table_privilege('authenticated', 'public.photo_usages', 'select') then
    wrong := wrong || ' authenticated cannot select photo_usages;';
  end if;

  -- ── Nobody writes rows to these tables through a grant ──────────────────
  --
  -- P1 left INSERT and DELETE revoked from every role, and this phase has no
  -- reason to change that: the sweeper writes three timestamps and deletes no
  -- row. Asserted so that a later migration which widens it has to argue with
  -- this one.
  if has_table_privilege('service_role', 'public.photo_assets', 'insert')
     or has_table_privilege('service_role', 'public.photo_assets', 'delete')
     or has_table_privilege('service_role', 'public.photo_usages', 'insert')
     or has_table_privilege('service_role', 'public.photo_usages', 'delete') then
    wrong := wrong || ' service_role unexpectedly holds insert or delete;';
  end if;
  if has_table_privilege('authenticated', 'public.photo_assets', 'insert')
     or has_table_privilege('authenticated', 'public.photo_assets', 'delete')
     or has_table_privilege('authenticated', 'public.photo_usages', 'insert')
     or has_table_privilege('authenticated', 'public.photo_usages', 'delete') then
    wrong := wrong || ' authenticated unexpectedly holds insert or delete;';
  end if;

  -- ── And the public roles hold nothing at all ────────────────────────────
  if has_table_privilege('anon', 'public.photo_assets', 'select')
     or has_table_privilege('anon', 'public.photo_usages', 'select') then
    wrong := wrong || ' anon unexpectedly holds select;';
  end if;

  if wrong <> '' then
    raise exception 'P6 sweeper migration did not land as stated.%', wrong;
  end if;
end $$;

-- Columns and the index, read back the same way.
do $$
declare
  n int;
begin
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'photo_assets'
    and column_name in ('unreferenced_since', 'sweep_checked_at', 'swept_at');
  if n <> 3 then
    raise exception 'P6 sweeper migration: expected 3 new columns, found %.', n;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'photo_assets_sweep_queue'
  ) then
    raise exception 'P6 sweeper migration: the candidate index is missing.';
  end if;
end $$;

commit;

-- PostgREST caches the schema; the new columns are invisible to it until told.
notify pgrst, 'reload schema';
