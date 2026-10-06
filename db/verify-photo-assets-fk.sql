-- Proof of P4 unit 2 — db/migrations/2026-10-05_photo_assets_fk.sql: photos
-- and site_images point at a real asset of their OWN site, and nothing else
-- about either table changed.
--
-- Needs a database where unit 2 has applied. Unit 2 is DEPLOYED (Supabase
-- 20261006012958) and the reconciled db/test-fixture.sql carries its keys, so
-- the fixture alone is enough:
--
--   node scripts/p4-local-db.mjs sql db/verify-photo-assets-fk.sql
--
-- scripts/photo-assets-fk.mjs runs it twice more: after rebuilding the
-- pre-P4 stage, proving the preflight and applying the migration twice; and
-- after rolling the migration back, to watch it fail.
--
-- One transaction that ALWAYS ends by raising; nothing is kept. Referential
-- checks run as the TABLE OWNER (bypasses RLS, holds every privilege): when a
-- write is refused, the key did it, and the assertion names it. One check
-- repeats a refusal as a signed-in photographer.

begin;

create temp table fk_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

create function pg_temp.ok(p_step text, p_expected text, p_actual text)
returns void language sql as $$
  insert into fk_res (step, expected, actual, pass)
  values (p_step, p_expected, coalesce(p_actual, '(null)'), p_expected = coalesce(p_actual, '(null)'));
$$;

-- Runs a statement; 'accepted' or '<SQLSTATE> <constraint>'.
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare st text; con text;
begin
  execute p_sql;
  return 'accepted';
exception when others then
  get stacked diagnostics st = returned_sqlstate, con = constraint_name;
  return trim(st || ' ' || coalesce(con, ''));
end $$;

do $$ begin
  perform set_config('fk.owner', session_user, true);
  update public.profiles set is_platform_admin = false;
end $$;

-- An asset on each site, and a linked photograph and Uploads row on site A.
do $$
declare
  ta uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  tb uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  ka text := 't/aaaaaaaa-0000-0000-0000-000000000001/site-images/0f000000-0000-4000-8000-000000000001';
  kb text := 't/aaaaaaaa-0000-0000-0000-000000000002/site-images/0f000000-0000-4000-8000-000000000002';
  kc text := 't/aaaaaaaa-0000-0000-0000-000000000001/site-images/0f000000-0000-4000-8000-000000000003';
begin
  insert into public.photo_assets (id, tenant_id, key_base, display_path, derivatives, state) values
    ('0f000000-0000-4000-8000-0000000000a1', ta, ka, ka || '/400.webp', jsonb_build_object('400', ka || '/400.webp'), 'derived'),
    ('0f000000-0000-4000-8000-0000000000b1', tb, kb, kb || '/400.webp', jsonb_build_object('400', kb || '/400.webp'), 'derived'),
    ('0f000000-0000-4000-8000-0000000000a3', ta, kc, kc || '/400.webp', jsonb_build_object('400', kc || '/400.webp'), 'derived');
  insert into public.photos (id, tenant_id, album_id, storage_path, sort_order, asset_id)
  values ('cccccccc-0000-0000-0000-0000000000f1', ta, 'bbbbbbbb-0000-0000-0000-000000000001', ka || '/400.webp', 50,
          '0f000000-0000-4000-8000-0000000000a1');
  insert into public.site_images (id, tenant_id, storage_path, asset_id)
  values ('eeeeeeee-0000-0000-0000-0000000000f1', ta, kc || '/400.webp', '0f000000-0000-4000-8000-0000000000a3');
end $$;


-- ── 1. The constraints and indexes, from the catalogue ──────────────────────

