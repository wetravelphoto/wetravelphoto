-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-29 — P1: the photograph gets an identity, and its placements a table
--
-- claude/photo-assets-design.md (revision 6) is the design; this is its §1, §2
-- and §3 as DDL, and nothing else. claude/photo-migration-plan.md, P1, is the
-- phase.
--
--   · photo_assets  — the canonical photograph. One row per upload.
--   · photo_usages  — a READ-ONLY PROJECTION of where each photograph is
--                     placed. Written by syncUsages() (P3) and by nothing
--                     else. Drop it, re-run syncUsages over every document,
--                     and it comes back identical.
--   · unique (id, tenant_id) on photos, albums, blog_posts, catalog_items —
--     the targets of the tenant-aware foreign keys below.
--   · photos.asset_id and site_images.asset_id — nullable, and deliberately
--     WITHOUT a foreign key until P4 has populated them.
--
-- NOTHING READS OR WRITES ANY OF THIS YET. The site, the admin and the editor
-- behave exactly as before. Rollback is a drop (see the bottom of this file).
--
-- ── Three decisions this file carries (design rev 6) ────────────────────────
--
-- 1. NO TENANT DEFAULT on either new table. `tenant_for_insert()` is
--    coalesce(current_tenant_id(), default_tenant_id()), and under the
--    service-role client there is no current tenant — so it falls back to the
--    OLDEST site on the platform. Ingestion, the backfill and the job handlers
--    all run under that client. A forgotten tenant must be a NOT NULL error,
--    not a photograph filed under somebody else's site. Same reasoning as jobs,
--    page_views and 2026-09-24_no_guessing_tenant.sql. The existing parents'
--    `tenant_for_insert()` defaults are NOT touched here.
--
-- 2. NOBODY WRITES THESE TABLES IN P1. `authenticated` may read, narrowed by
--    the tenant policy to its own site; `anon`, `service_role` and `public`
--    hold nothing. There is no write function either. P2 (ingestion) and P3
--    (syncUsages) each introduce the narrowest write capability their writer
--    needs, in their own reviewed migration.
--
-- 3. page_key IS CHECKED against the same contract as isPageKey() in
--    lib/sections/pages.ts — including `notfound`, which analytics excludes and
--    photo placement does not (the 404 page has sections). .mk/photo-assets.ts
--    holds the two together.
--
-- ── Tenant integrity is a foreign key, not a trigger ────────────────────────
--
-- `photo_usages.tenant_id` plus a plain `references albums(id)` would not stop
-- a row claiming site A from pointing at an album owned by site B. RLS would
-- refuse that for a signed-in editor — but the service-role client bypasses
-- RLS, and the backfill and the drain run under it. So every parent reference
-- carries the tenant: (parent_id, tenant_id) → parent (id, tenant_id). The
-- planner enforces it on every write, for every role, owner included. MATCH
-- SIMPLE (the default) skips a composite key with a null in it, so each parent
-- key binds only when that parent is set.
--
-- Safe to run twice. Run against db/test-fixture.sql, which deliberately does
-- NOT contain these tables until production does.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. The four parents gain their (id, tenant_id) target ───────────────────
--
-- Redundant with each primary key as a uniqueness rule, and required anyway: a
-- composite foreign key can only reference a unique constraint on exactly its
-- columns. Cost: one btree each.
--
-- Guarded rather than dropped-and-re-added, because on a second run the foreign
-- keys below depend on these and a drop would be refused.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('photos',        'photos_id_tenant'),
      ('albums',        'albums_id_tenant'),
      ('blog_posts',    'blog_posts_id_tenant'),
      ('catalog_items', 'catalog_items_id_tenant')
    ) as v(tbl, con)
  loop
    if not exists (select 1 from pg_constraint
                    where conname = r.con
                      and conrelid = format('public.%I', r.tbl)::regclass) then
      execute format('alter table public.%I add constraint %I unique (id, tenant_id)',
                     r.tbl, r.con);
    end if;
  end loop;
