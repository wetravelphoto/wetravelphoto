-- 2026-09-14 — repair migration
--
-- Three unrelated problems, all traced back to migrations that were written
-- but never actually landed in the database.
--
--   1. Five site_settings columns that lib/site.ts declares and that both the
--      page editors and the public pages read. Because getSiteSettings() does
--      select('*') and casts, their absence produced no error anywhere — the
--      reads came back undefined and the writes in app/actions/site.ts failed
--      against a column PostgREST couldn't find.
--
--   2. albums.display_order. The original migration said
--         alter table albums add column if not exists sort_order int ...
--      but albums.sort_order already existed as the *photo sort mode* inside
--      an album ('manual' | 'date_asc' | 'date_desc'). "if not exists" matched
--      on the name, no-opped, and the gallery reordering feature was then built
--      against a column that was never created. reorderAlbums() has been
--      writing positions into the sort mode ever since.
--
--   3. tenant_id on four tables that were missed when the rest of the schema
--      got it. Foreign keys to tenants are deliberately left for the
--      multi-tenant work; this only adds the columns.

begin;

-- ── 1. Missing site_settings columns ─────────────────────────────────────────

alter table site_settings
  add column if not exists galleries_eyebrow    text,
  add column if not exists galleries_heading    text,
  add column if not exists journal_page_eyebrow text,
  add column if not exists journal_page_heading text,
  add column if not exists journal_title_scale  numeric not null default 1;


-- ── 2. Gallery ordering ──────────────────────────────────────────────────────

alter table albums
  add column if not exists display_order int not null default 0;

-- Seed positions from the current listing order so nothing visibly jumps.
-- Only touches rows still at the default, so this is safe to re-run.
with ordered as (
  select id, row_number() over (order by created_at) as rn
  from albums
)
update albums a
   set display_order = ordered.rn
  from ordered
 where a.id = ordered.id
   and a.display_order = 0;

create index if not exists albums_display_order_idx on albums (display_order);

-- Any album that was dragged in the admin had its sort mode overwritten with a
-- position number. Those values are unrecoverable, so reset them to the default.
update albums
   set sort_order = 'manual'
 where sort_order not in ('manual', 'date_asc', 'date_desc');


-- ── 3. Missing tenant_id columns ─────────────────────────────────────────────

alter table products
  add column if not exists tenant_id uuid not null default default_tenant_id();

alter table contact_messages
  add column if not exists tenant_id uuid not null default default_tenant_id();

alter table instagram_media
  add column if not exists tenant_id uuid not null default default_tenant_id();

alter table newsletter_signups
  add column if not exists tenant_id uuid not null default default_tenant_id();

commit;


-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect 6 rows: the five site_settings columns and albums.display_order.
--
--   select table_name, column_name
--     from information_schema.columns
--    where table_schema = 'public'
--      and (
--        (table_name = 'site_settings' and column_name in (
--           'galleries_eyebrow', 'galleries_heading',
--           'journal_page_eyebrow', 'journal_page_heading',
--           'journal_title_scale'))
--        or (table_name = 'albums' and column_name = 'display_order')
--      )
--    order by table_name, column_name;
