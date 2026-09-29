-- ════════════════════════════════════════════════════════════════════════════
-- SCHEMA SURVEY — READ ONLY. CHANGES NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Run each PART separately in the Supabase SQL editor and send the result back.
-- Every part returns ONE text column called `line`, so the output pastes as a
-- flat list rather than a wide grid. Supabase can also download a result as
-- CSV, which is easier for the long parts (1, 2 and 4).
--
-- Nothing here writes, locks or analyses. It reads catalogue views only.
--
-- ── Why this file exists ────────────────────────────────────────────────────
--
-- There is no committed schema snapshot, so `lib/site.ts` can disagree with the
-- real table without anything failing, and the migration history only records
-- what was *intended*. That has been wrong three times: the `single_row`
-- constraint on `site_settings`, `albums.allow_downloads`, and
-- `photos.album_id`'s cascade. Each was found in production, not in review.
--
-- Verified answers go in `db/schema-verified.md`; the full snapshot from this
-- survey goes in `db/schema-2026-09.sql`.
--
-- ── The specific unknowns this run has to settle ────────────────────────────
--
-- 1. `photos` — the app reads sixteen columns; db/test-fixture.sql declares
--    six. What is really there?
-- 2. `page_views` — the app reads `visitor_hash` and `viewed_at`, which appear
--    in NO migration and NO fixture.
-- 3. **Every foreign key that points at `albums`.** The fixture declares six,
--    and only `photos` cascades. The other five — `album_clients`,
--    `blog_posts`, `favorites`, `page_views`, `site_settings.hero_album_id` —
--    would each REFUSE `delete from albums`, and `deleteAlbum` in
--    `app/actions/galleries.ts` deletes only the album row and works in
--    production. So production differs from the fixture on at least some of
--    them. Part 2 settles which. (Confirmed locally 2026-09-29: building the
--    fixture and deleting an album fails on `page_views_album_id_fkey`.)
-- 4. The same question for everything pointing at `photos` — `deletePhoto`
--    deletes the row directly, so a non-cascading `favorites.photo_id` would
--    make deleting a favourited photograph fail.
-- 5. Server version and installed extensions.
-- 6. Which tables `anon` can reach, and with what privileges.
--
-- ════════════════════════════════════════════════════════════════════════════


-- ── PART 0 — Environment ────────────────────────────────────────────────────
-- Small. Settles the server version and whether pgvector is installed or
-- merely available (it is not needed until Step 8, but the answer shapes that
-- step).

select 'server: ' || version() as line
union all
select 'installed extension: ' || extname || ' ' || extversion from pg_extension
union all
select 'available (not installed): ' || name || ' ' || default_version
from pg_available_extensions
where name in ('vector', 'pg_cron', 'pg_trgm', 'pgcrypto', 'uuid-ossp')
  and installed_version is null;


-- ── PART 1 — Every column of every table ────────────────────────────────────
-- The big one. This is what db/schema-2026-09.sql is built from.
-- Format:  table.column :: type [NOT NULL] [DEFAULT ...] [GENERATED STORED]

select
  c.relname || '.' || a.attname
  || ' :: ' || format_type(a.atttypid, a.atttypmod)
  || case when a.attnotnull then ' NOT NULL' else '' end
  || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
  || case a.attgenerated when 's' then ' GENERATED STORED' else '' end
  || case when a.attidentity <> '' then ' IDENTITY' else '' end
  as line
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname = 'public'
  and c.relkind = 'r'
  and a.attnum > 0
  and not a.attisdropped
order by c.relname, a.attnum;


-- ── PART 2 — Every constraint, with its ON DELETE action ────────────────────
-- Settles unknowns 3 and 4. `pg_get_constraintdef` prints the whole thing,
-- including ON DELETE CASCADE where it exists.
-- Format:  table | constraint_name | definition

select
  c.conrelid::regclass::text || ' | ' || c.conname || ' | ' || pg_get_constraintdef(c.oid)
  as line
from pg_constraint c
join pg_namespace n on n.oid = c.connamespace
join pg_class rel on rel.oid = c.conrelid
where n.nspname = 'public'
  and rel.relkind = 'r'
order by c.conrelid::regclass::text, c.contype, c.conname;


