alter table site_settings
  add column if not exists shop_room text not null default 'living-room';

notify pgrst, 'reload schema';

select column_name, data_type, column_default
from information_schema.columns
where table_name = 'site_settings' and column_name = 'shop_room';
