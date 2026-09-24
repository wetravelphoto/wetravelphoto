-- ═══════════════════════════════════════════════════════════════════════════
-- A FORGOTTEN TENANT MUST FAIL, NOT GUESS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Almost every tenant-owned table declares:
--
--     tenant_id uuid not null default public.default_tenant_id()
--
-- and `default_tenant_id()` returns **the oldest tenant** — WeTravelPhoto.
-- The intent was kind: written when there was one site, so that a row with no
-- tenant still belonged somewhere. With two sites it is the opposite of kind.
-- An insert that forgets `tenant_id` does not fail. It silently files a second
-- photographer's work under the first photographer's site.
--
-- It has already caused two real bugs in one day:
--
--   · `site_template_history` — applying ANY look on ANY site but the original
--     wrote its undo point under the original's history. Row-level security
--     refused it, the write threw, and Next.js redacted the reason into
--     "Minified React error #441". Looks were simply broken, unexplainably.
--   · `instagram_media` and `catalog_items` — a second site's Instagram cache
--     and print catalogue entries were written under the first site's tenant,
--     where RLS did NOT refuse them, because a platform admin's session passes
--     every tenant check.
--
-- The difference between those two is luck, not design.
--
-- **The default goes.** Afterwards an insert that omits the tenant violates
-- NOT NULL and fails immediately, with a message naming the column — which is
-- a bug found in a test, rather than a bug found months later in somebody
-- else's gallery. Every insert in the application was audited first
-- (35 of them, across app/ and lib/); all now name their site explicitly.
--
-- `default_tenant_id()` itself is KEPT. Migrations and backfills use it, and
-- it is correct there: a backfill really does mean "the original site". It
-- just has no business being a column default.
--
-- **Nothing is dropped, added or moved.** No row changes. Only the DEFAULT
-- clause, which affects future inserts alone. If something turns out to have
-- relied on it, the fix is to name the tenant at that insert — and the error
-- will say exactly where.
--
-- Safe to run twice. Reversible: see the bottom of this file.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  r       record;
  changed int := 0;
begin
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name = 'tenant_id'
       and c.column_default like '%default_tenant_id%'
     order by c.table_name
  loop
    execute format('alter table public.%I alter column %I drop default', r.table_name, r.column_name);
    raise notice 'no longer guesses: %.%', r.table_name, r.column_name;
    changed := changed + 1;
  end loop;

  if changed = 0 then
    raise notice 'nothing to change — no tenant_id column defaults to default_tenant_id()';
  else
    raise notice '% column(s) now require a tenant to be named', changed;
  end if;
end $$;

comment on function public.default_tenant_id() is
  'The oldest tenant. For migrations and backfills, where "the original site" '
  'is what is meant. Deliberately NOT a column default any more: as a default '
  'it turned a forgotten tenant_id into a silent write against somebody '
  'else''s site (db/migrations/2026-09-24_no_guessing_tenant.sql).';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- AFTERWARDS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Nothing still guesses (expect no rows):
--
--   select table_name, column_name, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and column_name = 'tenant_id'
--      and column_default like '%default_tenant_id%';
--
-- Every tenant_id is still NOT NULL, which is what turns a forgotten tenant
-- into an error rather than a null row (expect no rows):
--
--   select table_name from information_schema.columns
--    where table_schema = 'public' and column_name = 'tenant_id'
--      and is_nullable = 'YES';
--
-- Nobody's rows moved. Counts per site, before and after, should match:
--
--   select t.name, count(a.id) as galleries, count(distinct p.id) as photographs
--     from tenants t
--     left join albums a on a.tenant_id = t.id
--     left join photos p on p.tenant_id = t.id
--    group by t.name order by t.name;
--
-- ── If this has to be undone ───────────────────────────────────────────────
--
-- Put the defaults back on the tables that had them. This restores the
-- guessing, so it is a step backwards taken knowingly:
--
--   do $$
--   declare r record;
--   begin
--     for r in select table_name from information_schema.columns
--               where table_schema='public' and column_name='tenant_id'
--     loop
--       execute format('alter table public.%I alter column tenant_id set default public.default_tenant_id()', r.table_name);
--     end loop;
--   end $$;
-- ═══════════════════════════════════════════════════════════════════════════
