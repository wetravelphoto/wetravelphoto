-- Proof that an album's chosen cover is on the album's own site — P3's
-- prerequisite, db/migrations/2026-09-30_album_cover_tenant_fk.sql — and that
-- nothing else about the cover changed.
--
--   psql -d wtp -f db/test-fixture.sql
--   psql -d wtp -f db/verify-album-cover-fk.sql
--
-- (Migration A is DEPLOYED — Supabase 20261001005946 — and reconciled into the
-- fixture; applying it on top is a no-op.)
--
-- The preflight refusal, running the migration twice, the rollback and the
-- mutation proof (this file FAILING against the old single-column key) are in
-- scripts/album-cover-fk.sh, which needs a database of its own.
--
-- One transaction that ALWAYS ends by raising; nothing is kept.
--
-- Referential integrity runs as the TABLE OWNER, who bypasses row-level
-- security and holds every privilege: when a write is refused here, the
-- foreign key did it, and the assertion names it. One check repeats the
-- refusal as a signed-in photographer, whose own album RLS lets them update.

begin;

create temp table cf_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

create function pg_temp.ok(p_step text, p_expected text, p_actual text)
returns void language sql as $$
  insert into cf_res (step, expected, actual, pass)
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

do $$
begin
  perform set_config('cf.owner', session_user, true);
  update public.profiles set is_platform_admin = false;
end $$;

-- Site A: its two albums and three photographs, from the fixture. Site B gets a
-- photograph of its own, so there is something foreign to point at.
insert into public.photos (id, tenant_id, album_id, storage_path, sort_order) values
  ('cccccccc-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000003', 't/two/photos/x/1/2400.webp', 0);


-- ── 1. The constraint, from the catalogue ───────────────────────────────────

do $$
begin
  perform pg_temp.ok('albums_cover_photo_fk is tenant-aware and nulls only the cover',
    'FOREIGN KEY (cover_photo_id, tenant_id) REFERENCES photos(id, tenant_id) ON DELETE SET NULL (cover_photo_id)',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'albums_cover_photo_fk'));
  perform pg_temp.ok('it is the only foreign key on albums.cover_photo_id', '1',
    (select count(*)::text from pg_constraint
      where conrelid = 'public.albums'::regclass and contype = 'f'
        and conkey @> array[(select attnum from pg_attribute
                              where attrelid = 'public.albums'::regclass and attname = 'cover_photo_id')]));
  -- MATCH SIMPLE skips the check when any column is NULL: a NULL tenant would
  -- let a cover point anywhere. It cannot be NULL.
  perform pg_temp.ok('albums.tenant_id is NOT NULL, so the key is always checked', 'true',
    (select attnotnull::text from pg_attribute where attrelid = 'public.albums'::regclass and attname = 'tenant_id'));
  perform pg_temp.ok('its target is photos_id_tenant', 'photos_id_tenant',
    (select c2.conname::text from pg_constraint c
       join pg_constraint c2 on c2.conindid = c.conindid and c2.contype = 'u'
      where c.conname = 'albums_cover_photo_fk'));
end $$;


-- ── 2. What it refuses and what it allows ───────────────────────────────────