do $$
begin
  perform pg_temp.ok('photos_asset_fk is tenant-aware, NO ACTION',
    'FOREIGN KEY (asset_id, tenant_id) REFERENCES photo_assets(id, tenant_id)',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'photos_asset_fk'));
  perform pg_temp.ok('site_images_asset_fk is tenant-aware, NO ACTION',
    'FOREIGN KEY (asset_id, tenant_id) REFERENCES photo_assets(id, tenant_id)',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'site_images_asset_fk'));
  perform pg_temp.ok('both target photo_assets_id_tenant', 'photo_assets_id_tenant,photo_assets_id_tenant',
    (select string_agg(c2.conname::text, ',' order by c.conname) from pg_constraint c
       join pg_constraint c2 on c2.conindid = c.conindid and c2.contype = 'u'
      where c.conname in ('photos_asset_fk', 'site_images_asset_fk')));
  perform pg_temp.ok('each is the only foreign key on its asset_id', '1|1',
    (select count(*) from pg_constraint where conrelid = 'public.photos'::regclass and contype = 'f'
        and conkey @> array[(select attnum from pg_attribute where attrelid = 'public.photos'::regclass and attname = 'asset_id')])
    || '|' ||
    (select count(*) from pg_constraint where conrelid = 'public.site_images'::regclass and contype = 'f'
        and conkey @> array[(select attnum from pg_attribute where attrelid = 'public.site_images'::regclass and attname = 'asset_id')]));
  perform pg_temp.ok('both are validated', 'true|true',
    (select string_agg(convalidated::text, '|' order by conname) from pg_constraint
      where conname in ('photos_asset_fk', 'site_images_asset_fk')));
  perform pg_temp.ok('the supporting indexes',
    'CREATE INDEX photos_asset_tenant ON public.photos USING btree (asset_id, tenant_id) WHERE (asset_id IS NOT NULL)|' ||
    'CREATE INDEX site_images_asset_tenant ON public.site_images USING btree (asset_id, tenant_id) WHERE (asset_id IS NOT NULL)',
    (select string_agg(indexdef, '|' order by indexname) from pg_indexes
      where indexname in ('photos_asset_tenant', 'site_images_asset_tenant')));
  perform pg_temp.ok('asset_id is still nullable on both (samples keep NULL)', 'false|false',
    (select string_agg(attnotnull::text, '|' order by attrelid::regclass::text) from pg_attribute
      where attname = 'asset_id' and attrelid in ('public.photos'::regclass, 'public.site_images'::regclass)));
end $$;


-- ── 2. What the keys refuse, and what they allow ────────────────────────────

do $$
begin
  perform pg_temp.ok('a photograph pointing at ANOTHER site''s asset is refused', '23503 photos_asset_fk',
    pg_temp.try($q$update public.photos set asset_id = '0f000000-0000-4000-8000-0000000000b1'
                   where id = 'cccccccc-0000-0000-0000-0000000000f1'$q$));
  perform pg_temp.ok('an Uploads row pointing at ANOTHER site''s asset is refused', '23503 site_images_asset_fk',
    pg_temp.try($q$update public.site_images set asset_id = '0f000000-0000-4000-8000-0000000000b1'
                   where id = 'eeeeeeee-0000-0000-0000-0000000000f1'$q$));
  perform pg_temp.ok('a photograph pointing at NO asset is refused', '23503 photos_asset_fk',
    pg_temp.try($q$update public.photos set asset_id = '0f000000-0000-4000-8000-00000000dead'
                   where id = 'cccccccc-0000-0000-0000-0000000000f1'$q$));
  perform pg_temp.ok('moving a linked photograph to another site is refused', '23503 photos_asset_fk',
    pg_temp.try($q$update public.photos set tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002',
                          album_id = 'bbbbbbbb-0000-0000-0000-000000000003'
                   where id = 'cccccccc-0000-0000-0000-0000000000f1'$q$));
  perform pg_temp.ok('moving an asset a photograph points at to another site is refused', '23503 photos_asset_fk',
    pg_temp.try($q$update public.photo_assets set tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002'
                   where id = '0f000000-0000-4000-8000-0000000000a1'$q$));
  perform pg_temp.ok('deleting an asset a photograph points at is refused (P6 starts here)', '23503 photos_asset_fk',
    pg_temp.try($q$delete from public.photo_assets where id = '0f000000-0000-4000-8000-0000000000a1'$q$));
  perform pg_temp.ok('deleting an asset an Uploads row points at is refused', '23503 site_images_asset_fk',
    pg_temp.try($q$delete from public.photo_assets where id = '0f000000-0000-4000-8000-0000000000a3'$q$));
  perform pg_temp.ok('a sample photograph with NO asset is accepted', 'accepted',
    pg_temp.try($q$insert into public.photos (tenant_id, album_id, storage_path, sort_order)
                   values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
                           '/samples/wildlife/zebra.webp', 60)$q$));
  perform pg_temp.ok('deleting a linked photograph is accepted, and leaves its asset', 'accepted|1',
    pg_temp.try($q$delete from public.photos where id = 'cccccccc-0000-0000-0000-0000000000f1'$q$)
    || '|' || (select count(*) from public.photo_assets where id = '0f000000-0000-4000-8000-0000000000a1'));
end $$;

