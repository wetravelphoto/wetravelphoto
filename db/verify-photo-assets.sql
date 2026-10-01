-- Proof that P1 — photo_assets and photo_usages — is the shape the design says,
-- refuses what it must, and can be reached by nobody it should not be.
--
-- P1 is DEPLOYED (Supabase migration 20260930123113, 2026-09-30) and
-- db/test-fixture.sql now contains it, so the fixture alone is enough:
--
--   psql -d wtp -f db/test-fixture.sql
--   psql -d wtp -f db/verify-photo-assets.sql
--
-- Applying db/migrations/2026-09-29_photo_assets.sql on top as well is safe (it
-- is idempotent) but no longer needed. Before deployment the fixture did not
-- have these tables and the migration had to be applied first.
--
-- ── Since P3 ────────────────────────────────────────────────────────────────
--
-- db/migrations/2026-09-30_photo_usages_sync.sql adds the eighth kind,
-- page_share: three CHECKs are restated with it (kind_known, scope_by_kind,
-- one_parent), one CHECK is added (share_slot) and one slot index is added. The exact definitions below are
-- the P3 ones, and every per-kind proof now covers eight kinds. P3 is DEPLOYED
-- (Supabase 20261001010021) and reconciled, so the fixture alone carries them.
--
-- The core isolation assertions now ALSO live in db/verify-tenant-isolation.sql,
-- beside every other table's; this file keeps the complete P1 proof.
--
-- ── It cannot leave anything behind ─────────────────────────────────────────
--
-- One transaction that ALWAYS ends by raising, which aborts it. The report is
-- the exception message. Same shape as db/verify-jobs.sql and
-- db/verify-analytics.sql.
--
-- ── Two kinds of test, deliberately kept apart ──────────────────────────────
--
-- REFERENTIAL INTEGRITY runs as the TABLE OWNER. The owner bypasses RLS and
-- holds every privilege, so when one of those writes is refused, the foreign
-- key or CHECK did it and nothing else could have. Each of those assertions
-- names the constraint that refused, not merely that something did.
--
-- GRANTS AND RLS run as the REAL ROLES — anon, authenticated, service_role, and
-- a platform admin through the same JWT-claim setup the other suites use. A
-- suite that only runs as the owner cannot see a grant problem, which is how
-- S3's service_role defect hid behind a green suite.
--
-- ── Mutations that were run against this file ──────────────────────────────
--
-- Recorded in the P1 report rather than here. The two that live inside the
-- file, because they are the design's own argument: block 5 builds the single
-- wide UNIQUE the design rejected and shows it admitting a duplicate of every
-- kind; block 6 swaps each composite foreign key for a plain one and shows it
-- admitting a cross-tenant parent.

begin;

create temp table pa_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

create function pg_temp.ok(p_step text, p_expected text, p_actual text)
returns void language sql as $$
  insert into pa_res (step, expected, actual, pass)
  values (p_step, p_expected, coalesce(p_actual, '(null)'), p_expected = p_actual);
$$;

/*
 * Run one statement AS WHOEVER IS CURRENT and say what happened: `accepted`,
 * or the SQLSTATE and the name of the constraint that refused it. That second
 * half is the point — "it was refused" is satisfied by the wrong layer, and S4
 * had a test pass 215/215 for exactly that reason.
 */
create function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare
  v_state text;
  v_con   text;
  v_col   text;
begin
  execute p_sql;
  return 'accepted';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate,
                          v_con   = constraint_name,
                          v_col   = column_name;
  return v_state || coalesce(' ' || nullif(v_con, ''), '')
                 || coalesce(' column ' || nullif(v_col, ''), '');
end $$;

-- The cast of characters. Sites A and B and the rows the fixture seeds for
-- them; everything else is created below and rolled back with the rest.
create temp table k (name text primary key, id uuid not null);
insert into k values
  ('A',        'aaaaaaaa-0000-0000-0000-000000000001'),
  ('B',        'aaaaaaaa-0000-0000-0000-000000000002'),
  ('userA',    '11111111-1111-1111-1111-111111111111'),
  ('userB',    '22222222-2222-2222-2222-222222222222'),
  ('albumA',   'bbbbbbbb-0000-0000-0000-000000000001'),
  ('albumB',   'bbbbbbbb-0000-0000-0000-000000000003'),
  ('photoA',   'cccccccc-0000-0000-0000-000000000001'),
  ('photoA2',  'cccccccc-0000-0000-0000-000000000002'),
  ('photoB',   'cccccccc-0000-0000-0000-0000000000b1'),
  ('postA',    'dddddddd-0000-0000-0000-000000000001'),
  ('postA2',   'dddddddd-0000-0000-0000-0000000000a2'),
  ('postB',    'dddddddd-0000-0000-0000-0000000000b1'),
  ('itemA',    '77777777-0000-0000-0000-0000000000a1'),
  ('itemA2',   '77777777-0000-0000-0000-0000000000a2'),
  ('itemB',    '77777777-0000-0000-0000-0000000000b1'),
  ('assetA',   '55555555-0000-0000-0000-0000000000a1'),
  ('assetA2',  '55555555-0000-0000-0000-0000000000a2'),
  ('assetB',   '55555555-0000-0000-0000-0000000000b1');

create function pg_temp.k(p text) returns uuid language sql stable as $$
  select id from pg_temp.k where name = p;
$$;


-- ── 0. A clean slate, and the parents the tests need ────────────────────────

do $$
declare n_a int; n_u int;
begin
  select count(*) into n_a from photo_assets;
  select count(*) into n_u from photo_usages;
  perform pg_temp.ok('photo_assets starts empty', '0', n_a::text);
  perform pg_temp.ok('photo_usages starts empty', '0', n_u::text);

  -- The fixture gives site B an album and nothing else.
  insert into photos (id, tenant_id, album_id, storage_path)
  values (pg_temp.k('photoB'), pg_temp.k('B'), pg_temp.k('albumB'), 't/two/photos/x/1/2400.webp');
  insert into blog_posts (id, tenant_id, title, slug, status) values
    (pg_temp.k('postA2'), pg_temp.k('A'), 'Second Light', 'second-light', 'published'),
    (pg_temp.k('postB'),  pg_temp.k('B'), 'Other Story',  'other-story',  'published');
  insert into catalog_items (id, tenant_id, photo_id) values
    (pg_temp.k('itemA'),  pg_temp.k('A'), pg_temp.k('photoA')),
    (pg_temp.k('itemA2'), pg_temp.k('A'), pg_temp.k('photoA2')),
    (pg_temp.k('itemB'),  pg_temp.k('B'), pg_temp.k('photoB'));

  -- Assets are NAMED with their site: there is no default to fall back on.
  insert into photo_assets (id, tenant_id, key_base, display_path) values
    (pg_temp.k('assetA'),  pg_temp.k('A'), 't/a/photos/1', 't/a/photos/1/2400.webp'),
    (pg_temp.k('assetA2'), pg_temp.k('A'), 't/a/photos/2', 't/a/photos/2/2400.webp'),
    (pg_temp.k('assetB'),  pg_temp.k('B'), 't/b/photos/1', 't/b/photos/1/2400.webp');
end $$;


-- ── 1. Columns: names, types, nullability, defaults, generation ─────────────
--
-- Compared as a set against the design (rev 6 §1, §2.2). A missing, extra or
-- altered column is listed by name.

