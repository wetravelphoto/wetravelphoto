-- A stand-in for the live database, built from what db/survey.sql reported on
-- 2026-09-15: the same tables, the same tenant columns, the same policies, and
-- a fake auth.uid() shaped like Supabase's.
--
-- It exists so a migration can be run for real before it is run for real:
--
--   createdb wtp
--   psql -d wtp -f db/test-fixture.sql
--   psql -d wtp -f db/migrations/<the new one>.sql
--   psql -d wtp -f db/verify-tenant-isolation.sql
--
-- This is not the app and nothing imports it. It is a rehearsal room. Keep it
-- roughly in step with the real schema — re-run db/survey.sql and compare when
-- something here starts disagreeing with production.
--
-- It paid for itself the day it was written, catching two things that would
-- otherwise have been found in the live database: a function defined before the
-- column it reads, and an infinite recursion between the albums and
-- album_clients policies that would have taken down every gallery page.

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;

create schema if not exists auth;

-- Same shape as Supabase's.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create extension if not exists pgcrypto;

-- ── Tables, as the survey found them ────────────────────────────────────────

create table tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  domain     text not null,
  created_at timestamptz not null default now()
);

create function default_tenant_id() returns uuid
language sql stable as $$ select id from tenants limit 1 $$;   -- the buggy original

create table profiles (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  display_name text,
  role         text not null default 'editor',
  tenant_id    uuid not null default default_tenant_id() references tenants(id),
  created_at   timestamptz not null default now()
);

create table albums (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  slug         text not null,
  privacy_type text not null default 'private',
  password_hash text,
  allow_downloads boolean default false,
  display_order int default 0,
  created_by   uuid references profiles(id),
  tenant_id    uuid not null default default_tenant_id() references tenants(id),
  created_at   timestamptz not null default now()
);

create table photos (
  id         uuid primary key default gen_random_uuid(),
  album_id   uuid references albums(id),
  is_for_sale boolean not null default false,
  caption    text,
  tenant_id  uuid not null default default_tenant_id() references tenants(id),
  created_at timestamptz not null default now()
);

create table blog_posts (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null,
  status     text not null default 'draft',
  album_id   uuid references albums(id),
  author_id  uuid references profiles(id),
  tenant_id  uuid not null default default_tenant_id() references tenants(id),
  created_at timestamptz not null default now()
);

create table clients (
  id           uuid primary key default gen_random_uuid(),
  name         text,
  email        text,
  access_token text,
  tenant_id    uuid not null default default_tenant_id() references tenants(id)
);

create table album_clients (
  id        uuid primary key default gen_random_uuid(),
  album_id  uuid references albums(id),
  client_id uuid references clients(id)
);

create table favorites (
  id        uuid primary key default gen_random_uuid(),
  album_id  uuid references albums(id),
  client_id uuid references clients(id),
  photo_id  uuid references photos(id)
);

create table downloads (
  id        uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  photo_id  uuid references photos(id)
);

create table page_views (
  id       uuid primary key default gen_random_uuid(),
  album_id uuid references albums(id),
  post_id  uuid references blog_posts(id)
);

create table contact_messages (
  id        uuid primary key default gen_random_uuid(),
  body      text,
  tenant_id uuid not null default default_tenant_id()
);

create table newsletter_signups (
  id        uuid primary key default gen_random_uuid(),
  email     text,
  tenant_id uuid not null default default_tenant_id()
);

create table instagram_media (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default default_tenant_id()
);

create table shop_categories (
  id        uuid primary key default gen_random_uuid(),
  slug      text,
  tenant_id uuid not null default default_tenant_id()
);

create table photo_shop_categories (
  photo_id    uuid references photos(id),
  category_id uuid references shop_categories(id),
  primary key (photo_id, category_id)
);

create table print_options (
  id         uuid primary key default gen_random_uuid(),
  is_active  boolean not null default true,
  sort_order int not null default 0,
  tenant_id  uuid not null default default_tenant_id()
);

create table products (
  id              uuid primary key default gen_random_uuid(),
  photo_id        uuid references photos(id),
  print_option_id uuid references print_options(id),
  is_active       boolean not null default true,
  tenant_id       uuid not null default default_tenant_id()
);

create table catalog_items (
  id           uuid primary key default gen_random_uuid(),
  photo_id     uuid references photos(id) unique,
  is_published boolean not null default true,
  tenant_id    uuid not null default default_tenant_id()
);

create table orders (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references clients(id),
  tenant_id  uuid not null default default_tenant_id(),
  created_at timestamptz not null default now()
);

create table order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references orders(id),
  photo_id   uuid references photos(id),
  product_id uuid references products(id),
  tenant_id  uuid not null default default_tenant_id()
);

create table room_scenes (
  id        uuid primary key default gen_random_uuid(),
  is_active boolean not null default true,
  tenant_id uuid                                        -- nullable, no default
);

-- NOTE, 2026-09-23. This fixture is written by hand from what production is
-- believed to look like, and on 2026-09-23 that belief was wrong: the real
-- site_settings still carried `constraint single_row check (id = 1)` from the
-- single-site era, which this file had never mentioned. Every local test of
-- the create-a-site screen therefore passed, and the first real attempt failed
-- against the live database. The constraint is gone now
-- (db/migrations/2026-09-23_site_settings_per_site.sql) and the shape below
-- matches production again — id defaulted from a sequence, one row per site
-- enforced by the unique index on tenant_id.
--
-- The lesson worth keeping: a fixture proves the code agrees with THIS FILE.
-- When something fails only in production, suspect the file first.
create sequence site_settings_id_seq;

