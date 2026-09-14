-- 2026-09-14 — shop schema
--
-- Print sales, manual fulfilment, no payment provider yet. Stripe slots in
-- later at the checkout seam; the order records this creates are the real
-- thing either way.
--
-- Shape:
--   print_options    the tenant's own size/price list, defined once
--   shop_categories  browse categories for /shop (Wildlife, Landscape, …)
--   products         one row per photo × option — the photo is the product,
--                    the rows are its buyable options
--   orders           one per checkout, with the shipping address needed to
--                    actually post a print
--
-- Money is integer cents throughout. Never floats.

begin;

-- ── Print options: the per-tenant price list ─────────────────────────────────
-- Every photographer picks their own sizes and prices. Marking a photo for
-- sale generates its product rows from this list, so prices live in one place
-- rather than being typed per photo.

create table if not exists print_options (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default default_tenant_id(),
  label       text not null,                      -- '16 × 24"'
  kind        text not null default 'print',      -- print | framed | canvas
  price_cents int  not null,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists print_options_tenant_idx
  on print_options (tenant_id, sort_order);


-- ── Shop categories ──────────────────────────────────────────────────────────
-- Many-to-many: a photo can be both Wildlife and Travel. Deliberately separate
-- from photos.tags, which holds raw Lightroom keywords — those are too
-- inconsistent to drive navigation, but stay available for search later.

create table if not exists shop_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default default_tenant_id(),
  name       text not null,
  slug       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists shop_categories_tenant_slug_idx
  on shop_categories (tenant_id, slug);

create table if not exists photo_shop_categories (
  photo_id    uuid not null references photos(id)          on delete cascade,
  category_id uuid not null references shop_categories(id) on delete cascade,
  primary key (photo_id, category_id)
);

create index if not exists photo_shop_categories_category_idx
  on photo_shop_categories (category_id);


-- ── Products ─────────────────────────────────────────────────────────────────
-- The table already exists (id, photo_id, type, size_label, price_cents,
-- fulfillment_sku). price_cents and size_label are copied from the print
-- option at generation time so changing the price list doesn't silently
-- rewrite what a photo is currently listed at.

alter table products
  add column if not exists is_active       boolean not null default true,
  add column if not exists sort_order      int     not null default 0,
  add column if not exists print_option_id uuid references print_options(id) on delete set null;

create index if not exists products_photo_idx on products (photo_id) where is_active;
create index if not exists photos_for_sale_idx on photos (is_for_sale) where is_for_sale;


-- ── Orders ───────────────────────────────────────────────────────────────────
-- Shipping address included because fulfilment is manual — you need somewhere
-- to post the print to.
--
-- status: pending_payment → paid → shipped → cancelled
-- Left unconstrained for now; a check constraint goes in once the payment
-- step exists and the set is settled.

alter table orders
  add column if not exists order_number         text,
  add column if not exists customer_name        text,
  add column if not exists customer_phone       text,
  add column if not exists shipping_line1       text,
  add column if not exists shipping_line2       text,
  add column if not exists shipping_city        text,
  add column if not exists shipping_state       text,
  add column if not exists shipping_postal_code text,
  add column if not exists shipping_country     text not null default 'US',
  add column if not exists customer_note        text,
  add column if not exists subtotal_cents       int  not null default 0,
  add column if not exists shipping_cents       int  not null default 0,
  add column if not exists total_cents          int  not null default 0,
  add column if not exists currency             text not null default 'usd',
  add column if not exists updated_at           timestamptz not null default now();

-- Human-readable reference for emails and packing slips.
-- Global rather than per-tenant for now; revisit when tenants go live.
create sequence if not exists order_number_seq start 1001;

alter table orders
  alter column order_number set default ('WTP-' || nextval('order_number_seq'));

alter table orders
  alter column status set default 'pending_payment';

create index if not exists orders_tenant_created_idx on orders (tenant_id, created_at desc);
create unique index if not exists orders_order_number_idx on orders (order_number);


-- ── Order items ──────────────────────────────────────────────────────────────
-- Title and option label are denormalised on purpose: an order must still
-- read correctly years later, after the photo is renamed or the size retired.

alter table order_items
  add column if not exists tenant_id    uuid not null default default_tenant_id(),
  add column if not exists photo_id     uuid references photos(id) on delete set null,
  add column if not exists title        text,
  add column if not exists option_label text,
  add column if not exists image_path   text;

create index if not exists order_items_order_idx on order_items (order_id);


-- ── Site settings ────────────────────────────────────────────────────────────

alter table site_settings
  add column if not exists show_shop                 boolean not null default false,
  add column if not exists shop_mode                 text    not null default 'curated',  -- curated | all
  add column if not exists shop_eyebrow              text,
  add column if not exists shop_heading              text,
  add column if not exists shop_intro                text,
  add column if not exists nav_shop_label            text,
  add column if not exists shop_currency             text    not null default 'usd',
  add column if not exists shop_shipping_flat_cents  int     not null default 1200,
  add column if not exists shop_order_note           text;


-- ── Seeds ────────────────────────────────────────────────────────────────────
-- Starting points only — both are editable in the admin. Guarded so re-running
-- doesn't duplicate them.

insert into print_options (label, kind, price_cents, sort_order)
select * from (values
  ('8 × 12"',  'print', 6500,  1),
  ('12 × 18"', 'print', 11500, 2),
  ('16 × 24"', 'print', 19500, 3),
  ('24 × 36"', 'print', 32500, 4)
) as seed(label, kind, price_cents, sort_order)
where not exists (select 1 from print_options);

insert into shop_categories (name, slug, sort_order)
select * from (values
  ('Wildlife',  'wildlife',  1),
  ('Landscape', 'landscape', 2),
  ('Travel',    'travel',    3)
) as seed(name, slug, sort_order)
where not exists (select 1 from shop_categories);


-- ── Row level security ───────────────────────────────────────────────────────
--
-- products, orders and order_items already had RLS enabled with no policies
-- at all, which is deny-all: every read returns empty and every write fails,
-- with no error that points at the cause. That's fixed here.
--
-- These follow the existing house pattern — role `public` with a USING
-- expression, rather than `to authenticated` — so the shop tables read the
-- same way as the rest of the schema.
--
-- NOTE on the owner check. The existing policies use
--     exists (select 1 from profiles p where p.id = auth.uid())
-- which only asserts that the caller has a profile row. It ignores
-- profiles.role and, more importantly, profiles.tenant_id. Once a second
-- photographer has a login, that lets either of them read and write the
-- other's data. Matched here for consistency; must be fixed across every
-- table before beta accounts exist.

alter table print_options         enable row level security;
alter table shop_categories       enable row level security;
alter table photo_shop_categories enable row level security;

-- Catalogue: world-readable, owner-writable.

drop policy if exists "Anyone reads print options" on print_options;
create policy "Anyone reads print options" on print_options
  for select using (is_active);

drop policy if exists "Owners manage print options" on print_options;
create policy "Owners manage print options" on print_options
  for all
  using      (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));