create temp table want_cols (tbl text, col text, spec text);
insert into want_cols values
  ('photo_assets','id','uuid NO def:gen_random_uuid()'),
  ('photo_assets','tenant_id','uuid NO def:-'),
  ('photo_assets','key_base','text NO def:-'),
  ('photo_assets','original_path','text YES def:-'),
  ('photo_assets','display_path','text NO def:-'),
  ('photo_assets','derivatives','jsonb NO def:''{}''::jsonb'),
  ('photo_assets','original_bytes','bigint YES def:-'),
  ('photo_assets','content_type','text YES def:-'),
  ('photo_assets','filename','text YES def:-'),
  ('photo_assets','content_sha256','text YES def:-'),
  ('photo_assets','width','integer YES def:-'),
  ('photo_assets','height','integer YES def:-'),
  ('photo_assets','orientation','text YES generated'),
  ('photo_assets','aspect_ratio','numeric(8,4) YES generated'),
  ('photo_assets','taken_at','timestamp with time zone YES def:-'),
  ('photo_assets','latitude','double precision YES def:-'),
  ('photo_assets','longitude','double precision YES def:-'),
  ('photo_assets','camera_make','text YES def:-'),
  ('photo_assets','camera_model','text YES def:-'),
  ('photo_assets','lens','text YES def:-'),
  ('photo_assets','iso','integer YES def:-'),
  ('photo_assets','aperture','numeric(4,1) YES def:-'),
  ('photo_assets','shutter','text YES def:-'),
  ('photo_assets','focal_length','numeric(6,1) YES def:-'),
  ('photo_assets','keywords','text[] NO def:''{}''::text[]'),
  ('photo_assets','exif','jsonb NO def:''{}''::jsonb'),
  ('photo_assets','alt_text','text YES def:-'),
  ('photo_assets','alt_source','text YES def:-'),
  ('photo_assets','alt_reviewed_at','timestamp with time zone YES def:-'),
  ('photo_assets','state','text NO def:''pending''::text'),
  ('photo_assets','derived_at','timestamp with time zone YES def:-'),
  ('photo_assets','last_error','text YES def:-'),
  ('photo_assets','archived_at','timestamp with time zone YES def:-'),
  ('photo_assets','deleted_at','timestamp with time zone YES def:-'),
  ('photo_assets','original_purged_at','timestamp with time zone YES def:-'),
  ('photo_assets','created_by','uuid YES def:-'),
  ('photo_assets','created_at','timestamp with time zone NO def:now()'),
  ('photo_assets','updated_at','timestamp with time zone NO def:now()'),
  ('photo_usages','id','uuid NO def:gen_random_uuid()'),
  ('photo_usages','tenant_id','uuid NO def:-'),
  ('photo_usages','asset_id','uuid NO def:-'),
  ('photo_usages','scope','text NO def:''live''::text'),
  ('photo_usages','kind','text NO def:-'),
  ('photo_usages','photo_id','uuid YES def:-'),
  ('photo_usages','album_id','uuid YES def:-'),
  ('photo_usages','post_id','uuid YES def:-'),
  ('photo_usages','product_id','uuid YES def:-'),
  ('photo_usages','page_key','text YES def:-'),
  ('photo_usages','field','text NO def:-'),
  ('photo_usages','position','integer NO def:0'),
  ('photo_usages','alt_override','text YES def:-'),
  ('photo_usages','decorative','boolean NO def:false'),
  ('photo_usages','created_at','timestamp with time zone NO def:now()'),
  -- The two link columns: nullable, no default, and (block 2) no foreign key.
  ('photos','asset_id','uuid YES def:-'),
  ('site_images','asset_id','uuid YES def:-');

do $$
declare v_diff text; n_want int; n_have int;
begin
  with have as (
    select c.relname::text as tbl, a.attname::text as col,
           format_type(a.atttypid, a.atttypmod) || ' ' ||
           case when a.attnotnull then 'NO' else 'YES' end || ' ' ||
           case when a.attgenerated = 's' then 'generated'
                else 'def:' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') end as spec
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where c.relnamespace = 'public'::regnamespace
       and a.attnum > 0 and not a.attisdropped
       and (c.relname in ('photo_assets','photo_usages')
            or (c.relname in ('photos','site_images') and a.attname = 'asset_id'))
  )
  select string_agg(coalesce(w.tbl, h.tbl) || '.' || coalesce(w.col, h.col) || ' want[' ||
                    coalesce(w.spec, 'absent') || '] have[' || coalesce(h.spec, 'absent') || ']',
                    '; ' order by 1)
    into v_diff
    from want_cols w full join have h on h.tbl = w.tbl and h.col = w.col
   where w.spec is distinct from h.spec;

  perform pg_temp.ok('every column matches the design (type, null, default)',
                     'no differences', coalesce(v_diff, 'no differences'));

  select count(*) into n_want from want_cols where tbl like 'photo\_%';
  select count(*) into n_have from pg_attribute
   where attrelid in ('photo_assets'::regclass, 'photo_usages'::regclass)
     and attnum > 0 and not attisdropped;
  perform pg_temp.ok('column count, both tables', n_want::text, n_have::text);
end $$;

-- NO TENANT DEFAULT, proved by behaviour as well as by the catalogue: an insert
-- that does not name a site is a NOT NULL error rather than a row filed under
-- the oldest site on the platform.
do $$
begin
  perform pg_temp.ok('photo_assets.tenant_id has no default (catalogue)', 'none',
    coalesce((select pg_get_expr(adbin, adrelid) from pg_attrdef
               where adrelid = 'photo_assets'::regclass
                 and adnum = (select attnum from pg_attribute
                               where attrelid = 'photo_assets'::regclass and attname = 'tenant_id')), 'none'));
  perform pg_temp.ok('photo_usages.tenant_id has no default (catalogue)', 'none',
    coalesce((select pg_get_expr(adbin, adrelid) from pg_attrdef
               where adrelid = 'photo_usages'::regclass
                 and adnum = (select attnum from pg_attribute
                               where attrelid = 'photo_usages'::regclass and attname = 'tenant_id')), 'none'));

  perform pg_temp.ok('an asset that names no site is refused, not guessed',
    '23502 column tenant_id',
    pg_temp.try($q$insert into photo_assets (key_base, display_path)
                   values ('t/x/none', 't/x/none/2400.webp')$q$));
  perform pg_temp.ok('a usage that names no site is refused, not guessed',
    '23502 column tenant_id',
    pg_temp.try(format($q$insert into photo_usages (asset_id, kind, page_key, field)
                          values (%L, 'page_section', 'home', 'image_path')$q$, pg_temp.k('assetA'))));

  -- And the parents keep theirs: P1 does not change them.
  perform pg_temp.ok('photos.tenant_id default is unchanged', 'tenant_for_insert()',
    (select pg_get_expr(adbin, adrelid) from pg_attrdef
      where adrelid = 'photos'::regclass
        and adnum = (select attnum from pg_attribute where attrelid = 'photos'::regclass and attname = 'tenant_id')));

  -- The generated columns compute what the design says.
  insert into photo_assets (tenant_id, key_base, display_path, width, height)
  values (pg_temp.k('A'), 't/a/gen/1', 'x', 3000, 2000),
         (pg_temp.k('A'), 't/a/gen/2', 'x', 2000, 3000),
         (pg_temp.k('A'), 't/a/gen/3', 'x', 1000, 1000),
         (pg_temp.k('A'), 't/a/gen/4', 'x', 1000, 0),
         (pg_temp.k('A'), 't/a/gen/5', 'x', null, 1000);
  perform pg_temp.ok('orientation and aspect_ratio are generated correctly',
    't/a/gen/1:landscape:1.5000 t/a/gen/2:portrait:0.6667 t/a/gen/3:square:1.0000 t/a/gen/4:landscape:- t/a/gen/5:-:-',
    (select string_agg(key_base || ':' || coalesce(orientation, '-') || ':' || coalesce(aspect_ratio::text, '-'), ' ' order by key_base)
       from photo_assets where key_base like 't/a/gen/%'));
  delete from photo_assets where key_base like 't/a/gen/%';

  -- The content hash is indexed, NOT unique: the same bytes uploaded twice are
  -- two uploads. key_base is what is unique per site.
  perform pg_temp.ok('the same content_sha256 twice on one site is allowed', 'accepted',
    pg_temp.try(format($q$insert into photo_assets (tenant_id, key_base, display_path, content_sha256)
                          values (%1$L, 't/a/sha/1', 'x', 'abc'), (%1$L, 't/a/sha/2', 'x', 'abc')$q$, pg_temp.k('A'))));
  perform pg_temp.ok('the same key_base twice on one site is refused', '23505 photo_assets_key',
    pg_temp.try(format($q$insert into photo_assets (tenant_id, key_base, display_path)
                          values (%L, 't/a/photos/1', 'x')$q$, pg_temp.k('A'))));
  perform pg_temp.ok('the same key_base on ANOTHER site is allowed', 'accepted',
    pg_temp.try(format($q$insert into photo_assets (tenant_id, key_base, display_path)
                          values (%L, 't/a/photos/1', 'x')$q$, pg_temp.k('B'))));
  delete from photo_assets where key_base in ('t/a/sha/1', 't/a/sha/2')
     or (tenant_id = pg_temp.k('B') and key_base = 't/a/photos/1');