-- As the photographer of site A: RLS lets them update their own Uploads row;
-- the key still refuses another site's asset.
do $$
declare r text;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  perform set_config('role', 'authenticated', true);
  r := pg_temp.try($q$update public.site_images set asset_id = '0f000000-0000-4000-8000-0000000000b1'
                      where id = 'eeeeeeee-0000-0000-0000-0000000000f1'$q$);
  perform set_config('role', current_setting('fk.owner'), true);
  perform pg_temp.ok('as the site''s own photographer, a foreign asset is refused by the key', '23503 site_images_asset_fk', r);
end $$;


-- ── 3. P2's upload still works with the key in place ────────────────────────

do $$
declare
  r text;
  base text := 't/aaaaaaaa-0000-0000-0000-000000000001/photos/bbbbbbbb-0000-0000-0000-000000000001/0f000000-0000-4000-8000-000000000009';
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  perform set_config('role', 'authenticated', true);
  r := pg_temp.try(format($q$select * from public.register_gallery_photo(
         'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', %1$L,
         %1$L || '/original.jpg', %1$L || '/400.webp', jsonb_build_object('400', %1$L || '/400.webp'),
         400, 300, 1024, repeat('ab', 32), 'image/jpeg',
         null, null, null, null, null, null, null, null, null, '{}'::jsonb, null, null)$q$, base));
  perform set_config('role', current_setting('fk.owner'), true);
  perform pg_temp.ok('register_gallery_photo (P2) still succeeds', 'accepted', r);
  perform pg_temp.ok('…and its row points at its asset', 'true',
    (select (p.asset_id = a.id)::text from public.photos p join public.photo_assets a on a.key_base = base
      where p.storage_path = base || '/400.webp'));
end $$;


-- ── 4. Deleting a site, in deleteSite's order ───────────────────────────────

do $$
declare
  tc uuid := 'aaaaaaaa-0000-0000-0000-0000000000c2';
  kc text := 't/aaaaaaaa-0000-0000-0000-0000000000c2/site-images/0f000000-0000-4000-8000-0000000000c2';
begin
  insert into public.tenants (id, name, domain) values (tc, 'Throwaway', 'c2.example');
  insert into public.albums (id, tenant_id, title, slug, privacy_type)
  values ('bbbbbbbb-0000-0000-0000-0000000000c2', tc, 'C', 'c', 'public');
  insert into public.photo_assets (id, tenant_id, key_base, display_path, derivatives, state)
  values ('0f000000-0000-4000-8000-0000000000c2', tc, kc, kc || '/400.webp', jsonb_build_object('400', kc || '/400.webp'), 'derived');
  insert into public.photos (tenant_id, album_id, storage_path, sort_order, asset_id)
  values (tc, 'bbbbbbbb-0000-0000-0000-0000000000c2', kc || '/400.webp', 0, '0f000000-0000-4000-8000-0000000000c2');
  insert into public.site_images (tenant_id, storage_path, asset_id)
  values (tc, kc || '/400.webp', '0f000000-0000-4000-8000-0000000000c2');
  insert into public.photo_usages (tenant_id, asset_id, kind, photo_id, field)
  select tc, '0f000000-0000-4000-8000-0000000000c2', 'gallery', id, 'photo' from public.photos where tenant_id = tc;

  perform pg_temp.ok('deleteSite order: photos, then albums', 'accepted|accepted',
    pg_temp.try(format('delete from public.photos where tenant_id = %L', tc)) || '|' ||
    pg_temp.try(format('delete from public.albums where tenant_id = %L', tc)));
  perform pg_temp.ok('…then the site: site_images and the asset cascade together, the key checked at the end', 'accepted',
    pg_temp.try(format('delete from public.tenants where id = %L', tc)));
  perform pg_temp.ok('…and nothing of it is left', '0|0|0|0',
    (select count(*) from public.tenants where id = tc) || '|' ||
    (select count(*) from public.photo_assets where tenant_id = tc) || '|' ||
    (select count(*) from public.site_images where tenant_id = tc) || '|' ||
    (select count(*) from public.photo_usages where tenant_id = tc));
end $$;


-- ── Report, and undo everything ─────────────────────────────────────────────

do $$
declare
  report text;
  failed int;
  total  int;
begin
  select string_agg(
           format('%s  %-84s expected %-30s got %s',
                  case when coalesce(pass, false) then '  ok  ' else ' FAIL ' end,
                  step, expected, actual),
           E'\n' order by ord)
    into report
    from fk_res;

  select count(*), count(*) filter (where not coalesce(pass, false)) into total, failed from fk_res;

  raise exception E'\n\n%\n\n%\n\nNothing was kept — this transaction always rolls back.\n',
    report,
    case when failed = 0 then format('All %s checks passed.', total)
         else format('%s of %s check(s) failed. The asset keys are NOT ready.', failed, total) end;
end $$;

rollback;
