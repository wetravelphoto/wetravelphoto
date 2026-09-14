alter table site_settings
  add column if not exists shop_preset_rooms boolean not null default true;

notify pgrst, 'reload schema';

select column_name, data_type, column_default
from information_schema.columns
where table_name = 'site_settings' and column_name = 'shop_preset_rooms';