end $$;


-- ── 2. Constraints and foreign keys, exactly ────────────────────────────────

create temp table want_cons (tbl text, con text, def text);
insert into want_cons values
  ('albums','albums_id_tenant','UNIQUE (id, tenant_id)'),
  ('blog_posts','blog_posts_id_tenant','UNIQUE (id, tenant_id)'),
  ('catalog_items','catalog_items_id_tenant','UNIQUE (id, tenant_id)'),
  ('photos','photos_id_tenant','UNIQUE (id, tenant_id)'),
  ('photo_assets','photo_assets_pkey','PRIMARY KEY (id)'),
  ('photo_assets','photo_assets_id_tenant','UNIQUE (id, tenant_id)'),
  ('photo_assets','photo_assets_tenant_fk','FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE'),
  ('photo_assets','photo_assets_created_by_fk','FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL'),
  ('photo_assets','photo_assets_state_known','CHECK ((state = ANY (ARRAY[''pending''::text, ''derived''::text, ''failed''::text])))'),
  ('photo_assets','photo_assets_alt_source_known','CHECK (((alt_source IS NULL) OR (alt_source = ANY (ARRAY[''photographer''::text, ''ai''::text]))))'),
  ('photo_assets','photo_assets_alt_source_present','CHECK (((alt_text IS NULL) OR (alt_source IS NOT NULL)))'),
  ('photo_usages','photo_usages_pkey','PRIMARY KEY (id)'),
  ('photo_usages','photo_usages_tenant_fk','FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE'),
  ('photo_usages','photo_usages_asset_fk','FOREIGN KEY (asset_id, tenant_id) REFERENCES photo_assets(id, tenant_id) ON DELETE RESTRICT'),
  ('photo_usages','photo_usages_photo_fk','FOREIGN KEY (photo_id, tenant_id) REFERENCES photos(id, tenant_id) ON DELETE CASCADE'),
  ('photo_usages','photo_usages_album_fk','FOREIGN KEY (album_id, tenant_id) REFERENCES albums(id, tenant_id) ON DELETE CASCADE'),
  ('photo_usages','photo_usages_post_fk','FOREIGN KEY (post_id, tenant_id) REFERENCES blog_posts(id, tenant_id) ON DELETE CASCADE'),
  ('photo_usages','photo_usages_product_fk','FOREIGN KEY (product_id, tenant_id) REFERENCES catalog_items(id, tenant_id) ON DELETE CASCADE'),
  ('photo_usages','photo_usages_kind_known','CHECK ((kind = ANY (ARRAY[''gallery''::text, ''gallery_cover''::text, ''page_section''::text, ''page_legacy''::text, ''page_share''::text, ''story_cover''::text, ''story_block''::text, ''shop_listing''::text])))'),
  ('photo_usages','photo_usages_scope_known','CHECK ((scope = ANY (ARRAY[''live''::text, ''draft''::text])))'),
  ('photo_usages','photo_usages_share_slot','CHECK (((kind <> ''page_share''::text) OR ((field = ''page_seo.image''::text) AND ("position" = 0))))'),
  ('photo_usages','photo_usages_scope_by_kind','CHECK (((scope = ''live''::text) OR (kind = ANY (ARRAY[''page_section''::text, ''page_legacy''::text, ''page_share''::text]))))'),
  ('photo_usages','photo_usages_page_key_shape','CHECK (((page_key IS NULL) OR (page_key = ANY (ARRAY[''home''::text, ''about''::text, ''contact''::text, ''journal''::text, ''galleries''::text, ''shop''::text, ''notfound''::text])) OR (page_key ~ ''^p_[a-z0-9]{8}$''::text)))'),
  ('photo_usages','photo_usages_one_parent','CHECK ((((kind = ''gallery''::text) AND (photo_id IS NOT NULL) AND (album_id IS NULL) AND (post_id IS NULL) AND (product_id IS NULL) AND (page_key IS NULL)) OR ((kind = ''gallery_cover''::text) AND (album_id IS NOT NULL) AND (photo_id IS NULL) AND (post_id IS NULL) AND (product_id IS NULL) AND (page_key IS NULL)) OR ((kind = ANY (ARRAY[''story_cover''::text, ''story_block''::text])) AND (post_id IS NOT NULL) AND (photo_id IS NULL) AND (album_id IS NULL) AND (product_id IS NULL) AND (page_key IS NULL)) OR ((kind = ''shop_listing''::text) AND (product_id IS NOT NULL) AND (photo_id IS NULL) AND (album_id IS NULL) AND (post_id IS NULL) AND (page_key IS NULL)) OR ((kind = ANY (ARRAY[''page_section''::text, ''page_legacy''::text, ''page_share''::text])) AND (page_key IS NOT NULL) AND (photo_id IS NULL) AND (album_id IS NULL) AND (post_id IS NULL) AND (product_id IS NULL))))');

do $$
declare v_diff text; v_fk text;
begin
  with have as (
    select conrelid::regclass::text as tbl, conname::text as con, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid in ('photo_assets'::regclass, 'photo_usages'::regclass)
        or conname in ('photos_id_tenant','albums_id_tenant','blog_posts_id_tenant','catalog_items_id_tenant')
  )
  select string_agg(coalesce(w.con, h.con) || ' want[' || coalesce(w.def, 'absent') ||
                    '] have[' || coalesce(h.def, 'absent') || ']', '; ' order by 1)
    into v_diff
    from want_cons w full join have h on h.con = w.con and h.tbl = w.tbl
   where w.def is distinct from h.def;
  perform pg_temp.ok('every constraint and foreign key matches the design',
                     'no differences', coalesce(v_diff, 'no differences'));

  -- The link columns have NO foreign key yet (P4 adds them).
  select string_agg(conrelid::regclass || '.' || conname, ', ') into v_fk
    from pg_constraint
   where contype = 'f'
     and conrelid in ('photos'::regclass, 'site_images'::regclass)
     and conkey @> array[(select attnum from pg_attribute
                           where attrelid = conrelid and attname = 'asset_id')];
  perform pg_temp.ok('photos.asset_id / site_images.asset_id have no foreign key yet',
                     'none', coalesce(v_fk, 'none'));
end $$;


-- ── 3. Indexes, exactly ─────────────────────────────────────────────────────

