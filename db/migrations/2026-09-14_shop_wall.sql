-- Shop wall display settings
--
-- The shop index is now a hung wall: frames sized from the column, horizontals
-- and squares sharing a baseline, verticals centred on that baseline so they
-- rise higher and hang lower. Everything the page shows around the frames —
-- the three header lines, the caption lines, the closing quote — is editable
-- and each part can be switched off.
--
-- Safe to run more than once.

alter table site_settings
  add column if not exists shop_subheading        text,
  add column if not exists shop_columns           int     not null default 4,
  add column if not exists shop_show_collection   boolean not null default true,
  add column if not exists shop_show_location     boolean not null default true,
  add column if not exists shop_show_price        boolean not null default true,
  add column if not exists shop_wall_texture      text,
  add column if not exists shop_title_font        text,
  add column if not exists shop_quote             text,
  add column if not exists shop_quote_by          text;

-- Where a photograph was taken, shown under the title in the shop. Separate
-- from the gallery caption so the selling copy can differ from the field note.
alter table catalog_items
  add column if not exists location text;

-- Keep the column count sane if someone types into the settings field directly
alter table site_settings
  drop constraint if exists site_settings_shop_columns_check;

alter table site_settings
  add constraint site_settings_shop_columns_check
  check (shop_columns between 2 and 5);

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify. Every row below should list the column with the type in brackets.
-- If a row is missing, the ALTER above silently found an existing column of
-- that name — say so rather than carrying on.
-- ---------------------------------------------------------------------------
select table_name, column_name, data_type, column_default
from information_schema.columns
where (table_name = 'site_settings' and column_name in (
         'shop_subheading','shop_columns','shop_show_collection',
         'shop_show_location','shop_show_price','shop_wall_texture',
         'shop_title_font','shop_quote','shop_quote_by'))
   or (table_name = 'catalog_items' and column_name = 'location')
order by table_name, column_name;
