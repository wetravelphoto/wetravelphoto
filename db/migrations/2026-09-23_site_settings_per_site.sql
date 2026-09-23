-- ═══════════════════════════════════════════════════════════════════════════
-- THERE IS MORE THAN ONE SITE NOW, AND THE TABLE HAS TO BE TOLD
-- ═══════════════════════════════════════════════════════════════════════════
--
-- site_settings was written when WeTravelPhoto was the only thing that
-- existed. It was given an integer id and a check constraint — `single_row`,
-- `check (id = 1)` — whose entire purpose was to make a second row impossible.
-- At the time that was good work: a configuration table with two rows and no
-- way to say which one is yours is a bug waiting to happen, and the constraint
-- said so out loud.
--
-- Everything since has been unpicking that assumption. site_settings gained a
-- tenant_id and a unique index on it (2026-09-15_tenant_scoping.sql), which is
-- now the real "one row per site" rule and a better one: it counts per site
-- rather than in total. The old constraint was left behind, unmentioned in
-- this repository and therefore absent from db/test-fixture.sql — which is
-- exactly why every local test of the create-a-site screen passed and the
-- first real attempt failed:
--
--   new row for relation "site_settings" violates check constraint "single_row"
--
-- The database was doing precisely what it was told. This tells it something
-- else.
--
-- Two changes:
--
--   1. Drop the constraint. The unique index on tenant_id replaced it.
--   2. Give `id` a sequence, so a new row no longer has to be handed a number
--      by whoever is inserting it. app/actions/sites.ts was reading the
--      highest id and adding one, with a comment admitting that two people
--      creating sites at the same moment would collide. A sequence is what
--      that comment was asking for.
--
-- `id` stays. Nothing about it is load-bearing any more — tenant_id is the
-- identity — but dropping a primary key that other things may quietly join on
-- is a separate decision, taken on a day when it is the only thing happening.
--
-- Safe to run twice. Safe to run on a database that never had the constraint.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. the constraint that says there can be only one ──────────────────────
--
-- Found by shape as well as by name. The name in the error is `single_row`,
-- but a constraint created through the Supabase table editor can be named
-- anything, and the one thing that cannot vary is that it pins id to 1.

do $$
declare
  victim text;
  found  int := 0;
begin
  for victim in
    select conname
      from pg_constraint
     where conrelid = 'public.site_settings'::regclass
       and contype = 'c'
       and (
         conname = 'single_row'
         or replace(pg_get_constraintdef(oid), ' ', '') ilike '%id=1%'
       )
  loop
    execute format('alter table public.site_settings drop constraint %I', victim);
    raise notice 'dropped check constraint % on site_settings', victim;
    found := found + 1;
  end loop;

  if found = 0 then
    raise notice 'no single-row constraint on site_settings — nothing to drop';
  end if;
end $$;

-- ── 2. the rule that replaced it, stated explicitly ────────────────────────
--
-- This index already exists from 2026-09-15_tenant_scoping.sql. It is repeated
-- here because it is the thing standing in for what was just removed, and a
-- migration that takes a safeguard away should be readable as the migration
-- that put the better one in its place.

create unique index if not exists site_settings_tenant_idx
  on site_settings (tenant_id);

-- ── 3. a number of its own ─────────────────────────────────────────────────

create sequence if not exists site_settings_id_seq owned by site_settings.id;

select setval(
  'site_settings_id_seq',
  greatest(coalesce((select max(id) from site_settings), 0), 1)
);

alter table site_settings alter column id set default nextval('site_settings_id_seq');

comment on column site_settings.id is
  'Legacy key from the single-site era. tenant_id is the identity; this is now '
  'just a number from a sequence so inserts do not have to choose one.';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- AFTERWARDS — worth running, and worth reading
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Nothing left pinning site_settings to one row (expect no rows):
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.site_settings'::regclass and contype = 'c';
--
-- The same fault anywhere else in the database. This is the one that matters:
-- site_settings was found by a failure, and a second table like it would be
-- found the same way, by a beta tester (expect no rows):
--
--   select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where contype = 'c'
--      and connamespace = 'public'::regnamespace
--      and replace(pg_get_constraintdef(oid), ' ', '') ilike '%id=1%';
--
-- And the settings that exist, one line per site:
--
--   select s.id, t.name, s.site_title
--     from site_settings s join tenants t on t.id = s.tenant_id
--    order by s.id;
-- ═══════════════════════════════════════════════════════════════════════════