create temp table want_idx (idx text, def text);
insert into want_idx values
  ('photo_assets_pkey',       'CREATE UNIQUE INDEX photo_assets_pkey ON public.photo_assets USING btree (id)'),
  ('photo_assets_id_tenant',  'CREATE UNIQUE INDEX photo_assets_id_tenant ON public.photo_assets USING btree (id, tenant_id)'),
  ('photo_assets_key',        'CREATE UNIQUE INDEX photo_assets_key ON public.photo_assets USING btree (tenant_id, key_base)'),
  ('photo_assets_sha',        'CREATE INDEX photo_assets_sha ON public.photo_assets USING btree (tenant_id, content_sha256) WHERE (content_sha256 IS NOT NULL)'),
  ('photo_assets_library',    'CREATE INDEX photo_assets_library ON public.photo_assets USING btree (tenant_id, created_at DESC) WHERE ((deleted_at IS NULL) AND (archived_at IS NULL))'),
  ('photo_assets_unfinished', 'CREATE INDEX photo_assets_unfinished ON public.photo_assets USING btree (state) WHERE (state = ANY (ARRAY[''pending''::text, ''failed''::text]))'),
  ('photo_assets_sweep',      'CREATE INDEX photo_assets_sweep ON public.photo_assets USING btree (deleted_at) WHERE (deleted_at IS NOT NULL)'),
  ('photo_assets_no_alt',     'CREATE INDEX photo_assets_no_alt ON public.photo_assets USING btree (tenant_id) WHERE ((alt_text IS NULL) AND (deleted_at IS NULL))'),
  ('photo_usages_pkey',       'CREATE UNIQUE INDEX photo_usages_pkey ON public.photo_usages USING btree (id)'),
  ('photo_usages_slot_gallery',     'CREATE UNIQUE INDEX photo_usages_slot_gallery ON public.photo_usages USING btree (photo_id) WHERE (kind = ''gallery''::text)'),
  ('photo_usages_slot_cover',       'CREATE UNIQUE INDEX photo_usages_slot_cover ON public.photo_usages USING btree (album_id, field) WHERE (kind = ''gallery_cover''::text)'),
  ('photo_usages_slot_section',     'CREATE UNIQUE INDEX photo_usages_slot_section ON public.photo_usages USING btree (tenant_id, scope, page_key, "position", field) WHERE (kind = ''page_section''::text)'),
  ('photo_usages_slot_legacy',      'CREATE UNIQUE INDEX photo_usages_slot_legacy ON public.photo_usages USING btree (tenant_id, scope, page_key, field) WHERE (kind = ''page_legacy''::text)'),
  ('photo_usages_slot_story_cover', 'CREATE UNIQUE INDEX photo_usages_slot_story_cover ON public.photo_usages USING btree (post_id) WHERE (kind = ''story_cover''::text)'),
  ('photo_usages_slot_story_block', 'CREATE UNIQUE INDEX photo_usages_slot_story_block ON public.photo_usages USING btree (post_id, field, "position") WHERE (kind = ''story_block''::text)'),
  ('photo_usages_slot_shop',        'CREATE UNIQUE INDEX photo_usages_slot_shop ON public.photo_usages USING btree (product_id) WHERE (kind = ''shop_listing''::text)'),
  ('photo_usages_slot_share',       'CREATE UNIQUE INDEX photo_usages_slot_share ON public.photo_usages USING btree (tenant_id, scope, page_key) WHERE (kind = ''page_share''::text)'),
  ('photo_usages_asset',      'CREATE INDEX photo_usages_asset ON public.photo_usages USING btree (asset_id)'),
  ('photo_usages_needs_alt',  'CREATE INDEX photo_usages_needs_alt ON public.photo_usages USING btree (tenant_id, asset_id) WHERE ((scope = ''live''::text) AND (decorative = false) AND (alt_override IS NULL))'),
  -- The four parent targets are indexes too.
  ('photos_id_tenant',        'CREATE UNIQUE INDEX photos_id_tenant ON public.photos USING btree (id, tenant_id)'),
  ('albums_id_tenant',        'CREATE UNIQUE INDEX albums_id_tenant ON public.albums USING btree (id, tenant_id)'),
  ('blog_posts_id_tenant',    'CREATE UNIQUE INDEX blog_posts_id_tenant ON public.blog_posts USING btree (id, tenant_id)'),
  ('catalog_items_id_tenant', 'CREATE UNIQUE INDEX catalog_items_id_tenant ON public.catalog_items USING btree (id, tenant_id)');

do $$
declare v_diff text;
begin
  with have as (
    select indexrelid::regclass::text as idx, pg_get_indexdef(indexrelid) as def
      from pg_index
     where indrelid in ('photo_assets'::regclass, 'photo_usages'::regclass)
        or indexrelid::regclass::text in ('photos_id_tenant','albums_id_tenant','blog_posts_id_tenant','catalog_items_id_tenant')
  )
  select string_agg(coalesce(w.idx, h.idx) || ' want[' || coalesce(w.def, 'absent') ||
                    '] have[' || coalesce(h.def, 'absent') || ']', '; ' order by 1)
    into v_diff
    from want_idx w full join have h on h.idx = w.idx
   where w.def is distinct from h.def;
  perform pg_temp.ok('every index matches the design (incl. 8 partial slot indexes)',
                     'no differences', coalesce(v_diff, 'no differences'));
end $$;


-- ── 4. CHECKs refuse the shapes they exist to refuse ────────────────────────
--
-- Each valid-looking except for one thing, so the constraint named is the only
-- one that could have fired.

do $$
declare
  v_a  uuid := pg_temp.k('A');
  v_as uuid := pg_temp.k('assetA');
  ins  text := 'insert into photo_usages (tenant_id, asset_id, scope, kind, photo_id, album_id, post_id, product_id, page_key, field) values ';
begin
  perform pg_temp.ok('asset state outside pending/derived/failed', '23514 photo_assets_state_known',
    pg_temp.try(format($q$insert into photo_assets (tenant_id, key_base, display_path, state) values (%L, 't/c/1', 'x', 'analyzed')$q$, v_a)));
  perform pg_temp.ok('asset alt_source outside photographer/ai', '23514 photo_assets_alt_source_known',
    pg_temp.try(format($q$insert into photo_assets (tenant_id, key_base, display_path, alt_text, alt_source) values (%L, 't/c/2', 'x', 'a heron', 'robot')$q$, v_a)));
  perform pg_temp.ok('asset alt_text with no alt_source', '23514 photo_assets_alt_source_present',
    pg_temp.try(format($q$insert into photo_assets (tenant_id, key_base, display_path, alt_text) values (%L, 't/c/3', 'x', 'a heron')$q$, v_a)));

  perform pg_temp.ok('an unknown kind', '23514 photo_usages_kind_known',
    pg_temp.try(ins || format($q$(%L, %L, 'live', 'portfolio', null, null, null, null, 'home', 'image_path')$q$, v_a, v_as)));
  perform pg_temp.ok('an unknown scope', '23514 photo_usages_scope_known',
    pg_temp.try(ins || format($q$(%L, %L, 'preview', 'page_section', null, null, null, null, 'home', 'image_path')$q$, v_a, v_as)));
  perform pg_temp.ok('a draft-scoped story_block', '23514 photo_usages_scope_by_kind',
    pg_temp.try(ins || format($q$(%L, %L, 'draft', 'story_block', null, null, %L, null, null, 'block:x')$q$, v_a, v_as, pg_temp.k('postA'))));
  perform pg_temp.ok('a draft-scoped gallery', '23514 photo_usages_scope_by_kind',
    pg_temp.try(ins || format($q$(%L, %L, 'draft', 'gallery', %L, null, null, null, null, 'photo')$q$, v_a, v_as, pg_temp.k('photoA'))));
  perform pg_temp.ok('a gallery usage with a page_key', '23514 photo_usages_one_parent',
    pg_temp.try(ins || format($q$(%L, %L, 'live', 'gallery', %L, null, null, null, 'home', 'photo')$q$, v_a, v_as, pg_temp.k('photoA'))));
  perform pg_temp.ok('a page_section usage with an album_id', '23514 photo_usages_one_parent',
    pg_temp.try(ins || format($q$(%L, %L, 'live', 'page_section', null, %L, null, null, 'home', 'image_path')$q$, v_a, v_as, pg_temp.k('albumA'))));
  perform pg_temp.ok('a page_section usage with no page_key', '23514 photo_usages_one_parent',
    pg_temp.try(ins || format($q$(%L, %L, 'live', 'page_section', null, null, null, null, null, 'image_path')$q$, v_a, v_as)));
  perform pg_temp.ok('a gallery usage with no photo', '23514 photo_usages_one_parent',
    pg_temp.try(ins || format($q$(%L, %L, 'live', 'gallery', null, null, null, null, null, 'photo')$q$, v_a, v_as)));
  perform pg_temp.ok('a story_cover with a product as well', '23514 photo_usages_one_parent',
    pg_temp.try(ins || format($q$(%L, %L, 'live', 'story_cover', null, null, %L, %L, null, 'featured_custom_path')$q$, v_a, v_as, pg_temp.k('postA'), pg_temp.k('itemA'))));
  perform pg_temp.ok('a shop_listing with no product', '23514 photo_usages_one_parent',
    pg_temp.try(ins || format($q$(%L, %L, 'live', 'shop_listing', null, null, null, null, null, 'photo')$q$, v_a, v_as)));
  perform pg_temp.ok('a page_section on a malformed page key', '23514 photo_usages_page_key_shape',
    pg_temp.try(ins || format($q$(%L, %L, 'live', 'page_section', null, null, null, null, 'Home', 'image_path')$q$, v_a, v_as)));
  perform pg_temp.ok('a page_legacy on a custom key one character short', '23514 photo_usages_page_key_shape',
    pg_temp.try(ins || format($q$(%L, %L, 'live', 'page_legacy', null, null, null, null, 'p_abcdefg', 'hero_image_path')$q$, v_a, v_as)));
  perform pg_temp.ok('a custom key in capitals (CUSTOM_KEY is lower-case)', '23514 photo_usages_page_key_shape',
    pg_temp.try(ins || format($q$(%L, %L, 'live', 'page_section', null, null, null, null, 'p_A1B2C3D4', 'image_path')$q$, v_a, v_as)));
  perform pg_temp.ok('the 404 page IS a page (isPageKey includes it)', 'accepted',
    pg_temp.try(ins || format($q$(%L, %L, 'live', 'page_section', null, null, null, null, 'notfound', 'image_path')$q$, v_a, v_as)));
  perform pg_temp.ok('a custom page key is a page', 'accepted',
    pg_temp.try(ins || format($q$(%L, %L, 'draft', 'page_section', null, null, null, null, 'p_a1b2c3d4', 'image_path')$q$, v_a, v_as)));
  delete from photo_usages;
