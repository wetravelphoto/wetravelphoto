-- The product page, and room mockups
--
-- Two things here.
--
-- 1. room_scenes. A room photograph plus the four corners of the wall space
--    where art hangs, as percentages of the image. Upload a handful once and
--    every print in the shop gets mocked up in every room — nothing is stored
--    per product, and nothing is baked, so changing the frame or replacing a
--    photograph updates every mockup at once.
--
-- 2. The rest of the words on the product page: the corner line, three
--    reassurance blurbs, the related heading and the footer band. Reviews
--    come later, but no copy is hard-coded in the meantime.
--
-- Safe to run more than once.

-- ── Room scenes ─────────────────────────────────────────────────────────────

create table if not exists room_scenes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid,
  name        text        not null default 'Room',
  image_path  text        not null,
  width       int,
  height      int,
  -- Four corners, clockwise from top-left, each [x, y] as a percentage of the
  -- image. A quad rather than a box, so a wall shot at an angle still works.
  corners     jsonb       not null default '[[32,20],[68,20],[68,64],[32,64]]'::jsonb,
  is_active   boolean     not null default true,
  sort_order  int         not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists room_scenes_order_idx on room_scenes (sort_order);

alter table room_scenes enable row level security;

drop policy if exists "room_scenes public read" on room_scenes;
create policy "room_scenes public read"
  on room_scenes for select
  using (is_active = true);

drop policy if exists "room_scenes admin read" on room_scenes;
create policy "room_scenes admin read"
  on room_scenes for select
  to authenticated
  using (true);

drop policy if exists "room_scenes admin write" on room_scenes;
create policy "room_scenes admin write"
  on room_scenes for all
  to authenticated
  using (true)
  with check (true);

-- ── The words on the product page ───────────────────────────────────────────

alter table site_settings
  add column if not exists shop_corner_line      text,
  add column if not exists shop_show_breadcrumbs boolean not null default true,
  add column if not exists shop_feature1_icon    text,
  add column if not exists shop_feature1_title   text,
  add column if not exists shop_feature1_body    text,
  add column if not exists shop_feature2_icon    text,
  add column if not exists shop_feature2_title   text,
  add column if not exists shop_feature2_body    text,
  add column if not exists shop_feature3_icon    text,
  add column if not exists shop_feature3_title   text,
  add column if not exists shop_feature3_body    text,
  add column if not exists shop_related_overline text,
  add column if not exists shop_related_heading  text,
  add column if not exists shop_footer_left      text,
  add column if not exists shop_footer_right     text;

-- Three across reads better than four: the frames come out larger.
alter table site_settings alter column shop_columns set default 3;
update site_settings set shop_columns = 3 where shop_columns = 4;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify. Expect one room_scenes row listing its columns, then fifteen
-- site_settings rows. A missing row means the ALTER found a column of that
-- name already there — say so rather than carrying on.
-- ---------------------------------------------------------------------------
select 'room_scenes' as what, count(*)::text as detail
from information_schema.columns where table_name = 'room_scenes'
union all
select column_name, data_type
from information_schema.columns
where table_name = 'site_settings'
  and column_name in (
    'shop_corner_line','shop_show_breadcrumbs',
    'shop_feature1_icon','shop_feature1_title','shop_feature1_body',
    'shop_feature2_icon','shop_feature2_title','shop_feature2_body',
    'shop_feature3_icon','shop_feature3_title','shop_feature3_body',
    'shop_related_overline','shop_related_heading',
    'shop_footer_left','shop_footer_right')
order by 1;
