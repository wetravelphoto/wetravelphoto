-- 2026-09-15 — page sections
--
-- The foundation of the visual editor. A page stops being a hard-coded
-- sequence of blocks in page.tsx and becomes an ordered list of rows: each
-- row names a section type from the registry (lib/sections/registry.ts) and
-- carries that type's own settings as JSON.
--
-- Why JSON and not columns: site_settings is at 130-odd columns and every new
-- option needs a migration, a TypeScript field, a form input and a save
-- action. A section's settings are only ever read by that one section, so a
-- blob is the honest shape — and adding the twentieth section type then costs
-- one folder rather than one migration.
--
-- NOTHING IS SEEDED HERE ON PURPOSE.
--
-- Until the first save in the new editor, lib/sections/legacy.ts synthesizes
-- the existing homepage from the site_settings columns, so the live page looks
-- the same whether this table is missing, empty, or full. That means the code
-- and this migration can be deployed in either order — the mistake that took
-- the shop down earlier this week.

begin;

create table if not exists page_sections (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default default_tenant_id(),

  -- Which page it belongs to. 'home' today; any page slug once pages are
  -- user-creatable.
  page       text not null,

  -- Registry key: 'hero', 'intro', 'galleries', … An unknown type is skipped
  -- rather than crashing the page, so a row written by a newer release can
  -- sit harmlessly in an older one's database.
  type       text not null,

  -- Rewritten 0..n on every reorder. No unique constraint: a unique index on
  -- (page, position) would make a swap need deferred constraints for no gain.
  position   int  not null default 0,
  visible    boolean not null default true,

  -- Only ever read by this section's own renderer. Missing keys are filled
  -- from the type's defaults at read time, so an older row never breaks when
  -- a new setting is added.
  settings   jsonb not null default '{}'::jsonb,

  -- The registry version this row's settings were written against. Read time
  -- runs the type's migrate() when this is behind. Bumped only when an
  -- existing key changes meaning — adding a key never needs it.
  version    int not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists page_sections_page_idx
  on page_sections (tenant_id, page, position);


-- ── Row level security ───────────────────────────────────────────────────────
-- World-readable (the live page is public), writable by the site that owns it.

alter table page_sections enable row level security;

drop policy if exists "Anyone reads page sections" on page_sections;
create policy "Anyone reads page sections" on page_sections
  for select using (true);

-- The owner policy comes from apply_tenant_policy() in the tenant scoping
-- migration, so there is one definition of "belongs to this site" rather than
-- a twenty-first copy of it.
--
-- If that migration has not been run, this one stops. The alternative — quietly
-- falling back to the old "caller has a profile" check — is how every other
-- table in this schema ended up unscoped.
do $$
begin
  if to_regprocedure('public.apply_tenant_policy(regclass)') is null then
    raise exception
      'Run db/migrations/2026-09-15_tenant_scoping.sql first — it defines the owner policy this table needs.';
  end if;

  drop policy if exists "Owners manage page sections" on page_sections;
  perform public.apply_tenant_policy('page_sections');
end $$;

commit;


-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect an empty table. It stays empty, and the homepage keeps rendering from
-- site_settings, until you reorder or edit something in /admin/pages/home —
-- that first write materializes the six current sections as real rows.
--
--   select count(*) as sections from page_sections;
--
-- Then reload PostgREST or the new table reads as missing:
--
--   notify pgrst, 'reload schema';
--
-- After a save in the editor, this is the whole homepage:
--
--   select position, type, visible, jsonb_pretty(settings)
--     from page_sections where page = 'home' order by position;