end $$;


-- ── 2. photo_assets — the canonical photograph ──────────────────────────────

create table if not exists photo_assets (
  id              uuid primary key default gen_random_uuid(),
  -- NO DEFAULT. Every writer names the site. See decision 1 above.
  tenant_id       uuid not null
                  constraint photo_assets_tenant_fk references tenants(id) on delete cascade,

  -- ══ Identity and storage ═══════════════════════════════════════════════
  -- key_base identifies one UPLOAD and all its derivatives. It does not
  -- identify identical bytes uploaded again under a new uuid — that is
  -- content_sha256's job, which is why that one is indexed and NOT unique.
  key_base        text        not null,
  original_path   text        null,
  display_path    text        not null,
  derivatives     jsonb       not null default '{}'::jsonb,
  original_bytes  bigint      null,
  content_type    text        null,
  filename        text        null,
  content_sha256  text        null,     -- hex sha256 of the original bytes

  -- ══ Dimensions ═════════════════════════════════════════════════════════
  width           integer     null,
  height          integer     null,
  orientation     text        generated always as (
                    case when width is null or height is null then null
                         when width > height then 'landscape'
                         when width < height then 'portrait'
                         else 'square' end) stored,
  aspect_ratio    numeric(8,4) generated always as (
                    case when coalesce(height, 0) = 0 then null
                         else round(width::numeric / height, 4) end) stored,

  -- ══ Capture metadata ═══════════════════════════════════════════════════
  taken_at        timestamptz null,
  latitude        double precision null,
  longitude       double precision null,
  camera_make     text        null,
  camera_model    text        null,
  lens            text        null,
  iso             integer     null,
  aperture        numeric(4,1) null,
  shutter         text        null,
  focal_length    numeric(6,1) null,
  keywords        text[]      not null default '{}',
  exif            jsonb       not null default '{}'::jsonb,

  -- ══ The canonical description ══════════════════════════════════════════
  alt_text        text        null,
  alt_source      text        null,     -- 'photographer' | 'ai'
  alt_reviewed_at timestamptz null,

  -- ══ Ingestion state — FILE READINESS ONLY ══════════════════════════════
  state           text        not null default 'pending',
  derived_at      timestamptz null,
  last_error      text        null,

  -- ══ Lifecycle ══════════════════════════════════════════════════════════
  archived_at        timestamptz null,
  deleted_at         timestamptz null,
  original_purged_at timestamptz null,

  created_by      uuid
                  constraint photo_assets_created_by_fk references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint photo_assets_state_known
    check (state in ('pending','derived','failed')),
  constraint photo_assets_alt_source_known
    check (alt_source is null or alt_source in ('photographer','ai')),
  constraint photo_assets_alt_source_present
    check (alt_text is null or alt_source is not null),

  -- The target for photo_usages' tenant-aware foreign key.
  constraint photo_assets_id_tenant unique (id, tenant_id)
);

create unique index if not exists photo_assets_key
  on photo_assets (tenant_id, key_base);
create index if not exists photo_assets_sha
  on photo_assets (tenant_id, content_sha256)
  where content_sha256 is not null;
create index if not exists photo_assets_library
  on photo_assets (tenant_id, created_at desc)
  where deleted_at is null and archived_at is null;
create index if not exists photo_assets_unfinished
  on photo_assets (state)
  where state in ('pending','failed');
create index if not exists photo_assets_sweep
  on photo_assets (deleted_at)
  where deleted_at is not null;
create index if not exists photo_assets_no_alt
  on photo_assets (tenant_id)
  where alt_text is null and deleted_at is null;


-- ── 3. photo_usages — a read-only projection of placement ───────────────────