end $$;


-- ── 5. Uniqueness — one logical slot, one row, for each of the eight kinds ──
--
-- For each kind: the slot is filled; the SAME SLOT pointing at a DIFFERENT
-- photograph is refused by that kind's own index (named); and a neighbouring
-- slot that differs only in its discriminator is accepted, so the index is not
-- stricter than the design either.

do $$
declare
  v_a   uuid := pg_temp.k('A');
  a1    uuid := pg_temp.k('assetA');
  a2    uuid := pg_temp.k('assetA2');
  ins   text := 'insert into photo_usages (tenant_id, asset_id, scope, kind, photo_id, album_id, post_id, product_id, page_key, field, position) values ';
  r     record;
begin
  for r in
    select * from (values
      ('gallery',       'photo_usages_slot_gallery',
         format($q$'live','gallery',%L,null,null,null,null,'photo',0$q$, pg_temp.k('photoA')),
         format($q$'live','gallery',%L,null,null,null,null,'photo',0$q$, pg_temp.k('photoA2')),
         'another photograph in the gallery'),
      ('gallery_cover', 'photo_usages_slot_cover',
         format($q$'live','gallery_cover',null,%L,null,null,null,'cover_photo_id',0$q$, pg_temp.k('albumA')),
         format($q$'live','gallery_cover',null,%L,null,null,null,'cover_custom_path',0$q$, pg_temp.k('albumA')),
         'the same album''s other cover field'),
      ('page_section',  'photo_usages_slot_section',
         $q$'live','page_section',null,null,null,null,'home','image_path',2$q$,
         $q$'live','page_section',null,null,null,null,'home','image_path',3$q$,
         'a second section of the same type at another position'),
      ('page_section (draft beside live)', 'photo_usages_slot_section',
         $q$'draft','page_section',null,null,null,null,'home','image_path',2$q$,
         $q$'draft','page_section',null,null,null,null,'about','image_path',2$q$,
         'the same slot on another page'),
      ('page_legacy',   'photo_usages_slot_legacy',
         $q$'live','page_legacy',null,null,null,null,'home','hero_image_path',0$q$,
         $q$'live','page_legacy',null,null,null,null,'home','intro_image_path',0$q$,
         'another legacy column'),
      ('story_cover',   'photo_usages_slot_story_cover',
         format($q$'live','story_cover',null,null,%L,null,null,'featured_custom_path',0$q$, pg_temp.k('postA')),
         format($q$'live','story_cover',null,null,%L,null,null,'featured_custom_path',0$q$, pg_temp.k('postA2')),
         'another story''s cover'),
      ('story_block',   'photo_usages_slot_story_block',
         format($q$'live','story_block',null,null,%L,null,null,'block:b1',0$q$, pg_temp.k('postA')),
         format($q$'live','story_block',null,null,%L,null,null,'block:b1',1$q$, pg_temp.k('postA')),
         'the next image in the same block'),
      ('shop_listing',  'photo_usages_slot_shop',
         format($q$'live','shop_listing',null,null,null,%L,null,'photo',0$q$, pg_temp.k('itemA')),
         format($q$'live','shop_listing',null,null,null,%L,null,'photo',0$q$, pg_temp.k('itemA2')),
         'another catalog listing'),
      ('page_share',    'photo_usages_slot_share',
         $q$'live','page_share',null,null,null,null,'home','page_seo.image',0$q$,
         $q$'live','page_share',null,null,null,null,'about','page_seo.image',0$q$,
         'another page''s share image'),
      ('page_share (draft beside live)', 'photo_usages_slot_share',
         $q$'draft','page_share',null,null,null,null,'home','page_seo.image',0$q$,
         $q$'draft','page_share',null,null,null,null,'about','page_seo.image',0$q$,
         'the draft''s share image of another page')
    ) as v(kind, idx, slot, neighbour, neighbour_is)
  loop
    perform pg_temp.ok(r.kind || ': the slot takes a photograph', 'accepted',
      pg_temp.try(ins || format('(%L,%L,', v_a, a1) || r.slot || ')'));
    perform pg_temp.ok(r.kind || ': the same slot, another photograph', '23505 ' || r.idx,
      pg_temp.try(ins || format('(%L,%L,', v_a, a2) || r.slot || ')'));
    perform pg_temp.ok(r.kind || ': the same slot, the SAME photograph again', '23505 ' || r.idx,
      pg_temp.try(ins || format('(%L,%L,', v_a, a1) || r.slot || ')'));
    perform pg_temp.ok(r.kind || ': ' || r.neighbour_is || ' is its own slot', 'accepted',
      pg_temp.try(ins || format('(%L,%L,', v_a, a2) || r.neighbour || ')'));
  end loop;

  -- draft and live are separate slots for the same page position.
  perform pg_temp.ok('page_section: live and draft of one position are two slots', '2',
    (select count(*)::text from photo_usages
      where kind = 'page_section' and page_key = 'home' and position = 2 and field = 'image_path'));

  delete from photo_usages;
end $$;

/*
 * THE DEFECT THE PARTIAL INDEXES CORRECT, shown rather than asserted.
 *
 * A copy of photo_usages with every CHECK but none of the slot indexes, given
 * instead the single wide UNIQUE the design rejected: every descriptive column
 * at once. Every kind leaves at least three of the four parent columns NULL,
 * and a unique constraint is NULLS DISTINCT, so the byte-identical duplicate is
 * accepted for ALL EIGHT kinds. It looked like protection and provided none.
 */
create temp table wide_demo (like photo_usages including defaults including constraints);
alter table wide_demo add constraint wide_demo_one_unique
  unique (tenant_id, asset_id, scope, kind, photo_id, album_id, post_id, product_id, page_key, field, position);

do $$
declare
  v_a text := pg_temp.k('A');
  a1  text := pg_temp.k('assetA');
  r   record;
  n   int;
  first_try text;
  second_try text;
begin
  for r in
    select * from (values
      ('gallery',       format($q$'gallery',%L,null,null,null,null,'photo'$q$, pg_temp.k('photoA'))),
      ('gallery_cover', format($q$'gallery_cover',null,%L,null,null,null,'cover_photo_id'$q$, pg_temp.k('albumA'))),
      ('page_section',  $q$'page_section',null,null,null,null,'home','image_path'$q$),
      ('page_legacy',   $q$'page_legacy',null,null,null,null,'home','hero_image_path'$q$),
      ('story_cover',   format($q$'story_cover',null,null,%L,null,null,'featured_custom_path'$q$, pg_temp.k('postA'))),
      ('story_block',   format($q$'story_block',null,null,%L,null,null,'block:b1'$q$, pg_temp.k('postA'))),
      ('shop_listing',  format($q$'shop_listing',null,null,null,%L,null,'photo'$q$, pg_temp.k('itemA'))),
      ('page_share',    $q$'page_share',null,null,null,null,'home','page_seo.image'$q$)
    ) as v(kind, rest)
  loop
    first_try  := pg_temp.try(format('insert into wide_demo (tenant_id, asset_id, kind, photo_id, album_id, post_id, product_id, page_key, field) values (%L,%L,', v_a, a1) || r.rest || ')');
    second_try := pg_temp.try(format('insert into wide_demo (tenant_id, asset_id, kind, photo_id, album_id, post_id, product_id, page_key, field) values (%L,%L,', v_a, a1) || r.rest || ')');
    select count(*) into n from wide_demo where kind = r.kind;
    perform pg_temp.ok('DEFECT DEMO, one wide UNIQUE: ' || r.kind || ' duplicate admitted',
                       'accepted / accepted, 2 rows', first_try || ' / ' || second_try || ', ' || n || ' rows');
  end loop;
