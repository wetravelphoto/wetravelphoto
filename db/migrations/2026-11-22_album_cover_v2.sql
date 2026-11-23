-- ════════════════════════════════════════════════════════════════════════════
-- 2026-11-22 — Client gallery v2: three cover columns on albums
--
-- CANDIDATE — NOT DEPLOYED. Rehearsed only on loopback scratch databases.
-- .ai-handoff/client-gallery-v2-prompt.md, Part 4 item 17. Every other cover
-- control reuses an existing column (cover_font, cover_title_scale,
-- cover_title_color, cover_button_text, cover_show_date, cover_subtitle,
-- cover_focal_x/y, cover_preset); this adds only what is missing:
--
--   albums.cover_background          text     NULL  — #RRGGBB or NULL
--   albums.cover_zoom                numeric  NULL  — 1.0 … 2.5 or NULL
--   albums.cover_secondary_photo_id  uuid     NULL  — one of THIS album's own
--                                                     photographs (diptych)
--
-- Additive and nullable: no default, no backfill, no row is written. NULL
-- means "not chosen", and the renderer keeps today's behaviour for it.
--
-- ── The second photograph is the album's own, on the album's site ───────────
--
--   albums (cover_secondary_photo_id, id, tenant_id)
--     → photos (id, album_id, tenant_id)
--   ON DELETE SET NULL (cover_secondary_photo_id)
--
-- A three-column key: the referenced photograph must carry THIS album's id and
-- THIS album's site. Enforced by the planner on every write, service-role
-- writes included (they bypass RLS, not foreign keys). albums.id and
-- albums.tenant_id are NOT NULL, so under MATCH SIMPLE the key is skipped only
-- when cover_secondary_photo_id itself is NULL — which is "none chosen".
--
-- Its target is a new UNIQUE (id, album_id, tenant_id) on photos. photos.id is
-- already the primary key, so the constraint cannot refuse any existing or
-- future row: it is an index the key can point at, nothing more (the same
-- reason P1 added photos_id_tenant).
--
-- Deletion semantics are preserved exactly:
--   · deleting the photograph (deletePhoto, P6) nulls cover_secondary_photo_id
--     and NOTHING ELSE — the column list on SET NULL (PostgreSQL 15+, as
--     albums_cover_photo_fk already uses) keeps albums.id and tenant_id, both
--     NOT NULL, out of it;
--   · deleting the album still removes its photographs by
--     photos_album_id_fkey's cascade; nothing new cascades anywhere;
--   · deleteSite (photos, then albums, explicitly) is unaffected.
-- ON UPDATE is NO ACTION (the default): moving a photograph that is some
-- album's second cover photograph to another album, or re-siting either row,
-- is refused rather than leaving a cover that is not the album's own. No
-- application path moves a photograph between albums today (checked
-- 2026-11-22: every `.from('photos').update` sets caption, tags, is_for_sale
-- or sort_order).
--
-- ── Values ──────────────────────────────────────────────────────────────────
-- cover_zoom: NULL or 1.0 ≤ z ≤ 2.5 (the reframe tool's 100–250 %). NaN and
-- ±Infinity fail the range. cover_background: NULL or exactly #RRGGBB — a
-- colour, never a CSS fragment; RLS decides rows, not values, so the shape is
-- the database's to hold.
--
-- No grant, policy, function or trigger changes. The new columns inherit the
-- table's existing privileges and policies exactly as cover_title_color does;
-- no column ACL is added. albums_access_revision does not read them, so a cover
-- edit does not rotate a gallery's access grants.
--
-- Safe to run twice: columns are added only when absent and then held to their
-- exact shape; each constraint and the index is created when absent, left alone
-- when its definition is exactly the one below, and refused (42710, nothing
-- changed) under any other definition. Everything is read back before COMMIT.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- Fail fast rather than queue every reader behind a waiting ACCESS EXCLUSIVE.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- pg_get_constraintdef() writes a table's schema only when it is not on the
-- path; fixed for this transaction so the comparisons below are like for like.
set local search_path = public, pg_catalog;

-- ADD COLUMN and ADD CONSTRAINT UNIQUE take ACCESS EXCLUSIVE on their tables.
-- Taken up front, albums then photos — the order deleteAlbum's cascade takes
-- them — so nothing is upgraded half-way. Both tables are small (8 albums,
-- 83 photographs at the last record); the hold is milliseconds. If the lock is
-- not granted within lock_timeout the migration aborts, changing nothing;
-- re-run it.
lock table public.albums, public.photos in access exclusive mode;

-- ── 1. The columns ──────────────────────────────────────────────────────────

alter table public.albums add column if not exists cover_background         text;
alter table public.albums add column if not exists cover_zoom               numeric;
alter table public.albums add column if not exists cover_secondary_photo_id uuid;

-- Held to their exact shape: a same-named column of another type, NOT NULL, or
-- with a default (from anywhere) refuses rather than being taken for ours.
do $$
declare
  r record;
  v_type text;
  v_notnull boolean;
  v_default boolean;
begin
  for r in
    select * from (values
      ('cover_background', 'text'),
      ('cover_zoom', 'numeric'),
      ('cover_secondary_photo_id', 'uuid')
    ) v(col, typ)
  loop
    select format_type(a.atttypid, a.atttypmod), a.attnotnull, a.atthasdef
      into v_type, v_notnull, v_default
      from pg_attribute a
     where a.attrelid = 'public.albums'::regclass and a.attname = r.col and not a.attisdropped;
    if v_type is distinct from r.typ or v_notnull or v_default then
      raise exception 'albums.% exists with another shape: type %, not null %, default %',
        r.col, v_type, v_notnull, v_default using errcode = '42710';
    end if;
  end loop;
end $$;

-- ── 2. The constraints ──────────────────────────────────────────────────────
-- Order matters: photos_id_album_tenant must exist before the key that points
-- at it.

do $$
declare
  r record;
  v_def text;
begin
  for r in
    select * from (values
      ('public.albums'::regclass, 'albums_cover_zoom_range',
       'CHECK (((cover_zoom >= 1.0) AND (cover_zoom <= 2.5)))',
       'alter table public.albums add constraint albums_cover_zoom_range
          check (cover_zoom >= 1.0 and cover_zoom <= 2.5)'),
      ('public.albums'::regclass, 'albums_cover_background_hex',
       'CHECK ((cover_background ~ ''^#[0-9A-Fa-f]{6}$''::text))',
       'alter table public.albums add constraint albums_cover_background_hex
          check (cover_background ~ ''^#[0-9A-Fa-f]{6}$'')'),
      ('public.photos'::regclass, 'photos_id_album_tenant',
       'UNIQUE (id, album_id, tenant_id)',
       'alter table public.photos add constraint photos_id_album_tenant
          unique (id, album_id, tenant_id)'),
      ('public.albums'::regclass, 'albums_cover_secondary_photo_fk',
       'FOREIGN KEY (cover_secondary_photo_id, id, tenant_id) REFERENCES photos(id, album_id, tenant_id) ON DELETE SET NULL (cover_secondary_photo_id)',
       'alter table public.albums add constraint albums_cover_secondary_photo_fk
          foreign key (cover_secondary_photo_id, id, tenant_id)
          references public.photos (id, album_id, tenant_id)
          on delete set null (cover_secondary_photo_id)')
    ) v(tbl, name, def, ddl)
  loop
    -- Looked up by name in the whole schema: a same-named constraint on the
    -- wrong table is as much a refusal as a wrong definition.
    select pg_get_constraintdef(c.oid) into v_def
      from pg_constraint c
     where c.conname = r.name and c.connamespace = 'public'::regnamespace and c.conrelid = r.tbl;
    if v_def is null then
      if exists (select 1 from pg_constraint c
                  where c.conname = r.name and c.connamespace = 'public'::regnamespace) then
        raise exception '% exists on another table', r.name using errcode = '42710';
      end if;
      execute r.ddl;
    elsif v_def <> r.def then
      raise exception '% exists with another definition: %', r.name, v_def using errcode = '42710';
    end if;

    -- Read back: what is in the catalogue now is exactly what was meant.
    select pg_get_constraintdef(c.oid) into v_def
      from pg_constraint c
     where c.conname = r.name and c.connamespace = 'public'::regnamespace and c.conrelid = r.tbl;
    if v_def is distinct from r.def then
      raise exception '% did not come out as defined: %', r.name, v_def using errcode = '42P17';
    end if;
  end loop;

  -- The key's behaviour beyond its text: validated, not deferrable, MATCH
  -- SIMPLE, NO ACTION on update, SET NULL on delete of exactly one column, and
  -- pointing at photos_id_album_tenant.
  if not exists (
    select 1
      from pg_constraint c
      join pg_constraint u on u.conindid = c.conindid and u.contype = 'u'
                          and u.conrelid = 'public.photos'::regclass
     where c.conname = 'albums_cover_secondary_photo_fk'
       and c.conrelid = 'public.albums'::regclass
       and c.confrelid = 'public.photos'::regclass
       and c.convalidated and not c.condeferrable
       and c.confmatchtype = 's' and c.confupdtype = 'a' and c.confdeltype = 'n'
       and c.confdelsetcols = array[(select attnum from pg_attribute
                                      where attrelid = 'public.albums'::regclass
                                        and attname = 'cover_secondary_photo_id')]::int2[]
       and u.conname = 'photos_id_album_tenant'
  ) then
    raise exception 'albums_cover_secondary_photo_fk does not behave as defined' using errcode = '42P17';
  end if;
end $$;

-- ── 3. The supporting index ─────────────────────────────────────────────────
-- So deleting a photograph does not scan albums to find who names it second.
-- `public` off the path so pg_get_indexdef() names the table in full.
set local search_path = pg_catalog;

do $$
declare
  c_name constant text := 'albums_cover_secondary_photo';
  c_def  constant text := 'CREATE INDEX albums_cover_secondary_photo ON public.albums USING btree (cover_secondary_photo_id) WHERE (cover_secondary_photo_id IS NOT NULL)';
  v_def text;
  v_valid boolean;
begin
  select pg_catalog.pg_get_indexdef(i.indexrelid), i.indisvalid into v_def, v_valid
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
   where c.relname = c_name and c.relnamespace = 'public'::regnamespace;
  if v_def is null then
    if exists (select 1 from pg_catalog.pg_class c
                where c.relname = c_name and c.relnamespace = 'public'::regnamespace) then
      raise exception '% exists and is not an index', c_name using errcode = '42710';
    end if;
    execute 'create index albums_cover_secondary_photo on public.albums (cover_secondary_photo_id) where cover_secondary_photo_id is not null';
  elsif v_def <> c_def or not v_valid then
    raise exception '% exists with another definition (or invalid): %', c_name, v_def using errcode = '42710';
  end if;

  select pg_catalog.pg_get_indexdef(i.indexrelid) into v_def
    from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid = i.indexrelid
   where c.relname = c_name and c.relnamespace = 'public'::regnamespace;
  if v_def is distinct from c_def then
    raise exception '% did not come out as defined: %', c_name, v_def using errcode = '42P17';
  end if;
end $$;

-- ── 4. Nothing else moved ───────────────────────────────────────────────────
-- No column ACL on the new columns, and no new row: every new value is NULL.
do $$
begin
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = 'public.albums'::regclass
                and a.attname in ('cover_background', 'cover_zoom', 'cover_secondary_photo_id')
                and a.attacl is not null) then
    raise exception 'a new cover column carries a column ACL' using errcode = '42P17';
  end if;
end $$;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Constraints and index first; no row changes:
--
--   begin;
--   alter table public.albums drop constraint if exists albums_cover_secondary_photo_fk;
--   drop index if exists public.albums_cover_secondary_photo;
--   alter table public.photos drop constraint if exists photos_id_album_tenant;
--   alter table public.albums drop constraint if exists albums_cover_zoom_range;
--   alter table public.albums drop constraint if exists albums_cover_background_hex;
--   commit;
--
-- Dropping the three COLUMNS is destructive once any application has written
-- them (the photographer's background, zoom and second photograph are lost),
-- and an application that selects them fails whole (PostgREST refuses a select
-- naming a missing column). Roll the application back first, and drop the
-- columns only under their own approval:
--
--   alter table public.albums drop column if exists cover_secondary_photo_id,
--                             drop column if exists cover_zoom,
--                             drop column if exists cover_background;