create table if not exists photo_usages (
  id            uuid primary key default gen_random_uuid(),
  -- NO DEFAULT. Every writer names the site. See decision 1 above.
  tenant_id     uuid not null
                constraint photo_usages_tenant_fk references tenants(id) on delete cascade,
  asset_id      uuid not null,

  scope         text not null default 'live',    -- 'live' | 'draft'
  kind          text not null,

  -- ── Typed parents. Exactly one is set, per photo_usages_one_parent. ──────
  photo_id      uuid null,
  album_id      uuid null,
  post_id       uuid null,
  product_id    uuid null,
  page_key      text null,                       -- 'home', 'p_a1b2c3d4'

  field         text not null,
  -- A SLOT DISCRIMINATOR, not an ordering. Order is photos.sort_order's.
  position      integer not null default 0,

  -- ── MIRRORS. Written only by syncUsages. Never authoritative. ───────────
  -- A value may be mirrored here only if its authoritative source lives inside
  -- the document whose rewrite triggers the rebuild (design §2.4).
  alt_override  text    null,
  decorative    boolean not null default false,

  created_at    timestamptz not null default now(),

  -- ══ Tenant-aware foreign keys ══════════════════════════════════════════
  -- RESTRICT on the asset: the database refuses to delete a photograph that
  -- is still placed somewhere. CASCADE on the parents: a placement dies with
  -- the thing it was placed in.
  constraint photo_usages_asset_fk
    foreign key (asset_id,   tenant_id) references photo_assets  (id, tenant_id)
    on delete restrict,
  constraint photo_usages_photo_fk
    foreign key (photo_id,   tenant_id) references photos        (id, tenant_id)
    on delete cascade,
  constraint photo_usages_album_fk
    foreign key (album_id,   tenant_id) references albums        (id, tenant_id)
    on delete cascade,
  constraint photo_usages_post_fk
    foreign key (post_id,    tenant_id) references blog_posts    (id, tenant_id)
    on delete cascade,
  constraint photo_usages_product_fk
    foreign key (product_id, tenant_id) references catalog_items (id, tenant_id)
    on delete cascade,

  constraint photo_usages_kind_known check (kind in (
    'gallery','gallery_cover','page_section','page_legacy',
    'story_cover','story_block','shop_listing'
  )),
  constraint photo_usages_scope_known check (scope in ('live','draft')),

  -- Only pages have a draft layer. Albums, posts and the catalog do not, so a
  -- draft-scoped usage of those kinds would be meaningless.
  constraint photo_usages_scope_by_kind check (
    scope = 'live' or kind in ('page_section','page_legacy')
  ),

  -- The SQL twin of isPageKey() in lib/sections/pages.ts: a key of PAGES —
  -- `notfound` INCLUDED, because isPageKey() includes it and the 404 page has
  -- sections that can hold a photograph — or a photographer's page, CUSTOM_KEY
  -- = /^p_[a-z0-9]{8}$/. Deliberately NOT the analytics set: record_page_view
  -- tracks visitable pages and excludes `notfound`. A placement is not a visit.
  -- A new built-in page costs a line here; .mk/photo-assets.ts fails until it
  -- is added.
  constraint photo_usages_page_key_shape check (
    page_key is null
    or page_key in ('home','about','contact','journal','galleries','shop','notfound')
    or page_key ~ '^p_[a-z0-9]{8}$'
  ),

  constraint photo_usages_one_parent check (
     (kind = 'gallery'
        and photo_id is not null and album_id is null and post_id is null
        and product_id is null and page_key is null)
  or (kind = 'gallery_cover'
        and album_id is not null and photo_id is null and post_id is null
        and product_id is null and page_key is null)
  or (kind in ('story_cover','story_block')
        and post_id is not null and photo_id is null and album_id is null
        and product_id is null and page_key is null)
  or (kind = 'shop_listing'
        and product_id is not null and photo_id is null and album_id is null
        and post_id is null and page_key is null)
  or (kind in ('page_section','page_legacy')
        and page_key is not null and photo_id is null and album_id is null
        and post_id is null and product_id is null)
  )
);

