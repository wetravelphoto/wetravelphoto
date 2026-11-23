-- Proof of the client-gallery-v2 cover columns —
-- db/migrations/2026-11-22_album_cover_v2.sql (CANDIDATE — NOT DEPLOYED).
--
-- The fixture does NOT carry this migration (it describes production, and
-- production does not have it yet). Rehearse it on a scratch database, the
-- migration applied TWICE first:
--
--   psql -d wtp -f db/test-fixture.sql
--   psql -d wtp -f db/migrations/2026-11-22_album_cover_v2.sql
--   psql -d wtp -f db/migrations/2026-11-22_album_cover_v2.sql
--   psql -d wtp -f db/verify-album-cover-v2.sql
--
--   # without psql:
--   CAND=db/migrations/2026-11-22_album_cover_v2.sql
--   node scripts/p4-local-db.mjs sql $CAND $CAND db/verify-album-cover-v2.sql
--
-- Without the migration it refuses at once (it does not report a pass).
--
-- One transaction that ALWAYS ends by raising; nothing is kept.
--
-- Integrity runs as the TABLE OWNER, who bypasses RLS and holds every
-- privilege: when a write is refused here, a constraint did it, and the
-- assertion names WHICH one ('<SQLSTATE> <constraint>'). Two checks repeat it
-- as a signed-in photographer, whose own album RLS lets them update.

begin;

do $$
begin
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.albums'::regclass
                    and attname = 'cover_secondary_photo_id' and not attisdropped) then
    raise exception 'db/migrations/2026-11-22_album_cover_v2.sql is not applied to this database — apply it (twice) first. Nothing was checked.';
  end if;
end $$;

create temp table cv_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

create function pg_temp.ok(p_step text, p_expected text, p_actual text)
returns void language sql as $$
  insert into cv_res (step, expected, actual, pass)
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

set local search_path = public, pg_catalog;

do $$
begin
  perform set_config('cv.owner', session_user, true);
  update public.profiles set is_platform_admin = false;
end $$;

-- From the fixture: site A owns album …01 (photos …01, …02) and album …02
-- (photo …03); site B owns album …03. Added here: one more photograph in
-- album …01 (…04) and one on site B (…b1).
insert into public.photos (id, tenant_id, album_id, storage_path, sort_order) values
  ('cccccccc-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001', 't/one/photos/a/4/2400.webp', 2),
  ('cccccccc-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000003', 't/two/photos/x/1/2400.webp', 0);


-- ── 1. The catalogue ────────────────────────────────────────────────────────

