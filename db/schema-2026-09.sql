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

create table page_views (
  id            uuid not null default gen_random_uuid(),
  album_id      uuid,
  post_id       uuid,
  visitor_hash  text not null,
  viewed_at     timestamptz not null default now()
);

create table photo_shop_categories (
  photo_id     uuid not null,
  category_id  uuid not null
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
  original_bytes     bigint
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
  created_at     timestamptz not null default now()
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
alter table newsletter_signups     add constraint newsletter_signups_pkey primary key (id);
alter table order_items            add constraint order_items_pkey primary key (id);
alter table orders                 add constraint orders_pkey primary key (id);
alter table page_sections          add constraint page_sections_pkey primary key (id);
alter table page_views             add constraint page_views_pkey primary key (id);
alter table photo_shop_categories  add constraint photo_shop_categories_pkey primary key (photo_id, category_id);
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
alter table newsletter_signups add constraint newsletter_signups_email_key unique (email);
alter table template_versions  add constraint template_versions_template_id_version_key unique (template_id, version);
alter table templates          add constraint templates_slug_key unique (slug);
alter table tenants            add constraint tenants_domain_key unique (domain);

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
alter table orders add constraint orders_status_check              check (status in ('pending','paid','fulfilled','cancelled'));

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

-- Row level security, exactly as production has it. The distinctions below are
-- deliberate and must not be homogenised:
--   · direct tenant_id scoping          ("Tenant members manage" on most tables)
--   · scoping through a parent          (tenant_of(...) — album_clients, downloads,
--                                        favorites, photo_shop_categories, page_views)
--   · intentionally public SELECT       (albums, blog_posts, page_sections, site_settings, …)
--   · intentionally public INSERT-only  (contact_messages, newsletter_signups, page_views)

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
alter table photo_shop_categories  enable row level security;
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

-- page_views hangs off EITHER an album or a story, so the generic helper cannot
-- express it. Hand-written, exactly as production has it.
create policy "Tenant members manage" on page_views for all
  using (
    public.tenant_of('albums'::regclass, album_id) = public.current_tenant_id()
    or public.tenant_of('blog_posts'::regclass, post_id) = public.current_tenant_id()
    or public.is_platform_admin()
  )
  with check (
    public.tenant_of('albums'::regclass, album_id) = public.current_tenant_id()
    or public.tenant_of('blog_posts'::regclass, post_id) = public.current_tenant_id()
    or public.is_platform_admin()
  );

-- ── Direct tenant_id scoping ────────────────────────────────────────────────
select public.apply_tenant_policy('albums');
select public.apply_tenant_policy('blog_posts');
select public.apply_tenant_policy('catalog_items');
select public.apply_tenant_policy('clients');
select public.apply_tenant_policy('contact_messages');
select public.apply_tenant_policy('draft_shares');
select public.apply_tenant_policy('instagram_media');
select public.apply_tenant_policy('newsletter_signups');
select public.apply_tenant_policy('order_items');
select public.apply_tenant_policy('orders');
select public.apply_tenant_policy('page_sections');
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
create policy "Anyone can record a view"   on page_views         for insert with check (true);

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
     page_sections, page_views, photo_shop_categories, photos, print_options,
     products, profiles, room_scenes, shop_categories, site_draft, site_settings,
     site_template, site_template_history, template_versions, templates, tenants
  to anon, authenticated, service_role;

-- Editor-only: anon gets nothing.
grant delete, insert, references, select, trigger, truncate, update
  on draft_shares, site_draft_steps, site_images, site_secrets, site_versions
  to authenticated, service_role;

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