-- ── Uniqueness: one partial index per slot shape ────────────────────────────
--
-- NOT one wide UNIQUE. A compound unique over the four nullable parent columns
-- is NULLS DISTINCT, so for a page_section usage — all four null — two
-- byte-identical rows would both be legal. It would look like protection and
-- provide none. photo_usages_one_parent guarantees each index's parent column
-- is NOT NULL for its kind, so no index key here contains a null and NULL
-- semantics never arise. db/verify-photo-assets.sql shows the wide form
-- failing, kind by kind, before it trusts these.

create unique index if not exists photo_usages_slot_gallery
  on photo_usages (photo_id)                              where kind = 'gallery';

create unique index if not exists photo_usages_slot_cover
  on photo_usages (album_id, field)                       where kind = 'gallery_cover';

-- position is the section's ORDINAL on the page: two `intro` sections on one
-- page both have an image_path, so page + field alone is not a slot.
create unique index if not exists photo_usages_slot_section
  on photo_usages (tenant_id, scope, page_key, position, field)
                                                          where kind = 'page_section';

create unique index if not exists photo_usages_slot_legacy
  on photo_usages (tenant_id, scope, page_key, field)     where kind = 'page_legacy';

create unique index if not exists photo_usages_slot_story_cover
  on photo_usages (post_id)                               where kind = 'story_cover';

create unique index if not exists photo_usages_slot_story_block
  on photo_usages (post_id, field, position)              where kind = 'story_block';

create unique index if not exists photo_usages_slot_shop
  on photo_usages (product_id)                            where kind = 'shop_listing';

-- "Where is this photograph used", and "which are unused" as an anti-join.
create index if not exists photo_usages_asset
  on photo_usages (asset_id);

-- The "needs alt" query (design §2.4).
create index if not exists photo_usages_needs_alt
  on photo_usages (tenant_id, asset_id)
  where scope = 'live' and decorative = false and alt_override is null;


-- ── 4. The link columns on the two existing photograph tables ───────────────
--
-- Nullable, and NO foreign key yet: P4's backfill populates them and then adds
-- the keys, so an empty column cannot fail a constraint in the meantime.

alter table photos      add column if not exists asset_id uuid;
alter table site_images add column if not exists asset_id uuid;


-- ── 5. Row-level security ───────────────────────────────────────────────────

select public.apply_tenant_policy('photo_assets');
select public.apply_tenant_policy('photo_usages');


-- ── 6. Grants: the whole privilege set, stated ──────────────────────────────
--
-- Revoke first. A `grant` is additive, and this file must produce the same
-- result on a database whose default privileges hand out ALL to anon,
-- authenticated and service_role as on one that hands out nothing.
--
-- `authenticated` may READ, and the policy narrows that to its own site (a
-- platform admin reaches across, by design). Nobody may write: nothing writes
-- these tables yet, and P2/P3 each add their own narrow writer on purpose.
-- `anon` and `service_role` hold nothing, which is the point and not an
-- omission.

revoke all on table photo_assets from public;
revoke all on table photo_assets from anon;
revoke all on table photo_assets from authenticated;
revoke all on table photo_assets from service_role;

revoke all on table photo_usages from public;
revoke all on table photo_usages from anon;
revoke all on table photo_usages from authenticated;
revoke all on table photo_usages from service_role;

grant select on table photo_assets to authenticated;
grant select on table photo_usages to authenticated;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Safe at any moment in P1: nothing reads or writes any of it.
--
--   begin;
--   drop table if exists photo_usages;
--   drop table if exists photo_assets;
--   alter table photos        drop column if exists asset_id;
--   alter table site_images   drop column if exists asset_id;
--   alter table photos        drop constraint if exists photos_id_tenant;
--   alter table albums        drop constraint if exists albums_id_tenant;
--   alter table blog_posts    drop constraint if exists blog_posts_id_tenant;
--   alter table catalog_items drop constraint if exists catalog_items_id_tenant;
--   commit;