create table site_settings (
  id            int primary key default nextval('site_settings_id_seq'),
  site_title    text not null default 'WeTravelPhoto',
  hero_album_id uuid references albums(id),
  type_styles   jsonb not null default '{}'::jsonb,
  hero_mode     text default 'stories',
  show_intro    boolean default true,
  intro_image_side text default 'left',
  show_galleries boolean default true,
  show_journal  boolean default true,
  journal_count int default 3,
  show_instagram boolean default false,
  show_contact_section boolean default true,
  contact_image_side text default 'left',
  hero_title_position text default 'center',
  hero_story_align text default 'left',
  hero_show_mark boolean default true
);

-- ── RLS exactly as it is today ──────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'albums','blog_posts','catalog_items','clients','contact_messages','downloads',
    'favorites','instagram_media','newsletter_signups','order_items','orders',
    'page_views','photo_shop_categories','photos','print_options','products',
    'profiles','room_scenes','shop_categories','site_settings','tenants','album_clients'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to anon, authenticated', t);
  end loop;
end $$;

grant usage on schema public, auth to anon, authenticated;

-- Supabase sets default privileges on the public schema, so a table created by
-- a later migration is reachable by anon and authenticated without the
-- migration saying so — which is why none of the migrations grant anything.
-- Without this line the rehearsal room is stricter than production and a
-- migration that is perfectly fine fails here with "permission denied",
-- sending you off to add grants the real database does not need. Found while
-- rehearsing the site_draft migration.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

-- the copy-pasted owner check, twenty-two times over
create policy "Owners and editors manage album shares" on album_clients for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone can read album shares" on album_clients for select using (true);

create policy "Owners and editors manage albums" on albums for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Public can view public albums" on albums for select using (privacy_type = 'public');
create policy "Shared albums are readable" on albums for select
  using (exists (select 1 from album_clients ac where ac.album_id = albums.id));

create policy "Owners and editors manage blog posts" on blog_posts for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Public can view published blog posts" on blog_posts for select using (status = 'published');

create policy "Owners manage catalog items" on catalog_items for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone reads published catalog items" on catalog_items for select using (is_published);

create policy "Owners and editors manage clients" on clients for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone with a token can read their client record" on clients for select using (true);

create policy "Owners read messages" on contact_messages for select
  using (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Owners update messages" on contact_messages for update
  using (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone can send a message" on contact_messages for insert with check (true);

create policy "Owners and editors view downloads" on downloads for select
  using (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Downloads can be logged" on downloads for insert with check (true);

create policy "Owners and editors view favorites" on favorites for select
  using (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Clients can manage their own favorites" on favorites for all using (true) with check (true);

create policy "Owners manage instagram media" on instagram_media for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone can read instagram media" on instagram_media for select using (true);

create policy "Owners read signups" on newsletter_signups for select
  using (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone can sign up" on newsletter_signups for insert with check (true);

create policy "Owners read order items" on order_items for select
  using (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Owners update order items" on order_items for update
  using (exists (select 1 from profiles p where p.id = auth.uid()));

create policy "Owners read orders" on orders for select
  using (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Owners update orders" on orders for update
  using (exists (select 1 from profiles p where p.id = auth.uid()));

create policy "Owners can read views" on page_views for select
  using (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone can record a view" on page_views for insert with check (true);

create policy "Owners manage photo categories" on photo_shop_categories for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone reads photo categories" on photo_shop_categories for select using (true);

create policy "Owners and editors manage photos" on photos for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Public can view photos in public albums" on photos for select
  using (exists (select 1 from albums a where a.id = photos.album_id and a.privacy_type = 'public'));
create policy "Photos in shared albums are readable" on photos for select
  using (exists (select 1 from album_clients ac where ac.album_id = photos.album_id));

create policy "Owners manage print options" on print_options for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone reads print options" on print_options for select using (is_active);

create policy "Owners manage products" on products for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone reads active products" on products for select using (is_active);

create policy "Users can view their own profile" on profiles for select using (id = auth.uid());

create policy "room_scenes admin read"  on room_scenes for select using (true);
create policy "room_scenes admin write" on room_scenes for all using (true) with check (true);
create policy "room_scenes public read" on room_scenes for select using (is_active = true);

create policy "Owners manage shop categories" on shop_categories for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone reads shop categories" on shop_categories for select using (true);

create policy "Owners update site settings" on site_settings for all
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));
create policy "Anyone reads site settings" on site_settings for select using (true);

create policy "Public can read tenant info" on tenants for select using (true);

-- ── Some data ───────────────────────────────────────────────────────────────

insert into tenants (name, domain) values ('WeTravelPhoto', 'wetravelphoto.com');

insert into profiles (email, role) values ('gmata007@gmail.com', 'editor');

insert into albums (title, slug, privacy_type) values
  ('Quiet Places', 'quiet-places', 'public'),
  ('Client shoot',  'client-shoot',  'private'),
  ('Baja 2025',     'baja-2025',     'private');

insert into photos (album_id) select id from albums;
insert into blog_posts (slug, status) values ('first-light', 'published');
insert into page_views (post_id) select id from blog_posts;
insert into page_views (album_id) select id from albums limit 1;
insert into clients (name, email, access_token)
  values ('A Client', 'client@example.com', 'abc123def456');

-- a real share, so "can an outsider read this?" has something to answer about
insert into album_clients (album_id, client_id)
select a.id, c.id from albums a, clients c where a.slug = 'client-shoot';

insert into favorites (album_id, client_id, photo_id)
select ac.album_id, ac.client_id, p.id
  from album_clients ac join photos p on p.album_id = ac.album_id;
insert into room_scenes (is_active) values (true), (true);   -- null tenant_id on purpose
insert into site_settings (id) values (1);
select setval('site_settings_id_seq', 1);