drop policy if exists "Anyone reads shop categories" on shop_categories;
create policy "Anyone reads shop categories" on shop_categories
  for select using (true);

drop policy if exists "Owners manage shop categories" on shop_categories;
create policy "Owners manage shop categories" on shop_categories
  for all
  using      (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));

drop policy if exists "Anyone reads photo categories" on photo_shop_categories;
create policy "Anyone reads photo categories" on photo_shop_categories
  for select using (true);

drop policy if exists "Owners manage photo categories" on photo_shop_categories;
create policy "Owners manage photo categories" on photo_shop_categories
  for all
  using      (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));

-- Products: only active listings are public. The owner policy is ALL, and
-- policies are OR'd, so the admin still sees inactive rows.

drop policy if exists "Anyone reads active products" on products;
create policy "Anyone reads active products" on products
  for select using (is_active);

drop policy if exists "Owners manage products" on products;
create policy "Owners manage products" on products
  for all
  using      (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));

-- Orders: owner-only, both directions.
--
-- Deliberately NO public INSERT, unlike contact_messages. An order carries a
-- total, and a policy that lets anonymous callers insert rows lets them insert
-- their own totals straight into PostgREST, bypassing the app. Checkout writes
-- orders through a service-role client on the server instead, which bypasses
-- RLS entirely. That needs SUPABASE_SERVICE_ROLE_KEY in .env.local and in
-- Vercel — server-side only, never a NEXT_PUBLIC_ variable.

drop policy if exists "Owners read orders" on orders;
create policy "Owners read orders" on orders
  for select using (exists (select 1 from profiles p where p.id = auth.uid()));

drop policy if exists "Owners update orders" on orders;
create policy "Owners update orders" on orders
  for update using (exists (select 1 from profiles p where p.id = auth.uid()));

drop policy if exists "Owners read order items" on order_items;
create policy "Owners read order items" on order_items
  for select using (exists (select 1 from profiles p where p.id = auth.uid()));

drop policy if exists "Owners update order items" on order_items;
create policy "Owners update order items" on order_items
  for update using (exists (select 1 from profiles p where p.id = auth.uid()));

commit;


-- ── Verify ───────────────────────────────────────────────────────────────────
--
--   select 'print_options' as t, count(*) from print_options
--   union all select 'shop_categories', count(*) from shop_categories
--   union all select 'photo_shop_categories', count(*) from photo_shop_categories;
--
-- Expect 4 print options, 3 categories, 0 joins.
--
-- Then reload PostgREST's schema cache or the new columns will read as missing:
--
--   notify pgrst, 'reload schema';
