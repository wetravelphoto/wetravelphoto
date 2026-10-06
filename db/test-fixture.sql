-- ════════════════════════════════════════════════════════════════════════════
-- THE REHEARSAL ROOM
-- ════════════════════════════════════════════════════════════════════════════
--
-- A local stand-in for the live database, so a migration can be run for real
-- before it is run for real:
--
--   createdb wtp
--   psql -d wtp -f db/test-fixture.sql
--   psql -d wtp -v ON_ERROR_STOP=1 -f db/migrations/<the new one>.sql
--   psql -d wtp -f db/verify-tenant-isolation.sql
--
-- ── Regenerated 2026-09-29 from the real schema ─────────────────────────────
--
-- Every table, column, default, constraint, index and policy below is taken
-- from db/schema-2026-09.sql, which is the output of db/survey.sql run against
-- production. The two files are meant to agree; if you change one, change both,
-- and re-run the S1 checks in claude/photo-migration-plan.md.
--
-- The previous version of this file was hand-written and had drifted badly:
-- it declared 6 columns on `photos` where production has 19, knew nothing of
-- page_views.visitor_hash, and had NO ACTION on nine foreign keys that
-- production cascades. A rehearsal against it proved the opposite of the truth
-- — deleting an album FAILED locally and succeeds in production.
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
-- ── UPDATED 2026-09-30 (later): the S3 tenant-guard hotfix, and P2 ───────────
--
-- Two further migrations, deployed and verified against the live database the
-- same day (db/schema-verified.md):
--
--   · db/migrations/2026-09-30_enqueue_jobs_tenant_guard.sql — Supabase
--     **20260930184309** (`enqueue_jobs_tenant_guard_2026_09_30`), sha256
--     **fb5e1689de95048f39c76f19a42ca2a7d18e2eecb3c0b8e69d0cbf8c7c4b1bc3**.
--     enqueue_jobs' tenant guard is now NULL-safe (`(…) is not true`); nothing
--     else about the function changed.
--   · db/migrations/2026-09-30_photo_ingest.sql — Supabase **20260930191116**
--     (`photo_ingest_2026_09_30`), sha256
--     **6b83b8176f2f669e61e828eea59f84244d3954c47e123b48965031b7af880b9d**.
--     Five functions — upsert_photo_asset (internal, INVOKER, callable by no
--     application role) and the four register_* wrappers (DEFINER, EXECUTE to
--     authenticated only). P2 changed FUNCTIONS only: no table, column, index,
--     policy or table grant.
--
-- Production is therefore now **37 tables, 549 columns, 18 functions**, RLS on
-- all 37, and **56 policies**. The hardened guard and all five functions below
-- are copied from those migration files, and the drift guard rebuilds them
-- from the files to prove it.
--
-- ── UPDATED 2026-10-01: P3 — the photo-usage projection ──────────────────────
--
-- Two migrations, deployed and verified against the live database
-- (db/schema-verified.md):
--
--   · db/migrations/2026-09-30_album_cover_tenant_fk.sql — Supabase
--     **20261001005946** (`album_cover_tenant_fk_2026_09_30`), sha256
--     **fad895dc3b16c4ac2bf5859a77bfb6b8d361be2a240351402ff1aad5a93f93ed**.
--     albums_cover_photo_fk is tenant-aware: (cover_photo_id, tenant_id) →
--     photos (id, tenant_id), ON DELETE SET NULL (cover_photo_id).
--   · db/migrations/2026-09-30_photo_usages_sync.sql — Supabase
--     **20261001010021** (`photo_usages_sync_2026_09_30`), sha256
--     **cad8cabf96345c288964f81fcebab953e1947a744e5aff4b7806b76dd82e642d**.
--     The eighth usage kind, page_share (three CHECKs restated, one added,
--     one slot index); seven functions — four internal helpers callable by no
--     application role, and sync_photo_usages / read_photo_usage_source /
--     list_photo_usage_parents, DEFINER, EXECUTE to service_role only; and
--     register_gallery_photo / register_album_cover re-created ONLY to take
--     the album's projection lock.
--
-- Production is therefore now **37 tables, 549 columns, 25 functions**, RLS on
-- all 37, and **56 policies**. Every P3 statement below is copied from those
-- two files, and the drift guard rebuilds them from the files to prove it.
--
-- ── UPDATED 2026-10-06: P4 — the legacy backfill and the asset keys ─────────
--
-- Two migrations, deployed and verified against the live database
-- (db/schema-verified.md, "P4"):
--
--   · db/migrations/2026-10-05_photo_backfill.sql (unit 1) — Supabase
--     **20261005192303** (`photo_backfill_p4_unit1_2026_10_05`), sha256
--     **aa46c4789f85f1280a17ab01af400d9fff5459792d334a44acfe7b351e4f3eb8**.
--     Five functions: photo_backfill_key_base and photo_backfill_foreign_claim
--     (internal, INVOKER, callable by no application role),
--     read_photo_backfill_inventory, read_photo_backfill_claims and
--     register_legacy_photo_asset (DEFINER, EXECUTE to service_role only, plus
--     a run-time role check); and photo_usage_resolve_path REPLACED (the flat
--     `<base>.jpg` rule; two candidates resolve to nothing).
--   · db/migrations/2026-10-05_photo_assets_fk.sql (unit 2) — Supabase
--     **20261006012958** (`photo_assets_fk_p4_unit2_2026_10_05`), sha256
--     **1bc2276e2ba325255be44509f203cc1695f8fafa276678b5f6b315a77c1d46d5**.
--     photos_asset_fk and site_images_asset_fk — (asset_id, tenant_id) →
--     photo_assets (id, tenant_id), NO ACTION, MATCH SIMPLE — and one partial
--     supporting index each.
--
-- Production is therefore now **37 tables, 549 columns, 30 functions**, RLS on
-- all 37, **56 policies**, 157 constraints and 101 indexes. Every P4 statement
-- below is copied from those two files, and the drift guard rebuilds them from
-- the files to prove it. The keys are created AFTER P1's and P3's keys, as
-- production created them (trigger order is creation order — see the cover-key
-- note further down).
--
-- The seeded rows are NOT production's data. In particular the three seeded
-- gallery photographs still have a NULL asset_id: MATCH SIMPLE lets a NULL pass
-- the keys, which is exactly why unit 2 carries its own completeness preflight
-- (and why that preflight would refuse THIS file's seeds — the P4 harnesses
-- link them first, in their own scratch databases, when they rebuild unit 2).
--
-- ── What is stubbed, and what that costs ────────────────────────────────────
--
-- Bare PostgreSQL has no Supabase. These stand-ins exist only here:
--
--   · the roles anon, authenticated, service_role;
--   · the `auth` schema, an `auth.users` table, and `auth.uid()` reading the
--     same request settings Supabase's does.
--
-- They are SHAPED like Supabase's, not equivalent to it. A test that passes
-- here proves the SQL is correct and the policy logic holds against a fake
-- session; it does not prove anything about real Supabase auth, JWT handling,
-- or PostgREST. Treat a local pass as necessary, never sufficient.
--
-- Production is PostgreSQL 17.6. This fixture is normally rehearsed on
-- whatever the local machine has; say which when reporting a result.
--
-- ════════════════════════════════════════════════════════════════════════════

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;

-- NOT installing pgcrypto. Supabase has it in the `extensions` schema, not in
-- `public`; installing it here put 38 of its functions into public and made the
-- local function inventory disagree with production's for no reason.
-- `gen_random_uuid()` has been core since PostgreSQL 13, which is all this
-- fixture ever used it for.
create schema if not exists auth;

-- Supabase owns this table. Only the column profiles.id references is needed.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);

-- Same shape as Supabase's.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

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
  -- P1, nullable. Tenant-aware key since P4 unit 2 (photos_asset_fk /
  -- site_images_asset_fk, below); NULL passes it (MATCH SIMPLE).
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
  -- P1, nullable. Tenant-aware key since P4 unit 2 (photos_asset_fk /
  -- site_images_asset_fk, below); NULL passes it (MATCH SIMPLE).
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
  --
  -- 2026-09-30 HOTFIX: `(…) is not true`, not `not (…)`. For a signed-in
  -- caller with NO profiles row, current_tenant_id() is NULL, so the
  -- comparison is NULL, `NULL or false` is NULL, and `if not (NULL)` did
  -- not raise — the gate silently let them through. `is not true` refuses
  -- NULL as well as false. This line is the whole of the hotfix.
  if (p_tenant = public.current_tenant_id() or public.is_platform_admin()) is not true then
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


-- ── P2's five ingestion functions ───────────────────────────────────────────
-- Copied verbatim from db/migrations/2026-09-30_photo_ingest.sql (Supabase
-- 20260930191116). The four register_* wrappers are the ONE way a photograph
-- enters photo_assets; see that migration's header and claude/photo-assets-
-- design.md §9. Their grants are with the other function-level grants below.

-- ── The internal helper ─────────────────────────────────────────────────────
--
-- Validates everything that does not depend on which route is asking, then
-- creates or reuses the asset and returns its id. INVOKER: inside a wrapper it
-- runs as the owner; anybody else would have neither EXECUTE on it nor any
-- write privilege on photo_assets.