do $$
declare r record;
begin
  for r in
    select * from (values
      ('cover_background', 'text'), ('cover_zoom', 'numeric'), ('cover_secondary_photo_id', 'uuid')
    ) v(col, typ)
  loop
    perform pg_temp.ok(format('albums.%s: type, nullable, no default, no column ACL', r.col),
      r.typ || ' null nodefault noacl',
      (select format_type(a.atttypid, a.atttypmod)
              || case when a.attnotnull then ' notnull' else ' null' end
              || case when a.atthasdef  then ' default' else ' nodefault' end
              || case when a.attacl is null then ' noacl' else ' acl' end
         from pg_attribute a
        where a.attrelid = 'public.albums'::regclass and a.attname = r.col and not a.attisdropped));
  end loop;

  perform pg_temp.ok('albums_cover_zoom_range',
    'CHECK (((cover_zoom >= 1.0) AND (cover_zoom <= 2.5)))',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'albums_cover_zoom_range'));
  perform pg_temp.ok('albums_cover_background_hex',
    'CHECK ((cover_background ~ ''^#[0-9A-Fa-f]{6}$''::text))',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'albums_cover_background_hex'));
  perform pg_temp.ok('photos_id_album_tenant, on photos',
    'photos UNIQUE (id, album_id, tenant_id)',
    (select conrelid::regclass::text || ' ' || pg_get_constraintdef(oid) from pg_constraint where conname = 'photos_id_album_tenant'));
  perform pg_temp.ok('albums_cover_secondary_photo_fk: same album AND same site; nulls only itself',
    'FOREIGN KEY (cover_secondary_photo_id, id, tenant_id) REFERENCES photos(id, album_id, tenant_id) ON DELETE SET NULL (cover_secondary_photo_id)',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'albums_cover_secondary_photo_fk'));
  perform pg_temp.ok('…validated, not deferrable, MATCH SIMPLE, NO ACTION on update',
    'true false s a n',
    -- confmatchtype/confupdtype/confdeltype are "char": there is no
    -- text || "char" operator, so each is cast explicitly.
    (select convalidated::text || ' ' || condeferrable::text || ' ' || confmatchtype::text
            || ' ' || confupdtype::text || ' ' || confdeltype::text
       from pg_constraint where conname = 'albums_cover_secondary_photo_fk'));
  perform pg_temp.ok('…its target is photos_id_album_tenant', 'photos_id_album_tenant',
    (select u.conname::text from pg_constraint c
       join pg_constraint u on u.conindid = c.conindid and u.contype = 'u'
      where c.conname = 'albums_cover_secondary_photo_fk'));
  -- MATCH SIMPLE skips the check when ANY column is NULL; id and tenant_id
  -- cannot be, so only "no second photograph" skips it.
  perform pg_temp.ok('albums.id and albums.tenant_id are NOT NULL', 'true true',
    (select string_agg(attnotnull::text, ' ' order by attname) from pg_attribute
      where attrelid = 'public.albums'::regclass and attname in ('id', 'tenant_id')));
  perform pg_temp.ok('albums_cover_secondary_photo index',
    'CREATE INDEX albums_cover_secondary_photo ON public.albums USING btree (cover_secondary_photo_id) WHERE (cover_secondary_photo_id IS NOT NULL)',
    (select replace(pg_get_indexdef('public.albums_cover_secondary_photo'::regclass), 'ON albums', 'ON public.albums')));
  -- Untouched neighbours.
  perform pg_temp.ok('albums_cover_photo_fk unchanged',
    'FOREIGN KEY (cover_photo_id, tenant_id) REFERENCES photos(id, tenant_id) ON DELETE SET NULL (cover_photo_id)',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'albums_cover_photo_fk'));
  perform pg_temp.ok('photos_album_id_fkey still cascades',
    'FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'photos_album_id_fkey'));
  perform pg_temp.ok('albums_access_revision trigger still enabled', 'O',
    (select tgenabled::text from pg_trigger where tgname = 'albums_access_revision'
        and tgrelid = 'public.albums'::regclass));
  perform pg_temp.ok('the fixture''s albums carry no new value', '0',
    (select count(*)::text from public.albums
      where cover_background is not null or cover_zoom is not null or cover_secondary_photo_id is not null));
end $$;


-- ── 2. cover_zoom ───────────────────────────────────────────────────────────

do $$
declare
  q constant text := $q$update public.albums set cover_zoom = %s where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$;
begin
  perform pg_temp.ok('zoom 1.0 accepted',  'accepted', pg_temp.try(format(q, '1.0')));
  perform pg_temp.ok('zoom 2.5 accepted',  'accepted', pg_temp.try(format(q, '2.5')));
  perform pg_temp.ok('zoom 1.75 accepted', 'accepted', pg_temp.try(format(q, '1.75')));
  perform pg_temp.ok('zoom NULL accepted', 'accepted', pg_temp.try(format(q, 'null')));
  perform pg_temp.ok('zoom 0.99 refused',  '23514 albums_cover_zoom_range', pg_temp.try(format(q, '0.99')));
  perform pg_temp.ok('zoom 2.5001 refused','23514 albums_cover_zoom_range', pg_temp.try(format(q, '2.5001')));
  perform pg_temp.ok('zoom 0 refused',     '23514 albums_cover_zoom_range', pg_temp.try(format(q, '0')));
  perform pg_temp.ok('zoom -1.5 refused',  '23514 albums_cover_zoom_range', pg_temp.try(format(q, '-1.5')));
  perform pg_temp.ok('zoom NaN refused',   '23514 albums_cover_zoom_range', pg_temp.try(format(q, $v$'NaN'::numeric$v$)));
  perform pg_temp.ok('zoom Infinity refused',  '23514 albums_cover_zoom_range', pg_temp.try(format(q, $v$'Infinity'::numeric$v$)));
  perform pg_temp.ok('zoom -Infinity refused', '23514 albums_cover_zoom_range', pg_temp.try(format(q, $v$'-Infinity'::numeric$v$)));
end $$;


-- ── 3. cover_background ─────────────────────────────────────────────────────

do $$
declare
  q constant text := $q$update public.albums set cover_background = %L where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$;
begin
  perform pg_temp.ok('background #1A1A1A accepted', 'accepted', pg_temp.try(format(q, '#1A1A1A')));
  perform pg_temp.ok('background #faf9f6 accepted', 'accepted', pg_temp.try(format(q, '#faf9f6')));
  perform pg_temp.ok('background NULL accepted', 'accepted',
    pg_temp.try($q$update public.albums set cover_background = null where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$));
  perform pg_temp.ok('background ''red'' refused',      '23514 albums_cover_background_hex', pg_temp.try(format(q, 'red')));
  perform pg_temp.ok('background #FFF refused',         '23514 albums_cover_background_hex', pg_temp.try(format(q, '#FFF')));
  perform pg_temp.ok('background #12345G refused',      '23514 albums_cover_background_hex', pg_temp.try(format(q, '#12345G')));
  perform pg_temp.ok('background #11223344 refused',    '23514 albums_cover_background_hex', pg_temp.try(format(q, '#11223344')));
  perform pg_temp.ok('background empty string refused', '23514 albums_cover_background_hex', pg_temp.try(format(q, '')));
  perform pg_temp.ok('background CSS fragment refused', '23514 albums_cover_background_hex', pg_temp.try(format(q, '#000000;background:url(x)')));
  perform pg_temp.ok('background trailing newline refused', '23514 albums_cover_background_hex', pg_temp.try(format(q, E'#000000\n')));
end $$;


-- ── 4. cover_secondary_photo_id: the album's own photograph, on its site ────

do $$
declare
  q constant text := $q$update public.albums set cover_secondary_photo_id = %L where id = %L$q$;
  a1 constant text := 'bbbbbbbb-0000-0000-0000-000000000001';
  a3 constant text := 'bbbbbbbb-0000-0000-0000-000000000003';
begin
  perform pg_temp.ok('a photograph of the SAME album accepted', 'accepted',
    pg_temp.try(format(q, 'cccccccc-0000-0000-0000-000000000002', a1)));
  perform pg_temp.ok('the same photograph as the main cover: the database allows it', 'accepted',
    pg_temp.try(format(q, 'cccccccc-0000-0000-0000-000000000001', a1)));
  perform pg_temp.ok('another album, SAME SITE: refused by the key', '23503 albums_cover_secondary_photo_fk',
    pg_temp.try(format(q, 'cccccccc-0000-0000-0000-000000000003', a1)));
  perform pg_temp.ok('ANOTHER SITE: refused by the key', '23503 albums_cover_secondary_photo_fk',
    pg_temp.try(format(q, 'cccccccc-0000-0000-0000-0000000000b1', a1)));
  perform pg_temp.ok('a photograph that does not exist: refused', '23503 albums_cover_secondary_photo_fk',
    pg_temp.try(format(q, 'cccccccc-0000-0000-0000-00000000dead', a1)));
  perform pg_temp.ok('site B''s album naming site A''s photograph: refused', '23503 albums_cover_secondary_photo_fk',
    pg_temp.try(format(q, 'cccccccc-0000-0000-0000-000000000002', a3)));
  perform pg_temp.ok('site B''s album naming its own: accepted', 'accepted',
    pg_temp.try(format(q, 'cccccccc-0000-0000-0000-0000000000b1', a3)));
  perform pg_temp.ok('none at all accepted', 'accepted',
    pg_temp.try(format('update public.albums set cover_secondary_photo_id = null where id = %L', a3)));
  -- The album leaves for another site while its second photograph stays. The
  -- main cover is cleared first, so the refusal can only be the new key's.
  perform pg_temp.ok('re-siting the album away from its second photograph: refused', '23503 albums_cover_secondary_photo_fk',
    pg_temp.try(format($s$update public.albums set cover_photo_id = null, cover_secondary_photo_id = 'cccccccc-0000-0000-0000-000000000002',
                                     tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002' where id = %L$s$, a1)));
end $$;

-- Moving photographs between albums (no application path does it today).
do $$
begin
  update public.albums set cover_secondary_photo_id = 'cccccccc-0000-0000-0000-000000000002'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  perform pg_temp.ok('moving the album''s second photograph to another album: refused (NO ACTION on update)',
    '23503 albums_cover_secondary_photo_fk',
    pg_temp.try($q$update public.photos set album_id = 'bbbbbbbb-0000-0000-0000-000000000002'
                   where id = 'cccccccc-0000-0000-0000-000000000002'$q$));
  -- …and the new unique/key do not refuse anything broader.
  perform pg_temp.ok('moving a photograph nobody names second: still accepted', 'accepted',
    pg_temp.try($q$update public.photos set album_id = 'bbbbbbbb-0000-0000-0000-000000000002'
                   where id = 'cccccccc-0000-0000-0000-000000000004'$q$));
  perform pg_temp.ok('…and back', 'accepted',
    pg_temp.try($q$update public.photos set album_id = 'bbbbbbbb-0000-0000-0000-000000000001'
                   where id = 'cccccccc-0000-0000-0000-000000000004'$q$));
  perform pg_temp.ok('a new photograph is still accepted', 'accepted',
    pg_temp.try($q$insert into public.photos (id, tenant_id, album_id, storage_path, sort_order) values
                   ('cccccccc-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001',
                    'bbbbbbbb-0000-0000-0000-000000000001', 't/one/photos/a/5/2400.webp', 3)$q$));
end $$;

-- As site A's photographer: RLS lets them update their own album; the key
-- still refuses a photograph from their OTHER album, and allows their own.
do $$
declare r_bad text; r_good text;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  perform set_config('role', 'authenticated', true);
  r_bad := pg_temp.try($q$update public.albums set cover_secondary_photo_id = 'cccccccc-0000-0000-0000-000000000003'
                          where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$);
  r_good := pg_temp.try($q$update public.albums set cover_secondary_photo_id = 'cccccccc-0000-0000-0000-000000000004',
                                               cover_zoom = 1.5, cover_background = '#101010'
                           where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$);
  perform set_config('role', current_setting('cv.owner'), true);
  perform pg_temp.ok('as the photographer, another album''s photograph is refused by the key',
    '23503 albums_cover_secondary_photo_fk', r_bad);
  perform pg_temp.ok('as the photographer, their own album''s photograph is accepted', 'accepted', r_good);
  perform pg_temp.ok('…and the write landed (RLS let it reach the row)', 'cccccccc-0000-0000-0000-000000000004 1.5 #101010',
    (select cover_secondary_photo_id::text || ' ' || cover_zoom::text || ' ' || cover_background
       from public.albums where id = 'bbbbbbbb-0000-0000-0000-000000000001'));
end $$;


-- ── 5. A cover edit does not rotate the gallery's access revision ───────────

do $$
declare v_before uuid; v_after uuid;
begin
  select access_revision into v_before from public.albums where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  update public.albums set cover_zoom = 2.0, cover_background = '#000000',
                           cover_secondary_photo_id = 'cccccccc-0000-0000-0000-000000000003'
   where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  select access_revision into v_after from public.albums where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  perform pg_temp.ok('editing the three cover columns keeps access_revision', 'same',
    case when v_before = v_after then 'same' else 'rotated' end);
end $$;


-- ── 6. Deleting the second photograph: it goes, nothing else ────────────────

do $$
declare before jsonb; after jsonb;
begin
  update public.albums
     set cover_photo_id = 'cccccccc-0000-0000-0000-000000000001',
         cover_secondary_photo_id = 'cccccccc-0000-0000-0000-000000000004',
         cover_zoom = 1.25, cover_background = '#222222'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  select to_jsonb(a) into before from public.albums a where a.id = 'bbbbbbbb-0000-0000-0000-000000000001';

  delete from public.photos where id = 'cccccccc-0000-0000-0000-000000000004';

  select to_jsonb(a) into after from public.albums a where a.id = 'bbbbbbbb-0000-0000-0000-000000000001';
  perform pg_temp.ok('deleting the second photograph nulls cover_secondary_photo_id', '(null)',
    after->>'cover_secondary_photo_id');
  perform pg_temp.ok('…and every other column, site, cover, zoom, background and revision included', 'same',
    case when (before - 'cover_secondary_photo_id') = (after - 'cover_secondary_photo_id') then 'same'
         else (before - 'cover_secondary_photo_id')::text || ' vs ' || (after - 'cover_secondary_photo_id')::text end);
  perform pg_temp.ok('…and the album''s other photographs stay', '3',
    (select count(*)::text from public.photos where album_id = 'bbbbbbbb-0000-0000-0000-000000000001'));
end $$;

-- One photograph that is both covers: both null, the album stays.
do $$
begin
  update public.albums set cover_photo_id = 'cccccccc-0000-0000-0000-000000000005',
                           cover_secondary_photo_id = 'cccccccc-0000-0000-0000-000000000005'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  perform pg_temp.ok('deleting a photograph that is both covers is accepted', 'accepted',
    pg_temp.try($q$delete from public.photos where id = 'cccccccc-0000-0000-0000-000000000005'$q$));
  perform pg_temp.ok('…both covers null, the album and its site intact', '(null) (null) aaaaaaaa-0000-0000-0000-000000000001',
    (select coalesce(cover_photo_id::text, '(null)') || ' ' || coalesce(cover_secondary_photo_id::text, '(null)') || ' ' || tenant_id::text
       from public.albums where id = 'bbbbbbbb-0000-0000-0000-000000000001'));
end $$;


-- ── 7. Deleting an album that names a second photograph ─────────────────────

do $$
begin
  update public.albums set cover_photo_id = 'cccccccc-0000-0000-0000-000000000001',
                           cover_secondary_photo_id = 'cccccccc-0000-0000-0000-000000000002'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  perform pg_temp.ok('deleting the album is accepted', 'accepted',
    pg_temp.try($q$delete from public.albums where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$));
  perform pg_temp.ok('…its photographs went by the existing cascade', '0',
    (select count(*)::text from public.photos where album_id = 'bbbbbbbb-0000-0000-0000-000000000001'));
  perform pg_temp.ok('…album …02 and its second photograph untouched', 'cccccccc-0000-0000-0000-000000000003',
    (select cover_secondary_photo_id::text from public.albums where id = 'bbbbbbbb-0000-0000-0000-000000000002'));
  perform pg_temp.ok('…site B''s photograph untouched', '1',
    (select count(*)::text from public.photos where id = 'cccccccc-0000-0000-0000-0000000000b1'));
  perform pg_temp.ok('deleting album …02 (client_only, with favourites and downloads) is accepted', 'accepted',
    pg_temp.try($q$delete from public.albums where id = 'bbbbbbbb-0000-0000-0000-000000000002'$q$));
end $$;


-- ── Report, and undo everything ─────────────────────────────────────────────

do $$
declare
  report text;
  failed int;
  total  int;
begin
  select string_agg(
           format('%s  %-84s expected %-24s got %s',
                  case when coalesce(pass, false) then '  ok  ' else ' FAIL ' end,
                  step, expected, actual),
           E'\n' order by ord)
    into report
    from cv_res;

  select count(*), count(*) filter (where not coalesce(pass, false)) into total, failed from cv_res;

  raise exception E'\n\n%\n\n%\n\nNothing was kept — this transaction always rolls back.\n',
    report,
    case when failed = 0 then format('All %s checks passed.', total)
         else format('%s of %s check(s) failed. The cover v2 migration is NOT ready.', failed, total) end;
end $$;

rollback;
