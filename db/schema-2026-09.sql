-- ════════════════════════════════════════════════════════════════════════════
-- PRODUCTION SCHEMA SNAPSHOT — 2026-09-29
-- ════════════════════════════════════════════════════════════════════════════
--
-- What production actually contains, as reported by db/survey.sql run against
-- the live Supabase database on 2026-09-29 (PostgreSQL 17.6).
--
-- THIS FILE IS DOCUMENTATION. Do not run it against production. It exists so
-- that "what does the database look like" is a file in version control rather
-- than a belief, after three occasions on which the belief was wrong:
--
--   · site_settings still carried `constraint single_row check (id = 1)`
--     from the single-site era, which nothing in the repository mentioned;
--   · albums.allow_downloads was read in three places before it existed;
--   · photos.album_id cascades, and db/test-fixture.sql declared NO ACTION.
--
--
-- ── UPDATED 2026-09-29 (evening): the queue ─────────────────────────────────
--
-- `jobs` and its three functions were deployed to production by
-- db/migrations/2026-09-29_jobs.sql, recorded by Supabase as migration version
-- **20260929212635** (`jobs_infrastructure_2026_09_29`), and verified against
-- the live database afterwards. They are in this file for the same reason
-- everything else is: so that "what does the database look like" stays a file
-- rather than a belief.
--
-- Production was therefore **35 tables, 488 columns, 12 functions**, RLS on all
-- 35, and 55 policies. The survey figures quoted below are the state before
-- that deployment.
--
-- (The policy figure was written here as 54 and was wrong by one. Production was
-- counted directly on 2026-09-29: 55 after the queue, of which `jobs` holds
-- exactly one, so 54 before it. `db/schema-verified.md` has the whole story;
-- the schema files were right all along.)
--
-- ── UPDATED 2026-09-29 (late): analytics ────────────────────────────────────
--
-- `page_views` gained six columns, seven CHECK constraints, a tenant foreign
-- key, two indexes, a replaced policy, narrowed grants and one function,
-- deployed by db/migrations/2026-09-29_analytics.sql, recorded by Supabase as
-- migration version **20260929231653** (`analytics_instrumentation_2026_09_29`),
-- sha256 **c1acb1ae3a68c21094622820c768343e1e5fba63de6ee2f769ba5d4ddd4bfbdf**,
-- and verified against the live database afterwards.
--
-- Production is therefore now **35 tables, 494 columns, 13 functions**, RLS on
-- all 35, and **54 policies** — one FEWER than before, which is the whole point
-- of the change: `"Anyone can record a view"` was `for insert with check (true)`
-- and is gone. No table was added and none was dropped.
--
-- The 77 rows that existed before it all survived, all carry a `tenant_id`
-- backfilled from their album or story, and all still carry NULL in the five
-- new metadata columns — verified, because a fixture that filled them in would
-- make every test about "what a pre-S4 row looks like" pass for the wrong
-- reason.
--
-- ── UPDATED 2026-09-30: photo assets (P1) ───────────────────────────────────
--
-- `photo_assets` and `photo_usages`, four `unique (id, tenant_id)` targets on
-- photos / albums / blog_posts / catalog_items, and a nullable `asset_id` on
-- photos and site_images, deployed by db/migrations/2026-09-29_photo_assets.sql,
-- recorded by Supabase as migration version **20260930123113**
-- (`photo_assets_p1_2026_09_29`), sha256
-- **fedb6e7f457f9a7e7568efefcb2116ca7ca1b38db113dd3b1d1bf47bdc887eef**, and
-- verified against the live database afterwards (db/schema-verified.md).
--
-- Production is therefore now **37 tables, 549 columns, 13 functions**, RLS on
-- all 37, and **56 policies** — one "Tenant members manage" on each new table.
-- Both new tables hold 0 rows: nothing reads or writes them until P2/P3.
-- Everything P1 added is copied from the migration, not retyped from memory, and
-- scripts/fixture-matches-migration.sh is what stops the copy drifting.
--
-- ── How faithful this is ────────────────────────────────────────────────────
--
-- Columns, types, nullability, defaults, foreign keys with their delete
-- actions, unique constraints, indexes, RLS status and every policy are
-- TRANSCRIBED from the survey output. Two things are not:
--
--   1. CHECK predicates. The survey output was pasted back in an abbreviated
--      form ("CHECK cover_fit IN ('cover','contain')") rather than the literal
--      text pg_get_constraintdef returns. The predicates below are a faithful
--      reconstruction of that meaning, not a byte-for-byte copy.
--   2. The tenant helper functions. Part 5 of the survey returned the trigger
--      list only, so the function bodies here come from
--      db/migrations/2026-09-15_tenant_scoping.sql — they are the INTENDED
--      definitions, not verified ones. See db/schema-verified.md.
--
-- Everything else is production truth as of the date above.
--
-- ── Things recorded here that look wrong and were NOT changed ───────────────
--
-- Production is the source of truth. Where it disagrees with the application
-- or with an older migration, the disagreement is documented, flagged in
-- db/schema-verified.md, and left alone.
--
--   · orders.status DEFAULT 'pending_payment' is not in orders_status_check.
--   · newsletter_signups_email_key is UNIQUE (email) — globally, not per site.
--   · profiles_role_check forbids 'admin', which lib/auth.ts checks for.
--   · albums and blog_posts each carry TWO identical unique indexes on
--     (tenant_id, slug).
--   · photos.watermark_enabled, blog_posts.cover_photo_id and
--     blog_posts.featured_photo_id are columns no application code uses.
--   · site_settings.instagram_token still exists beside site_secrets.
--
-- ════════════════════════════════════════════════════════════════════════════

-- A `language sql` function body is parsed when the function is created, and
-- these read `tenants` and `profiles`, which do not exist yet — while those
-- tables' DEFAULTs call `tenant_for_insert()`, so the functions cannot come
-- second either. pg_dump solves the same circularity the same way.
set check_function_bodies = off;

-- ── Sequences ───────────────────────────────────────────────────────────────
create sequence if not exists order_number_seq;
create sequence if not exists site_settings_id_seq;
create sequence if not exists site_draft_steps_id_seq;

-- ── Functions ───────────────────────────────────────────────────────────────
--
-- Production's function inventory was surveyed on 2026-09-29. Nine functions
-- then; twelve now, the three added by the queue migration being at the end of
-- this file rather than here (their return types need the jobs table first).
-- exist in `public`, and every one of their VOLATILITY and SECURITY attributes
-- matches the migration that created it — no drift. The attribute on each
-- function below is production truth, confirmed:
--
--   apply_tenant_policy      INVOKER  VOLATILE
--   apply_tenant_policy_via  INVOKER  VOLATILE
--   current_tenant_id        DEFINER  STABLE
--   default_tenant_id        DEFINER  STABLE
--   is_platform_admin        DEFINER  STABLE
--   push_draft_step          INVOKER  VOLATILE
--   tenant_for_insert        DEFINER  STABLE
--   tenant_of                DEFINER  STABLE
--   touch_site_draft         INVOKER  VOLATILE
--
-- The BODIES are not production output — the survey returns signatures and
-- attributes, not source. They are taken from the migrations that created
-- them, which the attributes above corroborate. See db/schema-verified.md.
--
-- DEFINER + STABLE on the four tenant readers is load-bearing, not incidental:
-- definer because a policy on `profiles` that reads `profiles` through an
-- invoker function recurses forever, and stable so Postgres evaluates them
-- once per statement rather than once per row.

create or replace function public.default_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  -- ORDER BY is the whole point of this redefinition. Without it "the first
  -- tenant" means "any tenant".
  select id from tenants order by created_at asc, id asc limit 1;
$$;

create or replace function public.current_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from profiles where id = auth.uid();
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from profiles where id = auth.uid()), false);
$$;

create or replace function public.tenant_for_insert() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_tenant_id(), public.default_tenant_id());
$$;

-- Parameter names matter: they are part of the signature for a named-argument
-- call. Production has (parent, key_value, key_column) — taken from
-- db/migrations/2026-09-15_tenant_scoping.sql, which production matches.
create or replace function public.tenant_of(
  parent     regclass,
  key_value  uuid,
  key_column text default 'id'
)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  found uuid;
begin
  if key_value is null then
    return null;
  end if;

  execute format('select tenant_id from %s where %I = $1', parent::text, key_column)
     into found
    using key_value;

  return found;
end $$;

-- INVOKER and VOLATILE, in production and in the migration. These two generate
-- policies; the next migration calls them by name.
create or replace function public.apply_tenant_policy(target regclass)
returns void language plpgsql as $$
declare
  tbl text := target::text;
  check_expr text := '(tenant_id = public.current_tenant_id() or public.is_platform_admin())';
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('drop policy if exists "Tenant members manage" on %s', tbl);
  execute format(
    'create policy "Tenant members manage" on %s for all using %s with check %s',
    tbl, check_expr, check_expr);
end $$;

create or replace function public.apply_tenant_policy_via(
  target regclass, fk_column text, parent regclass, parent_key text default 'id'
) returns void language plpgsql as $$
declare
  tbl text := target::text;
  check_expr text := format(
    '(public.tenant_of(%L::regclass, %I, %L) = public.current_tenant_id() '
    ' or public.is_platform_admin())',
    parent::text, fk_column, parent_key);
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('drop policy if exists "Tenant members manage" on %s', tbl);
  execute format(
    'create policy "Tenant members manage" on %s for all using %s with check %s',
    tbl, check_expr, check_expr);
end $$;