end $$;
drop table wide_demo;


-- ── 6. Cross-tenant references are refused by the foreign keys (OWNER) ──────
--
-- As the table owner: no RLS, every privilege. A refusal here can only be a
-- constraint, and each assertion says which.

do $$
declare
  v_a  uuid := pg_temp.k('A');
  v_b  uuid := pg_temp.k('B');
  a1   uuid := pg_temp.k('assetA');
  ins  text := 'insert into photo_usages (tenant_id, asset_id, kind, photo_id, album_id, post_id, product_id, page_key, field) values ';
  v_u  uuid;
  res  text;
begin
  perform pg_temp.ok('site A usage -> site B ASSET', '23503 photo_usages_asset_fk',
    pg_temp.try(ins || format($q$(%L,%L,'page_section',null,null,null,null,'home','image_path')$q$, v_a, pg_temp.k('assetB'))));
  perform pg_temp.ok('site A usage -> site B PHOTO', '23503 photo_usages_photo_fk',
    pg_temp.try(ins || format($q$(%L,%L,'gallery',%L,null,null,null,null,'photo')$q$, v_a, a1, pg_temp.k('photoB'))));
  perform pg_temp.ok('site A usage -> site B ALBUM', '23503 photo_usages_album_fk',
    pg_temp.try(ins || format($q$(%L,%L,'gallery_cover',null,%L,null,null,null,'cover_photo_id')$q$, v_a, a1, pg_temp.k('albumB'))));
  perform pg_temp.ok('site A usage -> site B BLOG POST', '23503 photo_usages_post_fk',
    pg_temp.try(ins || format($q$(%L,%L,'story_cover',null,null,%L,null,null,'featured_custom_path')$q$, v_a, a1, pg_temp.k('postB'))));
  perform pg_temp.ok('site A usage -> site B CATALOG ITEM', '23503 photo_usages_product_fk',
    pg_temp.try(ins || format($q$(%L,%L,'shop_listing',null,null,null,%L,null,'photo')$q$, v_a, a1, pg_temp.k('itemB'))));
  perform pg_temp.ok('a usage naming a site that does not exist', '23503 photo_usages_tenant_fk',
    pg_temp.try(ins || format($q$('99999999-9999-9999-9999-999999999999',%L,'page_section',null,null,null,null,'home','image_path')$q$, a1)));

  -- The control: the same five, each on its own site, are fine.
  perform pg_temp.ok('same-site references of all five kinds are accepted', 'accepted',
    pg_temp.try(ins || format($q$(%1$L,%2$L,'page_section',null,null,null,null,'home','image_path'),
                                  (%1$L,%2$L,'gallery',%3$L,null,null,null,null,'photo'),
                                  (%1$L,%2$L,'gallery_cover',null,%4$L,null,null,null,'cover_photo_id'),
                                  (%1$L,%2$L,'story_cover',null,null,%5$L,null,null,'featured_custom_path'),
                                  (%1$L,%2$L,'shop_listing',null,null,null,%6$L,null,'photo')$q$,
                              v_a, a1, pg_temp.k('photoA'), pg_temp.k('albumA'), pg_temp.k('postA'), pg_temp.k('itemA'))));

  -- REASSIGNING A USAGE. Moving only its site breaks the asset reference (and
  -- the parent's) — refused by a foreign key.
  select id into v_u from photo_usages where kind = 'gallery' and tenant_id = v_a;
  res := pg_temp.try(format('update photo_usages set tenant_id = %L where id = %L', v_b, v_u));
  perform pg_temp.ok('moving a usage to another site (asset still site A)', '23503 (a photo_usages FK)',
    case when res in ('23503 photo_usages_asset_fk', '23503 photo_usages_photo_fk')
         then '23503 (a photo_usages FK)' else res end);
  -- Moving its site AND its asset to B leaves only the parent disagreeing, so
  -- the parent's key is the one that must refuse.
  perform pg_temp.ok('moving a usage and its asset to B, parent photo still A', '23503 photo_usages_photo_fk',
    pg_temp.try(format('update photo_usages set tenant_id = %L, asset_id = %L where id = %L', v_b, pg_temp.k('assetB'), v_u)));

  -- REASSIGNING A PARENT that a usage points at.
  perform pg_temp.ok('moving a used PHOTO to another site', '23503 photo_usages_photo_fk',
    pg_temp.try(format('update photos set tenant_id = %L where id = %L', v_b, pg_temp.k('photoA'))));
  perform pg_temp.ok('moving a used ALBUM to another site', '23503 photo_usages_album_fk',
    pg_temp.try(format('update albums set tenant_id = %L where id = %L', v_b, pg_temp.k('albumA'))));
  perform pg_temp.ok('moving a used BLOG POST to another site', '23503 photo_usages_post_fk',
    pg_temp.try(format('update blog_posts set tenant_id = %L where id = %L', v_b, pg_temp.k('postA'))));
  perform pg_temp.ok('moving a used CATALOG ITEM to another site', '23503 photo_usages_product_fk',
    pg_temp.try(format('update catalog_items set tenant_id = %L where id = %L', v_b, pg_temp.k('itemA'))));
  perform pg_temp.ok('moving a used ASSET to another site', '23503 photo_usages_asset_fk',
    pg_temp.try(format('update photo_assets set tenant_id = %L where id = %L', v_b, a1)));

  delete from photo_usages;
end $$;

/*
 * AND THE SAME FIVE AGAINST A PLAIN FOREIGN KEY — the hole the design closes.
 *
 * Each composite key is swapped, inside a block that is always undone, for the
 * single-column `references parent(id)` a first draft would have written. The
 * cross-tenant row that section 6 saw refused is then ACCEPTED. So the refusals
 * above are the composite keys' doing, and these tests can tell the difference.
 */
do $$
declare
  v_a  uuid := pg_temp.k('A');
  a1   uuid := pg_temp.k('assetA');
  r    record;
  got  text;
begin
  for r in
    select * from (values
      ('photo_usages_asset_fk',   'asset_id',   'photo_assets',
         format($q$(%L,%L,'page_section',null,null,null,null,'home','image_path')$q$, v_a, pg_temp.k('assetB'))),
      ('photo_usages_photo_fk',   'photo_id',   'photos',
         format($q$(%L,%L,'gallery',%L,null,null,null,null,'photo')$q$, v_a, a1, pg_temp.k('photoB'))),
      ('photo_usages_album_fk',   'album_id',   'albums',
         format($q$(%L,%L,'gallery_cover',null,%L,null,null,null,'cover_photo_id')$q$, v_a, a1, pg_temp.k('albumB'))),
      ('photo_usages_post_fk',    'post_id',    'blog_posts',
         format($q$(%L,%L,'story_cover',null,null,%L,null,null,'featured_custom_path')$q$, v_a, a1, pg_temp.k('postB'))),
      ('photo_usages_product_fk', 'product_id', 'catalog_items',
         format($q$(%L,%L,'shop_listing',null,null,null,%L,null,'photo')$q$, v_a, a1, pg_temp.k('itemB')))
    ) as v(con, col, parent, row_sql)
  loop
    begin
      execute format('alter table photo_usages drop constraint %I', r.con);
      execute format('alter table photo_usages add constraint %I foreign key (%I) references %I (id)',
                     r.con || '_plain', r.col, r.parent);
      got := pg_temp.try('insert into photo_usages (tenant_id, asset_id, kind, photo_id, album_id, post_id, product_id, page_key, field) values ' || r.row_sql);
      raise exception 'undo' using errcode = 'P0001';
    exception when sqlstate 'P0001' then
      null;  -- the swap and the row are undone; `got` survives
    end;
    perform pg_temp.ok('DEFECT DEMO, plain FK instead of ' || r.con || ': cross-tenant row',
                       'accepted', got);
  end loop;

  perform pg_temp.ok('and every composite key is back afterwards', '5',
    (select count(*)::text from pg_constraint
      where conrelid = 'photo_usages'::regclass and contype = 'f' and array_length(conkey, 1) = 2));
end $$;


-- ── 7. Deletion: tenant cascade vs the asset's RESTRICT ─────────────────────
--
-- The design has photo_assets.tenant_id and photo_usages.tenant_id cascading
-- from tenants, and photo_usages.asset_id RESTRICT. Whether deleting a site
-- that holds a used asset succeeds was to be MEASURED, not reasoned about. If
-- this block fails, P1 stops: RESTRICT is not to be changed to make it pass.

do $$
declare
  v_t  uuid := '99999999-0000-0000-0000-000000000009';
  v_as uuid := '99999999-0000-0000-0000-0000000000a1';
  res  text;
  n_t int; n_a int; n_u int;
begin
  insert into tenants (id, name, domain) values (v_t, 'Throwaway — rolled back', 'throwaway.invalid');
  insert into photo_assets (id, tenant_id, key_base, display_path)
  values (v_as, v_t, 't/throwaway/1', 't/throwaway/1/2400.webp');
  insert into photo_usages (tenant_id, asset_id, kind, page_key, field)
  values (v_t, v_as, 'page_section', 'home', 'image_path'),
         (v_t, v_as, 'page_legacy',  'home', 'hero_image_path');

  res := pg_temp.try(format('delete from tenants where id = %L', v_t));
  select count(*) into n_t from tenants      where id = v_t;
  select count(*) into n_a from photo_assets where tenant_id = v_t;
  select count(*) into n_u from photo_usages where tenant_id = v_t;

  perform pg_temp.ok('deleting a site holding a USED asset succeeds', 'accepted', res);
  perform pg_temp.ok('and the site, its asset and its usages are all gone', '0/0/0',
                     n_t || '/' || n_a || '/' || n_u);
end $$;

-- RESTRICT still restricts on its own: a photograph that is placed somewhere
-- cannot be deleted directly. (What deletion SHOULD do is P6.)
--
-- Inside a block that is always undone: with a broken key (a CASCADE here, say)
-- the delete SUCCEEDS, and every later block would then trip over the missing
-- asset and lose the report. Undoing it keeps the failure a line in the report.
do $$
declare
  v_a  uuid := pg_temp.k('A');
  used text;
  free text;
begin
  begin
    insert into photo_usages (tenant_id, asset_id, kind, page_key, field)
    values (v_a, pg_temp.k('assetA'), 'page_section', 'home', 'image_path');
    used := pg_temp.try(format('delete from photo_assets where id = %L', pg_temp.k('assetA')));
    free := pg_temp.try(format('delete from photo_assets where id = %L', pg_temp.k('assetA2')));
    raise exception 'undo' using errcode = 'P0001';
  exception when sqlstate 'P0001' then null;
  end;
  perform pg_temp.ok('deleting a USED asset directly is refused', '23503 photo_usages_asset_fk', used);
  perform pg_temp.ok('deleting an UNUSED asset directly is allowed', 'accepted', free);
end $$;

-- And a placement dies with the thing it was placed in (each parent cascade),
-- each inside a block that is undone so the next starts from the same data.
do $$
declare
  v_a uuid := pg_temp.k('A');
  a1  uuid := pg_temp.k('assetA');
  r   record;
  n   int;
begin
  for r in
    select * from (values
      ('a gallery PHOTO',  format($q$('gallery',%L,null,null,null,null,'photo')$q$, pg_temp.k('photoA2')),
                           format('delete from photos where id = %L', pg_temp.k('photoA2'))),
      ('an ALBUM',         format($q$('gallery_cover',null,%L,null,null,null,'cover_photo_id')$q$, pg_temp.k('albumA')),
                           format('delete from albums where id = %L', pg_temp.k('albumA'))),
      ('a BLOG POST',      format($q$('story_block',null,null,%L,null,null,'block:b1')$q$, pg_temp.k('postA2')),
                           format('delete from blog_posts where id = %L', pg_temp.k('postA2'))),
      ('a CATALOG ITEM',   format($q$('shop_listing',null,null,null,%L,null,'photo')$q$, pg_temp.k('itemA2')),
                           format('delete from catalog_items where id = %L', pg_temp.k('itemA2')))
    ) as v(what, row_sql, del)
  loop
    begin
      execute format('insert into photo_usages (tenant_id, asset_id, kind, photo_id, album_id, post_id, product_id, page_key, field) values (%L,%L,', v_a, a1)
              || substr(r.row_sql, 2);
      execute r.del;
      select count(*) into n from photo_usages;
      raise exception 'undo' using errcode = 'P0001';
    exception when sqlstate 'P0001' then null;
    end;
    perform pg_temp.ok('deleting ' || r.what || ' removes its usage', '0', n::text);
  end loop;
end $$;


-- ── 8. Grants: exactly SELECT for authenticated, nothing for anyone else ────

do $$
declare
  t    text;
  r    text;
  got  text;
  want text;
begin
  foreach t in array array['photo_assets', 'photo_usages'] loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      select coalesce(string_agg(p, ',' order by p), 'none') into got
        from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
       where has_table_privilege(r, 'public.' || t, p);
      want := case r when 'authenticated' then 'SELECT' else 'none' end;
      perform pg_temp.ok(format('%s holds exactly this on %s', r, t), want, got);
    end loop;

    -- PUBLIC, read from the ACL itself (grantee 0), since has_table_privilege
    -- cannot be asked about PUBLIC by name.
    select coalesce(string_agg(privilege_type, ',' order by privilege_type), 'none') into got
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid = ('public.' || t)::regclass and a.grantee = 0;
    perform pg_temp.ok(format('PUBLIC holds nothing on %s', t), 'none', got);

    -- RLS is on, and the tenant policy is the only one.
    perform pg_temp.ok(format('RLS is enabled on %s', t), 'true',
      (select relrowsecurity::text from pg_class where oid = ('public.' || t)::regclass));
    perform pg_temp.ok(format('%s has exactly the tenant policy', t),
      'Tenant members manage ALL using[((tenant_id = current_tenant_id()) OR is_platform_admin())] check[((tenant_id = current_tenant_id()) OR is_platform_admin())]',
      (select string_agg(policyname || ' ' || cmd || ' using[' || qual || '] check[' || with_check || ']', ' | ')
         from pg_policies where schemaname = 'public' and tablename = t));
  end loop;
end $$;


-- ── 9. And as the real roles ────────────────────────────────────────────────
--
-- Rows on both sites first, as the owner, so "reads 0 foreign rows" is a
-- statement about rows that exist.

do $$
begin
  insert into photo_usages (tenant_id, asset_id, kind, page_key, field) values
    (pg_temp.k('A'), pg_temp.k('assetA'),  'page_section', 'home',  'image_path'),
    (pg_temp.k('A'), pg_temp.k('assetA2'), 'page_legacy',  'about', 'about_image_path'),
    (pg_temp.k('B'), pg_temp.k('assetB'),  'page_section', 'home',  'image_path');
  -- Nobody in this run is a platform admin until block 9d says so.
  update profiles set is_platform_admin = false where id in (pg_temp.k('userA'), pg_temp.k('userB'));
  perform set_config('pa.owner_role', session_user, true);
  perform set_config('pa.A', pg_temp.k('A')::text, true);
  perform set_config('pa.B', pg_temp.k('B')::text, true);
  perform set_config('pa.userA', pg_temp.k('userA')::text, true);
  perform set_config('pa.userB', pg_temp.k('userB')::text, true);
  perform set_config('pa.assetA', pg_temp.k('assetA')::text, true);
end $$;

-- 9a. anon: refused by PRIVILEGE — not "sees 0 rows", which RLS could also say.
do $$
declare e_assets text; e_usages text; e_ins text;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  begin perform count(*) from photo_assets; e_assets := 'READ ALLOWED';
  exception when others then e_assets := sqlstate; end;
  begin perform count(*) from photo_usages; e_usages := 'READ ALLOWED';
  exception when others then e_usages := sqlstate; end;
  begin
    insert into photo_assets (tenant_id, key_base, display_path)
    values (current_setting('pa.A')::uuid, 't/anon/1', 'x');
    e_ins := 'WRITE ALLOWED';
  exception when others then e_ins := sqlstate; end;
  perform set_config('role', current_setting('pa.owner_role'), true);

  perform pg_temp.ok('anon cannot read photo_assets (privilege)', '42501', e_assets);
  perform pg_temp.ok('anon cannot read photo_usages (privilege)', '42501', e_usages);
  perform pg_temp.ok('anon cannot write photo_assets (privilege)', '42501', e_ins);
end $$;

-- 9b. service_role: no direct table privilege at all in P1.
do $$
declare e_read text; e_ins text; e_upd text; e_del text; e_ins_u text;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
  begin perform count(*) from photo_assets; e_read := 'READ ALLOWED';
  exception when others then e_read := sqlstate; end;
  begin
    insert into photo_assets (tenant_id, key_base, display_path)
    values (current_setting('pa.A')::uuid, 't/sr/1', 'x');
    e_ins := 'WRITE ALLOWED';
  exception when others then e_ins := sqlstate; end;
  begin
    insert into photo_usages (tenant_id, asset_id, kind, page_key, field)
    values (current_setting('pa.A')::uuid, current_setting('pa.assetA')::uuid, 'page_section', 'contact', 'image_path');
    e_ins_u := 'WRITE ALLOWED';
  exception when others then e_ins_u := sqlstate; end;
  begin update photo_assets set state = 'failed'; e_upd := 'WRITE ALLOWED';
  exception when others then e_upd := sqlstate; end;
  begin delete from photo_usages; e_del := 'WRITE ALLOWED';
  exception when others then e_del := sqlstate; end;
  perform set_config('role', current_setting('pa.owner_role'), true);

  perform pg_temp.ok('service_role cannot read photo_assets', '42501', e_read);
  perform pg_temp.ok('service_role cannot insert photo_assets', '42501', e_ins);
  perform pg_temp.ok('service_role cannot insert photo_usages', '42501', e_ins_u);
  perform pg_temp.ok('service_role cannot update photo_assets', '42501', e_upd);
  perform pg_temp.ok('service_role cannot delete photo_usages', '42501', e_del);
end $$;

-- 9c. A signed-in photographer: reads their own site, nothing of anybody
-- else's, and cannot write at all.
do $$
declare
  n_own_a int; n_all_a int; n_foreign_a int; n_own_u int; n_all_u int; n_foreign_u int;
  n_b_all int;
  e_ins text; e_ins_u text; e_upd text; e_del text;
  n_true_a int; n_true_u int; n_true_b int;
begin
  -- The truth, counted as the owner.
  select count(*) into n_true_a from photo_assets where tenant_id = current_setting('pa.A')::uuid;
  select count(*) into n_true_u from photo_usages where tenant_id = current_setting('pa.A')::uuid;
  select count(*) into n_true_b from photo_assets where tenant_id = current_setting('pa.B')::uuid;

  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('pa.userA'))::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_own_a     from photo_assets where tenant_id = current_setting('pa.A')::uuid;
  select count(*) into n_all_a     from photo_assets;
  select count(*) into n_foreign_a from photo_assets where tenant_id = current_setting('pa.B')::uuid;
  select count(*) into n_own_u     from photo_usages where tenant_id = current_setting('pa.A')::uuid;
  select count(*) into n_all_u     from photo_usages;
  select count(*) into n_foreign_u from photo_usages where tenant_id = current_setting('pa.B')::uuid;

  begin
    insert into photo_assets (tenant_id, key_base, display_path)
    values (current_setting('pa.A')::uuid, 't/auth/1', 'x');
    e_ins := 'WRITE ALLOWED';
  exception when others then e_ins := sqlstate; end;
  begin
    insert into photo_usages (tenant_id, asset_id, kind, page_key, field)
    values (current_setting('pa.A')::uuid, current_setting('pa.assetA')::uuid, 'page_section', 'contact', 'image_path');
    e_ins_u := 'WRITE ALLOWED';
  exception when others then e_ins_u := sqlstate; end;
  begin update photo_assets set state = 'failed' where tenant_id = current_setting('pa.A')::uuid; e_upd := 'WRITE ALLOWED';
  exception when others then e_upd := sqlstate; end;
  begin delete from photo_usages where tenant_id = current_setting('pa.A')::uuid; e_del := 'WRITE ALLOWED';
  exception when others then e_del := sqlstate; end;

  -- Photographer B, the other way round.
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('pa.userB'))::text, true);
  select count(*) into n_b_all from photo_assets;

  perform set_config('role', current_setting('pa.owner_role'), true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.ok('photographer A reads all of their own assets', n_true_a::text, n_own_a::text);
  perform pg_temp.ok('photographer A sees ONLY their own assets unfiltered', n_true_a::text, n_all_a::text);
  perform pg_temp.ok('photographer A reads 0 of site B''s assets (' || n_true_b || ' exist)', '0', n_foreign_a::text);
  perform pg_temp.ok('photographer A reads all of their own usages', n_true_u::text, n_own_u::text);
  perform pg_temp.ok('photographer A sees ONLY their own usages unfiltered', n_true_u::text, n_all_u::text);
  perform pg_temp.ok('photographer A reads 0 of site B''s usages', '0', n_foreign_u::text);
  perform pg_temp.ok('photographer B sees only site B''s assets', n_true_b::text, n_b_all::text);
  perform pg_temp.ok('a photographer cannot insert an asset, even on their own site', '42501', e_ins);
  perform pg_temp.ok('a photographer cannot insert a usage, even on their own site', '42501', e_ins_u);
  perform pg_temp.ok('a photographer cannot update an asset', '42501', e_upd);
  perform pg_temp.ok('a photographer cannot delete a usage', '42501', e_del);
end $$;

-- 9d. A platform admin reaches across, deliberately — and only because of the
-- flag: the same account without it was held to site A in 9c.
do $$
declare n_true_a int; n_true_u int; n_seen_a int; n_seen_u int; n_b int;
begin
  select count(*) into n_true_a from photo_assets;
  select count(*) into n_true_u from photo_usages;
  update profiles set is_platform_admin = true where id = current_setting('pa.userA')::uuid;

  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('pa.userA'))::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n_seen_a from photo_assets;
  select count(*) into n_seen_u from photo_usages;
  select count(*) into n_b      from photo_assets where tenant_id = current_setting('pa.B')::uuid;
  perform set_config('role', current_setting('pa.owner_role'), true);
  perform set_config('request.jwt.claims', '', true);

  update profiles set is_platform_admin = false where id = current_setting('pa.userA')::uuid;

  perform pg_temp.ok('a platform admin reads every site''s assets', n_true_a::text, n_seen_a::text);
  perform pg_temp.ok('a platform admin reads every site''s usages', n_true_u::text, n_seen_u::text);
  perform pg_temp.ok('including site B''s, which it does not belong to', 'at least 1',
                     case when n_b >= 1 then 'at least 1' else n_b::text end);
end $$;

-- 9e. Signed in, but with no profile: no site, so nothing.
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from photo_assets;
  perform set_config('role', current_setting('pa.owner_role'), true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.ok('an account with no profile reads 0 assets', '0', n::text);
end $$;


-- ── Report, and undo everything ─────────────────────────────────────────────

do $$
declare
  report text;
  failed int;
  total  int;
begin
  select string_agg(
           format('%s  %-66s expected %-28s got %s',
                  -- COALESCE: a comparison against a null is unknown, and an
                  -- unknown result must count as a failure in the summary too.
                  case when coalesce(pass, false) then '  ok  ' else ' FAIL ' end,
                  step, expected, actual),
           E'\n' order by ord)
    into report
    from pa_res;

  select count(*), count(*) filter (where not coalesce(pass, false))
    into total, failed
    from pa_res;

  raise exception E'\n\n%\n\n%\n\nNothing was kept — this transaction always rolls back.\n',
    report,
    case
      when failed = 0 then format('All %s checks passed.', total)
      else format('%s of %s check(s) failed. P1 is NOT ready.', failed, total)
    end;
end $$;

rollback;