-- ── PART 2b — Foreign keys pointing at the four tables the photo design
--              depends on, on their own, with the delete action spelled out.
-- Short, and the single most important result of this survey. If Part 2 is too
-- long to paste, paste this one.

select
  con.conrelid::regclass::text || '.' || con.conname
  || '  ->  ' || con.confrelid::regclass::text
  || '  ON DELETE ' ||
  case con.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else con.confdeltype::text
  end
  as line
from pg_constraint con
where con.contype = 'f'
  and con.confrelid in (
    'albums'::regclass, 'photos'::regclass,
    'blog_posts'::regclass, 'catalog_items'::regclass
  )
order by con.confrelid::regclass::text, con.conrelid::regclass::text, con.conname;


-- ── PART 3 — Every index ────────────────────────────────────────────────────

select indexdef as line
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;


-- ── PART 4 — Row level security, and every policy ───────────────────────────
-- A table with RLS enabled and no policy is deny-all and reads as empty with
-- no error. A table with RLS off is wide open to the anon key.

select
  c.relname || ' | RLS '
  || case when c.relrowsecurity then 'ENABLED' else '*** DISABLED ***' end
  || case when c.relforcerowsecurity then ' (FORCED)' else '' end
  || ' | ' || (
    select count(*)::text || ' policies'
    from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
  )
  as line
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;


-- ── PART 4b — The policies themselves ───────────────────────────────────────
-- Format:  table | policy | cmd | roles | USING ... | CHECK ...

select
  tablename || ' | ' || policyname || ' | ' || cmd
  || ' | roles=' || array_to_string(roles, ',')
  || ' | USING ' || coalesce(qual, '-')
  || ' | CHECK ' || coalesce(with_check, '-')
  as line
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- ── PART 5 — Functions and triggers ─────────────────────────────────────────
-- The tenant helpers must be `stable security definer`, and a trigger anywhere
-- near albums or photos would change what the delete paths actually do.

select
  p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  || ' -> ' || pg_get_function_result(p.oid)
  || case when p.prosecdef then ' SECURITY DEFINER' else ' INVOKER' end
  || ' ' || case p.provolatile
              when 'i' then 'IMMUTABLE' when 's' then 'STABLE' else 'VOLATILE' end
  as line
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- Triggers (none are expected; `none` is the answer we want).
select
  c.relname || ' | ' || t.tgname || ' | ' || pg_get_triggerdef(t.oid) as line
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
order by c.relname, t.tgname;


-- ── PART 6 — What anon, authenticated and service_role may do ───────────────
-- Grants are a second gate in front of RLS: `site_images` is deliberately
-- `revoke all ... from anon`. A table missing from this list is one anon
-- cannot touch at all.

select
  table_name || ' | ' || grantee || ' | '
  || string_agg(privilege_type, ',' order by privilege_type) as line
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
group by table_name, grantee
order by table_name, grantee;


-- ── PART 7 — Approximate row counts ─────────────────────────────────────────
-- From the planner's statistics, so it is free and approximate. `-1` means the
-- table has never been analysed, not that it is empty.

select
  c.relname || ' | ~' || c.reltuples::bigint || ' rows'
  || ' | ' || pg_size_pretty(pg_total_relation_size(c.oid)) as line
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.reltuples desc;


-- ── PART 8 — Which tables carry a tenant, and which do not ──────────────────
-- The original survey, kept. Every site-owned table should have `tenant_id
-- uuid NOT NULL` and — since 2026-09-24_no_guessing_tenant.sql — NO DEFAULT,
-- so a forgotten tenant is a hard error rather than a silent write into the
-- oldest site.

select
  t.table_name || ' | ' ||
  case
    when c.column_name is null then '*** NO tenant_id ***'
    else 'tenant_id ' || c.data_type
         || case when c.is_nullable = 'YES' then ' NULL' else ' NOT NULL' end
         || coalesce(' DEFAULT ' || split_part(c.column_default, '::', 1),
                     ' (no default)')
  end as line
from information_schema.tables t
left join information_schema.columns c
  on c.table_schema = t.table_schema
 and c.table_name = t.table_name
 and c.column_name = 'tenant_id'
where t.table_schema = 'public'
  and t.table_type = 'BASE TABLE'
order by t.table_name;