-- Undo steps, coalesced in the database so a burst of slider drags is one step.
-- SECURITY INVOKER on purpose: it runs with the caller's own rights, so RLS
-- still decides which site's rows it can touch. Body from
-- db/migrations/2026-09-22_draft_steps.sql.
create or replace function public.push_draft_step(
  p_tenant   uuid,
  p_snapshot jsonb,
  p_label    text,
  p_window   interval default interval '1.5 seconds',
  p_keep     int      default 50
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  last_label text;
  last_write timestamptz;
begin
  -- A new edit makes whatever was undone unreachable, as in every editor.
  delete from site_draft_steps where tenant_id = p_tenant and stack = 'redo';

  select edit_label, updated_at
    into last_label, last_write
    from site_draft
   where tenant_id = p_tenant;

  -- Still the same burst: the same thing edited, moments ago. The step kept
  -- at the start of the burst already holds the state before it.
  if last_label is not null
     and last_label = p_label
     and last_write > clock_timestamp() - p_window then
    return;
  end if;

  insert into site_draft_steps (tenant_id, stack, snapshot, label)
  values (p_tenant, 'undo', p_snapshot, p_label);

  -- Newest p_keep only.
  delete from site_draft_steps
   where tenant_id = p_tenant
     and stack = 'undo'
     and id not in (
       select id from site_draft_steps
        where tenant_id = p_tenant and stack = 'undo'
        order by id desc
        limit p_keep
     );
end $$;




create table album_clients (
  album_id    uuid not null,
  client_id   uuid not null,
  created_at  timestamptz not null default now()
);

create table albums (
  id                     uuid not null default gen_random_uuid(),
  tenant_id              uuid not null default tenant_for_insert(),
  title                  text not null,
  slug                   text not null,
  description            text,
  location               text,
  trip_start_date        date,
  trip_end_date          date,
  cover_photo_id         uuid,
  cover_focal_x          numeric default 0.5,
  cover_focal_y          numeric default 0.5,
  cover_title_enabled    boolean not null default true,
  cover_title_text       text,
  layout_style           text not null default 'masonry'::text,
  sort_order             text not null default 'manual'::text,
  font_pairing           text not null default 'cinematic'::text,
  accent_color           text default '#C97A4A'::text,
  privacy_type           text not null default 'public'::text,
  password_hash          text,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  cover_custom_path      text,
  cover_overlay_type     text not null default 'none'::text,
  cover_overlay_opacity  numeric not null default 0.35,
  cover_preset           text not null default 'bottom_left'::text,
  cover_font             text not null default 'Oswald'::text,
  cover_title_size       text not null default 'medium'::text,
  cover_title_color      text not null default '#FAF9F6'::text,
  cover_subtitle         text,
  cover_show_location    boolean not null default false,
  cover_show_date        boolean not null default false,
  cover_title_scale      numeric not null default 1.0,
  cover_show_button      boolean not null default false,
  cover_button_text      text default 'View gallery'::text,
  cover_video_path       text,
  cover_date_format      text not null default 'month_year'::text,
  tags                   text[] not null default '{}'::text[],
  gallery_hero           boolean not null default false,
  show_tags              boolean not null default true,
  description_align      text not null default 'left'::text,
  description_scale      numeric not null default 1.0,
  description_font       text not null default 'body'::text,
  cover_height           text not null default 'large'::text,
  cover_fit              text not null default 'cover'::text,
  display_order          integer not null default 0,
  allow_downloads        boolean not null default false
);

create table blog_posts (
  id                    uuid not null default gen_random_uuid(),
  tenant_id             uuid not null default tenant_for_insert(),
  album_id              uuid,
  title                 text not null,
  slug                  text not null,
  content               jsonb not null default '{}'::jsonb,
  cover_photo_id        uuid,
  status                text not null default 'draft'::text,
  published_at          timestamptz,
  author_id             uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  excerpt               text,
  category              text,
  featured_photo_id     uuid,
  featured_custom_path  text,
  tags                  text[] not null default '{}'::text[],
  blocks                jsonb not null default '[]'::jsonb,
  read_minutes          integer,
  seo_title             text,
  seo_description       text,
  noindex               boolean not null default false,
  byline                text
);

create table catalog_items (
  id            uuid not null default gen_random_uuid(),
  tenant_id     uuid not null default tenant_for_insert(),
  photo_id      uuid not null,
  title         text,
  description   text,
  tags          text[] not null default '{}'::text[],
  is_published  boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  location      text
);

create table clients (
  id            uuid not null default gen_random_uuid(),
  tenant_id     uuid not null default tenant_for_insert(),
  name          text not null,
  email         text not null,
  access_token  uuid not null default gen_random_uuid(),
  created_at    timestamptz not null default now()
);

create table contact_messages (
  id            uuid not null default gen_random_uuid(),
  name          text not null,
  email         text not null,
  message       text not null,
  is_read       boolean not null default false,
  created_at    timestamptz not null default now(),
  subject       text,
  tenant_id     uuid not null default tenant_for_insert(),
  notified_at   timestamptz,
  notify_error  text
);

create table downloads (
  id             uuid not null default gen_random_uuid(),
  photo_id       uuid not null,
  client_id      uuid,
  downloaded_at  timestamptz not null default now()
);

create table draft_shares (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null default tenant_for_insert(),
  token       text not null,
  note        text,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table favorites (
  id          uuid not null default gen_random_uuid(),
  album_id    uuid not null,
  photo_id    uuid not null,
  client_id   uuid,
  created_at  timestamptz not null default now()
);

create table instagram_media (
  id             text not null,
  media_url      text not null,
  thumbnail_url  text,
  permalink      text not null,
  caption        text,
  media_type     text,
  posted_at      timestamptz,
  sort_order     integer not null default 0,
  fetched_at     timestamptz not null default now(),
  tenant_id      uuid not null default tenant_for_insert()
);

create table jobs (
  id            uuid not null default gen_random_uuid(),
  tenant_id     uuid not null,
  kind          text not null,
  payload       jsonb not null default '{}'::jsonb,
  dedupe_key    text,
  status        text not null default 'queued'::text,
  attempts      integer not null default 0,
  max_attempts  integer not null default 5,
  run_after     timestamptz not null default now(),
  locked_at     timestamptz,
  locked_by     text,
  lease_until   timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table newsletter_signups (
  id          uuid not null default gen_random_uuid(),
  email       text not null,
  created_at  timestamptz not null default now(),
  tenant_id   uuid not null default tenant_for_insert(),
  synced_at   timestamptz,
  sync_error  text
);

create table order_items (
  id            uuid not null default gen_random_uuid(),
  order_id      uuid not null,
  product_id    uuid not null,
  quantity      integer not null default 1,
  price_cents   integer not null,
  tenant_id     uuid not null default tenant_for_insert(),
  photo_id      uuid,
  title         text,
  option_label  text,
  image_path    text
);

create table orders (
  id                          uuid not null default gen_random_uuid(),
  tenant_id                   uuid not null default tenant_for_insert(),
  client_id                   uuid,
  customer_email              text not null,
  stripe_checkout_session_id  text,
  status                      text not null default 'pending_payment'::text,
  created_at                  timestamptz not null default now(),
  order_number                text default ('WTP-'::text || nextval('order_number_seq'::regclass)),
  customer_name               text,
  customer_phone              text,
  shipping_line1              text,
  shipping_line2              text,
  shipping_city               text,
  shipping_state              text,
  shipping_postal_code        text,
  shipping_country            text not null default 'US'::text,
  customer_note               text,
  subtotal_cents              integer not null default 0,
  shipping_cents              integer not null default 0,
  total_cents                 integer not null default 0,
  currency                    text not null default 'usd'::text,
  updated_at                  timestamptz not null default now()
);

create table page_sections (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null,
  page        text not null,
  type        text not null,
  "position"  integer not null default 0,
  visible     boolean not null default true,
  settings    jsonb not null default '{}'::jsonb,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The six columns after `viewed_at` were added by
-- db/migrations/2026-09-29_analytics.sql (Supabase migration version
-- 20260929231653) and are in the order production reports them, which is the
-- order `add column` created them. The first five columns are untouched: S4 was
-- additive, and `album_id`, `post_id`, `visitor_hash` and `viewed_at` keep their
-- names, their types and their meanings.
--
-- `tenant_id` is NOT NULL, verified against production after deployment: all 77
-- pre-existing rows were backfilled from their album or story and none was left
-- without a site. The other five are nullable FOR EVER, because a row written
-- before that migration genuinely has no path, no session and no device, and
-- production confirms all 77 of them still carry NULL in each.
create table page_views (
  id            uuid not null default gen_random_uuid(),
  album_id      uuid,
  post_id       uuid,
  visitor_hash  text not null,
  viewed_at     timestamptz not null default now(),
  tenant_id     uuid not null,
  path          text,
  page_key      text,
  referrer_host text,
  session_hash  text,
  device        text
);

create table photo_assets (
  id                  uuid not null default gen_random_uuid(),
  -- NO DEFAULT, deliberately: every writer names the site. P1 decision; see
  -- claude/photo-assets-design.md §3.6.
  tenant_id           uuid not null,
  key_base            text not null,
  original_path       text,
  display_path        text not null,
  derivatives         jsonb not null default '{}'::jsonb,
  original_bytes      bigint,
  content_type        text,
  filename            text,
  content_sha256      text,
  width               integer,
  height              integer,
  orientation         text generated always as (
                        case when width is null or height is null then null
                             when width > height then 'landscape'
                             when width < height then 'portrait'
                             else 'square' end) stored,
  aspect_ratio        numeric(8,4) generated always as (
                        case when coalesce(height, 0) = 0 then null
                             else round(width::numeric / height, 4) end) stored,
  taken_at            timestamptz,
  latitude            double precision,
  longitude           double precision,
  camera_make         text,
  camera_model        text,
  lens                text,
  iso                 integer,
  aperture            numeric(4,1),
  shutter             text,
  focal_length        numeric(6,1),
  keywords            text[] not null default '{}',
  exif                jsonb not null default '{}'::jsonb,
  alt_text            text,
  alt_source          text,
  alt_reviewed_at     timestamptz,
  state               text not null default 'pending',
  derived_at          timestamptz,
  last_error          text,
  archived_at         timestamptz,
  deleted_at          timestamptz,
  original_purged_at  timestamptz,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table photo_shop_categories (
  photo_id     uuid not null,
  category_id  uuid not null
);

create table photo_usages (
  id            uuid not null default gen_random_uuid(),
  -- NO DEFAULT, deliberately: every writer names the site.
  tenant_id     uuid not null,
  asset_id      uuid not null,
  scope         text not null default 'live',
  kind          text not null,
  photo_id      uuid,
  album_id      uuid,
  post_id       uuid,
  product_id    uuid,
  page_key      text,
  field         text not null,
  position      integer not null default 0,
  alt_override  text,
  decorative    boolean not null default false,
  created_at    timestamptz not null default now()
);

create table photos (
  id                 uuid not null default gen_random_uuid(),
  tenant_id          uuid not null default tenant_for_insert(),
  album_id           uuid not null,
  storage_path       text not null,
  width              integer,
  height             integer,
  caption            text,
  alt_text           text,
  taken_at           timestamptz,
  latitude           numeric,
  longitude          numeric,
  sort_order         integer not null default 0,
  is_for_sale        boolean not null default false,
  watermark_enabled  boolean not null default false,
  created_at         timestamptz not null default now(),
  tags               text[] not null default '{}'::text[],
  original_path      text,
  derivatives        jsonb not null default '{}'::jsonb,
  original_bytes     bigint,
  -- P1. Nullable, and deliberately NO foreign key until P4's backfill fills it.
  asset_id           uuid
);

create table print_options (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null default tenant_for_insert(),
  label        text not null,
  kind         text not null default 'print'::text,
  price_cents  integer not null,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table products (
  id               uuid not null default gen_random_uuid(),
  photo_id         uuid not null,
  type             text not null,
  size_label       text,
  price_cents      integer not null,
  fulfillment_sku  text,
  created_at       timestamptz not null default now(),
  tenant_id        uuid not null default tenant_for_insert(),
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  print_option_id  uuid
);

create table profiles (
  id                 uuid not null,
  tenant_id          uuid not null default tenant_for_insert(),
  email              text not null,
  display_name       text,
  role               text not null default 'editor'::text,
  created_at         timestamptz not null default now(),
  is_platform_admin  boolean not null default false
);

create table room_scenes (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null default tenant_for_insert(),
  name        text not null default 'Room'::text,
  image_path  text not null,
  width       integer,
  height      integer,
  corners     jsonb not null default '[[32, 20], [68, 20], [68, 64], [32, 64]]'::jsonb,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  has_frame   boolean not null default true
);

create table shop_categories (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null default tenant_for_insert(),
  name        text not null,
  slug        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table site_draft (
  tenant_id      uuid not null,
  pages          jsonb not null default '{}'::jsonb,
  global_styles  jsonb,
  type_styles    jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  edit_label     text,
  page_seo       jsonb,
  custom_pages   jsonb,
  menu           jsonb,
  chrome         jsonb
);

create table site_draft_steps (
  id          bigint not null default nextval('site_draft_steps_id_seq'::regclass),
  tenant_id   uuid not null default tenant_for_insert(),
  stack       text not null,
  snapshot    jsonb not null,
  label       text,
  created_at  timestamptz not null default clock_timestamp()
);

create table site_images (
  id             uuid not null default gen_random_uuid(),
  tenant_id      uuid not null default tenant_for_insert(),
  storage_path   text not null,
  original_path  text,
  derivatives    jsonb not null default '{}'::jsonb,
  width          integer,
  height         integer,
  bytes          bigint,
  filename       text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  -- P1. Nullable, and deliberately NO foreign key until P4's backfill fills it.
  asset_id       uuid
);

create table site_secrets (
  tenant_id                uuid not null default tenant_for_insert(),
  instagram_token          text,
  updated_at               timestamptz not null default now(),
  newsletter_provider      text,
  newsletter_key           text,
  newsletter_list_id       text,
  newsletter_list_name     text,
  newsletter_double_optin  boolean not null default false
);

create table site_settings (
  id                         integer not null default nextval('site_settings_id_seq'::regclass),
  site_title                 text not null default 'WeTravelPhoto'::text,
  tagline                    text default 'Travel photography and field notes'::text,
  about_heading              text default 'About'::text,
  about_body                 text,
  contact_intro              text,
  instagram_url              text,
  email_public               text,
  hero_album_id              uuid,
  intro_heading              text,
  intro_body                 text,
  hero_kicker                text,
  show_newsletter            boolean not null default true,
  newsletter_heading         text,
  newsletter_body            text,
  featured_post_ids          uuid[] not null default '{}'::uuid[],
  intro_image_path           text,
  intro_image_side           text not null default 'left'::text,
  intro_kicker               text,
  carousel_source            text not null default 'albums'::text,
  carousel_heading           text,
  show_contact_section       boolean not null default true,
  contact_heading            text,
  show_intro                 boolean not null default true,
  show_galleries             boolean not null default true,
  show_journal               boolean not null default true,
  journal_heading            text,
  journal_count              integer not null default 3,
  hero_titles                jsonb not null default '{}'::jsonb,
  hero_subtitles             jsonb not null default '{}'::jsonb,
  type_styles                jsonb not null default '{}'::jsonb,
  contact_image_path         text,
  show_instagram             boolean not null default false,
  instagram_heading          text,
  instagram_handle           text,
  instagram_token            text,
  instagram_token_expires    timestamptz,
  instagram_synced_at        timestamptz,
  facebook_url               text,
  youtube_url                text,
  contact_image_side         text not null default 'left'::text,
  contact_eyebrow            text,
  contact_note               text,
  contact_tagline            text,
  footer_note                text,
  hero_focal                 jsonb not null default '{}'::jsonb,
  hero_title_position        text not null default 'center'::text,
  hero_show_mark             boolean not null default true,
  owner_name                 text,
  logo_header_path           text,
  logo_footer_path           text,
  logo_bird_path             text,
  logo_header_height         integer not null default 34,
  logo_footer_height         integer not null default 130,
  logo_bird_size             integer not null default 64,
  show_bird                  boolean not null default true,
  footer_copy                text,
  header_align               text not null default 'split'::text,
  header_nav_font            text not null default 'Oswald'::text,
  header_nav_scale           numeric not null default 1,
  footer_align               text not null default 'left'::text,
  footer_font                text not null default 'Karla'::text,
  footer_scale               numeric not null default 1,
  hero_mode                  text not null default 'stories'::text,
  hero_image_path            text,
  hero_fixed_title           text,
  hero_fixed_subtitle        text,
  hero_fixed_cta_label       text,
  hero_fixed_cta_href        text,
  hero_fixed_focal           jsonb not null default '{}'::jsonb,
  journal_show_excerpt       boolean not null default true,
  journal_show_date          boolean not null default false,
  journal_show_byline        boolean not null default false,
  show_about                 boolean not null default true,
  about_eyebrow              text,
  about_image_path           text,
  about_image_side           text not null default 'left'::text,
  about_cta_label            text,
  about_cta_href             text,
  nav_galleries_label        text,
  nav_journal_label          text,
  nav_about_label            text,
  nav_contact_label          text,
  logo_header_height_mobile  integer not null default 26,
  logo_footer_height_mobile  integer not null default 90,
  header_nav_scale_mobile    numeric not null default 1,
  footer_scale_mobile        numeric not null default 1,
  hero_story_align           text not null default 'left'::text,
  galleries_eyebrow          text,
  galleries_heading          text,
  journal_page_eyebrow       text,
  journal_page_heading       text,
  journal_title_scale        numeric not null default 1,
  show_shop                  boolean not null default false,
  shop_mode                  text not null default 'curated'::text,
  shop_eyebrow               text,
  shop_heading               text,
  shop_intro                 text,
  nav_shop_label             text,
  shop_currency              text not null default 'usd'::text,
  shop_shipping_flat_cents   integer not null default 1200,
  shop_order_note            text,
  shop_frames                jsonb not null default '{}'::jsonb,
  shop_subheading            text,
  shop_columns               integer not null default 3,
  shop_show_collection       boolean not null default true,
  shop_show_location         boolean not null default true,
  shop_show_price            boolean not null default true,
  shop_wall_texture          text,
  shop_title_font            text,
  shop_quote                 text,
  shop_quote_by              text,
  shop_corner_line           text,
  shop_show_breadcrumbs      boolean not null default true,
  shop_feature1_icon         text,
  shop_feature1_title        text,
  shop_feature1_body         text,
  shop_feature2_icon         text,
  shop_feature2_title        text,
  shop_feature2_body         text,
  shop_feature3_icon         text,
  shop_feature3_title        text,
  shop_feature3_body         text,
  shop_related_overline      text,
  shop_related_heading       text,
  shop_footer_left           text,
  shop_footer_right          text,
  shop_room                  text not null default 'living-room'::text,
  tenant_id                  uuid not null default tenant_for_insert(),
  global_styles              jsonb not null default '{}'::jsonb,
  global_styles_version      integer not null default 1,
  page_seo                   jsonb not null default '{}'::jsonb,
  custom_pages               jsonb not null default '[]'::jsonb,
  menu                       jsonb,
  contact_notify             boolean not null default true,
  contact_notify_email       text,
  favicon_path               text
);

create table site_template (
  tenant_id    uuid not null,
  template_id  uuid,
  version      integer not null default 1,
  snapshot     jsonb not null default '{}'::jsonb,
  adopted_at   timestamptz not null default now()
);

create table site_template_history (
  id                uuid not null default gen_random_uuid(),
  tenant_id         uuid not null,
  action            text not null,
  template_id       uuid,
  template_slug     text,
  template_name     text,
  version           integer,
  sections_before   jsonb not null default '[]'::jsonb,
  styles_before     jsonb not null default '{}'::jsonb,
  from_template_id  uuid,
  from_version      integer,
  note              text,
  created_at        timestamptz not null default now()
);

create table site_versions (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null default tenant_for_insert(),
  kind        text not null default 'publish'::text,
  note        text,
  snapshot    jsonb not null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table template_versions (
  id           uuid not null default gen_random_uuid(),
  template_id  uuid not null,
  version      integer not null,
  manifest     jsonb not null,
  notes        text,
  created_at   timestamptz not null default now()
);

create table templates (
  id                uuid not null default gen_random_uuid(),
  slug              text not null,
  name              text not null,
  blurb             text,
  version           integer not null default 1,
  status            text not null default 'draft'::text,
  origin            text not null default 'system'::text,
  author_tenant_id  uuid,
  tier              text,
  manifest          jsonb not null default '{}'::jsonb,
  preview_path      text,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  published_at      timestamptz
);

create table tenant_domains (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null,
  host        text not null,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table tenants (
  id          uuid not null default gen_random_uuid(),
  name        text not null,
  domain      text not null,
  created_at  timestamptz not null default now()
);

-- ── The queue's three functions ─────────────────────────────────────────────
--
-- AFTER the tables, not up with the other functions, and that is a property of
-- this FILE rather than of production: `claim_jobs` returns `setof public.jobs`
-- and `finish_job` returns `public.jobs`, so the table's composite type has to
-- exist before either can be created. `set check_function_bodies = off` at the
-- top excuses a body that mentions a missing table; it does not excuse a
-- missing RETURN TYPE.
--
-- Deployed 2026-09-29 by db/migrations/2026-09-29_jobs.sql (Supabase migration
-- version 20260929212635). Kept in their own sub-section rather than folded
-- into the alphabetical list above, because they belong to one migration and
-- read as one thing.
--
-- COPIED VERBATIM from that migration, which is the only reason this file can
-- be trusted about them: the long explanations of WHY each is shaped the way it
-- is live there, and `db/verify-jobs.sql` is what checks the behaviour. Verified
-- against production after deployment — all three SECURITY DEFINER, VOLATILE,
-- `search_path = ''`, and `claim_jobs` carrying the materialised CTE rather
-- than the `where id in (…)` form that could claim more than p_limit.

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
  if not (p_tenant = public.current_tenant_id() or public.is_platform_admin()) then
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

comment on function public.enqueue_jobs(uuid, text, jsonb) is
  'The only way work is added. Validates the site, the kind AND the resource '
  'the payload names, then BUILDS the payload and the dedupe key from what it '
  'validated rather than copying what it was sent. Names four columns and '
  'leaves the machinery — status, attempts, the lock and the lease — to its '
  'defaults, so a caller cannot enqueue a job that is already running, already '
  'out of attempts, or due in a decade.';


create or replace function public.claim_jobs(
  p_worker text,
  p_limit  int      default 1,
  p_lease  interval default interval '10 minutes',
  p_tenant uuid     default null
)
returns setof public.jobs
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_worker is null or length(p_worker) = 0 then
    raise exception 'A worker has to say who it is.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Between one and a hundred jobs at a time.' using errcode = '22023';
  end if;

  /*
   * FIRST, RETIRE THE CRASH LOOPS.
   *
   * A job whose lease has run out is claimable again — but if it has already
   * used every attempt, claiming it again would start the loop over. This is
   * where "the worker never came back" becomes a visible terminal failure
   * instead of an endless one, and it runs before the claim so that a job in
   * this state can never be picked up.
   */
  update public.jobs
     set status      = 'failed',
         finished_at = now(),
         lease_until = null,
         last_error  = coalesce(last_error || ' / ', '')
                       || 'the worker did not report back'
   where status = 'running'
     and lease_until < now()
     and attempts >= max_attempts
     and (p_tenant is null or tenant_id = p_tenant);

  /*
   * A CTE, NOT A SUBQUERY IN `where id in (…)`, AND THIS IS NOT A STYLE
   * CHOICE — it is a correctness fix for a bug that shipped in the first draft
   * of this file and was caught by an intermittent test failure.
   *
   * The first version was:
   *
   *     update jobs j set … where j.id in (
   *       select c.id from jobs c where … order by … limit p_limit
   *       for update skip locked)
   *
   * which reads as "take at most p_limit rows" and is not what it does. The
   * planner turns it into a Nested Loop Semi Join with the LIMIT/LockRows
   * subquery on the INNER side, so the subquery is RE-EXECUTED once per
   * candidate row of the outer scan — and because `skip locked` locks whatever
   * it returns, each re-execution hands back a DIFFERENT row. Measured against
   * five queued rows:
   *
   *     select count(*) from claim_jobs('w', 1, …)   →  5
   *
   * One call, `p_limit => 1`, five rows claimed and five attempts burned. In
   * production that is a drain claiming a batch, running only the first, and
   * abandoning the rest `running` under a ten-minute lease with an attempt
   * spent — and after five such rounds each would be failed as "the worker did
   * not report back" having never been run once.
   *
   * A CTE containing FOR UPDATE is never inlined and is materialised exactly
   * once, so `limit p_limit` means what it says. `db/verify-jobs.sql` asserts
   * it does, and that assertion fails against the form above.
   *
   * `for update skip locked` is still the whole concurrency story: two workers
   * running this at the same instant each lock a different set of rows and
   * neither waits for the other; a row already locked is passed over rather
   * than queued behind. Without `skip locked` the second worker would block and
   * then claim the SAME rows the first had just taken.
   */
  return query
  with picked as (
    select c.id
      from public.jobs c
     where (p_tenant is null or c.tenant_id = p_tenant)
       and (
             (c.status = 'queued'  and c.run_after <= now())
          or (c.status = 'running' and c.lease_until < now())
       )
     order by c.run_after, c.created_at
     limit p_limit
     for update skip locked
  )
  update public.jobs j
     set status      = 'running',
         attempts    = j.attempts + 1,
         locked_at   = now(),
         locked_by   = p_worker,
         lease_until = now() + p_lease
    from picked
   where j.id = picked.id
  returning j.*;
end $$;

comment on function public.claim_jobs(text, int, interval, uuid) is
  'Takes up to p_limit jobs for p_worker, counting the attempt as it goes. '
  'Also reclaims jobs whose lease ran out, and fails the ones that have no '
  'attempts left. The only way a worker reaches the jobs table.';


create or replace function public.finish_job(
  p_id        uuid,
  p_worker    text,
  p_error     text    default null,
  p_permanent boolean default false
)
returns public.jobs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job   public.jobs;
  v_delay interval;
begin
  -- Still holding the lease? See note 4 at the top. A worker that lost its job
  -- to a reclaim gets nothing back and must not pretend otherwise.
  select * into v_job from public.jobs
   where id = p_id and locked_by = p_worker and status = 'running'
   for update;

  if not found then
    return null;
  end if;

  if p_error is null then
    update public.jobs
       set status = 'done', finished_at = now(),
           lease_until = null, locked_by = null
     where id = p_id
     returning * into v_job;
    return v_job;
  end if;

  /*
   * OUT OF ATTEMPTS — OR NOT WORTH ANY.
   *
   * `p_permanent` is for a failure repeating cannot fix: a job kind with no
   * handler, a payload that names a photograph that no longer exists. Five
   * attempts at a spelling mistake is five times the noise and none of the
   * information.
   */
  if p_permanent or v_job.attempts >= v_job.max_attempts then
    update public.jobs
       set status = 'failed', finished_at = now(),
           lease_until = null, locked_by = null, last_error = p_error
     where id = p_id
     returning * into v_job;
    return v_job;
  end if;

  /*
   * EXPONENTIAL BACKOFF, FACTOR OF 4, WITH JITTER.
   *
   * 10s, 40s, 160s, 640s, then capped at an hour — each wait four times the
   * one before it rather than twice, because the failures this is for (a rate
   * limit, a service having a bad minute) are not fixed by trying again in
   * eleven seconds. The ±25% jitter matters once there is more than one job: a
   * hundred jobs that all failed against the same outage would otherwise all
   * come back at the same instant and reproduce it.
   */
  v_delay := least(
    interval '1 hour',
    interval '10 seconds' * power(4, greatest(v_job.attempts - 1, 0)) * (0.75 + random() * 0.5)
  );

  update public.jobs
     set status = 'queued', run_after = now() + v_delay,
         lease_until = null, locked_by = null, last_error = p_error
   where id = p_id
   returning * into v_job;

  return v_job;
end $$;

comment on function public.finish_job(uuid, text, text, boolean) is
  'Marks a job done, or re-queues it with exponential backoff, or fails it '
  'when the attempts are spent. Returns null if the caller no longer holds '
  'the lease.';


-- ── Analytics' one function ─────────────────────────────────────────────────
--
-- Here rather than up with the alphabetical list for the same reason as the
-- queue's three: it belongs to one migration and reads as one thing. Unlike
-- them its RETURN TYPE is `uuid`, so it does not depend on a table existing —
-- only its body mentions `public.page_views`, which `set check_function_bodies
-- = off` excuses.
--
-- Deployed 2026-09-29 by db/migrations/2026-09-29_analytics.sql (Supabase
-- migration version 20260929231653, sha256
-- c1acb1ae3a68c21094622820c768343e1e5fba63de6ee2f769ba5d4ddd4bfbdf).
--
-- COPIED VERBATIM from that migration. Verified against production after
-- deployment: SECURITY DEFINER, `search_path = ''`, returns uuid, EXECUTE to
-- `service_role` only, and carrying the FINAL nullable-session behaviour — a
-- null session is accepted, a non-null one must match `^[0-9a-f]{32}$`. The
-- long explanations of WHY each check is there live in the migration, and
-- `db/verify-analytics.sql` is what checks the behaviour.
--
-- A live smoke test was run against production as `service_role` after
-- deployment — homepage, page_key `home`, device `desktop`, referrer
-- `instagram.com`, session NULL — the row was created, then deleted, and
-- `page_views` returned to exactly 77 rows.

create or replace function public.record_page_view(
  p_tenant        uuid,
  p_path          text,
  p_visitor       text,
  p_session       text,
  p_device        text,
  p_page_key      text default null,
  p_album         uuid default null,
  p_post          uuid default null,
  p_referrer_host text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_id       uuid;
begin
  -- 1. the site
  if p_tenant is null
     or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'record_page_view: no such site %', p_tenant;
  end if;

  -- 2. and whether this caller may record for it
  --
  -- `session_user` and `current_user` are written BARE, and `coalesce` below
  -- too. They are not functions: the parser resolves them as SQL constructs,
  -- there is no `pg_catalog.current_user` to call, and qualifying them fails
  -- with "missing FROM-clause entry for table pg_catalog" — measured, not
  -- assumed. Being parser constructs is also why `search_path = ''` cannot
  -- reach them, which is the property that matters here.
  if not (p_tenant = public.current_tenant_id() or public.is_platform_admin()
          or pg_catalog.current_setting('role', true) = 'service_role'
          or session_user = current_user) then
    raise exception 'record_page_view: not permitted to record for site %', p_tenant;
  end if;

  -- 3. exactly one identity
  if pg_catalog.num_nonnulls(p_page_key, p_album, p_post) <> 1 then
    raise exception
      'record_page_view: a view is of exactly one thing — a page, a gallery or '
      'a story. Given page_key=%, album=%, post=%.', p_page_key, p_album, p_post;
  end if;

  -- 4/5/6. the resource, its owner, and the address it lives at
  if p_album is not null then
    select '/trips/' || a.slug into v_expected
      from public.albums a
     where a.id = p_album and a.tenant_id = p_tenant;
    if v_expected is null then
      raise exception
        'record_page_view: gallery % does not belong to site %', p_album, p_tenant;
    end if;

  elsif p_post is not null then
    select '/journal/' || p.slug into v_expected
      from public.blog_posts p
     where p.id = p_post and p.tenant_id = p_tenant;
    if v_expected is null then
      raise exception
        'record_page_view: story % does not belong to site %', p_post, p_tenant;
    end if;

  else
    v_expected := case p_page_key
      when 'home'      then '/'
      when 'about'     then '/about'
      when 'contact'   then '/contact'
      when 'journal'   then '/journal'
      -- The editor calls it "galleries"; the public address has always been
      -- /trips and links to it are out in the world. lib/sections/pages.ts.
      when 'galleries' then '/trips'
      when 'shop'      then '/shop'
      else null
    end;

    if v_expected is null then
      -- One of the photographer's own pages. Its key and its address both
      -- live in the same stored list, so the address is read from there
      -- rather than trusted.
      select '/' || (e.value ->> 'slug') into v_expected
        from public.site_settings s,
             pg_catalog.jsonb_array_elements(
               coalesce(s.custom_pages, '[]'::jsonb)) as e
       where s.tenant_id = p_tenant
         and e.value ->> 'key' = p_page_key
       limit 1;
    end if;

    if v_expected is null then
      raise exception
        'record_page_view: site % has no page called %', p_tenant, p_page_key;
    end if;
  end if;

  if p_path is distinct from v_expected then
    raise exception
      'record_page_view: that resource lives at %, not at %', v_expected, p_path;
  end if;

  -- 7. the shapes
  if p_device is null or p_device not in ('phone', 'tablet', 'desktop') then
    raise exception 'record_page_view: device must be phone, tablet or desktop, not %',
      coalesce(p_device, 'null');
  end if;

  -- Null is allowed and means "this browser would not keep a per-tab value".
  -- Anything else must be exactly what lib/analytics/session.ts mints: 16
  -- random bytes as lower-case hex. `~` is case-sensitive, so an upper-case
  -- hex string is refused, which is deliberate — one canonical spelling or the
  -- column cannot be grouped by.
  if p_session is not null and p_session !~ '^[0-9a-f]{32}$' then
    raise exception
      'record_page_view: a session id must be 32 lower-case hex characters, or null';
  end if;

  -- A hash. Not an address, not a user-agent, not an email — see the
  -- page_views_visitor_is_a_hash constraint for what each clause rules out.
  if p_visitor is null
     or pg_catalog.length(p_visitor) not between 8 and 64
     or p_visitor ~ '[[:space:]@/:]'
     or p_visitor ~ '^[0-9.]+$' then
    raise exception 'record_page_view: visitor hash is not a hash';
  end if;

  if p_referrer_host is not null
     and not (p_referrer_host ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'
              and p_referrer_host like '%.%') then
    raise exception
      'record_page_view: referrer must be a bare host, not %', p_referrer_host;
  end if;

  insert into public.page_views
    (tenant_id, path, page_key, album_id, post_id,
     visitor_hash, session_hash, referrer_host, device)
  values
    (p_tenant, p_path, p_page_key, p_album, p_post,
     p_visitor, p_session, p_referrer_host, p_device)
  returning id into v_id;

  return v_id;
end $$;

comment on function public.record_page_view(uuid, text, text, text, text, text, uuid, uuid, text) is
  'The only way a page view is written. Validates the site, exactly one '
  'identity, that an album or story belongs to that site, that the path is the '
  'one that resource lives at, and every column shape. A null session is '
  'allowed; anything else must be 32 lower-case hex characters.';


-- ── Primary keys ────────────────────────────────────────────────────────────
alter table album_clients          add constraint album_clients_pkey primary key (album_id, client_id);
alter table albums                 add constraint albums_pkey primary key (id);
alter table blog_posts             add constraint blog_posts_pkey primary key (id);
alter table catalog_items          add constraint catalog_items_pkey primary key (id);
alter table clients                add constraint clients_pkey primary key (id);
alter table contact_messages       add constraint contact_messages_pkey primary key (id);
alter table downloads              add constraint downloads_pkey primary key (id);
alter table draft_shares           add constraint draft_shares_pkey primary key (id);
alter table favorites              add constraint favorites_pkey primary key (id);
alter table instagram_media        add constraint instagram_media_pkey primary key (id);
alter table jobs                   add constraint jobs_pkey primary key (id);
alter table newsletter_signups     add constraint newsletter_signups_pkey primary key (id);
alter table order_items            add constraint order_items_pkey primary key (id);
alter table orders                 add constraint orders_pkey primary key (id);
alter table page_sections          add constraint page_sections_pkey primary key (id);
alter table page_views             add constraint page_views_pkey primary key (id);
alter table photo_assets           add constraint photo_assets_pkey primary key (id);
alter table photo_shop_categories  add constraint photo_shop_categories_pkey primary key (photo_id, category_id);
alter table photo_usages           add constraint photo_usages_pkey primary key (id);
alter table photos                 add constraint photos_pkey primary key (id);
alter table print_options          add constraint print_options_pkey primary key (id);
alter table products               add constraint products_pkey primary key (id);
alter table profiles               add constraint profiles_pkey primary key (id);
alter table room_scenes            add constraint room_scenes_pkey primary key (id);
alter table shop_categories        add constraint shop_categories_pkey primary key (id);
alter table site_draft             add constraint site_draft_pkey primary key (tenant_id);
alter table site_draft_steps       add constraint site_draft_steps_pkey primary key (id);
alter table site_images            add constraint site_images_pkey primary key (id);
alter table site_secrets           add constraint site_secrets_pkey primary key (tenant_id);
alter table site_settings          add constraint site_settings_pkey primary key (id);
alter table site_template          add constraint site_template_pkey primary key (tenant_id);
alter table site_template_history  add constraint site_template_history_pkey primary key (id);
alter table site_versions          add constraint site_versions_pkey primary key (id);
alter table template_versions      add constraint template_versions_pkey primary key (id);
alter table templates              add constraint templates_pkey primary key (id);
alter table tenant_domains         add constraint tenant_domains_pkey primary key (id);
alter table tenants                add constraint tenants_pkey primary key (id);

-- ── Unique constraints ──────────────────────────────────────────────────────
alter table albums             add constraint albums_tenant_id_slug_key unique (tenant_id, slug);
alter table blog_posts         add constraint blog_posts_tenant_id_slug_key unique (tenant_id, slug);
alter table catalog_items      add constraint catalog_items_photo_id_key unique (photo_id);
alter table draft_shares       add constraint draft_shares_token_key unique (token);
-- NOTE: production truth. This is unique on email ALONE, not (tenant_id, email).
-- See db/schema-verified.md — flagged, not changed.
alter table jobs add constraint jobs_tenant_id_fkey
  foreign key (tenant_id) references tenants(id) on delete cascade;

alter table newsletter_signups add constraint newsletter_signups_email_key unique (email);
alter table template_versions  add constraint template_versions_template_id_version_key unique (template_id, version);
alter table templates          add constraint templates_slug_key unique (slug);
alter table tenants            add constraint tenants_domain_key unique (domain);

-- P1. The targets of photo_usages' tenant-aware foreign keys: redundant with each
-- primary key as a uniqueness rule, and required anyway, because a composite
-- foreign key can only reference a unique constraint on exactly its columns.
alter table photos             add constraint photos_id_tenant unique (id, tenant_id);
alter table albums             add constraint albums_id_tenant unique (id, tenant_id);
alter table blog_posts         add constraint blog_posts_id_tenant unique (id, tenant_id);
alter table catalog_items      add constraint catalog_items_id_tenant unique (id, tenant_id);
alter table photo_assets       add constraint photo_assets_id_tenant unique (id, tenant_id);

-- ── Foreign keys, with the delete action production actually has ────────────
alter table album_clients add constraint album_clients_album_id_fkey
  foreign key (album_id) references albums(id) on delete cascade;
alter table album_clients add constraint album_clients_client_id_fkey
  foreign key (client_id) references clients(id) on delete cascade;

alter table albums add constraint albums_cover_photo_fk
  foreign key (cover_photo_id) references photos(id) on delete set null;
alter table albums add constraint albums_created_by_fkey
  foreign key (created_by) references profiles(id);
alter table albums add constraint albums_tenant_id_fkey
  foreign key (tenant_id) references tenants(id);

alter table blog_posts add constraint blog_posts_album_id_fkey
  foreign key (album_id) references albums(id) on delete set null;
alter table blog_posts add constraint blog_posts_author_id_fkey
  foreign key (author_id) references profiles(id);
-- NO ACTION: the only photo child that neither cascades nor nulls. See notes.
alter table blog_posts add constraint blog_posts_cover_photo_id_fkey
  foreign key (cover_photo_id) references photos(id);
alter table blog_posts add constraint blog_posts_featured_photo_id_fkey
  foreign key (featured_photo_id) references photos(id) on delete set null;
alter table blog_posts add constraint blog_posts_tenant_id_fkey
  foreign key (tenant_id) references tenants(id);

alter table catalog_items add constraint catalog_items_photo_id_fkey
  foreign key (photo_id) references photos(id) on delete cascade;

alter table clients add constraint clients_tenant_id_fkey
  foreign key (tenant_id) references tenants(id);

alter table downloads add constraint downloads_client_id_fkey
  foreign key (client_id) references clients(id) on delete set null;
alter table downloads add constraint downloads_photo_id_fkey
  foreign key (photo_id) references photos(id) on delete cascade;

alter table draft_shares add constraint draft_shares_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table draft_shares add constraint draft_shares_tenant_id_fkey
  foreign key (tenant_id) references tenants(id) on delete cascade;

alter table favorites add constraint favorites_album_id_fkey
  foreign key (album_id) references albums(id) on delete cascade;
alter table favorites add constraint favorites_client_id_fkey
  foreign key (client_id) references clients(id) on delete cascade;
alter table favorites add constraint favorites_photo_id_fkey
  foreign key (photo_id) references photos(id) on delete cascade;

alter table order_items add constraint order_items_order_id_fkey
  foreign key (order_id) references orders(id) on delete cascade;
alter table order_items add constraint order_items_photo_id_fkey
  foreign key (photo_id) references photos(id) on delete set null;
alter table order_items add constraint order_items_product_id_fkey
  foreign key (product_id) references products(id);

alter table orders add constraint orders_client_id_fkey
  foreign key (client_id) references clients(id);
alter table orders add constraint orders_tenant_id_fkey
  foreign key (tenant_id) references tenants(id);

alter table page_views add constraint page_views_album_id_fkey
  foreign key (album_id) references albums(id) on delete cascade;
alter table page_views add constraint page_views_post_id_fkey
  foreign key (post_id) references blog_posts(id) on delete cascade;
-- S4. ON DELETE CASCADE, matching this table's other two and matching `jobs`.
-- `app/actions/sites.ts` still deletes the rows explicitly and first; the
-- cascade is the backstop for a path nobody thought of.
alter table page_views add constraint page_views_tenant_id_fkey
  foreign key (tenant_id) references tenants(id) on delete cascade;

alter table photo_shop_categories add constraint photo_shop_categories_category_id_fkey
  foreign key (category_id) references shop_categories(id) on delete cascade;
alter table photo_shop_categories add constraint photo_shop_categories_photo_id_fkey
  foreign key (photo_id) references photos(id) on delete cascade;

-- VERIFIED 2026-09-29. confdeltype = 'c'. The whole gallery-usage projection
-- in claude/photo-assets-design.md rests on this being CASCADE.
alter table photos add constraint photos_album_id_fkey
  foreign key (album_id) references albums(id) on delete cascade;
alter table photos add constraint photos_tenant_id_fkey
  foreign key (tenant_id) references tenants(id);

alter table products add constraint products_photo_id_fkey
  foreign key (photo_id) references photos(id) on delete cascade;
alter table products add constraint products_print_option_id_fkey
  foreign key (print_option_id) references print_options(id) on delete set null;

alter table profiles add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;
alter table profiles add constraint profiles_tenant_id_fkey
  foreign key (tenant_id) references tenants(id);

alter table site_draft add constraint site_draft_updated_by_fkey
  foreign key (updated_by) references profiles(id) on delete set null;

alter table site_draft_steps add constraint site_draft_steps_tenant_id_fkey
  foreign key (tenant_id) references tenants(id) on delete cascade;

alter table site_images add constraint site_images_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table site_images add constraint site_images_tenant_id_fkey
  foreign key (tenant_id) references tenants(id) on delete cascade;

alter table site_secrets add constraint site_secrets_tenant_id_fkey
  foreign key (tenant_id) references tenants(id) on delete cascade;

alter table site_settings add constraint site_settings_hero_album_id_fkey
  foreign key (hero_album_id) references albums(id) on delete set null;
alter table site_settings add constraint site_settings_tenant_id_fkey
  foreign key (tenant_id) references tenants(id);

alter table site_template add constraint site_template_template_id_fkey
  foreign key (template_id) references templates(id) on delete set null;

alter table site_template_history add constraint site_template_history_template_id_fkey
  foreign key (template_id) references templates(id) on delete set null;

alter table site_versions add constraint site_versions_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table site_versions add constraint site_versions_tenant_id_fkey
  foreign key (tenant_id) references tenants(id) on delete cascade;

alter table template_versions add constraint template_versions_template_id_fkey
  foreign key (template_id) references templates(id) on delete cascade;

alter table tenant_domains add constraint tenant_domains_tenant_id_fkey
  foreign key (tenant_id) references tenants(id) on delete cascade;

-- P1, from db/migrations/2026-09-29_photo_assets.sql. Every parent reference on
-- photo_usages carries the tenant, so a row claiming site A cannot point at a
-- parent owned by site B — enforced for every role, the owner included.
-- RESTRICT on the asset: a photograph still placed somewhere cannot be deleted.
-- Deleting a SITE still succeeds: verified in production 2026-09-30 (tenant,
-- asset and usages all gone), and asserted by db/verify-photo-assets.sql.
alter table photo_assets add constraint photo_assets_tenant_fk
  foreign key (tenant_id) references tenants(id) on delete cascade;
alter table photo_assets add constraint photo_assets_created_by_fk
  foreign key (created_by) references profiles(id) on delete set null;
alter table photo_usages add constraint photo_usages_tenant_fk
  foreign key (tenant_id) references tenants(id) on delete cascade;
alter table photo_usages add constraint photo_usages_asset_fk
  foreign key (asset_id, tenant_id) references photo_assets (id, tenant_id) on delete restrict;
alter table photo_usages add constraint photo_usages_photo_fk
  foreign key (photo_id, tenant_id) references photos (id, tenant_id) on delete cascade;
alter table photo_usages add constraint photo_usages_album_fk
  foreign key (album_id, tenant_id) references albums (id, tenant_id) on delete cascade;
alter table photo_usages add constraint photo_usages_post_fk
  foreign key (post_id, tenant_id) references blog_posts (id, tenant_id) on delete cascade;
alter table photo_usages add constraint photo_usages_product_fk
  foreign key (product_id, tenant_id) references catalog_items (id, tenant_id) on delete cascade;

-- ── CHECK constraints ───────────────────────────────────────────────────────
-- The survey output abbreviated these to "CHECK col IN (...)". The predicates
-- below are a faithful reconstruction of that meaning, NOT the literal text
-- pg_get_constraintdef returned. See db/schema-verified.md, "Reconstructed".
alter table albums add constraint albums_cover_date_format_check   check (cover_date_format in ('full','month_year','year'));
alter table albums add constraint albums_cover_fit_check           check (cover_fit in ('cover','contain'));
alter table albums add constraint albums_cover_height_check        check (cover_height in ('full','large','medium','short'));
alter table albums add constraint albums_cover_overlay_type_check  check (cover_overlay_type in ('none','darken','gradient','grain','darken_grain'));
alter table albums add constraint albums_description_align_check   check (description_align in ('left','center','right'));
alter table albums add constraint albums_layout_style_check        check (layout_style in ('masonry','grid','single_column'));
alter table albums add constraint albums_privacy_type_check        check (privacy_type in ('public','unlisted','password','client_only'));
alter table albums add constraint albums_sort_order_check          check (sort_order in ('manual','date_asc','date_desc'));

alter table blog_posts add constraint blog_posts_status_check      check (status in ('draft','published'));

-- NOTE: orders.status DEFAULT is 'pending_payment', which is NOT in this list.
-- Production truth, reproduced verbatim. Flagged in db/schema-verified.md.
alter table jobs add constraint jobs_payload_object               check (jsonb_typeof(payload) = 'object');
alter table jobs add constraint jobs_dedupe_key_check            check (dedupe_key is null or length(dedupe_key) <= 200);
alter table jobs add constraint jobs_status_check                check (status in ('queued','running','done','failed'));
alter table jobs add constraint jobs_max_attempts_check          check (max_attempts between 1 and 20);
alter table orders add constraint orders_status_check              check (status in ('pending','paid','fulfilled','cancelled'));

-- S4's seven, from db/migrations/2026-09-29_analytics.sql. Unlike almost every
-- other CHECK in this file these are NOT a reconstruction — they were written by
-- that migration and verified present in production by name after deployment,
-- so the predicates here are the literal ones.
--
-- They say the same things `record_page_view` says, on purpose: the function is
-- the door, and these are what the table IS. A future migration, a backfill or
-- somebody at a psql prompt goes round the door; nothing goes round a CHECK.
--
-- `page_views_visitor_is_a_hash` is the one to read twice. `visitor_hash` is
-- where an IP address would go if somebody ever decided hashing it was
-- inconvenient, so the table refuses one: no colon rules out IPv6,
-- `^[0-9.]+$` rules out IPv4, and no space, `@` or `/` rules out a user-agent,
-- an email address and a URL.
alter table page_views add constraint page_views_identity
  check (num_nonnulls(page_key, album_id, post_id) = 1);
alter table page_views add constraint page_views_path_is_a_path
  check (path is null or (path ~ '^/[^?#[:space:]]*$' and length(path) <= 255));
alter table page_views add constraint page_views_page_key_shape
  check (page_key is null or page_key ~
    '^(home|about|contact|journal|galleries|shop|p_[a-z0-9]{8})$');
alter table page_views add constraint page_views_referrer_is_a_host
  check (referrer_host is null or
         (referrer_host ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'
          and referrer_host like '%.%'));
-- Null is an ordinary value: a browser that will not keep a per-tab value is
-- still a visitor, and the view is recorded without one. A session id that IS
-- present is exactly 16 random bytes as LOWER-CASE hex — `~` is case-sensitive,
-- so one canonical spelling, or the column cannot be grouped by.
alter table page_views add constraint page_views_session_shape
  check (session_hash is null or session_hash ~ '^[0-9a-f]{32}$');
alter table page_views add constraint page_views_device_bucket
  check (device is null or device in ('phone', 'tablet', 'desktop'));
alter table page_views add constraint page_views_visitor_is_a_hash
  check (length(visitor_hash) between 8 and 64
         and visitor_hash !~ '[[:space:]@/:]'
         and visitor_hash !~ '^[0-9.]+$');

alter table products add constraint products_type_check            check (type in ('print','digital_download'));

-- NOTE: lib/auth.ts EDIT_ROLES includes 'admin', which this forbids.
alter table profiles add constraint profiles_role_check            check (role in ('owner','editor'));

alter table site_draft_steps add constraint site_draft_steps_stack_check check (stack in ('undo','redo'));

alter table site_settings add constraint site_settings_about_image_side_check    check (about_image_side in ('left','right'));
alter table site_settings add constraint site_settings_carousel_source_check     check (carousel_source in ('albums','journal'));
alter table site_settings add constraint site_settings_contact_image_side_check  check (contact_image_side in ('left','right'));
alter table site_settings add constraint site_settings_footer_align_check        check (footer_align in ('left','center'));
alter table site_settings add constraint site_settings_header_align_check        check (header_align in ('split','left','center'));
alter table site_settings add constraint site_settings_hero_mode_check           check (hero_mode in ('stories','fixed'));
alter table site_settings add constraint site_settings_hero_story_align_check    check (hero_story_align in ('left','center'));
alter table site_settings add constraint site_settings_hero_title_position_check check (hero_title_position in ('center','lower','upper'));
alter table site_settings add constraint site_settings_intro_image_side_check    check (intro_image_side in ('left','right'));
alter table site_settings add constraint site_settings_shop_columns_check        check (shop_columns >= 2 and shop_columns <= 5);

alter table site_template_history add constraint site_template_history_action_check check (action in ('apply','update','revert','publish'));
alter table site_versions         add constraint site_versions_kind_check           check (kind in ('publish','baseline'));
alter table templates             add constraint templates_origin_check             check (origin in ('system','tenant'));
alter table templates             add constraint templates_status_check             check (status in ('draft','published','retired'));

-- The survey abbreviated this to "CHECK host shape/lowercase/length rules".
-- Taken verbatim from db/migrations/2026-09-23_tenant_domains.sql instead.
alter table tenant_domains add constraint tenant_domains_host_shape check (
  host = lower(host)
  and host !~ '[:/[:space:]]'
  and host not like '%.'
  and length(host) between 3 and 253
);

-- P1. Unlike the survey-era CHECKs above, these are copied VERBATIM from
-- db/migrations/2026-09-29_photo_assets.sql, and the drift guard compares them.
alter table photo_assets add constraint photo_assets_state_known
  check (state in ('pending','derived','failed'));
alter table photo_assets add constraint photo_assets_alt_source_known
  check (alt_source is null or alt_source in ('photographer','ai'));
alter table photo_assets add constraint photo_assets_alt_source_present
  check (alt_text is null or alt_source is not null);

alter table photo_usages add constraint photo_usages_kind_known check (kind in (
  'gallery','gallery_cover','page_section','page_legacy',
  'story_cover','story_block','shop_listing'
));
alter table photo_usages add constraint photo_usages_scope_known check (scope in ('live','draft'));
alter table photo_usages add constraint photo_usages_scope_by_kind check (
  scope = 'live' or kind in ('page_section','page_legacy')
);
-- The SQL twin of isPageKey() in lib/sections/pages.ts, notfound included. A new
-- built-in page needs a line here; .mk/photo-assets.ts fails until it has one.
alter table photo_usages add constraint photo_usages_page_key_shape check (
  page_key is null
  or page_key in ('home','about','contact','journal','galleries','shop','notfound')
  or page_key ~ '^p_[a-z0-9]{8}$'
);
alter table photo_usages add constraint photo_usages_one_parent check (
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
);

-- Standalone indexes only. Primary keys and UNIQUE constraints create their own
-- and are not repeated here.

create index        albums_display_order_idx        on albums (display_order);
-- DUPLICATE of albums_tenant_id_slug_key. Production truth; not removed. See notes.
create unique index albums_site_slug_key            on albums (tenant_id, slug);

-- DUPLICATE of blog_posts_tenant_id_slug_key. Production truth; not removed.
create unique index blog_posts_site_slug_key        on blog_posts (tenant_id, slug);

create index        catalog_items_published_idx     on catalog_items (is_published) where is_published;
create index        catalog_items_tenant_sort_idx   on catalog_items (tenant_id, sort_order);
create index        clients_access_token_idx        on clients (access_token);
create index        draft_shares_site               on draft_shares (tenant_id, created_at desc);
create index        order_items_order_idx           on order_items (order_id);
create unique index orders_order_number_idx         on orders (order_number);
create index        orders_tenant_created_idx       on orders (tenant_id, created_at desc);
create index        page_sections_page_idx          on page_sections (tenant_id, page, "position");
create index        page_views_album_idx            on page_views (album_id, viewed_at desc);
-- S4's two, verified present in production after deployment. `page_views_post_idx`
-- is the album index's missing twin: lib/admin/overview.ts has queried by
-- post_id since it was written with nothing to serve it. `page_views_tenant_time`
-- is the shape every read after S4 begins with — this site, this window.
create index        page_views_post_idx             on page_views (post_id, viewed_at desc) where post_id is not null;
create index        page_views_tenant_time          on page_views (tenant_id, viewed_at desc);
create index        photo_shop_categories_category_idx on photo_shop_categories (category_id);
create index        photos_for_sale_idx             on photos (is_for_sale) where is_for_sale;
create index        print_options_tenant_idx        on print_options (tenant_id, sort_order);
create index        products_photo_idx              on products (photo_id) where is_active;
create index        room_scenes_order_idx           on room_scenes (sort_order);
create unique index shop_categories_tenant_slug_idx on shop_categories (tenant_id, slug);
create index        site_draft_steps_top            on site_draft_steps (tenant_id, stack, id desc);
create index        site_images_newest              on site_images (tenant_id, created_at desc);
create unique index site_settings_tenant_idx        on site_settings (tenant_id);
create index        site_template_history_idx       on site_template_history (tenant_id, created_at desc);
create index        site_versions_newest            on site_versions (tenant_id, created_at desc);
create index        templates_offered_idx           on templates (status, sort_order) where status = 'published'::text;
create unique index tenant_domains_host_key         on tenant_domains (lower(host));
create unique index tenant_domains_primary_key      on tenant_domains (tenant_id) where is_primary;
create index        tenant_domains_tenant           on tenant_domains (tenant_id);

-- The queue's four, from db/migrations/2026-09-29_jobs.sql. Three are partial:
-- `done` and `failed` rows accumulate and are never candidates for a claim.
-- `jobs_pending_dedupe` is what makes "the same work is not queued twice" true,
-- and it is partial over a nullable column on purpose — see that migration.
create index        jobs_ready          on jobs (run_after) where status = 'queued';
create index        jobs_stale          on jobs (lease_until) where status = 'running';
create index        jobs_tenant_status  on jobs (tenant_id, status, created_at desc);
create unique index jobs_pending_dedupe on jobs (tenant_id, kind, dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');

-- P1's, from db/migrations/2026-09-29_photo_assets.sql. The seven
-- photo_usages_slot_* are one PARTIAL unique index per usage kind, not one wide
-- UNIQUE: a unique constraint over the nullable parent columns is NULLS DISTINCT
-- and would admit a duplicate of every kind. The content hash is indexed and
-- deliberately NOT unique. Several show as "unused" in the advisor until P2/P3
-- write rows — recorded in claude/open-items.md, not acted on.
create unique index photo_assets_key        on photo_assets (tenant_id, key_base);
create index        photo_assets_sha        on photo_assets (tenant_id, content_sha256)
  where content_sha256 is not null;
create index        photo_assets_library    on photo_assets (tenant_id, created_at desc)
  where deleted_at is null and archived_at is null;
create index        photo_assets_unfinished on photo_assets (state)
  where state in ('pending','failed');
create index        photo_assets_sweep      on photo_assets (deleted_at)
  where deleted_at is not null;
create index        photo_assets_no_alt     on photo_assets (tenant_id)
  where alt_text is null and deleted_at is null;

create unique index photo_usages_slot_gallery     on photo_usages (photo_id)
  where kind = 'gallery';
create unique index photo_usages_slot_cover       on photo_usages (album_id, field)
  where kind = 'gallery_cover';
create unique index photo_usages_slot_section     on photo_usages (tenant_id, scope, page_key, position, field)
  where kind = 'page_section';
create unique index photo_usages_slot_legacy      on photo_usages (tenant_id, scope, page_key, field)
  where kind = 'page_legacy';
create unique index photo_usages_slot_story_cover on photo_usages (post_id)
  where kind = 'story_cover';
create unique index photo_usages_slot_story_block on photo_usages (post_id, field, position)
  where kind = 'story_block';
create unique index photo_usages_slot_shop        on photo_usages (product_id)
  where kind = 'shop_listing';
create index        photo_usages_asset            on photo_usages (asset_id);
create index        photo_usages_needs_alt        on photo_usages (tenant_id, asset_id)
  where scope = 'live' and decorative = false and alt_override is null;

-- Row level security, exactly as production has it. The distinctions below are
-- deliberate and must not be homogenised:
--   · direct tenant_id scoping          ("Tenant members manage" on most tables)
--   · scoping through a parent          (tenant_of(...) — album_clients, downloads,
--                                        favorites, photo_shop_categories)
--   · intentionally public SELECT       (albums, blog_posts, page_sections, site_settings, …)
--   · intentionally public INSERT-only  (contact_messages, newsletter_signups)
--
-- `page_views` used to be in BOTH of the last two and is now in neither. S4
-- gave it a tenant_id of its own, so it scopes directly; and it dropped
-- "Anyone can record a view", which was `with check (true)` — a policy under
-- which anybody at all could write a row naming any gallery on the platform.
-- Nothing may insert into it now; `record_page_view` is the whole write path.

alter table album_clients          enable row level security;
alter table albums                 enable row level security;
alter table blog_posts             enable row level security;
alter table catalog_items          enable row level security;
alter table clients                enable row level security;
alter table contact_messages       enable row level security;
alter table downloads              enable row level security;
alter table draft_shares           enable row level security;
alter table favorites              enable row level security;
alter table instagram_media        enable row level security;
alter table newsletter_signups     enable row level security;
alter table order_items            enable row level security;
alter table orders                 enable row level security;
alter table page_sections          enable row level security;
alter table page_views             enable row level security;
alter table photo_assets           enable row level security;
alter table photo_shop_categories  enable row level security;
alter table photo_usages           enable row level security;
alter table photos                 enable row level security;
alter table print_options          enable row level security;
alter table products               enable row level security;
alter table profiles               enable row level security;
alter table room_scenes            enable row level security;
alter table shop_categories        enable row level security;
alter table site_draft             enable row level security;
alter table site_draft_steps       enable row level security;
alter table site_images            enable row level security;
alter table site_secrets           enable row level security;
alter table site_settings          enable row level security;
alter table site_template          enable row level security;
alter table site_template_history  enable row level security;
alter table site_versions          enable row level security;
alter table template_versions      enable row level security;
alter table templates              enable row level security;
alter table tenant_domains         enable row level security;
alter table tenants                enable row level security;

-- ── Scoped through a parent ─────────────────────────────────────────────────
select public.apply_tenant_policy_via('album_clients',         'album_id', 'albums');
select public.apply_tenant_policy_via('downloads',             'photo_id', 'photos');
select public.apply_tenant_policy_via('favorites',             'album_id', 'albums');
select public.apply_tenant_policy_via('photo_shop_categories', 'photo_id', 'photos');

-- page_views used to hang off EITHER an album or a story, with no site of its
-- own, and its policy reached the site through whichever parent it had. S4
-- replaced that with the direct form, because the parent-based one is false for
-- every row that has neither — which is what a homepage view is, so a
-- photographer could not have read their own homepage views at all.
--
-- Replaced rather than added to: `tenant_id` is NOT NULL and was backfilled
-- from exactly those parents, so the two forms agree on every row that existed,
-- and `tenant_of` was a function call per row on a table about to get much
-- bigger. Verified against production after deployment as the ONLY policy on
-- this table.
--
-- It is written out here rather than through `apply_tenant_policy` to match the
-- migration's text exactly; the helper would produce the same predicate.
create policy "Tenant members manage" on page_views for all
  using      (tenant_id = public.current_tenant_id() or public.is_platform_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());

-- ── Direct tenant_id scoping ────────────────────────────────────────────────
select public.apply_tenant_policy('albums');
select public.apply_tenant_policy('blog_posts');
select public.apply_tenant_policy('catalog_items');
select public.apply_tenant_policy('clients');
select public.apply_tenant_policy('contact_messages');
select public.apply_tenant_policy('draft_shares');
select public.apply_tenant_policy('instagram_media');
select public.apply_tenant_policy('jobs');
select public.apply_tenant_policy('newsletter_signups');
select public.apply_tenant_policy('order_items');
select public.apply_tenant_policy('orders');
select public.apply_tenant_policy('page_sections');
select public.apply_tenant_policy('photo_assets');
select public.apply_tenant_policy('photo_usages');
select public.apply_tenant_policy('photos');
select public.apply_tenant_policy('print_options');
select public.apply_tenant_policy('products');
select public.apply_tenant_policy('room_scenes');
select public.apply_tenant_policy('shop_categories');
select public.apply_tenant_policy('site_draft');
select public.apply_tenant_policy('site_draft_steps');
select public.apply_tenant_policy('site_images');
select public.apply_tenant_policy('site_secrets');
select public.apply_tenant_policy('site_settings');
select public.apply_tenant_policy('site_template');
select public.apply_tenant_policy('site_template_history');
select public.apply_tenant_policy('site_versions');

-- ── Public SELECT surfaces ──────────────────────────────────────────────────
create policy "Public can view public albums"        on albums              for select using (privacy_type = 'public');
create policy "Public can view published blog posts" on blog_posts          for select using (status = 'published');
create policy "Anyone reads published catalog items" on catalog_items       for select using (is_published);
create policy "Anyone can read instagram media"      on instagram_media     for select using (true);
create policy "Anyone reads page sections"           on page_sections       for select using (true);
create policy "Anyone reads photo categories"        on photo_shop_categories for select using (true);
create policy "Public can view photos in public albums" on photos           for select using (
  exists (select 1 from albums a where a.id = photos.album_id and a.privacy_type = 'public')
);
create policy "Anyone reads print options"           on print_options       for select using (is_active);
create policy "Anyone reads active products"         on products            for select using (is_active);
create policy "room_scenes public read"              on room_scenes         for select using (is_active = true);
create policy "Anyone reads shop categories"         on shop_categories     for select using (true);
create policy "Anyone reads site settings"           on site_settings       for select using (true);

-- ── Public INSERT-only surfaces ─────────────────────────────────────────────
create policy "Anyone can send a message"  on contact_messages   for insert with check (true);
create policy "Anyone can sign up"         on newsletter_signups for insert with check (true);
-- "Anyone can record a view" on page_views, `for insert with check (true)`, was
-- DROPPED by S4 and is deliberately absent. It let anybody at all — no account
-- needed — POST to PostgREST and write a view against any gallery on the
-- platform, with any visitor hash and any timestamp. Verified gone in
-- production.

-- ── Platform-owned and account tables ───────────────────────────────────────
create policy "Tenant members read profiles" on profiles for select using (
  id = auth.uid() or tenant_id = public.current_tenant_id() or public.is_platform_admin()
);
create policy "Platform admins manage profiles" on profiles for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "Anyone reads template versions" on template_versions for select using (true);
create policy "Platform admins manage template versions" on template_versions for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "Anyone reads published templates" on templates for select using (status <> 'draft');
create policy "Platform admins manage templates" on templates for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "Anyone resolves a site by its address" on tenant_domains for select using (true);
create policy "Platform admins manage addresses" on tenant_domains for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "Public can read tenant info" on tenants for select using (true);
create policy "Platform admins manage tenants" on tenants for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());


-- ── Grants ──────────────────────────────────────────────────────────────────
-- From the survey's Part 6. These are a SECOND gate in front of RLS: a role
-- with no grant cannot reach a table at all, whatever the policies say.
--
-- Production grants nearly everything to all three roles and relies on RLS for
-- row-level enforcement. The exceptions are the point: five editor-only tables
-- that `anon` cannot touch, and tenant_domains, which anon may only read.
--
-- Getting this wrong is not cosmetic. Omitting it entirely is what made
-- db/verify-tenant-isolation.sql fail locally with "permission denied for
-- table site_settings" — a failure that looks like a policy bug and is not.

grant delete, insert, references, select, trigger, truncate, update
  on album_clients, albums, blog_posts, catalog_items, clients, contact_messages,
     downloads, favorites, instagram_media, newsletter_signups, order_items, orders,
     page_sections, photo_shop_categories, photos, print_options,
     products, profiles, room_scenes, shop_categories, site_draft, site_settings,
     site_template, site_template_history, template_versions, templates, tenants
  to anon, authenticated, service_role;

-- ANALYTICS IS THE SECOND TABLE NOBODY MAY WRITE TO DIRECTLY. `page_views` left
-- the list above when S4 deployed, and these are the grants production carries,
-- verified by name after deployment:
--
--   anon           NOTHING. A visitor causes a view to be recorded; they do not
--                  get to write one.
--   authenticated  SELECT, which RLS narrows to their own site — that is what
--                  lib/admin/overview.ts and the album stats screen read.
--   service_role   SELECT and DELETE. DELETE because `deleteSite()` removes a
--                  site's rows; SELECT because **a filtered DELETE reads the
--                  column it filters on**, so DELETE alone fails with
--                  "permission denied for table page_views". That was a real
--                  bug in S4's first draft, found by running the verification
--                  as the real role rather than as the owner.
--
-- NO INSERT for anybody, service_role included: `record_page_view` is SECURITY
-- DEFINER, so the row is written with the owner's rights, and the absence of the
-- grant is what stops the admin client going round the validation.
revoke all on table page_views from public;
revoke all on table page_views from anon;
revoke all on table page_views from authenticated;
revoke all on table page_views from service_role;
grant select on table page_views to authenticated;
grant select, delete on table page_views to service_role;

-- Editor-only: anon gets nothing.
grant delete, insert, references, select, trigger, truncate, update
  on draft_shares, site_draft_steps, site_images, site_secrets, site_versions
  to authenticated, service_role;

-- THE QUEUE IS THE ONE TABLE NOBODY MAY WRITE TO DIRECTLY, and its grants are
-- the mechanism. A photographer may read their own queue and nothing more;
-- `anon` and `service_role` hold NOTHING on the table at all, by design rather
-- than by omission — the worker reaches it only through claim_jobs/finish_job
-- and a photographer only through enqueue_jobs, all three SECURITY DEFINER.
-- Verified against production 2026-09-29.
grant select on jobs to authenticated;

-- P1: the photo tables. authenticated may READ (narrowed by the tenant policy to
-- its own site); anon, service_role and PUBLIC hold NOTHING, and nobody may
-- write — P2 and P3 each add their own narrow writer, deliberately. Revoked
-- first because a grant is additive. Verified against production 2026-09-30.
revoke all on table photo_assets from public, anon, authenticated, service_role;
revoke all on table photo_usages from public, anon, authenticated, service_role;
grant select on table photo_assets to authenticated;
grant select on table photo_usages to authenticated;

-- A visitor resolves a site by its address and may do nothing else here.
grant select on tenant_domains to anon;
grant delete, insert, references, select, trigger, truncate, update
  on tenant_domains to authenticated, service_role;

-- NOT SURVEYED: sequence grants were not part of db/survey.sql. This is
-- Supabase's default and is required for an `authenticated` insert into
-- site_settings (whose id defaults to nextval). Flagged in db/schema-verified.md
-- as inferred rather than verified.
grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

-- ── Function-level grants ───────────────────────────────────────────────────
-- From db/migrations/2026-09-22_draft_steps.sql. Undo history is an editor's
-- tool; anon has no business calling it.
revoke all on function public.push_draft_step(uuid, jsonb, text, interval, int)
  from public, anon;
grant execute on function public.push_draft_step(uuid, jsonb, text, interval, int)
  to authenticated;

-- The queue's three, from db/migrations/2026-09-29_jobs.sql. Verified against
-- production 2026-09-29: enqueue_jobs is the photographer's only door, and the
-- worker's two are the whole of what service_role can do.
revoke all on function public.enqueue_jobs(uuid, text, jsonb)       from public, anon, authenticated, service_role;
revoke all on function public.claim_jobs(text, int, interval, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finish_job(uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_jobs(uuid, text, jsonb)       to authenticated;
grant execute on function public.claim_jobs(text, int, interval, uuid) to service_role;
grant execute on function public.finish_job(uuid, text, text, boolean) to service_role;

-- Analytics' one, from db/migrations/2026-09-29_analytics.sql. Verified against
-- production 2026-09-29: `service_role` is the only application role that may
-- call it, so a browser has no database path to analytics at all — stricter
-- than the queue, where a photographer holds EXECUTE on enqueue_jobs.
revoke all on function public.record_page_view(uuid, text, text, text, text, text, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_page_view(uuid, text, text, text, text, text, uuid, uuid, text)
  to service_role;

-- ── The only trigger in the public schema ───────────────────────────────────
-- Verified 2026-09-29: this is the ONLY non-internal trigger production has.
-- In particular there are none on `albums` or `photos`, so the cascade in
-- photos_album_id_fkey is the whole of what happens when an album is deleted.
create or replace function public.touch_site_draft() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger site_draft_touch
  before update on public.site_draft
  for each row execute function public.touch_site_draft();