do $$
begin
  perform pg_temp.ok('a cover on ANOTHER SITE is refused, by the foreign key', '23503 albums_cover_photo_fk',
    pg_temp.try($q$update public.albums set cover_photo_id = 'cccccccc-0000-0000-0000-0000000000b1'
                   where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$));
  perform pg_temp.ok('a cover from the SAME album is accepted', 'accepted',
    pg_temp.try($q$update public.albums set cover_photo_id = 'cccccccc-0000-0000-0000-000000000002'
                   where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$));
  -- Same site, another album: the DATABASE boundary is the site. That a cover
  -- is one of the album's own photographs is updateAlbumSettings' rule.
  perform pg_temp.ok('a cover from another album of the same site: the database allows it', 'accepted',
    pg_temp.try($q$update public.albums set cover_photo_id = 'cccccccc-0000-0000-0000-000000000003'
                   where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$));
  perform pg_temp.ok('no cover at all is accepted', 'accepted',
    pg_temp.try($q$update public.albums set cover_photo_id = null where id = 'bbbbbbbb-0000-0000-0000-000000000002'$q$));
  perform pg_temp.ok('an album of site B cannot take a cover from site A', '23503 albums_cover_photo_fk',
    pg_temp.try($q$update public.albums set cover_photo_id = 'cccccccc-0000-0000-0000-000000000001'
                   where id = 'bbbbbbbb-0000-0000-0000-000000000003'$q$));
  perform pg_temp.ok('moving an album to another site while its cover stays behind is refused', '23503 albums_cover_photo_fk',
    pg_temp.try($q$update public.albums set tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002'
                   where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$));
end $$;

-- As the photographer who owns album A: row-level security lets them update
-- their own album; the foreign key still refuses the foreign cover.
do $$
declare r text;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  perform set_config('role', 'authenticated', true);
  r := pg_temp.try($q$update public.albums set cover_photo_id = 'cccccccc-0000-0000-0000-0000000000b1'
                      where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$);
  perform set_config('role', current_setting('cf.owner'), true);
  perform pg_temp.ok('as the album''s own photographer, a foreign cover is refused by the key', '23503 albums_cover_photo_fk', r);
end $$;


-- ── 3. Deleting the chosen photograph: the cover goes, nothing else ─────────

do $$
declare
  before record;
  after  record;
begin
  update public.albums
     set cover_photo_id = 'cccccccc-0000-0000-0000-000000000002', cover_custom_path = 't/one/covers/a/c/800.webp'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  select a.* into before from public.albums a where a.id = 'bbbbbbbb-0000-0000-0000-000000000001';

  delete from public.photos where id = 'cccccccc-0000-0000-0000-000000000002';

  select a.* into after from public.albums a where a.id = 'bbbbbbbb-0000-0000-0000-000000000001';
  perform pg_temp.ok('deleting the cover photograph nulls cover_photo_id', '(null)', after.cover_photo_id::text);
  perform pg_temp.ok('…and leaves the album''s site alone', before.tenant_id::text, after.tenant_id::text);
  perform pg_temp.ok('…and every other column', 'same',
    case when (to_jsonb(before) - 'cover_photo_id') = (to_jsonb(after) - 'cover_photo_id') then 'same'
         else ((to_jsonb(before) - 'cover_photo_id')::text || ' vs ' || (to_jsonb(after) - 'cover_photo_id')::text) end);
end $$;


-- ── 4. Deleting an album: unchanged — its photographs go by cascade ─────────

do $$
begin
  perform pg_temp.ok('deleting the album is accepted', 'accepted',
    pg_temp.try($q$delete from public.albums where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$));
  perform pg_temp.ok('…and its photographs went with it', '0',
    (select count(*)::text from public.photos where album_id = 'bbbbbbbb-0000-0000-0000-000000000001'));
  perform pg_temp.ok('…and site B''s photograph did not', '1',
    (select count(*)::text from public.photos where id = 'cccccccc-0000-0000-0000-0000000000b1'));
end $$;


-- ── Report, and undo everything ─────────────────────────────────────────────

do $$
declare
  report text;
  failed int;
  total  int;
begin
  select string_agg(
           format('%s  %-78s expected %-24s got %s',
                  case when coalesce(pass, false) then '  ok  ' else ' FAIL ' end,
                  step, expected, actual),
           E'\n' order by ord)
    into report
    from cf_res;

  select count(*), count(*) filter (where not coalesce(pass, false)) into total, failed from cf_res;

  raise exception E'\n\n%\n\n%\n\nNothing was kept — this transaction always rolls back.\n',
    report,
    case when failed = 0 then format('All %s checks passed.', total)
         else format('%s of %s check(s) failed. The cover key is NOT ready.', failed, total) end;
end $$;

rollback;