create or replace function public.upsert_photo_asset(
  p_tenant          uuid,
  p_key_base        text,
  p_original_path   text,
  p_display_path    text,
  p_derivatives     jsonb,
  p_width           integer,
  p_height          integer,
  p_original_bytes  bigint,
  p_content_sha256  text,
  p_content_type    text,
  p_filename        text,
  p_taken_at        timestamptz,
  p_camera_make     text,
  p_camera_model    text,
  p_lens            text,
  p_iso             integer,
  p_aperture        numeric,
  p_shutter         text,
  p_focal_length    numeric,
  p_keywords        text[],
  p_exif            jsonb,
  p_latitude        double precision,
  p_longitude       double precision,
  p_created_by      uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_sizes   constant text[] := array['400', '800', '1600', '2400'];
  v_exif    jsonb := coalesce(p_exif, '{}'::jsonb);
  v_key     text;
  v_value   jsonb;
  v_largest text;
  v_kw      text;
  v_id      uuid;
  v_sha     text;
  v_archived timestamptz;
  v_deleted  timestamptz;
begin
  -- ── Paths: all inside the key ─────────────────────────────────────────────
  if p_key_base is null or p_display_path is null or p_derivatives is null then
    raise exception 'A photograph needs its key, its display path and its sizes.'
      using errcode = '23502';
  end if;

  -- The original, when the route keeps one, is `<key>/original.<ext>` and
  -- nothing else. Compared as strings, not as a pattern, so nothing in the key
  -- can act as a wildcard.
  if p_original_path is not null and not (
       left(p_original_path, length(p_key_base) + 10) = p_key_base || '/original.'
       and substr(p_original_path, length(p_key_base) + 11) in ('jpg', 'png', 'webp', 'tif', 'avif')
     ) then
    raise exception 'The original is not where this upload''s key says it is.'
      using errcode = '22023';
  end if;

  -- The sizes: an object of "<size>": "<key>/<size>.webp", sizes from the
  -- ladder only, 400 always — exactly what lib/derivatives.ts produces.
  if jsonb_typeof(p_derivatives) <> 'object' then
    raise exception 'The sizes must be an object.' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(p_derivatives) loop
    if not (v_key = any (c_sizes)) then
      raise exception 'There is no display size called "%".', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(v_value) <> 'string'
       or (v_value #>> '{}') <> p_key_base || '/' || v_key || '.webp' then
      raise exception 'Size % is not where this upload''s key says it is.', v_key
        using errcode = '22023';
    end if;
  end loop;
  if not (p_derivatives ? '400') then
    raise exception 'Every photograph has a 400 size.' using errcode = '22023';
  end if;
  select s into v_largest
    from unnest(c_sizes) with ordinality as z(s, n)
   where p_derivatives ? s
   order by n desc
   limit 1;
  if p_display_path <> p_derivatives ->> v_largest then
    raise exception 'The display path must be the largest size, %.', v_largest
      using errcode = '22023';
  end if;

  -- ── Facts the server measured ─────────────────────────────────────────────
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'The content hash must be 64 lower-case hex characters.' using errcode = '22023';
  end if;
  if p_original_bytes is null or p_original_bytes <= 0 then
    raise exception 'A photograph has more than zero bytes.' using errcode = '22023';
  end if;
  -- A photograph that was really processed has real dimensions, and the
  -- asset and its row must agree on them — so a zero is a failure, not a NULL.
  if p_width is null or p_height is null or p_width <= 0 or p_height <= 0 then
    raise exception 'A processed photograph has a width and a height.' using errcode = '22023';
  end if;
  -- NULL when the processor decoded the pixels but not as one of these. The
  -- helper allows it; the wrappers decide per route: the three signed-upload
  -- routes (gallery, site, journal) refuse a NULL, and only a custom cover —
  -- which arrives in the form and may be any format sharp reads — may keep
  -- one. Never used to authorise anything.
  if p_content_type is not null and p_content_type not in
       ('image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif', 'image/heif') then
    raise exception 'Unknown content type "%".', p_content_type using errcode = '22023';
  end if;
  if p_filename is not null and (length(p_filename) > 120 or p_filename ~ '[[:cntrl:]]') then
    raise exception 'A file name is at most 120 characters, with no control characters.'
      using errcode = '22023';
  end if;

  -- ── Capture metadata: the normalised shape, bounded ──────────────────────
  if length(p_camera_make)  > 64 or p_camera_make  ~ '[[:cntrl:]]'
  or length(p_camera_model) > 64 or p_camera_model ~ '[[:cntrl:]]'
  or length(p_lens)         > 96 or p_lens         ~ '[[:cntrl:]]' then
    raise exception 'Camera and lens names are at most 64 / 64 / 96 plain characters.'
      using errcode = '22023';
  end if;
  if p_iso is not null and (p_iso < 1 or p_iso > 1000000) then
    raise exception 'ISO % is out of range.', p_iso using errcode = '22023';
  end if;
  if p_aperture is not null and (p_aperture < 0.5 or p_aperture > 99.9 or p_aperture <> round(p_aperture, 1)) then
    raise exception 'Aperture % is out of range.', p_aperture using errcode = '22023';
  end if;
  if p_shutter is not null and p_shutter !~ '^(1/[1-9][0-9]{0,5}|[0-9]{1,4}(\.[0-9])?s)$' then
    raise exception 'Shutter "%" is not in the normalised form.', p_shutter using errcode = '22023';
  end if;
  if p_focal_length is not null and (p_focal_length < 0.1 or p_focal_length > 9999.9
                                     or p_focal_length <> round(p_focal_length, 1)) then
    raise exception 'Focal length % is out of range.', p_focal_length using errcode = '22023';
  end if;
  if p_keywords is not null then
    if coalesce(array_length(p_keywords, 1), 0) > 25 then
      raise exception 'At most 25 keywords.' using errcode = '22023';
    end if;
    foreach v_kw in array p_keywords loop
      if v_kw is null or v_kw = '' or length(v_kw) > 200 or v_kw ~ '[[:cntrl:]]' then
        raise exception 'A keyword is 1 to 200 plain characters.' using errcode = '22023';
      end if;
    end loop;
  end if;
  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90)
  or p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    raise exception 'That is not a place on Earth.' using errcode = '22023';
  end if;
  -- Both or neither: half a coordinate is not a place. The application's
  -- normaliser already guarantees it; this makes it true of every writer.
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'A place needs both a latitude and a longitude.' using errcode = '22023';
  end if;

  -- The `exif` subset: an object, version 1, allowlisted keys of allowlisted
  -- types and ranges, at most 1024 bytes. '{}' means nothing was worth keeping.
  if jsonb_typeof(v_exif) <> 'object' then
    raise exception 'exif must be an object.' using errcode = '22023';
  end if;
  if octet_length(v_exif::text) > 1024 then
    raise exception 'exif is over 1024 bytes.' using errcode = '22023';
  end if;
  if v_exif <> '{}'::jsonb and (v_exif -> 'v') is distinct from '1'::jsonb then
    raise exception 'exif must say it is version 1.' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(v_exif) loop
    if not (case v_key
      when 'v'                 then v_value = '1'::jsonb
      when 'orientation'       then jsonb_typeof(v_value) = 'number'
                                    and (v_value #>> '{}')::numeric in (1, 2, 3, 4, 5, 6, 7, 8)
      when 'offset_time'       then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') ~ '^[+-][0-9]{2}:[0-9]{2}$'
      when 'exposure_program'  then jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') in
                                    ('manual', 'program', 'aperture_priority', 'shutter_priority',
                                     'creative', 'action', 'portrait', 'landscape', 'other')
      when 'exposure_mode'     then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') in ('auto', 'manual', 'bracket')
      when 'exposure_bias_ev'  then jsonb_typeof(v_value) = 'number'
                                    and (v_value #>> '{}')::numeric between -20 and 20
      when 'metering_mode'     then jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') in
                                    ('average', 'center_weighted', 'spot', 'multi_spot',
                                     'pattern', 'partial', 'other')
      when 'flash_fired'       then jsonb_typeof(v_value) = 'boolean'
      when 'white_balance'     then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') in ('auto', 'manual')
      when 'focal_length_35mm' then jsonb_typeof(v_value) = 'number'
                                    and (v_value #>> '{}')::numeric between 1 and 5000
                                    and (v_value #>> '{}')::numeric = trunc((v_value #>> '{}')::numeric)
      when 'lens_make'         then jsonb_typeof(v_value) = 'string'
                                    and length(v_value #>> '{}') between 1 and 64
                                    and (v_value #>> '{}') !~ '[[:cntrl:]]'
      when 'color_space'       then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') in ('srgb', 'adobe_rgb', 'uncalibrated')
      when 'software'          then jsonb_typeof(v_value) = 'string'
                                    and length(v_value #>> '{}') between 1 and 64
                                    and (v_value #>> '{}') !~ '[[:cntrl:]]'
      else false
    end) then
      raise exception 'exif "%" is not an allowed key, or not an allowed value for it.', v_key
        using errcode = '22023';
    end if;
  end loop;

  -- ── Create, or find and LOCK ──────────────────────────────────────────────
  --
  -- State and derived_at are the database's to set: P2 ingestion is
  -- synchronous, so the sizes exist before this is called. created_by is the
  -- caller's identity, set once and never rewritten by a retry.
  insert into public.photo_assets (
    tenant_id, key_base, original_path, display_path, derivatives,
    original_bytes, content_type, filename, content_sha256, width, height,
    taken_at, latitude, longitude, camera_make, camera_model, lens, iso,
    aperture, shutter, focal_length, keywords, exif,
    state, derived_at, created_by
  ) values (
    p_tenant, p_key_base, p_original_path, p_display_path, p_derivatives,
    p_original_bytes, p_content_type, p_filename, p_content_sha256, p_width, p_height,
    p_taken_at, p_latitude, p_longitude, p_camera_make, p_camera_model, p_lens, p_iso,
    p_aperture, p_shutter, p_focal_length, coalesce(p_keywords, '{}'::text[]), v_exif,
    'derived', now(), p_created_by
  )
  on conflict (tenant_id, key_base) do nothing;

  select a.id, a.content_sha256, a.archived_at, a.deleted_at
    into v_id, v_sha, v_archived, v_deleted
    from public.photo_assets a
   where a.tenant_id = p_tenant and a.key_base = p_key_base
     for update;

  if v_sha is distinct from p_content_sha256 then
    raise exception 'That upload key already holds a different file.' using errcode = '22023';
  end if;
  if v_archived is not null or v_deleted is not null then
    raise exception 'That photograph has been archived or deleted.' using errcode = '55000';
  end if;

  return v_id;
end $$;


-- ── The tenant rule, restated in every wrapper ──────────────────────────────
--
-- A definer function is not subject to row-level security, so each wrapper
-- says the policy's rule itself. `current_tenant_id()` is the caller's OWN
-- site; a platform admin working on another site's address passes through
-- `is_platform_admin()`, exactly as the table policies let them.
--
-- WRITTEN `(…) IS NOT TRUE`, NOT `NOT (…)`. For a caller with no profile — a
-- signed-in account not attached to any site, or no identity at all —
-- `current_tenant_id()` is NULL, so `p_tenant = current_tenant_id()` is NULL,
-- `NULL or false` is NULL, and `if not (NULL)` does NOT raise: the check
-- silently passes. db/verify-photo-ingest.sql caught exactly that in the first
-- draft of this file. `is not true` refuses NULL as well as false.

-- ── A. A gallery photograph ─────────────────────────────────────────────────

create or replace function public.register_gallery_photo(
  p_tenant          uuid,
  p_album           uuid,
  p_key_base        text,
  p_original_path   text,
  p_display_path    text,
  p_derivatives     jsonb,
  p_width           integer,
  p_height          integer,
  p_original_bytes  bigint,
  p_content_sha256  text,
  p_content_type    text,
  p_taken_at        timestamptz,
  p_camera_make     text,
  p_camera_model    text,
  p_lens            text,
  p_iso             integer,
  p_aperture        numeric,
  p_shutter         text,
  p_focal_length    numeric,
  p_keywords        text[],
  p_exif            jsonb,
  p_latitude        double precision,
  p_longitude       double precision
)
returns table (photo_id uuid, asset_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_prefix text;
  v_asset  uuid;
  v_photo  uuid;
  v_sort   integer;
begin
  if p_tenant is null or p_album is null then
    raise exception 'A gallery photograph needs its site and its gallery.' using errcode = '23502';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant)
     or (p_tenant = public.current_tenant_id() or public.is_platform_admin()) is not true then
    raise exception 'That is not your site.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.albums al where al.id = p_album and al.tenant_id = p_tenant) then
    raise exception 'There is no such gallery on this site.' using errcode = '42501';
  end if;
  -- P3: the album's projection lock, shared with sync_photo_usages, so an
  -- album projection and this registration never interleave.
  perform public.photo_usage_lock(p_tenant, 'album', p_album::text);

  v_prefix := 't/' || p_tenant::text || '/photos/' || p_album::text || '/';
  if left(p_key_base, length(v_prefix)) is distinct from v_prefix
     or substr(p_key_base, length(v_prefix) + 1)
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'That upload does not belong to this gallery.' using errcode = '42501';
  end if;
  if p_original_path is null then
    raise exception 'A gallery photograph keeps its original.' using errcode = '23502';
  end if;
  -- A signed upload came through /api/upload-url, which accepts exactly five
  -- image types; the server identified the bytes. Anything else — NULL (not
  -- recognised) or HEIF (recognised, but not an upload type) — fails here.
  -- Only a custom cover may be HEIF or unrecognised. Never used to authorise
  -- anything.
  if p_content_type is null or p_content_type not in
       ('image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif') then
    raise exception 'A gallery photograph must be one of the five upload image types.' using errcode = '22023';
  end if;

  v_asset := public.upsert_photo_asset(
    p_tenant, p_key_base, p_original_path, p_display_path, p_derivatives,
    p_width, p_height, p_original_bytes, p_content_sha256, p_content_type, null,
    p_taken_at, p_camera_make, p_camera_model, p_lens, p_iso, p_aperture,
    p_shutter, p_focal_length, p_keywords, p_exif, p_latitude, p_longitude,
    auth.uid());

  -- The membership: reused if this upload is already in this gallery (a
  -- retry), otherwise written with exactly the columns registerPhoto wrote
  -- before P2, plus asset_id. sort_order is "after the last", as it was.
  select ph.id into v_photo
    from public.photos ph
   where ph.tenant_id = p_tenant and ph.album_id = p_album and ph.asset_id = v_asset
   order by ph.created_at, ph.id
   limit 1;

  if v_photo is null then
    select coalesce(max(ph.sort_order), -1) + 1 into v_sort
      from public.photos ph
     where ph.tenant_id = p_tenant and ph.album_id = p_album;

    -- Every file fact comes from the CANONICAL ASSET, not from this call's
    -- arguments. On a first registration they are the same values. On a
    -- retry against an asset that already exists (its membership deleted
    -- meanwhile) the helper did not rewrite the asset — and the recreated row
    -- must agree with the asset, not with whatever the retry sent.
    insert into public.photos (
      tenant_id, album_id, storage_path, original_path, original_bytes,
      derivatives, width, height, sort_order, tags, taken_at, latitude, longitude,
      asset_id
    )
    select p_tenant, p_album, pa.display_path, pa.original_path, pa.original_bytes,
           pa.derivatives, pa.width, pa.height, v_sort, pa.keywords,
           pa.taken_at, pa.latitude, pa.longitude,
           pa.id
      from public.photo_assets pa
     where pa.id = v_asset and pa.tenant_id = p_tenant
    returning id into v_photo;
  end if;

  -- The one usage P2 writes: the gallery membership's, beside its row, and
  -- removed with it by cascade.
  insert into public.photo_usages (tenant_id, asset_id, kind, photo_id, field)
  values (p_tenant, v_asset, 'gallery', v_photo, 'photo')
  on conflict (photo_id) where kind = 'gallery' do nothing;

  return query select v_photo, v_asset;
end $$;


-- ── B. A photograph uploaded from the editor's picker ───────────────────────

create or replace function public.register_site_image(
  p_tenant          uuid,
  p_key_base        text,
  p_original_path   text,
  p_display_path    text,
  p_derivatives     jsonb,
  p_width           integer,
  p_height          integer,
  p_original_bytes  bigint,
  p_content_sha256  text,
  p_content_type    text,
  p_filename        text,
  p_taken_at        timestamptz,
  p_camera_make     text,
  p_camera_model    text,
  p_lens            text,
  p_iso             integer,
  p_aperture        numeric,
  p_shutter         text,
  p_focal_length    numeric,
  p_keywords        text[],
  p_exif            jsonb
)
returns table (site_image_id uuid, asset_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_prefix text;
  v_asset  uuid;
  v_image  uuid;
begin
  if p_tenant is null then
    raise exception 'A photograph needs its site.' using errcode = '23502';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant)
     or (p_tenant = public.current_tenant_id() or public.is_platform_admin()) is not true then
    raise exception 'That is not your site.' using errcode = '42501';
  end if;

  v_prefix := 't/' || p_tenant::text || '/site-images/';
  if left(p_key_base, length(v_prefix)) is distinct from v_prefix
     or substr(p_key_base, length(v_prefix) + 1)
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'That upload does not belong to this site''s uploads.' using errcode = '42501';
  end if;
  if p_original_path is null then
    raise exception 'An uploaded photograph keeps its original.' using errcode = '23502';
  end if;
  -- A signed upload came through /api/upload-url, which accepts exactly five
  -- image types; the server identified the bytes. Anything else — NULL (not
  -- recognised) or HEIF (recognised, but not an upload type) — fails here.
  -- Only a custom cover may be HEIF or unrecognised. Never used to authorise
  -- anything.
  if p_content_type is null or p_content_type not in
       ('image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif') then
    raise exception 'An uploaded photograph must be one of the five upload image types.' using errcode = '22023';
  end if;

  -- No latitude or longitude: this route never stored them.
  v_asset := public.upsert_photo_asset(
    p_tenant, p_key_base, p_original_path, p_display_path, p_derivatives,
    p_width, p_height, p_original_bytes, p_content_sha256, p_content_type, p_filename,
    p_taken_at, p_camera_make, p_camera_model, p_lens, p_iso, p_aperture,
    p_shutter, p_focal_length, p_keywords, p_exif, null, null,
    auth.uid());

  select si.id into v_image
    from public.site_images si
   where si.tenant_id = p_tenant and si.asset_id = v_asset
   order by si.created_at, si.id
   limit 1;

  if v_image is null then
    -- The columns registerSiteImage wrote before P2, plus asset_id — each
    -- taken from the CANONICAL ASSET, never from a retry's arguments (see the
    -- note in register_gallery_photo).
    insert into public.site_images (
      tenant_id, storage_path, original_path, derivatives, width, height,
      bytes, filename, asset_id
    )
    select p_tenant, pa.display_path, pa.original_path, pa.derivatives, pa.width, pa.height,
           pa.original_bytes, pa.filename, pa.id
      from public.photo_assets pa
     where pa.id = v_asset and pa.tenant_id = p_tenant
    returning id into v_image;
  end if;

  return query select v_image, v_asset;
end $$;


-- ── C. A journal / story photograph ─────────────────────────────────────────
--
-- The asset only. The post the photograph goes into owns its placement; P3
-- projects it from there.

create or replace function public.register_journal_image(
  p_tenant          uuid,
  p_key_base        text,
  p_original_path   text,
  p_display_path    text,
  p_derivatives     jsonb,
  p_width           integer,
  p_height          integer,
  p_original_bytes  bigint,
  p_content_sha256  text,
  p_content_type    text,
  p_taken_at        timestamptz,
  p_camera_make     text,
  p_camera_model    text,
  p_lens            text,
  p_iso             integer,
  p_aperture        numeric,
  p_shutter         text,
  p_focal_length    numeric,
  p_keywords        text[],
  p_exif            jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
begin
  if p_tenant is null then
    raise exception 'A photograph needs its site.' using errcode = '23502';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant)
     or (p_tenant = public.current_tenant_id() or public.is_platform_admin()) is not true then
    raise exception 'That is not your site.' using errcode = '42501';
  end if;

  v_prefix := 't/' || p_tenant::text || '/journal/';
  if left(p_key_base, length(v_prefix)) is distinct from v_prefix
     or substr(p_key_base, length(v_prefix) + 1)
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'That upload does not belong to this site''s journal.' using errcode = '42501';
  end if;
  if p_original_path is null then
    raise exception 'A journal photograph keeps its original.' using errcode = '23502';
  end if;
  -- A signed upload came through /api/upload-url, which accepts exactly five
  -- image types; the server identified the bytes. Anything else — NULL (not
  -- recognised) or HEIF (recognised, but not an upload type) — fails here.
  -- Only a custom cover may be HEIF or unrecognised. Never used to authorise
  -- anything.
  if p_content_type is null or p_content_type not in
       ('image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif') then
    raise exception 'A journal photograph must be one of the five upload image types.' using errcode = '22023';
  end if;

  return public.upsert_photo_asset(
    p_tenant, p_key_base, p_original_path, p_display_path, p_derivatives,
    p_width, p_height, p_original_bytes, p_content_sha256, p_content_type, null,
    p_taken_at, p_camera_make, p_camera_model, p_lens, p_iso, p_aperture,
    p_shutter, p_focal_length, p_keywords, p_exif, null, null,
    auth.uid());
end $$;


-- ── D. A custom gallery cover ───────────────────────────────────────────────
--
-- No original path: uploadCustomCover has never kept an original, only the
-- sizes, and P2 does not start. The album's cover changes in the same
-- transaction, exactly as uploadCustomCover changed it before. The
-- gallery_cover usage is P3's to project.

create or replace function public.register_album_cover(
  p_tenant          uuid,
  p_album           uuid,
  p_key_base        text,
  p_display_path    text,
  p_derivatives     jsonb,
  p_width           integer,
  p_height          integer,
  p_original_bytes  bigint,
  p_content_sha256  text,
  p_content_type    text,
  p_filename        text,
  p_taken_at        timestamptz,
  p_camera_make     text,
  p_camera_model    text,
  p_lens            text,
  p_iso             integer,
  p_aperture        numeric,
  p_shutter         text,
  p_focal_length    numeric,
  p_keywords        text[],
  p_exif            jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix  text;
  v_asset   uuid;
  v_updated integer;
begin
  if p_tenant is null or p_album is null then
    raise exception 'A cover needs its site and its gallery.' using errcode = '23502';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant)
     or (p_tenant = public.current_tenant_id() or public.is_platform_admin()) is not true then
    raise exception 'That is not your site.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.albums al where al.id = p_album and al.tenant_id = p_tenant) then
    raise exception 'There is no such gallery on this site.' using errcode = '42501';
  end if;
  -- P3: the album's projection lock, shared with sync_photo_usages, so an
  -- album projection and this registration never interleave.
  perform public.photo_usage_lock(p_tenant, 'album', p_album::text);

  v_prefix := 't/' || p_tenant::text || '/covers/' || p_album::text || '/';
  if left(p_key_base, length(v_prefix)) is distinct from v_prefix
     or substr(p_key_base, length(v_prefix) + 1)
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'That upload does not belong to this gallery''s cover.' using errcode = '42501';
  end if;

  v_asset := public.upsert_photo_asset(
    p_tenant, p_key_base, null, p_display_path, p_derivatives,
    p_width, p_height, p_original_bytes, p_content_sha256, p_content_type, p_filename,
    p_taken_at, p_camera_make, p_camera_model, p_lens, p_iso, p_aperture,
    p_shutter, p_focal_length, p_keywords, p_exif, null, null,
    auth.uid());

  -- The cover path is the CANONICAL ASSET's display path, not this call's: a
  -- same-SHA retry cannot point the album anywhere the asset does not.
  update public.albums al
     set cover_custom_path = pa.display_path,
         cover_photo_id    = null
    from public.photo_assets pa
   where al.id = p_album and al.tenant_id = p_tenant
     and pa.id = v_asset and pa.tenant_id = p_tenant;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'The gallery''s cover could not be set.' using errcode = '42501';
  end if;

  return v_asset;
end $$;


-- ── P3's seven projection functions ─────────────────────────────────────────
-- Copied verbatim from db/migrations/2026-09-30_photo_usages_sync.sql (Supabase
-- 20261001010021). Their grants are with the other function-level grants below.

-- ══ 2. Internal helpers — EXECUTE to nobody ═════════════════════════════════
--
-- Each is SECURITY INVOKER: inside the definer functions below (and inside the
-- two P2 wrappers) it runs as the owner; nobody else holds EXECUTE on it.

-- The one lock per parent. Shared, for albums, with register_gallery_photo and
-- register_album_cover, so an album projection and an upload into that album
-- never interleave. `p_key` must already be canonical (a uuid's own text).
create or replace function public.photo_usage_lock(p_tenant uuid, p_parent text, p_key text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'photo_usages:' || p_tenant::text || ':' || p_parent || ':' || coalesce(p_key, ''), 0));
end $$;

-- Validates a parent and returns its CANONICAL key: a uuid as its own
-- lower-case text (so every caller hashes the same lock), a page key as given,
-- NULL for the draft. Anything else is refused.
create or replace function public.photo_usage_parent_key(p_tenant uuid, p_parent text, p_key text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'photo usages: there is no such site.' using errcode = '22023';
  end if;
  case p_parent
    when 'live_page' then
      -- Shape only. photo_usages_page_key_shape is the authority on WHICH keys
      -- exist; this keeps anything that is not a key out of the lock and the
      -- queries.
      if p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,31}$' then
        raise exception 'photo usages: "%" is not a page key.', p_key using errcode = '22023';
      end if;
      return p_key;
    when 'draft' then
      if p_key is not null then
        raise exception 'photo usages: the draft is the whole site; it takes no key.' using errcode = '22023';
      end if;
      return null;
    when 'album', 'post', 'catalog_item' then
      if p_key is null
         or p_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'photo usages: "%" is not an id.', p_key using errcode = '22023';
      end if;
      return p_key::uuid::text;
    else
      raise exception 'photo usages: there is no parent called "%".', p_parent using errcode = '22023';
  end case;
end $$;

-- THE SOURCE: the saved state the document-shaped references are extracted
-- from, and nothing else, in a deterministic jsonb shape. `p_key` canonical.
--
--   live_page  {"parent","page","sections":[{"type","settings"}…],"legacy","share"}
--              sections ordered by position, then id — the ORDINAL is the
--              slot, so two rows sharing a position (page_sections has no
--              unique on it) still get distinct, stable slots; `legacy` is the
--              page's legacy photograph columns ({} for pages that have none),
--              `share` its stored page_seo image (null when none)
--   draft      {"parent","exists","pages","page_seo"}  (site_draft verbatim)
--   post       {"parent","post","exists","blocks","featured"}
--              (blog_posts.blocks and featured_custom_path verbatim)
--   album      {"parent","album","exists","photos":[{"id","storage_path"}…]}
--              (the album's photographs, by id)
--   catalog_item {"parent","photo","exists","storage_path"}
--              (the storage path of the entry's photograph)
--
-- The legacy columns, share images, featured image and photograph paths are
-- here so the extractor can SEE them — it alone knows which paths are
-- built-in samples (isSamplePhoto) — and so a change to them makes an older
-- snapshot stale. They are still never accepted as references: the sync
-- projects every one of them itself. Covers are read inside the sync.
create or replace function public.photo_usage_source(p_tenant uuid, p_parent text, p_key text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v jsonb;
begin
  case p_parent
    when 'live_page' then
      select jsonb_build_object(
               'parent', 'live_page',
               'page', p_key,
               'sections', coalesce(
                 jsonb_agg(jsonb_build_object('type', s.type, 'settings', s.settings)
                           order by s."position", s.id),
                 '[]'::jsonb))
        into v
        from public.page_sections s
       where s.tenant_id = p_tenant and s.page = p_key;
      v := v || jsonb_build_object(
        'legacy', coalesce((
          select case p_key
                   when 'home' then jsonb_build_object('hero_image_path', st.hero_image_path,
                                                       'intro_image_path', st.intro_image_path,
                                                       'contact_image_path', st.contact_image_path)
                   when 'about' then jsonb_build_object('about_image_path', st.about_image_path)
                   else '{}'::jsonb
                 end
            from public.site_settings st where st.tenant_id = p_tenant), '{}'::jsonb),
        'share', (select st.page_seo -> p_key -> 'image'
                    from public.site_settings st where st.tenant_id = p_tenant));
    when 'draft' then
      select jsonb_build_object('parent', 'draft', 'exists', true, 'pages', d.pages, 'page_seo', d.page_seo)
        into v
        from public.site_draft d
       where d.tenant_id = p_tenant;
      v := coalesce(v, jsonb_build_object('parent', 'draft', 'exists', false));
    when 'post' then
      select jsonb_build_object('parent', 'post', 'post', p_key, 'exists', true, 'blocks', b.blocks,
                                'featured', b.featured_custom_path)
        into v
        from public.blog_posts b
       where b.id = p_key::uuid and b.tenant_id = p_tenant;
      v := coalesce(v, jsonb_build_object('parent', 'post', 'post', p_key, 'exists', false));
    when 'album' then
      v := jsonb_build_object('parent', 'album', 'album', p_key, 'exists',
             exists (select 1 from public.albums al where al.id = p_key::uuid and al.tenant_id = p_tenant),
             'photos', coalesce((
               select jsonb_agg(jsonb_build_object('id', ph.id, 'storage_path', ph.storage_path) order by ph.id)
                 from public.photos ph
                where ph.tenant_id = p_tenant and ph.album_id = p_key::uuid), '[]'::jsonb));
    when 'catalog_item' then
      v := jsonb_build_object('parent', 'catalog_item', 'photo', p_key, 'exists',
             exists (select 1 from public.catalog_items ci
                      where ci.photo_id = p_key::uuid and ci.tenant_id = p_tenant),
             'storage_path', (select ph.storage_path from public.photos ph
                               where ph.id = p_key::uuid and ph.tenant_id = p_tenant));
    else
      raise exception 'photo usages: there is no parent called "%".', p_parent using errcode = '22023';
  end case;
  return v;
end $$;

-- THE RESOLVER, as P4 unit 1 (Supabase 20261005192303) replaced P3's, copied
-- verbatim from db/migrations/2026-10-05_photo_backfill.sql. P3's rule is
-- unchanged inside it; the flat-era rule is the addition.
create or replace function public.photo_usage_resolve_path(p_tenant uuid, p_path text)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  with m as (
    select a.id
      from public.photo_assets a
     where a.tenant_id = p_tenant
       and strpos(p_path, '/') > 0
       and a.key_base = left(p_path, length(p_path) - strpos(reverse(p_path), '/'))
       and (p_path = a.original_path
            or p_path = a.display_path
            or exists (select 1 from jsonb_each_text(a.derivatives) d where d.value = p_path))
    union
    select a.id
      from public.photo_assets a
     where a.tenant_id = p_tenant
       and length(p_path) > 4
       and right(p_path, 4) = '.jpg'
       and a.key_base = left(p_path, length(p_path) - 4)
       and (p_path = a.original_path
            or p_path = a.display_path
            or exists (select 1 from jsonb_each_text(a.derivatives) d where d.value = p_path))
  )
  select case when count(*) = 1 then (array_agg(m.id))[1] end from m
$$;


-- ══ 3. The service-role interface ═══════════════════════════════════════════
--
-- EXECUTE to service_role only (below), AND a run-time check of the effective
-- role, so a grant added by mistake later still opens nothing. Measured on
-- PostgreSQL 17: inside a SECURITY DEFINER function `current_setting('role')`
-- still reports the CALLER's role (service_role / authenticated), while
-- current_user is the owner; a bare owner connection reports 'none' and is
-- refused too. PostgREST sets it with SET LOCAL ROLE, as record_page_view
-- already relies on.

create or replace function public.read_photo_usage_source(p_tenant uuid, p_parent text, p_key text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the projection service reads a usage source.' using errcode = '42501';
  end if;
  return public.photo_usage_source(
    p_tenant, p_parent, public.photo_usage_parent_key(p_tenant, p_parent, p_key))::text;
end $$;

-- Every parent of a site that could hold a usage, for rebuildUsages. Pages
-- are every key any source names — section rows, legacy home/about, stored
-- share images, the photographer's own pages — PLUS every page that still
-- holds a live usage, so a page whose source vanished is cleared too.
create or replace function public.list_photo_usage_parents(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seo    jsonb;
  v_custom jsonb;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the projection service lists usage parents.' using errcode = '42501';
  end if;
  perform public.photo_usage_parent_key(p_tenant, 'draft', null);

  select s.page_seo, s.custom_pages into v_seo, v_custom
    from public.site_settings s where s.tenant_id = p_tenant;

  return jsonb_build_object(
    'albums', coalesce((select jsonb_agg(al.id order by al.id)
                          from public.albums al where al.tenant_id = p_tenant), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(b.id order by b.id)
                         from public.blog_posts b where b.tenant_id = p_tenant), '[]'::jsonb),
    'catalog_items', coalesce((select jsonb_agg(ci.photo_id order by ci.photo_id)
                                 from public.catalog_items ci where ci.tenant_id = p_tenant), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(k order by k) from (
        select s.page as k from public.page_sections s where s.tenant_id = p_tenant
        union select 'home' union select 'about'
        union select e.key from jsonb_each(case when jsonb_typeof(v_seo) = 'object' then v_seo else '{}'::jsonb end) e
        union select c ->> 'key' from jsonb_array_elements(
                 case when jsonb_typeof(v_custom) = 'array' then v_custom else '[]'::jsonb end) c
               where jsonb_typeof(c -> 'key') = 'string'
        union select u.page_key from public.photo_usages u
               where u.tenant_id = p_tenant and u.scope = 'live' and u.page_key is not null
      ) keys where k ~ '^[a-z][a-z0-9_]{0,31}$'), '[]'::jsonb));
end $$;

-- THE ONE WRITER.
--
-- p_source_snapshot is the text read_photo_usage_source returned. p_refs is a
-- JSON array of the document references extracted from it:
--
--   page_section  {"kind","page_key","position","field","path","decorative"}
--   story_block   {"kind","position","field","path"}        ("decorative" false if present)
--   sample        a page:      {"kind","page_key","position":0,"field","path"}
--                              field: a legacy column or 'page_seo.image'
--                 a story:     {"kind","position":0,"field":"featured_custom_path","path"}
--                 an album or
--                 catalogue:   {"kind","photo_id","position":0,"field":"photo","path"}
--
-- and nothing else — every other kind is read here, never accepted.
--
-- A `sample` is NOT a usage. It declares that a source this function projects
-- itself holds one of the platform's BUILT-IN sample photographs, which never
-- become assets: a legacy column, a stored share image, a story's featured
-- image, or a photographs row (gallery membership, a chosen cover, a
-- catalogue entry). Each declaration is proved against the source before it
-- counts — the snapshot slot, or for a photograph the canonical photos row
-- (this site, this album or entry, exactly this storage_path) — and anything
-- else is refused (22023). A proved declaration only makes that one source
-- SKIPPED: no usage, not counted unresolved. It never creates a usage, never
-- chooses an asset, never names a parent and never removes another source's
-- row. Which paths are samples is the application's rule (isSamplePhoto,
-- lib/images.ts), stated once, there; this function never guesses it. Sample
-- section and story-block photographs are simply not sent.
create or replace function public.sync_photo_usages(
  p_tenant           uuid,
  p_parent           text,
  p_key              text,
  p_source_snapshot  text,
  p_refs             jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_list_cap  constant integer := 50;
  v_key       text;
  v_scope     text := case when p_parent = 'draft' then 'draft' else 'live' end;
  v_current   jsonb;
  v_text      text;
  v_uuid      uuid;
  v_n         integer;
  v_leaves    integer;
  v_ref       jsonb;
  v_kind      text;
  v_field     text;
  v_pos       integer;
  v_page      text;
  v_path      text;
  v_dec       boolean;
  v_alt       text;
  v_slot      jsonb;
  v_block     jsonb;
  v_img       jsonb;
  v_asset     uuid;
  v_written   integer := 0;
  v_missed    integer := 0;
  v_list      jsonb := '[]'::jsonb;
  v_skip      text[] := '{}';
  v_samples   uuid[] := '{}';
  v_photo     uuid;
  v_album     record;
  v_constraint text;
  r           record;
begin
  -- ── 1. Who, and what ──────────────────────────────────────────────────────
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the projection service writes photo usages.' using errcode = '42501';
  end if;
  v_key := public.photo_usage_parent_key(p_tenant, p_parent, p_key);
  if p_source_snapshot is null then
    raise exception 'photo usages: a sync needs the source it was extracted from.' using errcode = '22023';
  end if;
  if p_refs is null or jsonb_typeof(p_refs) <> 'array' then
    raise exception 'photo usages: the references must be an array.' using errcode = '22023';
  end if;
  if p_parent in ('album', 'post', 'catalog_item') then
    v_uuid := v_key::uuid;
  end if;

  -- ── 2. One at a time, per parent ──────────────────────────────────────────
  perform public.photo_usage_lock(p_tenant, p_parent, v_key);

  -- ── 3. Fresh, or nothing ──────────────────────────────────────────────────
  v_current := public.photo_usage_source(p_tenant, p_parent, v_key);
  v_text := v_current::text;
  if v_text is distinct from p_source_snapshot then
    return jsonb_build_object('stale', true, 'written', 0,
                              'unresolved', '[]'::jsonb, 'unresolved_count', 0);
  end if;

  -- ── 4. Resource ceilings, relative to the saved source ────────────────────
  -- Every legitimate reference is one distinct STRING value of the source (the
  -- slot it names), so there are never more references than string values.
  -- And each serialises as at most 320 bytes of structure plus its path —
  -- itself a string of the source — so the whole array is never longer than
  -- 320 bytes a reference plus the source's own text. Neither can refuse a
  -- document the editor could save; both refuse a payload no document made.
  v_n := jsonb_array_length(p_refs);
  if v_n > 0 then
    select count(*) into v_leaves
      from jsonb_path_query(v_current, 'strict $.**') x(v)
     where jsonb_typeof(x.v) = 'string';
    if v_n > v_leaves then
      raise exception 'photo usages: % references for a source holding % values.', v_n, v_leaves
        using errcode = '22023';
    end if;
    if octet_length(p_refs::text) > 320 * v_n + octet_length(v_text) + 2 then
      raise exception 'photo usages: the references are larger than their source could produce.'
        using errcode = '22023';
    end if;
  end if;

  -- ── 5. Out with the parent's rows ─────────────────────────────────────────
  -- For a parent with a ROW, that row (and, for an album, its photographs) is
  -- locked FOR KEY SHARE first, so a concurrent delete of it waits for this
  -- transaction instead of deadlocking against the rows deleted here.
  case p_parent
    when 'live_page' then
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.scope = 'live' and u.page_key = v_key
         and u.kind in ('page_section', 'page_legacy', 'page_share');
    when 'draft' then
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.scope = 'draft'
         and u.kind in ('page_section', 'page_legacy', 'page_share');
    when 'album' then
      perform 1 from public.albums al
        where al.id = v_uuid and al.tenant_id = p_tenant for key share;
      perform 1 from public.photos ph
        where ph.tenant_id = p_tenant
          and (ph.album_id = v_uuid
               or ph.id = (select al.cover_photo_id from public.albums al
                            where al.id = v_uuid and al.tenant_id = p_tenant))
        order by ph.id for key share;
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.kind = 'gallery'
         and u.photo_id in (select ph.id from public.photos ph
                             where ph.tenant_id = p_tenant and ph.album_id = v_uuid);
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.kind = 'gallery_cover' and u.album_id = v_uuid;
    when 'post' then
      perform 1 from public.blog_posts b
        where b.id = v_uuid and b.tenant_id = p_tenant for key share;
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.post_id = v_uuid
         and u.kind in ('story_cover', 'story_block');
    when 'catalog_item' then
      perform 1 from public.catalog_items ci
        where ci.photo_id = v_uuid and ci.tenant_id = p_tenant for key share;
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.kind = 'shop_listing'
         and u.product_id in (select ci.id from public.catalog_items ci
                               where ci.tenant_id = p_tenant and ci.photo_id = v_uuid);
  end case;

  -- ── 6. The document references, each bound to the saved source ───────────
  for v_ref in select e from jsonb_array_elements(p_refs) e loop
    if jsonb_typeof(v_ref) <> 'object' then
      raise exception 'photo usages: a reference must be an object.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_object_keys(v_ref) k
                where k not in ('kind', 'page_key', 'position', 'field', 'path', 'decorative', 'photo_id')) then
      raise exception 'photo usages: a reference carries a key it may not.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_ref -> 'kind') is distinct from 'string'
       or jsonb_typeof(v_ref -> 'field') is distinct from 'string'
       or jsonb_typeof(v_ref -> 'path') is distinct from 'string'
       or jsonb_typeof(v_ref -> 'position') is distinct from 'number'
       or (v_ref ? 'decorative' and jsonb_typeof(v_ref -> 'decorative') <> 'boolean') then
      raise exception 'photo usages: a reference needs a kind, field, path and position.' using errcode = '22023';
    end if;
    if (v_ref ->> 'position') !~ '^(0|[1-9][0-9]{0,8})$' then
      raise exception 'photo usages: a position is a whole number from 0.' using errcode = '22023';
    end if;

    v_kind  := v_ref ->> 'kind';
    v_field := v_ref ->> 'field';
    v_pos   := (v_ref ->> 'position')::integer;
    v_path  := v_ref ->> 'path';
    v_dec   := coalesce((v_ref ->> 'decorative')::boolean, false);
    v_page  := null;
    v_alt   := null;
    if v_ref ? 'photo_id' and not (v_kind = 'sample' and p_parent in ('album', 'catalog_item')) then
      raise exception 'photo usages: only an album or catalogue sample names a photograph.' using errcode = '22023';
    end if;

    if v_kind = 'page_section' and p_parent in ('live_page', 'draft') then
      if v_field !~ '^[a-z][a-z0-9_]{0,63}$' then
        raise exception 'photo usages: "%" is not a setting.', v_field using errcode = '22023';
      end if;
      if jsonb_typeof(v_ref -> 'page_key') is distinct from 'string' then
        raise exception 'photo usages: a section reference names its page.' using errcode = '22023';
      end if;
      v_page := v_ref ->> 'page_key';
      if p_parent = 'live_page' then
        if v_page <> v_key then
          raise exception 'photo usages: a reference to another page.' using errcode = '22023';
        end if;
        -- Zero rows → sections is [] → no slot, so a live page on its legacy
        -- columns can never take a page_section as well.
        v_slot := v_current -> 'sections' -> v_pos -> 'settings' -> v_field;
      else
        if v_page !~ '^[a-z][a-z0-9_]{0,31}$' then
          raise exception 'photo usages: "%" is not a page key.', v_page using errcode = '22023';
        end if;
        v_slot := v_current -> 'pages' -> v_page -> v_pos -> 'settings' -> v_field;
      end if;
      if v_slot is null or jsonb_typeof(v_slot) <> 'string' or (v_slot #>> '{}') <> v_path then
        raise exception 'photo usages: the reference does not match the saved source.' using errcode = '22023';
      end if;

    elsif v_kind = 'story_block' and p_parent = 'post' then
      if v_field !~ '^block:(0|[1-9][0-9]{0,8})$' then
        raise exception 'photo usages: "%" is not a block slot.', v_field using errcode = '22023';
      end if;
      if v_dec then
        raise exception 'photo usages: a story photograph is not decorative.' using errcode = '22023';
      end if;
      v_block := v_current -> 'blocks' -> (substr(v_field, 7)::integer);
      v_img := case
        when jsonb_typeof(v_block) <> 'object' then null
        when v_block ->> 'type' = 'image' and v_pos = 0 then v_block -> 'image'
        when v_block ->> 'type' = 'image_pair' and v_pos = 0 then v_block -> 'left'
        when v_block ->> 'type' = 'image_pair' and v_pos = 1 then v_block -> 'right'
        when v_block ->> 'type' in ('gallery', 'masonry') then v_block -> 'images' -> v_pos
      end;
      if v_img is null or jsonb_typeof(v_img) <> 'object'
         or jsonb_typeof(v_img -> 'path') is distinct from 'string'
         or (v_img ->> 'path') <> v_path then
        raise exception 'photo usages: the reference does not match the saved story.' using errcode = '22023';
      end if;
      -- The block's own alt, mirrored as it is: blank or whitespace is NULL,
      -- anything else verbatim. Read from the source, never from the caller.
      if jsonb_typeof(v_img -> 'alt') = 'string' and (v_img ->> 'alt') ~ '[^[:space:]]' then
        v_alt := v_img ->> 'alt';
      end if;

    elsif v_kind = 'sample' and p_parent in ('live_page', 'draft') then
      if v_pos <> 0 or v_dec then
        raise exception 'photo usages: a sample slot is position 0 and not decorative.' using errcode = '22023';
      end if;
      if jsonb_typeof(v_ref -> 'page_key') is distinct from 'string' then
        raise exception 'photo usages: a sample names its page.' using errcode = '22023';
      end if;
      v_page := v_ref ->> 'page_key';
      if p_parent = 'live_page' then
        if v_page <> v_key then
          raise exception 'photo usages: a reference to another page.' using errcode = '22023';
        end if;
        v_slot := case
          when v_field = 'page_seo.image' then v_current -> 'share'
          when v_field in ('hero_image_path', 'intro_image_path', 'contact_image_path', 'about_image_path')
            then v_current -> 'legacy' -> v_field
        end;
      else
        v_slot := case when v_field = 'page_seo.image'
                       then v_current -> 'page_seo' -> v_page -> 'image' end;
      end if;
      if v_slot is null or jsonb_typeof(v_slot) <> 'string' or (v_slot #>> '{}') <> v_path then
        raise exception 'photo usages: the reference does not match the saved source.' using errcode = '22023';
      end if;
      v_skip := v_skip || (v_page || '|' || v_field);
      continue;

    elsif v_kind = 'sample' and p_parent = 'post' then
      -- The story's featured image, as the snapshot holds it.
      if v_field <> 'featured_custom_path' or v_pos <> 0 or v_dec or v_ref ? 'page_key' then
        raise exception 'photo usages: a story sample is its featured image, position 0.' using errcode = '22023';
      end if;
      v_slot := v_current -> 'featured';
      if v_slot is null or jsonb_typeof(v_slot) <> 'string' or (v_slot #>> '{}') <> v_path then
        raise exception 'photo usages: the reference does not match the saved story.' using errcode = '22023';
      end if;
      v_skip := v_skip || 'story_cover|featured_custom_path'::text;
      continue;

    elsif v_kind = 'sample' and p_parent in ('album', 'catalog_item') then
      -- A photographs row, proved against the CANONICAL row: this site, this
      -- album (or, for a catalogue entry, the entry's own photograph), and
      -- exactly this stored path.
      if v_field <> 'photo' or v_pos <> 0 or v_dec or v_ref ? 'page_key' then
        raise exception 'photo usages: a photograph sample is field "photo", position 0.' using errcode = '22023';
      end if;
      if jsonb_typeof(v_ref -> 'photo_id') is distinct from 'string'
         or (v_ref ->> 'photo_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'photo usages: a photograph sample names its photograph.' using errcode = '22023';
      end if;
      v_photo := (v_ref ->> 'photo_id')::uuid;
      if not exists (
           select 1 from public.photos ph
            where ph.id = v_photo
              and ph.tenant_id = p_tenant
              and ph.storage_path = v_path
              and case when p_parent = 'album' then ph.album_id = v_uuid else ph.id = v_uuid end) then
        raise exception 'photo usages: the sample does not match a photograph of this %.',
          case when p_parent = 'album' then 'album' else 'catalogue entry' end
          using errcode = '22023';
      end if;
      v_samples := v_samples || v_photo;
      continue;

    else
      raise exception 'photo usages: a % reference is not accepted for a %.', v_kind, p_parent
        using errcode = '22023';
    end if;

    v_asset := case when length(v_path) between 1 and 1024
                    then public.photo_usage_resolve_path(p_tenant, v_path) end;
    if v_asset is null then
      v_missed := v_missed + 1;
      if v_missed <= c_list_cap then
        v_list := v_list || jsonb_build_object('kind', v_kind, 'page_key', v_page, 'field', v_field,
          'position', v_pos, 'path', left(v_path, 200),
          'reason', case when length(v_path) between 1 and 1024 then 'no_asset' else 'bad_shape' end);
      end if;
      continue;
    end if;

    begin
      insert into public.photo_usages
        (tenant_id, asset_id, scope, kind, post_id, page_key, field, position, alt_override, decorative)
      values
        (p_tenant, v_asset, v_scope, v_kind,
         case when v_kind = 'story_block' then v_uuid end,
         v_page, v_field, v_pos, v_alt, v_dec);
      v_written := v_written + 1;
    exception when check_violation then
      -- Only a page key the CHECK does not know is caught: count it, and let
      -- the rest of the page project. Any other CHECK is a defect — raise it.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'photo_usages_page_key_shape' then
        raise;
      end if;
      v_missed := v_missed + 1;
      if v_missed <= c_list_cap then
        v_list := v_list || jsonb_build_object('kind', v_kind, 'page_key', v_page, 'field', v_field,
          'position', v_pos, 'path', left(v_path, 200), 'reason', 'bad_page_key');
      end if;
    end;
  end loop;

  -- ── 7. The relational sources, read here under the lock ───────────────────
  -- The legacy columns and share images are projected from the SNAPSHOT just
  -- compared — the same values the extractor saw — skipping any slot it
  -- declared a built-in sample.
  if p_parent = 'live_page' then
    -- Legacy columns: only while the page has no section rows. `legacy` is {}
    -- for every page but home and about.
    if jsonb_array_length(v_current -> 'sections') = 0 then
      for r in
        select e.key as field, e.value #>> '{}' as path
          from jsonb_each(v_current -> 'legacy') e
         where jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') <> ''
           and not ((v_key || '|' || e.key) = any (v_skip))
         order by e.key
      loop
        v_asset := public.photo_usage_resolve_path(p_tenant, r.path);
        if v_asset is null then
          v_missed := v_missed + 1;
          if v_missed <= c_list_cap then
            v_list := v_list || jsonb_build_object('kind', 'page_legacy', 'page_key', v_key,
              'field', r.field, 'position', 0, 'path', left(r.path, 200), 'reason', 'no_asset');
          end if;
        else
          insert into public.photo_usages (tenant_id, asset_id, scope, kind, page_key, field)
          values (p_tenant, v_asset, 'live', 'page_legacy', v_key, r.field);
          v_written := v_written + 1;
        end if;
      end loop;
    end if;

    -- The explicitly stored share image, and only that.
    if jsonb_typeof(v_current -> 'share') = 'string'
       and (v_current ->> 'share') <> ''
       and not ((v_key || '|page_seo.image') = any (v_skip)) then
      v_path := v_current ->> 'share';
      v_asset := public.photo_usage_resolve_path(p_tenant, v_path);
      if v_asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'page_share', 'page_key', v_key,
            'field', 'page_seo.image', 'position', 0, 'path', left(v_path, 200), 'reason', 'no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, scope, kind, page_key, field)
        values (p_tenant, v_asset, 'live', 'page_share', v_key, 'page_seo.image');
        v_written := v_written + 1;
      end if;
    end if;

  elsif p_parent = 'draft' then
    -- The draft's explicitly stored share images. NULL page_seo means the
    -- draft has not touched search and sharing: nothing to project.
    for r in
      select e.key as page, e.value ->> 'image' as path
        from jsonb_each(case when jsonb_typeof(v_current -> 'page_seo') = 'object'
                             then v_current -> 'page_seo' else '{}'::jsonb end) e
       where jsonb_typeof(e.value -> 'image') = 'string' and (e.value ->> 'image') <> ''
         and not ((e.key || '|page_seo.image') = any (v_skip))
       order by e.key
    loop
      v_asset := public.photo_usage_resolve_path(p_tenant, r.path);
      if v_asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'page_share', 'page_key', r.page,
            'field', 'page_seo.image', 'position', 0, 'path', left(r.path, 200), 'reason', 'no_asset');
        end if;
        continue;
      end if;
      begin
        insert into public.photo_usages (tenant_id, asset_id, scope, kind, page_key, field)
        values (p_tenant, v_asset, 'draft', 'page_share', r.page, 'page_seo.image');
        v_written := v_written + 1;
      exception when check_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'photo_usages_page_key_shape' then
          raise;
        end if;
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'page_share', 'page_key', r.page,
            'field', 'page_seo.image', 'position', 0, 'path', left(r.path, 200), 'reason', 'bad_page_key');
        end if;
      end;
    end loop;

  elsif p_parent = 'album' then
    -- Gallery membership: every photograph of the album that has an asset of
    -- this site. The same logical row register_gallery_photo writes on upload.
    -- A photograph PROVED to be a built-in sample (above) is skipped silently.
    for r in
      select ph.id as photo, a.id as asset
        from public.photos ph
        left join public.photo_assets a on a.id = ph.asset_id and a.tenant_id = p_tenant
       where ph.tenant_id = p_tenant and ph.album_id = v_uuid
         and not (ph.id = any (v_samples))
       order by ph.id
    loop
      if r.asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'gallery', 'field', 'photo', 'position', 0,
            'photo_id', r.photo, 'reason', 'photo_has_no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, kind, photo_id, field)
        values (p_tenant, r.asset, 'gallery', r.photo, 'photo');
        v_written := v_written + 1;
      end if;
    end loop;

    select al.cover_photo_id, al.cover_custom_path into v_album
      from public.albums al where al.id = v_uuid and al.tenant_id = p_tenant;

    -- The chosen cover. The implicit one (the first photograph when none is
    -- chosen) is NOT a usage, and a chosen cover that is a proved sample is
    -- skipped silently.
    if v_album.cover_photo_id is not null and not (v_album.cover_photo_id = any (v_samples)) then
      select a.id into v_asset
        from public.photos ph
        join public.photo_assets a on a.id = ph.asset_id and a.tenant_id = p_tenant
       where ph.id = v_album.cover_photo_id and ph.tenant_id = p_tenant;
      if v_asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'gallery_cover', 'field', 'cover_photo_id',
            'position', 0, 'photo_id', v_album.cover_photo_id, 'reason', 'photo_has_no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, kind, album_id, field)
        values (p_tenant, v_asset, 'gallery_cover', v_uuid, 'cover_photo_id');
        v_written := v_written + 1;
      end if;
    end if;

    if v_album.cover_custom_path is not null and v_album.cover_custom_path <> '' then
      v_asset := public.photo_usage_resolve_path(p_tenant, v_album.cover_custom_path);
      if v_asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'gallery_cover', 'field', 'cover_custom_path',
            'position', 0, 'path', left(v_album.cover_custom_path, 200), 'reason', 'no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, kind, album_id, field)
        values (p_tenant, v_asset, 'gallery_cover', v_uuid, 'cover_custom_path');
        v_written := v_written + 1;
      end if;
    end if;

  elsif p_parent = 'post' then
    -- The featured image, from the snapshot just compared; skipped silently
    -- when it was proved a sample.
    v_path := v_current ->> 'featured';
    if jsonb_typeof(v_current -> 'featured') = 'string' and v_path <> ''
       and not ('story_cover|featured_custom_path' = any (v_skip)) then
      v_asset := public.photo_usage_resolve_path(p_tenant, v_path);
      if v_asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'story_cover', 'field', 'featured_custom_path',
            'position', 0, 'path', left(v_path, 200), 'reason', 'no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, kind, post_id, field)
        values (p_tenant, v_asset, 'story_cover', v_uuid, 'featured_custom_path');
        v_written := v_written + 1;
      end if;
    end if;

  elsif p_parent = 'catalog_item' then
    for r in
      select ci.id as item, a.id as asset
        from public.catalog_items ci
        join public.photos ph on ph.id = ci.photo_id and ph.tenant_id = p_tenant
        left join public.photo_assets a on a.id = ph.asset_id and a.tenant_id = p_tenant
       where ci.photo_id = v_uuid and ci.tenant_id = p_tenant
         and not (ci.photo_id = any (v_samples))
    loop
      if r.asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'shop_listing', 'field', 'photo', 'position', 0,
            'photo_id', v_uuid, 'reason', 'photo_has_no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, kind, product_id, field)
        values (p_tenant, r.asset, 'shop_listing', r.item, 'photo');
        v_written := v_written + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('stale', false, 'written', v_written,
                            'unresolved', v_list, 'unresolved_count', v_missed);
end $$;



-- ── P4 unit 1's backfill functions ──────────────────────────────────────────
--
-- From db/migrations/2026-10-05_photo_backfill.sql (Supabase 20261005192303),
-- copied verbatim: the key grammar, the foreign-claim check, the inventory,
-- the claims read and the writer. The replaced resolver is above, in place of
-- P3's; the grants are with the other function grants below.

-- ══ 1. The key grammar ═══════════════════════════════════════════════════════
--
-- A KEY BASE is one upload. The shapes every era of this application minted:
--
--   photos/<album>/<upload>          gallery, before the site prefix
--   covers/<album>/<upload>          custom cover, before the site prefix
--   journal/<upload>                 journal image, before the site prefix
--   t/<site>/photos/<album>/<upload>, t/<site>/covers/<album>/<upload>,
--   t/<site>/journal/<upload>, t/<site>/site-images/<upload>   since the prefix
--
-- every id a lower-case uuid. A PATH belongs to a base when it is the base
-- itself, `<base>/original.<jpg|png|webp|tif|avif>`, `<base>/<400|800|1600|
-- 2400>.webp` (the folder eras), or — for the three unprefixed routes only —
-- `<base>.jpg`, the FLAT era, which stored one resized JPEG and nothing else.
-- Anything else is NULL: a URL, a traversal, an encoded or upper-case id, a
-- shape no route ever minted, a sample, furniture, a video.

create or replace function public.photo_backfill_key_base(p_path text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  with r as (
    select replace('(t/U/)?(photos|covers)/U/U|(t/U/)?journal/U|t/U/site-images/U', 'U', u) as base,
           replace('(photos|covers)/U/U|journal/U', 'U', u) as flat
      from (select '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'::text as u) x
  )
  select case
           when p_path ~ ('^(' || r.base || ')$') then p_path
           when p_path ~ ('^(' || r.base || ')/(original\.(jpg|png|webp|tif|avif)|(400|800|1600|2400)\.webp)$')
             then left(p_path, length(p_path) - strpos(reverse(p_path), '/'))
           when p_path ~ ('^(' || r.flat || ')\.jpg$')
             then left(p_path, length(p_path) - 4)
         end
    from r
$$;


-- ══ 2. Another site's claim on an unprefixed key ════════════════════════════
--
-- An unprefixed key says nothing about whose it is. For a gallery photograph
-- or a cover the album in the key decides (it belongs to exactly one site).
-- A journal key names no album, so for it EVERY place a site keeps a path is
-- searched on every OTHER site — rows, covers, stories (blocks, featured image
-- and the old rich-text content), sections, the draft, the legacy columns,
-- share images, and frozen history. Any mention is a claim, and a claim
-- refuses: a false positive costs a manual review, a false negative would file
-- one photographer's photograph under another's site. `p_documents = false`
-- checks only for another site's asset at the same key.

create or replace function public.photo_backfill_foreign_claim(p_tenant uuid, p_key_base text, p_documents boolean)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.photo_assets a
                  where a.key_base = p_key_base and a.tenant_id <> p_tenant)
      or (p_documents and (
            exists (select 1 from public.photos ph where ph.tenant_id <> p_tenant
                     and strpos(concat_ws(' ', ph.storage_path, ph.original_path, ph.derivatives::text), p_key_base) > 0)
         or exists (select 1 from public.site_images si where si.tenant_id <> p_tenant
                     and strpos(concat_ws(' ', si.storage_path, si.original_path, si.derivatives::text), p_key_base) > 0)
         or exists (select 1 from public.albums al where al.tenant_id <> p_tenant
                     and strpos(coalesce(al.cover_custom_path, ''), p_key_base) > 0)
         or exists (select 1 from public.blog_posts b where b.tenant_id <> p_tenant
                     and strpos(concat_ws(' ', b.featured_custom_path, b.blocks::text, b.content::text), p_key_base) > 0)
         or exists (select 1 from public.page_sections s where s.tenant_id <> p_tenant
                     and strpos(s.settings::text, p_key_base) > 0)
         or exists (select 1 from public.site_draft d where d.tenant_id <> p_tenant
                     and strpos(concat_ws(' ', d.pages::text, d.page_seo::text), p_key_base) > 0)
         or exists (select 1 from public.site_settings st where st.tenant_id <> p_tenant
                     and strpos(concat_ws(' ', st.hero_image_path, st.intro_image_path, st.contact_image_path,
                                          st.about_image_path, st.page_seo::text), p_key_base) > 0)
         or exists (select 1 from public.site_versions v where v.tenant_id <> p_tenant
                     and strpos(v.snapshot::text, p_key_base) > 0)
         or exists (select 1 from public.site_draft_steps ds where ds.tenant_id <> p_tenant
                     and strpos(ds.snapshot::text, p_key_base) > 0)))
$$;


-- ══ 3. The inventory — service role only ════════════════════════════════════
--
-- One site, everything the plan needs: its photographs and Uploads (every
-- row, used or not), its albums' custom covers, the assets it already has, and
-- the SAVED SOURCE of every live page, the draft and every story — exactly the
-- text P3's projection reads, so the CLI runs P3's own extractor over it
-- (hidden sections, mobile twins, backgrounds and video posters included; the
-- hero video excluded by key). Frozen history is not read.

create or replace function public.read_photo_backfill_inventory(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parents jsonb;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the backfill service reads the photograph inventory.' using errcode = '42501';
  end if;
  -- Refuses a missing site (22023), and lists every page, post and album
  -- exactly as the projection does.
  v_parents := public.list_photo_usage_parents(p_tenant);

  return jsonb_build_object(
    'tenant', p_tenant,
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ph.id, 'album_id', ph.album_id, 'storage_path', ph.storage_path,
               'original_path', ph.original_path, 'derivatives', ph.derivatives,
               'width', ph.width, 'height', ph.height, 'tags', to_jsonb(ph.tags),
               'asset_id', ph.asset_id) order by ph.id)
        from public.photos ph where ph.tenant_id = p_tenant), '[]'::jsonb),
    'site_images', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', si.id, 'storage_path', si.storage_path, 'original_path', si.original_path,
               'derivatives', si.derivatives, 'width', si.width, 'height', si.height,
               'filename', si.filename, 'asset_id', si.asset_id) order by si.id)
        from public.site_images si where si.tenant_id = p_tenant), '[]'::jsonb),
    'albums', coalesce((
      select jsonb_agg(jsonb_build_object('id', al.id, 'cover_custom_path', al.cover_custom_path) order by al.id)
        from public.albums al where al.tenant_id = p_tenant), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'key_base', a.key_base, 'original_path', a.original_path,
               'display_path', a.display_path, 'derivatives', a.derivatives,
               'width', a.width, 'height', a.height, 'original_bytes', a.original_bytes,
               'content_sha256', a.content_sha256, 'content_type', a.content_type,
               'archived', a.archived_at is not null, 'deleted', a.deleted_at is not null) order by a.key_base)
        from public.photo_assets a where a.tenant_id = p_tenant), '[]'::jsonb),
    'sources',
      coalesce((select jsonb_agg(jsonb_build_object('parent', 'live_page', 'key', k,
                                   'source', public.photo_usage_source(p_tenant, 'live_page', k)) order by k)
                  from jsonb_array_elements_text(v_parents -> 'pages') k), '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('parent', 'draft', 'key', null,
                             'source', public.photo_usage_source(p_tenant, 'draft', null)))
      || coalesce((select jsonb_agg(jsonb_build_object('parent', 'post', 'key', k,
                                      'source', public.photo_usage_source(p_tenant, 'post', k)) order by k)
                     from jsonb_array_elements_text(v_parents -> 'posts') k), '[]'::jsonb)
  );
end $$;

-- For each key base asked about: does another site claim it? Bounded, and
-- every key must be one the grammar recognises.
create or replace function public.read_photo_backfill_claims(p_tenant uuid, p_key_bases text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_out jsonb := '{}'::jsonb;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the backfill service reads key claims.' using errcode = '42501';
  end if;
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'photo backfill: there is no such site.' using errcode = '22023';
  end if;
  if p_key_bases is null or coalesce(array_length(p_key_bases, 1), 0) > 1000 then
    raise exception 'photo backfill: between 0 and 1000 keys at a time.' using errcode = '22023';
  end if;
  foreach v_key in array p_key_bases loop
    if v_key is null or public.photo_backfill_key_base(v_key) is distinct from v_key then
      raise exception 'photo backfill: "%" is not a key base.', v_key using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object(v_key, public.photo_backfill_foreign_claim(p_tenant, v_key, true));
  end loop;
  return v_out;
end $$;


-- ══ 4. The writer — service role only ═══════════════════════════════════════
--
-- p_source and its locator:
--
--   'photo'       p_source_id = photos.id        p_source_path = its storage_path
--   'site_image'  p_source_id = site_images.id   p_source_path = its storage_path
--   'album_cover' p_source_id = albums.id        p_source_path = its cover_custom_path
--   'document'    p_parent, p_parent_key (as P3 names a parent: live_page + page
--                 key, draft + NULL, post + id) and p_slot, the ONE image slot
--                 of that saved source the path is in:
--
--     live_page  sections/<n>/<setting>   a section's setting (P3's page_section)
--                legacy/<column>          hero/intro/contact/about_image_path —
--                                         only while the page has NO section rows,
--                                         exactly P3's fallback; otherwise refused
--                share                    the page's stored share image
--     draft      pages/<page>/<n>/<setting>, page_seo/<page>
--     post       featured                 the story's featured image
--                blocks/<i>/image | left | right | images/<j>
--                                         an image slot of a block of the type
--                                         that has it (image / image_pair /
--                                         gallery, masonry) — never a caption
--
--   Which SETTING of a section is a photograph is the registry's to say, in
--   TypeScript (lib/photos/extract.ts); this function does not keep a second
--   copy of it, exactly as sync_photo_usages does not. It binds the path to the
--   slot of the saved source, under the parent's projection lock.
--
-- Returns {status, asset_id, linked}:
--
--   created         a new asset; a row source had its NULL asset_id filled
--   reused          the asset already at this key, its facts identical; a row
--                   source was linked to it
--   already_linked  the row already has an asset — nothing was touched
--   stale           the source no longer holds what the caller read — nothing
--                   was touched; re-read and plan again
--   gone            the source row no longer exists — nothing was touched
--
-- and RAISES (nothing kept) for anything that is not a legacy file of this
-- site in a shape its era wrote, or that disagrees with the asset already at
-- its key: 42501 ownership, 22023 a bad or conflicting value, 23502 a missing
-- one, 55000 an archived or deleted asset.
--
-- What the caller may NOT say: state (always 'derived' — the backfill read and
-- decoded the display file before calling), derived_at (NULL: when the sizes
-- were made is not known), created_by (NULL: nobody uploaded anything now),
-- alt text, any lifecycle column. For a 'photo' source the capture date and the
-- place are taken from the ROW, under its lock, at the moment of the write (the
-- caller's p_taken_at must be NULL). Its KEYWORDS are the row's tags put
-- through the ONE keyword normaliser, normalizeKeywords() in lib/photos/exif.ts
-- (trim, lower-case, control characters out, each cut to 200, empties dropped,
-- the first 25) — computed by the caller, never restated here. What binds them
-- to the row is p_source_tags: the raw `photos.tags` the caller normalised. It
-- must equal the row's tags under the lock, or the answer is `stale` and
-- nothing is written; p_keywords is then held to the asset's bounds like any
-- other source's. The row's tags themselves are never rewritten. For every
-- other source p_source_tags must be NULL.
--
-- An absent ladder is `{}`. A row whose `derivatives` holds JSON null counts as
-- `{}` here and in the backfill alike, so a valid display-only row is never
-- "stale" for ever.

create or replace function public.register_legacy_photo_asset(
  p_tenant              uuid,
  p_source              text,
  p_source_id           uuid,
  p_parent              text,
  p_parent_key          text,
  p_slot                text,
  p_source_path         text,
  p_key_base            text,
  p_original_path       text,
  p_display_path        text,
  p_derivatives         jsonb,
  p_width               integer,
  p_height              integer,
  p_original_bytes      bigint,
  p_content_sha256      text,
  p_content_type        text,
  p_taken_at            timestamptz,
  p_camera_make         text,
  p_camera_model        text,
  p_lens                text,
  p_iso                 integer,
  p_aperture            numeric,
  p_shutter             text,
  p_focal_length        numeric,
  p_keywords            text[],
  p_source_tags         text[],
  p_exif                jsonb,
  p_provenance_reviewed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_sizes     constant text[] := array['400', '800', '1600', '2400'];
  v_exif      jsonb := coalesce(p_exif, '{}'::jsonb);
  v_prefixed  boolean;
  v_route     text;
  v_album     uuid;
  v_flat      boolean;
  v_key       text;
  v_value     jsonb;
  v_kw        text;
  v_row       record;
  v_row_album uuid;
  v_cover     text;
  v_pkey      text;
  v_src       jsonb;
  v_slot      jsonb;
  v_block     jsonb;
  v_img       jsonb;
  v_keywords  text[];
  v_taken     timestamptz;
  v_lat       double precision;
  v_lng       double precision;
  v_filename  text;
  v_asset     uuid;
  v_status    text;
  v_old       record;
  v_n         integer;
begin
  -- ── 1. Who ────────────────────────────────────────────────────────────────
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the backfill service registers legacy photographs.' using errcode = '42501';
  end if;
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'photo backfill: there is no such site.' using errcode = '22023';
  end if;

  -- ── 2. The key, and whose it is ───────────────────────────────────────────
  if p_key_base is null or public.photo_backfill_key_base(p_key_base) is distinct from p_key_base then
    raise exception 'photo backfill: "%" is not a key any upload route minted.', p_key_base using errcode = '22023';
  end if;
  if p_source_path is null or public.photo_backfill_key_base(p_source_path) is distinct from p_key_base then
    raise exception 'photo backfill: the source path is not a file of this key.' using errcode = '22023';
  end if;
  v_prefixed := left(p_key_base, 2) = 't/';
  if v_prefixed and split_part(p_key_base, '/', 2) <> p_tenant::text then
    raise exception 'photo backfill: that key is under another site''s prefix.' using errcode = '42501';
  end if;
  v_route := split_part(p_key_base, '/', case when v_prefixed then 3 else 1 end);
  if v_route in ('photos', 'covers') then
    v_album := split_part(p_key_base, '/', case when v_prefixed then 4 else 2 end)::uuid;
  end if;
  if not v_prefixed then
    -- One unprefixed key, one site: serialise the claim check and the insert
    -- across sites, not only within one.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photo_backfill_key:' || p_key_base, 0));
    if v_route in ('photos', 'covers')
       and not exists (select 1 from public.albums al where al.id = v_album and al.tenant_id = p_tenant) then
      raise exception 'photo backfill: the album in that key is not this site''s.' using errcode = '42501';
    end if;
    if v_route = 'journal' and p_provenance_reviewed is not true then
      raise exception 'photo backfill: an unprefixed journal key needs reviewed provenance for this site.'
        using errcode = '42501';
    end if;
    if public.photo_backfill_foreign_claim(p_tenant, p_key_base, v_route = 'journal') then
      raise exception 'photo backfill: another site claims that key.' using errcode = '42501';
    end if;
  end if;

  -- ── 3. The files: every path inside the key, in its era's shape ──────────
  if p_display_path is null or p_derivatives is null then
    raise exception 'photo backfill: a photograph needs its display path and its sizes ({} for none).'
      using errcode = '23502';
  end if;
  if jsonb_typeof(p_derivatives) <> 'object' then
    raise exception 'photo backfill: the sizes must be an object.' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(p_derivatives) loop
    if not (v_key = any (c_sizes)) then
      raise exception 'photo backfill: there is no display size called "%".', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(v_value) <> 'string' or (v_value #>> '{}') <> p_key_base || '/' || v_key || '.webp' then
      raise exception 'photo backfill: size % is not where this key says it is.', v_key using errcode = '22023';
    end if;
  end loop;

  -- The display file must itself be a file of this key by the grammar —
  -- checked on its own, not inferred from the source path: a prefixed key has
  -- no flat file, so `<prefixed base>.jpg` is refused here.
  if public.photo_backfill_key_base(p_display_path) is distinct from p_key_base then
    raise exception 'photo backfill: the display path is not a file of this key.' using errcode = '22023';
  end if;
  -- It is the flat era's single JPEG or one of the recorded sizes.
  v_flat := p_display_path = p_key_base || '.jpg';
  if not v_flat and not exists (select 1 from jsonb_each_text(p_derivatives) d where d.value = p_display_path) then
    raise exception 'photo backfill: the display path must be the flat file or one of the recorded sizes.'
      using errcode = '22023';
  end if;

  if p_original_path is not null then
    -- A flat-era file is a resized JPEG, and a `<base>/original.jpg` beside it
    -- was written by the old derivative job FROM that JPEG: neither is the
    -- photographer's original. A cover never kept one.
    if v_flat then
      raise exception 'photo backfill: a flat-era photograph has no known original.' using errcode = '22023';
    end if;
    if v_route = 'covers' then
      raise exception 'photo backfill: a cover keeps no original.' using errcode = '22023';
    end if;
    if not (left(p_original_path, length(p_key_base) + 10) = p_key_base || '/original.'
            and substr(p_original_path, length(p_key_base) + 11) in ('jpg', 'png', 'webp', 'tif', 'avif')) then
      raise exception 'photo backfill: the original is not where this key says it is.' using errcode = '22023';
    end if;
    if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'photo backfill: an original''s hash is 64 lower-case hex characters.' using errcode = '22023';
    end if;
    if p_original_bytes is null or p_original_bytes <= 0 then
      raise exception 'photo backfill: an original has more than zero bytes.' using errcode = '22023';
    end if;
    if p_content_type is not null and p_content_type not in
         ('image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif', 'image/heif') then
      raise exception 'photo backfill: unknown content type "%".', p_content_type using errcode = '22023';
    end if;
  elsif p_content_sha256 is not null or p_original_bytes is not null or p_content_type is not null then
    -- The hash, size and type are facts ABOUT the original. With no original
    -- there is nothing they could truthfully describe.
    raise exception 'photo backfill: original facts without an original.' using errcode = '22023';
  end if;

  if (p_width is null) <> (p_height is null) or p_width <= 0 or p_height <= 0 then
    raise exception 'photo backfill: dimensions are both known and positive, or both unknown.' using errcode = '22023';
  end if;

  -- NULL-safe: with no original, `p_source_path = p_original_path` is NULL,
  -- and `not (false or NULL or false)` is NULL — which an IF does not raise on.
  -- `is not true` refuses NULL as well as false.
  if (p_source_path = p_display_path
      or p_source_path = p_original_path
      or exists (select 1 from jsonb_each_text(p_derivatives) d where d.value = p_source_path)) is not true then
    raise exception 'photo backfill: the source path is not one of this photograph''s files.' using errcode = '22023';
  end if;

  -- ── 4. Capture: P2's normalised, bounded shape ───────────────────────────
  if length(p_camera_make)  > 64 or p_camera_make  ~ '[[:cntrl:]]'
  or length(p_camera_model) > 64 or p_camera_model ~ '[[:cntrl:]]'
  or length(p_lens)         > 96 or p_lens         ~ '[[:cntrl:]]' then
    raise exception 'photo backfill: camera and lens names are at most 64 / 64 / 96 plain characters.'
      using errcode = '22023';
  end if;
  if p_iso is not null and (p_iso < 1 or p_iso > 1000000) then
    raise exception 'photo backfill: ISO % is out of range.', p_iso using errcode = '22023';
  end if;
  if p_aperture is not null and (p_aperture < 0.5 or p_aperture > 99.9 or p_aperture <> round(p_aperture, 1)) then
    raise exception 'photo backfill: aperture % is out of range.', p_aperture using errcode = '22023';
  end if;
  if p_shutter is not null and p_shutter !~ '^(1/[1-9][0-9]{0,5}|[0-9]{1,4}(\.[0-9])?s)$' then
    raise exception 'photo backfill: shutter "%" is not in the normalised form.', p_shutter using errcode = '22023';
  end if;
  if p_focal_length is not null and (p_focal_length < 0.1 or p_focal_length > 9999.9
                                     or p_focal_length <> round(p_focal_length, 1)) then
    raise exception 'photo backfill: focal length % is out of range.', p_focal_length using errcode = '22023';
  end if;
  if p_keywords is not null then
    if coalesce(array_length(p_keywords, 1), 0) > 25 then
      raise exception 'photo backfill: at most 25 keywords.' using errcode = '22023';
    end if;
    foreach v_kw in array p_keywords loop
      if v_kw is null or v_kw = '' or length(v_kw) > 200 or v_kw ~ '[[:cntrl:]]' then
        raise exception 'photo backfill: a keyword is 1 to 200 plain characters.' using errcode = '22023';
      end if;
    end loop;
  end if;
  if jsonb_typeof(v_exif) <> 'object' then
    raise exception 'photo backfill: exif must be an object.' using errcode = '22023';
  end if;
  if octet_length(v_exif::text) > 1024 then
    raise exception 'photo backfill: exif is over 1024 bytes.' using errcode = '22023';
  end if;
  if v_exif <> '{}'::jsonb and (v_exif -> 'v') is distinct from '1'::jsonb then
    raise exception 'photo backfill: exif must say it is version 1.' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(v_exif) loop
    if not (case v_key
      when 'v'                 then v_value = '1'::jsonb
      when 'orientation'       then jsonb_typeof(v_value) = 'number'
                                    and (v_value #>> '{}')::numeric in (1, 2, 3, 4, 5, 6, 7, 8)
      when 'offset_time'       then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') ~ '^[+-][0-9]{2}:[0-9]{2}$'
      when 'exposure_program'  then jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') in
                                    ('manual', 'program', 'aperture_priority', 'shutter_priority',
                                     'creative', 'action', 'portrait', 'landscape', 'other')
      when 'exposure_mode'     then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') in ('auto', 'manual', 'bracket')
      when 'exposure_bias_ev'  then jsonb_typeof(v_value) = 'number'
                                    and (v_value #>> '{}')::numeric between -20 and 20
      when 'metering_mode'     then jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') in
                                    ('average', 'center_weighted', 'spot', 'multi_spot',
                                     'pattern', 'partial', 'other')
      when 'flash_fired'       then jsonb_typeof(v_value) = 'boolean'
      when 'white_balance'     then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') in ('auto', 'manual')
      when 'focal_length_35mm' then jsonb_typeof(v_value) = 'number'
                                    and (v_value #>> '{}')::numeric between 1 and 5000
                                    and (v_value #>> '{}')::numeric = trunc((v_value #>> '{}')::numeric)
      when 'lens_make'         then jsonb_typeof(v_value) = 'string'
                                    and length(v_value #>> '{}') between 1 and 64
                                    and (v_value #>> '{}') !~ '[[:cntrl:]]'
      when 'color_space'       then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') in ('srgb', 'adobe_rgb', 'uncalibrated')
      when 'software'          then jsonb_typeof(v_value) = 'string'
                                    and length(v_value #>> '{}') between 1 and 64
                                    and (v_value #>> '{}') !~ '[[:cntrl:]]'
      else false
    end) then
      raise exception 'photo backfill: exif "%" is not an allowed key, or not an allowed value for it.', v_key
        using errcode = '22023';
    end if;
  end loop;

  -- ── 5. The source: located, locked, and still holding what was read ──────
  v_taken := p_taken_at;
  v_keywords := p_keywords;
  if p_source <> 'document' and p_slot is not null then
    raise exception 'photo backfill: only a document source names a slot.' using errcode = '22023';
  end if;
  if p_source <> 'photo' and p_source_tags is not null then
    raise exception 'photo backfill: only a photograph source carries its row''s tags.' using errcode = '22023';
  end if;
  case p_source
    when 'photo' then
      if p_source_id is null then
        raise exception 'photo backfill: a photograph source names its row.' using errcode = '23502';
      end if;
      if p_parent is not null or p_parent_key is not null or p_taken_at is not null then
        raise exception 'photo backfill: a photograph''s date, place and parent are its row''s.' using errcode = '22023';
      end if;
      if p_source_tags is null or p_keywords is null then
        raise exception 'photo backfill: a photograph source sends the row''s tags as read and their normalised keywords.'
          using errcode = '23502';
      end if;
      select ph.album_id into v_row_album from public.photos ph
       where ph.id = p_source_id and ph.tenant_id = p_tenant;
      if not found then
        return jsonb_build_object('status', 'gone', 'asset_id', null, 'linked', false);
      end if;
      -- The album's projection lock first — the order register_gallery_photo
      -- and sync_photo_usages already use — then the row.
      perform public.photo_usage_lock(p_tenant, 'album', v_row_album::text);
      select ph.* into v_row from public.photos ph
       where ph.id = p_source_id and ph.tenant_id = p_tenant
         for update;
      if not found then
        return jsonb_build_object('status', 'gone', 'asset_id', null, 'linked', false);
      end if;
      if v_row.asset_id is not null then
        return jsonb_build_object('status', 'already_linked', 'asset_id', v_row.asset_id, 'linked', false);
      end if;
      if v_row.album_id is distinct from v_row_album
         or v_row.storage_path is distinct from p_source_path
         or coalesce(nullif(v_row.derivatives, 'null'::jsonb), '{}'::jsonb) is distinct from p_derivatives
         or v_row.width is distinct from p_width or v_row.height is distinct from p_height
         or (v_row.original_path is not null and v_row.original_path is distinct from p_original_path)
         -- The keywords were normalised from THESE tags; another set is stale.
         or v_row.tags is distinct from p_source_tags then
        return jsonb_build_object('status', 'stale', 'asset_id', null, 'linked', false);
      end if;
      if p_display_path <> v_row.storage_path then
        raise exception 'photo backfill: a photograph''s display path is its storage_path, exactly.' using errcode = '22023';
      end if;
      v_taken := v_row.taken_at;
      if v_row.latitude between -90 and 90 and v_row.longitude between -180 and 180 then
        v_lat := v_row.latitude;
        v_lng := v_row.longitude;
      end if;

    when 'site_image' then
      if p_source_id is null then
        raise exception 'photo backfill: an Uploads source names its row.' using errcode = '23502';
      end if;
      if p_parent is not null or p_parent_key is not null then
        raise exception 'photo backfill: an Uploads row has no parent.' using errcode = '22023';
      end if;
      select si.* into v_row from public.site_images si
       where si.id = p_source_id and si.tenant_id = p_tenant
         for update;
      if not found then
        return jsonb_build_object('status', 'gone', 'asset_id', null, 'linked', false);
      end if;
      if v_row.asset_id is not null then
        return jsonb_build_object('status', 'already_linked', 'asset_id', v_row.asset_id, 'linked', false);
      end if;
      if v_row.storage_path is distinct from p_source_path
         or coalesce(nullif(v_row.derivatives, 'null'::jsonb), '{}'::jsonb) is distinct from p_derivatives
         or v_row.width is distinct from p_width or v_row.height is distinct from p_height
         or (v_row.original_path is not null and v_row.original_path is distinct from p_original_path) then
        return jsonb_build_object('status', 'stale', 'asset_id', null, 'linked', false);
      end if;
      if p_display_path <> v_row.storage_path then
        raise exception 'photo backfill: an Uploads row''s display path is its storage_path, exactly.' using errcode = '22023';
      end if;
      if v_row.filename is not null and length(v_row.filename) between 1 and 120 and v_row.filename !~ '[[:cntrl:]]' then
        v_filename := v_row.filename;
      end if;

    when 'album_cover' then
      if p_source_id is null then
        raise exception 'photo backfill: a cover source names its album.' using errcode = '23502';
      end if;
      if p_parent is not null or p_parent_key is not null then
        raise exception 'photo backfill: a cover has no other parent.' using errcode = '22023';
      end if;
      if not exists (select 1 from public.albums al where al.id = p_source_id and al.tenant_id = p_tenant) then
        return jsonb_build_object('status', 'gone', 'asset_id', null, 'linked', false);
      end if;
      perform public.photo_usage_lock(p_tenant, 'album', p_source_id::text);
      select al.cover_custom_path into v_cover from public.albums al
       where al.id = p_source_id and al.tenant_id = p_tenant
         for share;
      if not found then
        return jsonb_build_object('status', 'gone', 'asset_id', null, 'linked', false);
      end if;
      if v_cover is distinct from p_source_path then
        return jsonb_build_object('status', 'stale', 'asset_id', null, 'linked', false);
      end if;

    when 'document' then
      if p_source_id is not null or p_parent is null or p_parent not in ('live_page', 'draft', 'post')
         or p_slot is null then
        raise exception 'photo backfill: a document source is a live page, the draft or a story, and one slot of it.'
          using errcode = '22023';
      end if;
      v_pkey := public.photo_usage_parent_key(p_tenant, p_parent, p_parent_key);
      -- The parent's PROJECTION lock — the one sync_photo_usages takes — so
      -- this binding and a projection of the same parent never interleave.
      perform public.photo_usage_lock(p_tenant, p_parent, v_pkey);
      v_src := public.photo_usage_source(p_tenant, p_parent, v_pkey);

      if p_parent = 'live_page' then
        if p_slot ~ '^sections/(0|[1-9][0-9]{0,8})/[a-z][a-z0-9_]{0,63}$' then
          v_slot := v_src -> 'sections' -> split_part(p_slot, '/', 2)::integer -> 'settings' -> split_part(p_slot, '/', 3);
        elsif p_slot in ('legacy/hero_image_path', 'legacy/intro_image_path',
                         'legacy/contact_image_path', 'legacy/about_image_path') then
          -- P3's fallback, exactly: with section rows the legacy columns are
          -- mirrors, and a mirror is not a placement.
          if jsonb_array_length(v_src -> 'sections') = 0 then
            v_slot := v_src -> 'legacy' -> split_part(p_slot, '/', 2);
          end if;
        elsif p_slot = 'share' then
          v_slot := v_src -> 'share';
        else
          raise exception 'photo backfill: "%" is not an image slot of a live page.', p_slot using errcode = '22023';
        end if;
      elsif p_parent = 'draft' then
        if p_slot ~ '^pages/[a-z][a-z0-9_]{0,31}/(0|[1-9][0-9]{0,8})/[a-z][a-z0-9_]{0,63}$' then
          v_slot := v_src -> 'pages' -> split_part(p_slot, '/', 2) -> split_part(p_slot, '/', 3)::integer
                          -> 'settings' -> split_part(p_slot, '/', 4);
        elsif p_slot ~ '^page_seo/[a-z][a-z0-9_]{0,31}$' then
          v_slot := v_src -> 'page_seo' -> split_part(p_slot, '/', 2) -> 'image';
        else
          raise exception 'photo backfill: "%" is not an image slot of the draft.', p_slot using errcode = '22023';
        end if;
      else
        if p_slot = 'featured' then
          v_slot := v_src -> 'featured';
        elsif p_slot ~ '^blocks/(0|[1-9][0-9]{0,8})/(image|left|right|images/(0|[1-9][0-9]{0,8}))$' then
          v_block := v_src -> 'blocks' -> split_part(p_slot, '/', 2)::integer;
          v_img := case
            when jsonb_typeof(v_block) <> 'object' then null
            when split_part(p_slot, '/', 3) = 'image' and v_block ->> 'type' = 'image' then v_block -> 'image'
            when split_part(p_slot, '/', 3) in ('left', 'right') and v_block ->> 'type' = 'image_pair'
              then v_block -> split_part(p_slot, '/', 3)
            when split_part(p_slot, '/', 3) = 'images' and v_block ->> 'type' in ('gallery', 'masonry')
              then v_block -> 'images' -> split_part(p_slot, '/', 4)::integer
          end;
          v_slot := case when jsonb_typeof(v_img) = 'object' then v_img -> 'path' end;
        else
          raise exception 'photo backfill: "%" is not an image slot of a story.', p_slot using errcode = '22023';
        end if;
      end if;
      if v_slot is null or jsonb_typeof(v_slot) <> 'string' or (v_slot #>> '{}') <> p_source_path then
        return jsonb_build_object('status', 'stale', 'asset_id', null, 'linked', false);
      end if;

    else
      raise exception 'photo backfill: there is no source called "%".', p_source using errcode = '22023';
  end case;

  -- ── 6. The asset: created, or the one already there — never rewritten ────
  insert into public.photo_assets (
    tenant_id, key_base, original_path, display_path, derivatives,
    original_bytes, content_type, filename, content_sha256, width, height,
    taken_at, latitude, longitude, camera_make, camera_model, lens, iso,
    aperture, shutter, focal_length, keywords, exif,
    state, derived_at, created_by
  ) values (
    p_tenant, p_key_base, p_original_path, p_display_path, p_derivatives,
    p_original_bytes, p_content_type, v_filename, p_content_sha256, p_width, p_height,
    v_taken, v_lat, v_lng, p_camera_make, p_camera_model, p_lens, p_iso,
    p_aperture, p_shutter, p_focal_length, coalesce(v_keywords, '{}'::text[]), v_exif,
    'derived', null, null
  )
  on conflict (tenant_id, key_base) do nothing
  returning id into v_asset;

  if v_asset is not null then
    v_status := 'created';
  else
    select a.id, a.original_path, a.display_path, a.derivatives, a.width, a.height,
           a.original_bytes, a.content_sha256, a.content_type, a.archived_at, a.deleted_at
      into v_old
      from public.photo_assets a
     where a.tenant_id = p_tenant and a.key_base = p_key_base
       for update;
    if v_old.display_path is distinct from p_display_path
       or v_old.original_path is distinct from p_original_path
       or v_old.derivatives is distinct from p_derivatives
       or v_old.width is distinct from p_width or v_old.height is distinct from p_height
       or v_old.original_bytes is distinct from p_original_bytes
       or v_old.content_sha256 is distinct from p_content_sha256
       or v_old.content_type is distinct from p_content_type then
      raise exception 'photo backfill: the asset already at this key records different files.' using errcode = '22023';
    end if;
    if v_old.archived_at is not null or v_old.deleted_at is not null then
      raise exception 'photo backfill: the asset at this key has been archived or deleted.' using errcode = '55000';
    end if;
    v_asset := v_old.id;
    v_status := 'reused';
  end if;

  -- ── 7. The link: a NULL asset_id filled, in this same transaction ────────
  if p_source = 'photo' then
    update public.photos ph set asset_id = v_asset
     where ph.id = p_source_id and ph.tenant_id = p_tenant and ph.asset_id is null;
    get diagnostics v_n = row_count;
  elsif p_source = 'site_image' then
    update public.site_images si set asset_id = v_asset
     where si.id = p_source_id and si.tenant_id = p_tenant and si.asset_id is null;
    get diagnostics v_n = row_count;
  end if;
  if p_source in ('photo', 'site_image') and v_n <> 1 then
    -- Impossible while the row lock is held; refuse rather than half-write.
    raise exception 'photo backfill: the source row could not be linked.' using errcode = '55000';
  end if;

  return jsonb_build_object('status', v_status, 'asset_id', v_asset,
                            'linked', p_source in ('photo', 'site_image'));
end $$;


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

-- The kind, scope and parent CHECKs as P3's Migration B (Supabase
-- 20261001010021) restated them with the eighth kind, page_share, and the
-- share-slot CHECK it added — copied from
-- db/migrations/2026-09-30_photo_usages_sync.sql.
alter table public.photo_usages add constraint photo_usages_kind_known check (kind in (
    'gallery','gallery_cover','page_section','page_legacy','page_share',
    'story_cover','story_block','shop_listing'
  ));
alter table photo_usages add constraint photo_usages_scope_known check (scope in ('live','draft'));
alter table public.photo_usages add constraint photo_usages_scope_by_kind check (
    scope = 'live' or kind in ('page_section','page_legacy','page_share')
  );
-- The SQL twin of isPageKey() in lib/sections/pages.ts, notfound included. A new
-- built-in page needs a line here; .mk/photo-assets.ts fails until it has one.
alter table photo_usages add constraint photo_usages_page_key_shape check (
  page_key is null
  or page_key in ('home','about','contact','journal','galleries','shop','notfound')
  or page_key ~ '^p_[a-z0-9]{8}$'
);
alter table public.photo_usages add constraint photo_usages_one_parent check (
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
  or (kind in ('page_section','page_legacy','page_share')
        and page_key is not null and photo_id is null and album_id is null
        and post_id is null and product_id is null)
  );
alter table public.photo_usages add constraint photo_usages_share_slot check (
    kind <> 'page_share'
    or (field = 'page_seo.image' and position = 0)
  );

-- albums' chosen-cover key, tenant-aware since P3's Migration A (Supabase
-- 20261001005946), copied from db/migrations/2026-09-30_album_cover_tenant_fk.sql.
--
-- It is created HERE, after photo_usages' keys, not with albums' other keys
-- above, because that is the order production created it in — and the order
-- is observable: PostgreSQL fires foreign-key triggers in creation order, so
-- when moving a photograph to another site breaks both this key and
-- photo_usages_photo_fk, the one created first is the one that reports.
-- In production that is photo_usages_photo_fk (P1, before Migration A);
-- db/verify-photo-assets.sql asserts it, and fails if this moves back up.
alter table public.albums add constraint albums_cover_photo_fk
  foreign key (cover_photo_id, tenant_id) references public.photos (id, tenant_id)
  on delete set null (cover_photo_id);

-- P4 unit 2's two asset keys (Supabase 20261006012958), copied from
-- db/migrations/2026-10-05_photo_assets_fk.sql. NO ACTION (an asset a row still
-- points at cannot be deleted — P6 starts from that refusal) and MATCH SIMPLE (a
-- NULL asset_id is not checked: the built-in samples keep theirs NULL).
--
-- Created HERE, after every P1 and P3 key, because that is the order production
-- created them in, and the order is observable (see the cover-key note above).
--
-- Deleting a SITE: tenants cascade to site_images and photo_assets, but NOT to
-- photos or albums (photos_tenant_id_fkey and albums_tenant_id_fkey are NO
-- ACTION) — deleteSite() in app/actions/sites.ts removes those explicitly first.
-- The unit 2 migration's own header says tenants cascade to photos; that
-- sentence is wrong, the migration file is left byte-for-byte as deployed, and
-- the correction is recorded in db/schema-verified.md.
alter table public.photos add constraint photos_asset_fk
  foreign key (asset_id, tenant_id) references public.photo_assets (id, tenant_id);
alter table public.site_images add constraint site_images_asset_fk
  foreign key (asset_id, tenant_id) references public.photo_assets (id, tenant_id);
create index photos_asset_tenant on public.photos (asset_id, tenant_id) where asset_id is not null;
create index site_images_asset_tenant on public.site_images (asset_id, tenant_id) where asset_id is not null;

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
create unique index if not exists photo_usages_slot_share
  on public.photo_usages (tenant_id, scope, page_key) where kind = 'page_share';
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

-- P2's, from db/migrations/2026-09-30_photo_ingest.sql. Verified against
-- production 2026-09-30: the four wrappers to authenticated ONLY (anon and
-- service_role have none); the helper to no application role at all. The
-- Supabase security advisor flags the authenticated-executable definer
-- functions — intended; see db/schema-verified.md.
-- ── Who may call what ───────────────────────────────────────────────────────

revoke all on function public.upsert_photo_asset(
  uuid, text, text, text, jsonb, integer, integer, bigint, text, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb,
  double precision, double precision, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.register_gallery_photo(
  uuid, uuid, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb,
  double precision, double precision)
  from public, anon, authenticated, service_role;

revoke all on function public.register_site_image(
  uuid, text, text, text, jsonb, integer, integer, bigint, text, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.register_journal_image(
  uuid, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.register_album_cover(
  uuid, uuid, text, text, jsonb, integer, integer, bigint, text, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  from public, anon, authenticated, service_role;

-- The four upload routes run as the signed-in photographer, so the four
-- wrappers are theirs. Nobody gets the helper.
grant execute on function public.register_gallery_photo(
  uuid, uuid, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb,
  double precision, double precision)
  to authenticated;

grant execute on function public.register_site_image(
  uuid, text, text, text, jsonb, integer, integer, bigint, text, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  to authenticated;

grant execute on function public.register_journal_image(
  uuid, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  to authenticated;

grant execute on function public.register_album_cover(
  uuid, uuid, text, text, jsonb, integer, integer, bigint, text, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  to authenticated;

-- P3's, from db/migrations/2026-09-30_photo_usages_sync.sql. Verified against
-- production 2026-10-01: the four helpers to no application role; the three
-- service functions to service_role ONLY (authenticated and anon have none).
-- The two P2 wrappers keep P2's grants above, unchanged.
revoke all on function public.photo_usage_lock(uuid, text, text)            from public, anon, authenticated, service_role;
revoke all on function public.photo_usage_parent_key(uuid, text, text)      from public, anon, authenticated, service_role;
revoke all on function public.photo_usage_source(uuid, text, text)          from public, anon, authenticated, service_role;
revoke all on function public.photo_usage_resolve_path(uuid, text)          from public, anon, authenticated, service_role;
revoke all on function public.read_photo_usage_source(uuid, text, text)     from public, anon, authenticated, service_role;
revoke all on function public.list_photo_usage_parents(uuid)                from public, anon, authenticated, service_role;
revoke all on function public.sync_photo_usages(uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;

grant execute on function public.read_photo_usage_source(uuid, text, text)     to service_role;
grant execute on function public.list_photo_usage_parents(uuid)                to service_role;
grant execute on function public.sync_photo_usages(uuid, text, text, text, jsonb) to service_role;

-- P4 unit 1's, from db/migrations/2026-10-05_photo_backfill.sql. Verified
-- against production 2026-10-05/06: the two internal helpers and the resolver
-- to no application role; the inventory, the claims read and the writer to
-- service_role ONLY.

revoke all on function public.photo_backfill_key_base(text)                       from public, anon, authenticated, service_role;
revoke all on function public.photo_backfill_foreign_claim(uuid, text, boolean)   from public, anon, authenticated, service_role;
revoke all on function public.read_photo_backfill_inventory(uuid)                 from public, anon, authenticated, service_role;
revoke all on function public.read_photo_backfill_claims(uuid, text[])            from public, anon, authenticated, service_role;
revoke all on function public.register_legacy_photo_asset(
  uuid, text, uuid, text, text, text, text, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], text[], jsonb, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.photo_usage_resolve_path(uuid, text)                from public, anon, authenticated, service_role;

grant execute on function public.read_photo_backfill_inventory(uuid)      to service_role;
grant execute on function public.read_photo_backfill_claims(uuid, text[]) to service_role;
grant execute on function public.register_legacy_photo_asset(
  uuid, text, uuid, text, text, text, text, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], text[], jsonb, boolean)
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

-- ── A small, valid site to rehearse against ─────────────────────────────────
-- Enough rows to exercise the cascades and the tenant policies. Every NOT NULL
-- column production has is supplied here, which is itself a check: a seed that
-- fails means the fixture and production disagree about what is required.

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

insert into tenants (id, name, domain) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Site One', 'one.example'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Site Two', 'two.example');

insert into tenant_domains (tenant_id, host, is_primary) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'one.example', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'two.example', true);

insert into profiles (id, tenant_id, email, role, is_platform_admin) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner@one.example', 'owner', false),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner@two.example', 'owner', false);

insert into site_settings (tenant_id, site_title) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Site One'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Site Two');

insert into albums (id, tenant_id, title, slug, privacy_type) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Public Gallery',  'public-gallery',  'public'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Private Gallery', 'private-gallery', 'client_only'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'Other Site',      'other-site',      'public');

insert into photos (id, tenant_id, album_id, storage_path, sort_order) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 't/one/photos/a/1/2400.webp', 0),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 't/one/photos/a/2/2400.webp', 1),
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 't/one/photos/b/1/2400.webp', 0);

update albums set cover_photo_id = 'cccccccc-0000-0000-0000-000000000001'
  where id = 'bbbbbbbb-0000-0000-0000-000000000001';

insert into blog_posts (id, tenant_id, album_id, title, slug, status) values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001', 'First Light', 'first-light', 'published');

insert into clients (id, tenant_id, name, email) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'A Client', 'client@one.example');

insert into album_clients (album_id, client_id) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001');

insert into favorites (album_id, photo_id, client_id) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000001');

insert into downloads (photo_id, client_id) values
  ('cccccccc-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000001');

-- Views on both a gallery and a story. These are what made the OLD fixture
-- refuse `delete from albums`: page_views.album_id was NO ACTION there and is
-- CASCADE in production.
--
-- `tenant_id` is named here because S4 made it NOT NULL. In production the
-- equivalent 77 rows were BACKFILLED from their album or story, and the site
-- named here is the one each parent belongs to — which is the invariant
-- `db/verify-analytics.sql` asserts for every row, not just these two.
--
-- `path`, `page_key`, `referrer_host`, `session_hash` and `device` are left
-- unset on purpose: these two rows stand for the history, and production's 77
-- legacy rows carry NULL in all five. A fixture that filled them in would make
-- every test about "what a pre-S4 row looks like" pass for the wrong reason.
insert into page_views (tenant_id, album_id, visitor_hash) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'hash-one');
insert into page_views (tenant_id, post_id, visitor_hash) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'hash-two');

insert into page_sections (tenant_id, page, type, position, settings) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'home', 'hero', 0, '{}'::jsonb);

insert into site_draft (tenant_id, pages) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '{}'::jsonb);
