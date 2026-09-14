-- 2026-09-14 — shop catalogue
--
-- Adds the step between "marked for sale in a gallery" and "on the shop page".
-- Marking a photograph for sale creates its catalogue entry; the entry is where
-- its selling title, description, tags and sizes live.
--
-- Deliberately separate from the photograph itself. photos.caption is the
-- caption shown under the image in a gallery, which is rarely the right title
-- for a print — and an entry needs its own lifecycle: you can unpublish a print
-- without unmarking the photograph, and delete an entry without touching the
-- photo.

begin;

create table if not exists catalog_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default default_tenant_id(),
  photo_id     uuid not null unique references photos(id) on delete cascade,
  title        text,
  description  text,
  -- Curated selling tags. Kept apart from photos.tags, which holds raw
  -- Lightroom keywords — those are too inconsistent to show a customer.
  tags         text[] not null default '{}',
  is_published boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists catalog_items_tenant_sort_idx
  on catalog_items (tenant_id, sort_order);

create index if not exists catalog_items_published_idx
  on catalog_items (is_published) where is_published;


-- ── Frames ───────────────────────────────────────────────────────────────────
-- A mockup frame per orientation, because a portrait photograph in a landscape
-- frame looks wrong. Each entry carries the path to the frame image plus the
-- mat opening measured as percentages of that image, so a tenant can upload
-- their own frame and tell the site where the picture sits inside it.
--
--   { "landscape": { "path": "...", "top": 18.42, "left": 17.33,
--                    "width": 65.33, "height": 59.02 },
--     "portrait":  { ... }, "square": { ... } }
--
-- Seeded with the bundled landscape frame; portrait and square fall back to it
-- until their own are uploaded.

alter table site_settings
  add column if not exists shop_frames jsonb not null default '{}'::jsonb;

update site_settings
   set shop_frames = jsonb_build_object(
         'landscape', jsonb_build_object(
           'path',   '/frames/frame-landscape.webp',
           'top',    18.42,
           'left',   17.33,
           'width',  65.33,
           'height', 59.02
         )
       )
 where id = 1
   and (shop_frames is null or shop_frames = '{}'::jsonb);


-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Anything already marked for sale gets an entry, titled from its caption.

insert into catalog_items (photo_id, title)
select p.id, nullif(p.caption, '')
  from photos p
 where p.is_for_sale
   and not exists (select 1 from catalog_items c where c.photo_id = p.id);


-- ── Row level security ───────────────────────────────────────────────────────
-- Same shape as the rest of the schema: world-readable when published,
-- owner-writable. (See the note in the shop migration about the owner check
-- ignoring tenant_id — that still needs fixing everywhere before beta logins.)

alter table catalog_items enable row level security;

drop policy if exists "Anyone reads published catalog items" on catalog_items;
create policy "Anyone reads published catalog items" on catalog_items
  for select using (is_published);

drop policy if exists "Owners manage catalog items" on catalog_items;
create policy "Owners manage catalog items" on catalog_items
  for all
  using      (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));

commit;


-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect one row per for-sale photograph, and a populated landscape frame.
--
--   select (select count(*) from catalog_items)                as catalog_entries,
--          (select count(*) from photos where is_for_sale)     as photos_for_sale,
--          (select shop_frames from site_settings where id = 1) as frames;
--
-- Then reload PostgREST or the new columns read as missing:
--
--   notify pgrst, 'reload schema';
