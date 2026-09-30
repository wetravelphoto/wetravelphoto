-- Proof that P2's write boundary — four register_* wrappers over one internal
-- upsert — lets the four upload routes in, keeps everybody else out, and
-- refuses every value the design says it must.
--
-- P2 is DEPLOYED (Supabase 20260930191116, 2026-09-30) and reconciled into
-- db/test-fixture.sql, so the fixture alone is enough:
--
--   psql -d wtp -f db/test-fixture.sql
--   psql -d wtp -f db/verify-photo-ingest.sql
--
-- (Applying db/migrations/2026-09-30_photo_ingest.sql on top is a no-op.)
--
-- One transaction that ALWAYS ends by raising; nothing is kept. Same shape as
-- db/verify-jobs.sql and db/verify-photo-assets.sql.
--
-- ── As the real roles ───────────────────────────────────────────────────────
--
-- Every registration below is made AS `authenticated` with a signed-in
-- photographer's JWT claims (or as anon / service_role where the point is that
-- they cannot), through `vi.as(...)`, a helper that switches role, calls the
-- wrapper, switches back and reports `ok|…` or `<SQLSTATE>|<message>`. The
-- owner never registers anything: a suite that did would pass straight through
-- a grant problem, which is how S3's defect hid.
--
-- What cannot be done in one transaction — two registrations of one upload
-- racing each other — is proved in .mk/ingest.ts, with two connections.

begin;

create temp table pi_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

create function pg_temp.ok(p_step text, p_expected text, p_actual text)
returns void language sql as $$
  insert into pi_res (step, expected, actual, pass)
  values (p_step, p_expected, coalesce(p_actual, '(null)'), p_expected = p_actual);
$$;

-- The SQLSTATE (or 'ok') of a vi.as(...) result.
create function pg_temp.st(p text) returns text language sql immutable as $$
  select split_part(p, '|', 1);
$$;

-- ── The cast ────────────────────────────────────────────────────────────────

do $$
begin
  perform set_config('pi.owner', session_user, true);
  perform set_config('pi.A', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  perform set_config('pi.B', 'aaaaaaaa-0000-0000-0000-000000000002', true);
  perform set_config('pi.userA', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('pi.userB', '22222222-2222-2222-2222-222222222222', true);
  perform set_config('pi.albumA', 'bbbbbbbb-0000-0000-0000-000000000001', true);
  perform set_config('pi.albumB', 'bbbbbbbb-0000-0000-0000-000000000003', true);
  -- Nobody is a platform admin until a block says so.
  update public.profiles set is_platform_admin = false;
end $$;

create function pg_temp.g(p text) returns uuid language sql stable as $$
  select current_setting('pi.' || p)::uuid;
$$;

-- ── The helper schema: a way to call each wrapper AS a role ─────────────────
--
-- `vi.call` builds a valid registration for a route and applies overrides
-- from a small JSON object, so each negative test states only what it breaks.
-- Created in this transaction and rolled back with it.

create schema vi;
grant usage on schema vi to anon, authenticated, service_role;

create function vi.key_base(route text, t uuid, a uuid, u text) returns text
language sql immutable as $$
  select case route
    when 'gallery' then 't/' || t || '/photos/' || a || '/' || u
    when 'site'    then 't/' || t || '/site-images/' || u
    when 'journal' then 't/' || t || '/journal/' || u
    when 'cover'   then 't/' || t || '/covers/' || a || '/' || u
  end;
$$;

create function vi.call(route text, t uuid, a uuid, u text, o jsonb default '{}')
returns text language plpgsql as $$
declare
  kb   text := coalesce(o ->> 'key_base', vi.key_base(route, t, a, u));
  orig text := case when o ? 'original_path' then o ->> 'original_path' else kb || '/original.jpg' end;
  der  jsonb := coalesce(o -> 'derivatives',
                         jsonb_build_object('400', kb || '/400.webp', '800', kb || '/800.webp',
                                            '1600', kb || '/1600.webp'));
  disp text := coalesce(o ->> 'display_path', kb || '/1600.webp');
  w    int := coalesce((o ->> 'width')::int, 1600);
  h    int := coalesce((o ->> 'height')::int, 1067);
  b    bigint := coalesce((o ->> 'bytes')::bigint, 4096);
  sha  text := coalesce(o ->> 'sha', repeat('ab', 32));
  ct   text := case when o ? 'ct' then o ->> 'ct' else 'image/jpeg' end;
  fn   text := case when o ? 'filename' then o ->> 'filename' else 'heron.jpg' end;
  kw   text[] := case when o ? 'keywords'
                      then array(select jsonb_array_elements_text(o -> 'keywords')) else '{}'::text[] end;
  ex   jsonb := coalesce(o -> 'exif', '{}'::jsonb);
  r    record;
  x    uuid;
  st   text;
  msg  text;
begin
  if route = 'gallery' then
    select * into r from public.register_gallery_photo(
      p_tenant => t, p_album => a, p_key_base => kb, p_original_path => orig,
      p_display_path => disp, p_derivatives => der, p_width => w, p_height => h,
      p_original_bytes => b, p_content_sha256 => sha, p_content_type => ct,
      p_taken_at => (o ->> 'taken_at')::timestamptz, p_camera_make => o ->> 'camera_make',
      p_camera_model => o ->> 'camera_model', p_lens => o ->> 'lens',
      p_iso => (o ->> 'iso')::int, p_aperture => (o ->> 'aperture')::numeric,
      p_shutter => o ->> 'shutter', p_focal_length => (o ->> 'focal')::numeric,
      p_keywords => kw, p_exif => ex,
      p_latitude => (o ->> 'lat')::float8, p_longitude => (o ->> 'lon')::float8);
    return 'ok|' || r.photo_id || '|' || r.asset_id;
  elsif route = 'site' then
    select * into r from public.register_site_image(
      p_tenant => t, p_key_base => kb, p_original_path => orig,
      p_display_path => disp, p_derivatives => der, p_width => w, p_height => h,
      p_original_bytes => b, p_content_sha256 => sha, p_content_type => ct, p_filename => fn,
      p_taken_at => (o ->> 'taken_at')::timestamptz, p_camera_make => o ->> 'camera_make',
      p_camera_model => o ->> 'camera_model', p_lens => o ->> 'lens',
      p_iso => (o ->> 'iso')::int, p_aperture => (o ->> 'aperture')::numeric,
      p_shutter => o ->> 'shutter', p_focal_length => (o ->> 'focal')::numeric,
      p_keywords => kw, p_exif => ex);
    return 'ok|' || r.site_image_id || '|' || r.asset_id;
  elsif route = 'journal' then
    x := public.register_journal_image(
      p_tenant => t, p_key_base => kb, p_original_path => orig,
      p_display_path => disp, p_derivatives => der, p_width => w, p_height => h,
      p_original_bytes => b, p_content_sha256 => sha, p_content_type => ct,
      p_taken_at => (o ->> 'taken_at')::timestamptz, p_camera_make => o ->> 'camera_make',
      p_camera_model => o ->> 'camera_model', p_lens => o ->> 'lens',
      p_iso => (o ->> 'iso')::int, p_aperture => (o ->> 'aperture')::numeric,
      p_shutter => o ->> 'shutter', p_focal_length => (o ->> 'focal')::numeric,
      p_keywords => kw, p_exif => ex);
    return 'ok|' || x;
  else
    x := public.register_album_cover(
      p_tenant => t, p_album => a, p_key_base => kb,
      p_display_path => disp, p_derivatives => der, p_width => w, p_height => h,
      p_original_bytes => b, p_content_sha256 => sha, p_content_type => ct, p_filename => fn,
      p_taken_at => (o ->> 'taken_at')::timestamptz, p_camera_make => o ->> 'camera_make',
      p_camera_model => o ->> 'camera_model', p_lens => o ->> 'lens',
      p_iso => (o ->> 'iso')::int, p_aperture => (o ->> 'aperture')::numeric,
      p_shutter => o ->> 'shutter', p_focal_length => (o ->> 'focal')::numeric,
      p_keywords => kw, p_exif => ex);
    return 'ok|' || x;
  end if;
exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text;
  return st || '|' || msg;
end $$;

-- As a role, with a user's JWT (NULL sub = signed out), and back.
create function vi.as(p_role text, p_sub uuid, route text, t uuid, a uuid, u text, o jsonb default '{}')
returns text language plpgsql as $$
declare res text;
begin
  perform set_config('request.jwt.claims',
                     case when p_sub is null then '' else json_build_object('sub', p_sub)::text end, true);
  perform set_config('role', p_role, true);
  res := vi.call(route, t, a, u, o);
  perform set_config('role', current_setting('pi.owner'), true);
  perform set_config('request.jwt.claims', '', true);
  return res;
end $$;

grant execute on all functions in schema vi to anon, authenticated, service_role;

-- A fresh upload id, the shape randomUUID() mints.
create function pg_temp.u() returns text language sql volatile as $$ select gen_random_uuid()::text $$;


-- ── 0. A clean start ────────────────────────────────────────────────────────

do $$
begin
  perform pg_temp.ok('photo_assets starts empty', '0', (select count(*)::text from public.photo_assets));
  perform pg_temp.ok('photo_usages starts empty', '0', (select count(*)::text from public.photo_usages));
end $$;


-- ── 1. Privileges ───────────────────────────────────────────────────────────

do $$
declare
  fn   text;
  r    text;
  want text;
begin
  foreach fn in array array['register_gallery_photo', 'register_site_image',
                            'register_journal_image', 'register_album_cover', 'upsert_photo_asset'] loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      want := case when r = 'authenticated' and fn <> 'upsert_photo_asset' then 'EXECUTE' else 'none' end;
      perform pg_temp.ok(format('%s: %s may %s', fn, r, lower(want)), want,
        (select case when bool_or(has_function_privilege(r, p.oid, 'EXECUTE')) then 'EXECUTE' else 'none' end
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn));
    end loop;
    perform pg_temp.ok(format('%s: PUBLIC holds nothing', fn), 'none',
      (select coalesce(string_agg(a.privilege_type, ','), 'none')
         from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.pronamespace = 'public'::regnamespace and p.proname = fn and a.grantee = 0));
  end loop;

  -- The tables are exactly as P1 left them: authenticated reads, nobody writes.
  foreach fn in array array['photo_assets', 'photo_usages'] loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      perform pg_temp.ok(format('table %s: %s holds', fn, r),
        case r when 'authenticated' then 'SELECT' else 'none' end,
        (select coalesce(string_agg(p, ',' order by p), 'none')
           from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
          where has_table_privilege(r, 'public.' || fn, p)));
    end loop;
  end loop;
end $$;

-- By behaviour: anon and service_role cannot call a wrapper; nobody but the
-- owner can call the helper.
do $$
declare
  u text := pg_temp.u();
  e text;
begin
  perform pg_temp.ok('anon cannot call register_journal_image', '42501',
    pg_temp.st(vi.as('anon', null, 'journal', pg_temp.g('A'), null, u)));
  perform pg_temp.ok('service_role cannot call register_gallery_photo', '42501',
    pg_temp.st(vi.as('service_role', null, 'gallery', pg_temp.g('A'), pg_temp.g('albumA'), u)));
  perform pg_temp.ok('service_role cannot call register_album_cover', '42501',
    pg_temp.st(vi.as('service_role', null, 'cover', pg_temp.g('A'), pg_temp.g('albumA'), u)));

  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.g('userA'))::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.upsert_photo_asset(
      pg_temp.g('A'), 't/x', null, 't/x/400.webp', '{"400":"t/x/400.webp"}', 1, 1, 1,
      repeat('a', 64), null, null, null, null, null, null, null, null, null, null,
      '{}', '{}', null, null, null);
    e := 'CALLED — NOT BLOCKED';
  exception when others then e := sqlstate;
  end;
  perform set_config('role', current_setting('pi.owner'), true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.ok('authenticated cannot call upsert_photo_asset directly', '42501', e);

  -- And a signed-in photographer still cannot write the tables themselves.
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.g('userA'))::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.photo_assets (tenant_id, key_base, display_path)
    values (pg_temp.g('A'), 't/direct', 'x');
    e := 'WRITTEN — NOT BLOCKED';
  exception when others then e := sqlstate;
  end;
  perform set_config('role', current_setting('pi.owner'), true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.ok('authenticated still cannot insert photo_assets directly', '42501', e);
end $$;


-- ── 2. Definer safety ───────────────────────────────────────────────────────

do $$
declare
  fn  text;
  src text;
begin
  foreach fn in array array['register_gallery_photo', 'register_site_image',
                            'register_journal_image', 'register_album_cover', 'upsert_photo_asset'] loop
    perform pg_temp.ok(format('%s: search_path is empty', fn), '{"search_path=\"\""}',
      (select proconfig::text from pg_proc where pronamespace = 'public'::regnamespace and proname = fn));
    perform pg_temp.ok(format('%s: security', fn),
      case when fn = 'upsert_photo_asset' then 'invoker' else 'definer' end,
      (select case when prosecdef then 'definer' else 'invoker' end
         from pg_proc where pronamespace = 'public'::regnamespace and proname = fn));
  end loop;

  -- The tenant rule and the identity are restated in EVERY wrapper — a
  -- definer function is not subject to the table's policy.
  foreach fn in array array['register_gallery_photo', 'register_site_image',
                            'register_journal_image', 'register_album_cover'] loop
    select prosrc into src from pg_proc where pronamespace = 'public'::regnamespace and proname = fn;
    perform pg_temp.ok(format('%s restates the tenant rule and names the uploader', fn), 'yes',
      case when src like '%p_tenant = public.current_tenant_id() or public.is_platform_admin()%'
            and src like '%from public.tenants t where t.id = p_tenant%'
            and src like '%auth.uid()%' then 'yes' else 'no' end);
  end loop;
end $$;

-- A decoy schema in front of the caller's path, carrying its own photo_assets
-- and its own current_tenant_id() that says "you are site B". An empty
-- search_path means the wrapper never sees either.
create schema decoy;
create table decoy.photo_assets (id uuid, tenant_id uuid, key_base text);
create function decoy.current_tenant_id() returns uuid language sql as
  $$ select 'aaaaaaaa-0000-0000-0000-000000000002'::uuid $$;
create function decoy.is_platform_admin() returns boolean language sql as $$ select true $$;
grant usage on schema decoy to authenticated;
grant all on decoy.photo_assets to authenticated;
grant execute on all functions in schema decoy to authenticated;

do $$
declare
  u   text := pg_temp.u();
  res text;
  n_public int;
  n_decoy  int;
begin
  perform set_config('search_path', 'decoy, public, pg_temp', true);
  res := vi.as('authenticated', pg_temp.g('userA'), 'journal', pg_temp.g('A'), null, u);
  -- The decoy's "site B" must not have let site A's photographer onto B:
  perform pg_temp.ok('decoy path: a registration onto site B is still refused', '42501',
    pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), 'journal', pg_temp.g('B'), null, pg_temp.u())));
  perform set_config('search_path', 'public, pg_temp', true);

  select count(*) into n_public from public.photo_assets
   where key_base = vi.key_base('journal', pg_temp.g('A'), null, u);
  select count(*) into n_decoy from decoy.photo_assets;
  perform pg_temp.ok('decoy path: the registration reached public.photo_assets', 'ok 1',
    pg_temp.st(res) || ' ' || n_public);
  perform pg_temp.ok('decoy path: the decoy table was never touched', '0', n_decoy::text);
end $$;

drop schema decoy cascade;


-- ── 3. Sites and galleries ──────────────────────────────────────────────────

do $$
declare
  r         text;
  foreign_m text;
  missing_m text;
begin
  foreach r in array array['gallery', 'site', 'journal', 'cover'] loop
    perform pg_temp.ok(r || ': own site succeeds', 'ok',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, pg_temp.g('A'), pg_temp.g('albumA'), pg_temp.u())));
    perform pg_temp.ok(r || ': another site (its own key shape) is refused', '42501',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, pg_temp.g('B'), pg_temp.g('albumB'), pg_temp.u())));
    perform pg_temp.ok(r || ': a site that does not exist is refused', '42501',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r,
                       '99999999-9999-9999-9999-999999999999', pg_temp.g('albumA'), pg_temp.u())));
    perform pg_temp.ok(r || ': signed out is refused', '42501',
      pg_temp.st(vi.as('authenticated', null, r, pg_temp.g('A'), pg_temp.g('albumA'), pg_temp.u())));
    -- The case a NULL-blind `if not (…)` lets through: a signed-in account
    -- with no profile, so current_tenant_id() is NULL. Must be refused by the
    -- TENANT check (42501), not by some later accident.
    perform pg_temp.ok(r || ': a signed-in account with no profile is refused', '42501',
      pg_temp.st(vi.as('authenticated', gen_random_uuid(), r, pg_temp.g('A'), pg_temp.g('albumA'), pg_temp.u())));
    perform pg_temp.ok(r || ': photographer B cannot use site A', '42501',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userB'), r, pg_temp.g('A'), pg_temp.g('albumA'), pg_temp.u())));
  end loop;

  -- A foreign gallery and a missing one are the same answer, word for word.
  foreach r in array array['gallery', 'cover'] loop
    foreign_m := vi.as('authenticated', pg_temp.g('userA'), r, pg_temp.g('A'), pg_temp.g('albumB'), pg_temp.u());
    missing_m := vi.as('authenticated', pg_temp.g('userA'), r, pg_temp.g('A'),
                       'bbbbbbbb-9999-9999-9999-999999999999', pg_temp.u());
    perform pg_temp.ok(r || ': another site''s gallery is refused', '42501', pg_temp.st(foreign_m));
    perform pg_temp.ok(r || ': "foreign" and "missing" gallery are indistinguishable', 'same',
      case when foreign_m = missing_m then 'same' else foreign_m || ' / ' || missing_m end);
  end loop;
end $$;

-- A platform admin, parked on site B, uploads to site A: allowed, filed under
-- A, and recorded as the admin who did it.
do $$
declare
  u   text := pg_temp.u();
  res text;
  row record;
begin
  update public.profiles set is_platform_admin = true where id = pg_temp.g('userB');
  res := vi.as('authenticated', pg_temp.g('userB'), 'gallery', pg_temp.g('A'), pg_temp.g('albumA'), u);
  update public.profiles set is_platform_admin = false where id = pg_temp.g('userB');

  select tenant_id, created_by into row from public.photo_assets
   where key_base = vi.key_base('gallery', pg_temp.g('A'), pg_temp.g('albumA'), u);
  perform pg_temp.ok('platform admin: an upload to the host site succeeds', 'ok', pg_temp.st(res));
  perform pg_temp.ok('platform admin: the asset belongs to the HOST site', pg_temp.g('A')::text, row.tenant_id::text);
  perform pg_temp.ok('platform admin: created_by is the admin who uploaded', pg_temp.g('userB')::text, row.created_by::text);
end $$;


-- ── 4. Paths — exact shapes, for every route ────────────────────────────────

do $$
declare
  r    text;
  t    uuid := pg_temp.g('A');
  a    uuid := pg_temp.g('albumA');
  u    text;
  kb   text;
  wrong_folder text;
begin
  foreach r in array array['gallery', 'site', 'journal', 'cover'] loop
    u := pg_temp.u();
    kb := vi.key_base(r, t, a, u);
    wrong_folder := case when r = 'site' then vi.key_base('journal', t, a, u) else vi.key_base('site', t, a, u) end;

    perform pg_temp.ok(r || ': the exact shape is accepted', 'ok',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, u)));
    perform pg_temp.ok(r || ': a key under another site''s prefix', '42501',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, pg_temp.u(),
        jsonb_build_object('key_base', vi.key_base(r, pg_temp.g('B'), a, pg_temp.u())))));
    perform pg_temp.ok(r || ': a key in another route''s folder', '42501',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, u,
        jsonb_build_object('key_base', wrong_folder))));
    perform pg_temp.ok(r || ': a traversal in the key', '42501',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, u,
        jsonb_build_object('key_base', kb || '/../' || pg_temp.u()))));
    perform pg_temp.ok(r || ': a malformed upload id', '42501',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, 'not-a-uuid')));
    perform pg_temp.ok(r || ': an upper-case upload id', '42501',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, upper(pg_temp.u()))));
    if r <> 'cover' then
      perform pg_temp.ok(r || ': an original outside the key', '22023',
        pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, pg_temp.u(),
          jsonb_build_object('original_path', 't/' || t || '/elsewhere/original.jpg'))));
      perform pg_temp.ok(r || ': an original with a disallowed extension', '22023',
        pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, u,
          jsonb_build_object('original_path', kb || '/original.exe'))));
    end if;
    u := pg_temp.u(); kb := vi.key_base(r, t, a, u);
    perform pg_temp.ok(r || ': a size that is not on the ladder (300)', '22023',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, u,
        jsonb_build_object('derivatives', jsonb_build_object('400', kb || '/400.webp', '300', kb || '/300.webp'),
                           'display_path', kb || '/400.webp'))));
    perform pg_temp.ok(r || ': an unsupported size (3200)', '22023',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, u,
        jsonb_build_object('derivatives', jsonb_build_object('400', kb || '/400.webp', '3200', kb || '/3200.webp'),
                           'display_path', kb || '/3200.webp'))));
    perform pg_temp.ok(r || ': a size stored outside the key', '22023',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, u,
        jsonb_build_object('derivatives', jsonb_build_object('400', 't/' || t || '/elsewhere/400.webp'),
                           'display_path', 't/' || t || '/elsewhere/400.webp'))));
    perform pg_temp.ok(r || ': a size that is not .webp', '22023',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, u,
        jsonb_build_object('derivatives', jsonb_build_object('400', kb || '/400.jpg'),
                           'display_path', kb || '/400.jpg'))));
    perform pg_temp.ok(r || ': no 400 size', '22023',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, u,
        jsonb_build_object('derivatives', jsonb_build_object('800', kb || '/800.webp'),
                           'display_path', kb || '/800.webp'))));
    perform pg_temp.ok(r || ': a display path that is not the largest size', '22023',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, u,
        jsonb_build_object('display_path', kb || '/800.webp'))));
    perform pg_temp.ok(r || ': sizes that are not an object', '22023',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, t, a, u,
        jsonb_build_object('derivatives', jsonb_build_array(kb || '/400.webp')))));
  end loop;
end $$;


-- ── 5. Values ───────────────────────────────────────────────────────────────

do $$
declare
  t uuid := pg_temp.g('A');
  a uuid := pg_temp.g('albumA');
  c record;
begin
  for c in select * from (values
    ('a malformed SHA-256',                   'journal', '{"sha":"ABCDEF"}'::jsonb,               '22023'),
    ('an upper-case SHA-256',                 'journal', jsonb_build_object('sha', repeat('AB', 32)), '22023'),
    ('zero bytes',                            'journal', '{"bytes":0}',                           '22023'),
    ('negative bytes',                        'journal', '{"bytes":-5}',                          '22023'),
    ('width 0',                               'journal', '{"width":0}',                           '22023'),
    ('height 0',                              'gallery', '{"height":0}',                          '22023'),
    ('negative width',                        'site',    '{"width":-1}',                          '22023'),
    ('a content type off the list',           'journal', '{"ct":"image/gif"}',                    '22023'),
    -- The three signed-upload routes need a RECOGNISED type; only a cover may
    -- carry NULL (accepted below).
    ('no recognised content type (signed upload)', 'gallery', '{"ct":null}',                  '22023'),
    ('no recognised content type (signed upload)', 'site',    '{"ct":null}',                  '22023'),
    ('no recognised content type (signed upload)', 'journal', '{"ct":null}',                  '22023'),
    ('a file name of 121 characters',         'site',    jsonb_build_object('filename', repeat('x', 121)), '22023'),
    ('a file name with a control character',  'cover',   jsonb_build_object('filename', 'a' || chr(10) || 'b'), '22023'),
    ('an exif key off the allowlist',         'journal', '{"exif":{"v":1,"GPSLatitude":51.5}}',   '22023'),
    ('an exif serial number',                 'journal', '{"exif":{"v":1,"BodySerialNumber":"123"}}', '22023'),
    ('an exif value of the wrong type',       'journal', '{"exif":{"v":1,"orientation":"1"}}',     '22023'),
    ('an exif value out of range',            'journal', '{"exif":{"v":1,"orientation":9}}',       '22023'),
    ('an exif enumeration off the list',      'journal', '{"exif":{"v":1,"metering_mode":"smart"}}', '22023'),
    ('exif without its version',              'journal', '{"exif":{"orientation":1}}',             '22023'),
    ('exif of the wrong version',             'journal', '{"exif":{"v":2}}',                       '22023'),
    ('exif that is not an object',            'journal', '{"exif":[1]}',                           '22023'),
    ('exif over 1024 bytes',                  'journal', jsonb_build_object('exif',
        jsonb_build_object('v', 1, 'software', repeat('é', 64), 'lens_make', repeat('é', 64)) ||
        (select jsonb_object_agg('k' || i, 1) from generate_series(1, 90) i)),                  '22023'),
    ('ISO 0',                                 'journal', '{"iso":0}',                             '22023'),
    ('aperture 100',                          'journal', '{"aperture":100}',                      '22023'),
    ('aperture not rounded to 0.1',           'journal', '{"aperture":5.66}',                     '22023'),
    ('a shutter not in the normalised form',  'journal', '{"shutter":"fast"}',                    '22023'),
    ('a shutter of 1/0',                      'journal', '{"shutter":"1/0"}',                     '22023'),
    ('focal length 0',                        'journal', '{"focal":0}',                           '22023'),
    ('a camera make over 64 characters',      'journal', jsonb_build_object('camera_make', repeat('m', 65)), '22023'),
    ('26 keywords',                           'journal', jsonb_build_object('keywords',
        (select jsonb_agg('k' || i) from generate_series(1, 26) i)),                           '22023'),
    ('a keyword of 201 characters',           'journal', jsonb_build_object('keywords', jsonb_build_array(repeat('k', 201))), '22023'),
    ('an empty keyword',                      'journal', '{"keywords":[""]}',                     '22023'),
    ('a latitude off the Earth (gallery)',    'gallery', '{"lat":91,"lon":0}',                    '22023'),
    -- Both or neither: half a coordinate is not a place.
    ('a latitude with no longitude (gallery)', 'gallery', '{"lat":51.5}',                         '22023'),
    ('a longitude with no latitude (gallery)', 'gallery', '{"lon":-0.12}',                        '22023'),
    -- HEIF is recognised but is not one of the five upload types.
    ('HEIF on a signed upload',               'gallery', '{"ct":"image/heif"}',                   '22023'),
    ('HEIF on a signed upload',               'site',    '{"ct":"image/heif"}',                   '22023'),
    ('HEIF on a signed upload',               'journal', '{"ct":"image/heif"}',                   '22023')
  ) as v(what, route, o, want) loop
    perform pg_temp.ok(c.route || ': ' || c.what, c.want,
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), c.route, t, a, pg_temp.u(), c.o)));
  end loop;

  -- The legitimate edges are ACCEPTED, so the rules are not stricter than the design.
  for c in select * from (values
    ('a null content type (readable, unlisted format)', 'cover',   '{"ct":null}'::jsonb),
    ('HEIF, on a custom cover only',                    'cover',   '{"ct":"image/heif"}'),
    ('image/avif',                                      'journal', '{"ct":"image/avif"}'),
    ('a 120-character file name',                       'site',    jsonb_build_object('filename', repeat('x', 120))),
    ('the full allowlisted exif object',                'journal', '{"exif":{"v":1,"orientation":6,"offset_time":"+02:00","exposure_program":"aperture_priority","exposure_mode":"auto","exposure_bias_ev":-0.7,"metering_mode":"pattern","flash_fired":false,"white_balance":"auto","focal_length_35mm":600,"lens_make":"Sony","color_space":"srgb","software":"Lightroom"}}'),
    ('an empty exif object',                            'journal', '{"exif":{}}'),
    ('25 keywords of 200 characters',                   'journal', jsonb_build_object('keywords',
        (select jsonb_agg(repeat('k', 199) || chr(96 + (i % 26) + 1)) from generate_series(1, 25) i))),
    ('the capture columns at their limits',             'journal', '{"iso":1000000,"aperture":99.9,"shutter":"1/999999","focal":9999.9,"camera_make":"Sony","lens":"FE 600mm"}'),
    ('a slow shutter',                                  'journal', '{"shutter":"2.5s"}'),
    ('a place on Earth (gallery)',                      'gallery', '{"lat":-33.9,"lon":18.4}')
  ) as v(what, route, o) loop
    perform pg_temp.ok(c.route || ': accepts ' || c.what, 'ok',
      pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), c.route, t, a, pg_temp.u(), c.o)));
  end loop;
end $$;


-- Every one of the five upload types is accepted on every signed-upload route.
do $$
declare
  r  text;
  ct text;
begin
  foreach r in array array['gallery', 'site', 'journal'] loop
    foreach ct in array array['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif'] loop
      perform pg_temp.ok(r || ': accepts ' || ct, 'ok',
        pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), r, pg_temp.g('A'), pg_temp.g('albumA'),
                         pg_temp.u(), jsonb_build_object('ct', ct))));
    end loop;
  end loop;
end $$;


-- ── 6. What the caller CANNOT say — from the catalogue ──────────────────────

do $$
declare
  fn    text;
  names text[];
  bad   text;
begin
  foreach fn in array array['register_gallery_photo', 'register_site_image',
                            'register_journal_image', 'register_album_cover'] loop
    select proargnames into names from pg_proc
     where pronamespace = 'public'::regnamespace and proname = fn;
    select string_agg(x, ',') into bad from unnest(names) x
     where x in ('p_state', 'p_alt_text', 'p_alt_source', 'p_alt_reviewed_at', 'p_archived_at',
                 'p_deleted_at', 'p_original_purged_at', 'p_created_by', 'p_derived_at', 'p_last_error');
    perform pg_temp.ok(fn || ': no parameter for state/alt/lifecycle/created_by', 'none', coalesce(bad, 'none'));
    perform pg_temp.ok(fn || ': a latitude/longitude parameter only on the gallery route',
      case when fn = 'register_gallery_photo' then 'yes' else 'no' end,
      case when 'p_latitude' = any (names) and 'p_longitude' = any (names) then 'yes'
           when 'p_latitude' = any (names) or 'p_longitude' = any (names) then 'HALF' else 'no' end);
    perform pg_temp.ok(fn || ': an original-path parameter except on the cover route',
      case when fn = 'register_album_cover' then 'no' else 'yes' end,
      case when 'p_original_path' = any (names) then 'yes' else 'no' end);
  end loop;
end $$;


-- ── 7. Idempotency — each route twice ───────────────────────────────────────

do $$
declare
  t  uuid := pg_temp.g('A');
  a  uuid := pg_temp.g('albumA');
  u  text;
  kb text;
  r1 text;
  r2 text;
  n  int;
begin
  -- A
  u := pg_temp.u(); kb := vi.key_base('gallery', t, a, u);
  r1 := vi.as('authenticated', pg_temp.g('userA'), 'gallery', t, a, u, '{"keywords":["heron"]}');
  r2 := vi.as('authenticated', pg_temp.g('userA'), 'gallery', t, a, u, '{"keywords":["heron"]}');
  perform pg_temp.ok('gallery twice: the same photo and asset come back', 'same',
    case when r1 = r2 and pg_temp.st(r1) = 'ok' then 'same' else r1 || ' / ' || r2 end);
  perform pg_temp.ok('gallery twice: one asset', '1',
    (select count(*)::text from public.photo_assets where tenant_id = t and key_base = kb));
  perform pg_temp.ok('gallery twice: one photos row', '1',
    (select count(*)::text from public.photos where asset_id = (select id from public.photo_assets where key_base = kb)));
  perform pg_temp.ok('gallery twice: one gallery usage', '1',
    (select count(*)::text from public.photo_usages where asset_id = (select id from public.photo_assets where key_base = kb)));

  -- B
  u := pg_temp.u(); kb := vi.key_base('site', t, null, u);
  r1 := vi.as('authenticated', pg_temp.g('userA'), 'site', t, null, u);
  r2 := vi.as('authenticated', pg_temp.g('userA'), 'site', t, null, u);
  perform pg_temp.ok('site twice: the same row and asset come back', 'same',
    case when r1 = r2 and pg_temp.st(r1) = 'ok' then 'same' else r1 || ' / ' || r2 end);
  perform pg_temp.ok('site twice: one site_images row', '1',
    (select count(*)::text from public.site_images where asset_id = (select id from public.photo_assets where key_base = kb)));

  -- C
  u := pg_temp.u(); kb := vi.key_base('journal', t, null, u);
  r1 := vi.as('authenticated', pg_temp.g('userA'), 'journal', t, null, u);
  r2 := vi.as('authenticated', pg_temp.g('userA'), 'journal', t, null, u);
  perform pg_temp.ok('journal twice: the same asset', 'same',
    case when r1 = r2 and pg_temp.st(r1) = 'ok' then 'same' else r1 || ' / ' || r2 end);
  perform pg_temp.ok('journal twice: one asset', '1',
    (select count(*)::text from public.photo_assets where key_base = kb));

  -- D
  u := pg_temp.u(); kb := vi.key_base('cover', t, a, u);
  r1 := vi.as('authenticated', pg_temp.g('userA'), 'cover', t, a, u);
  r2 := vi.as('authenticated', pg_temp.g('userA'), 'cover', t, a, u);
  perform pg_temp.ok('cover twice: the same asset', 'same',
    case when r1 = r2 and pg_temp.st(r1) = 'ok' then 'same' else r1 || ' / ' || r2 end);
  perform pg_temp.ok('cover twice: the album''s cover is this upload, and cover_photo_id is cleared',
    kb || '/1600.webp|null',
    (select cover_custom_path || '|' || coalesce(cover_photo_id::text, 'null') from public.albums where id = a));
  perform pg_temp.ok('cover: the asset keeps no original', 'null',
    (select coalesce(original_path, 'null') from public.photo_assets where key_base = kb));

  -- A retry never rewrites: created_by stays the first uploader even when an
  -- admin retries, and a changed exif on the retry is not written over the first.
  u := pg_temp.u(); kb := vi.key_base('journal', t, null, u);
  perform vi.as('authenticated', pg_temp.g('userA'), 'journal', t, null, u, '{"exif":{"v":1,"orientation":1}}');
  update public.profiles set is_platform_admin = true where id = pg_temp.g('userB');
  perform pg_temp.ok('a retry by a platform admin succeeds', 'ok',
    pg_temp.st(vi.as('authenticated', pg_temp.g('userB'), 'journal', t, null, u, '{"exif":{"v":1,"orientation":6}}')));
  update public.profiles set is_platform_admin = false where id = pg_temp.g('userB');
  perform pg_temp.ok('a retry does not overwrite created_by', pg_temp.g('userA')::text,
    (select created_by::text from public.photo_assets where key_base = kb));
  perform pg_temp.ok('a retry does not overwrite the facts', '{"v": 1, "orientation": 1}',
    (select exif::text from public.photo_assets where key_base = kb));
end $$;


-- ── 8. One key is one file; lifecycle is P6's ───────────────────────────────

do $$
declare
  t  uuid := pg_temp.g('A');
  u  text := pg_temp.u();
  kb text := vi.key_base('journal', t, null, u);
begin
  perform vi.as('authenticated', pg_temp.g('userA'), 'journal', t, null, u);
  perform pg_temp.ok('the same key with a different SHA-256 is refused', '22023',
    pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), 'journal', t, null, u,
      jsonb_build_object('sha', repeat('cd', 32)))));

  update public.photo_assets set archived_at = now() where key_base = kb;
  perform pg_temp.ok('a retry against an ARCHIVED asset is refused', '55000',
    pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), 'journal', t, null, u)));
  update public.photo_assets set archived_at = null, deleted_at = now() where key_base = kb;
  perform pg_temp.ok('a retry against a DELETED asset is refused', '55000',
    pg_temp.st(vi.as('authenticated', pg_temp.g('userA'), 'journal', t, null, u)));
end $$;


-- ── 9. What each route writes ───────────────────────────────────────────────

do $$
declare
  t     uuid := pg_temp.g('A');
  a     uuid := pg_temp.g('albumA');
  u     text;
  kb    text;
  res   text;
  pid   uuid;
  aid   uuid;
  maxso int;
  before_usages int;
begin
  -- A: the photos row has exactly the pre-P2 columns plus asset_id, and
  -- sort_order is "after the last", as registerPhoto computed it.
  select coalesce(max(sort_order), -1) into maxso from public.photos where tenant_id = t and album_id = a;
  u := pg_temp.u(); kb := vi.key_base('gallery', t, a, u);
  res := vi.as('authenticated', pg_temp.g('userA'), 'gallery', t, a, u,
    '{"keywords":["heron","wader"],"taken_at":"2026-05-01T06:30:00Z","lat":51.5,"lon":-0.12,"bytes":777777}');
  pid := split_part(res, '|', 2)::uuid; aid := split_part(res, '|', 3)::uuid;
  perform pg_temp.ok('gallery: the photos row as registerPhoto wrote it, plus asset_id',
    (maxso + 1) || '|' || kb || '/1600.webp|' || kb || '/original.jpg|777777|1600x1067|{heron,wader}|51.5|-0.12|' || aid,
    (select sort_order || '|' || storage_path || '|' || original_path || '|' || original_bytes || '|' ||
            width || 'x' || height || '|' || tags::text || '|' || latitude || '|' || longitude || '|' || asset_id
       from public.photos where id = pid));
  perform pg_temp.ok('gallery: row and asset agree on sizes, dimensions and bytes', 'yes',
    (select case when ph.derivatives = pa.derivatives and ph.width = pa.width and ph.height = pa.height
                  and ph.original_bytes = pa.original_bytes and ph.storage_path = pa.display_path
                 then 'yes' else 'no' end
       from public.photos ph join public.photo_assets pa on pa.id = ph.asset_id where ph.id = pid));
  perform pg_temp.ok('gallery: exactly one usage, the valid gallery one', 'gallery|photo|1',
    (select string_agg(kind || '|' || field || '|' || (photo_id = pid)::int, ',')
       from public.photo_usages where asset_id = aid));
  perform pg_temp.ok('gallery: the asset is derived, with GPS kept', 'derived|51.5|-0.12',
    (select state || '|' || latitude || '|' || longitude from public.photo_assets where id = aid));

  -- B, C, D write no usage at all, and no place.
  select count(*) into before_usages from public.photo_usages;
  perform vi.as('authenticated', pg_temp.g('userA'), 'site', t, null, pg_temp.u());
  perform vi.as('authenticated', pg_temp.g('userA'), 'journal', t, null, pg_temp.u());
  perform vi.as('authenticated', pg_temp.g('userA'), 'cover', t, a, pg_temp.u());
  perform pg_temp.ok('site, journal and cover create no usage', before_usages::text,
    (select count(*)::text from public.photo_usages));
  perform pg_temp.ok('no asset outside the gallery route has a place', '0',
    (select count(*)::text from public.photo_assets
      where (latitude is not null or longitude is not null) and key_base not like '%/photos/%'));

  -- B: the site_images row as registerSiteImage wrote it, plus asset_id.
  u := pg_temp.u(); kb := vi.key_base('site', t, null, u);
  res := vi.as('authenticated', pg_temp.g('userA'), 'site', t, null, u, '{"filename":"portrait.jpg","bytes":5555}');
  perform pg_temp.ok('site: the site_images row, plus asset_id',
    kb || '/1600.webp|' || kb || '/original.jpg|5555|portrait.jpg|' || split_part(res, '|', 3),
    (select storage_path || '|' || original_path || '|' || bytes || '|' || filename || '|' || asset_id
       from public.site_images where id = split_part(res, '|', 2)::uuid));
end $$;


-- ── 10. A recreated relationship takes the CANONICAL asset's facts ─────────
--
-- The dangerous state P2 accepts: the asset exists, its relationship row is
-- gone (deletePhoto, or Uploads' "forget"), and the same upload is registered
-- again — same key, SAME SHA-256, but with other, otherwise-valid facts. The
-- helper does not rewrite the asset. The recreated row must therefore be built
-- from the asset, not from the retry: otherwise the row and the asset it
-- points at disagree about paths, sizes, dimensions and bytes.

do $$
declare
  t   uuid := pg_temp.g('A');
  a   uuid := pg_temp.g('albumA');
  u   text;
  kb  text;
  res text;
  aid uuid;
  first_facts  jsonb;
  retry_facts  jsonb;
begin
  -- ── Gallery ─────────────────────────────────────────────────────────────
  u := pg_temp.u(); kb := vi.key_base('gallery', t, a, u);
  first_facts := jsonb_build_object('keywords', jsonb_build_array('heron'), 'lat', 51.5, 'lon', -0.12,
                                    'taken_at', '2026-05-01T06:30:00Z', 'bytes', 4096);
  res := vi.as('authenticated', pg_temp.g('userA'), 'gallery', t, a, u, first_facts);
  aid := split_part(res, '|', 3)::uuid;
  delete from public.photos where asset_id = aid;          -- the usage cascades away
  retry_facts := jsonb_build_object(
    'derivatives', jsonb_build_object('400', kb || '/400.webp', '800', kb || '/800.webp'),
    'display_path', kb || '/800.webp', 'width', 800, 'height', 533, 'bytes', 999,
    'keywords', jsonb_build_array('changed'), 'lat', 10.0, 'lon', 20.0,
    'taken_at', '2020-01-01T00:00:00Z');
  res := vi.as('authenticated', pg_temp.g('userA'), 'gallery', t, a, u, retry_facts);
  perform pg_temp.ok('gallery retry after the membership was deleted succeeds', 'ok', pg_temp.st(res));
  perform pg_temp.ok('gallery: the recreated photos row has the ASSET''s facts, not the retry''s',
    kb || '/1600.webp|' || kb || '/original.jpg|4096|1600x1067|{heron}|51.5|-0.12|2026-05-01 06:30:00+00|1600,800,400',
    (select storage_path || '|' || original_path || '|' || original_bytes || '|' || width || 'x' || height
            || '|' || tags::text || '|' || latitude || '|' || longitude || '|'
            || to_char(taken_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || '+00|'
            || (select string_agg(k, ',' order by k::int desc) from jsonb_object_keys(derivatives) k)
       from public.photos where asset_id = aid));
  perform pg_temp.ok('gallery: the recreated row agrees with its asset on every file fact', 'yes',
    (select case when ph.storage_path = pa.display_path and ph.original_path = pa.original_path
                  and ph.original_bytes = pa.original_bytes and ph.derivatives = pa.derivatives
                  and ph.width = pa.width and ph.height = pa.height and ph.tags = pa.keywords
                  and ph.taken_at = pa.taken_at and ph.latitude = pa.latitude and ph.longitude = pa.longitude
                 then 'yes' else 'no' end
       from public.photos ph join public.photo_assets pa on pa.id = ph.asset_id where pa.id = aid));
  perform pg_temp.ok('gallery: the asset itself was not rewritten by the retry', '1600|1067|4096',
    (select width || '|' || height || '|' || original_bytes from public.photo_assets where id = aid));

  -- ── Site ────────────────────────────────────────────────────────────────
  u := pg_temp.u(); kb := vi.key_base('site', t, null, u);
  res := vi.as('authenticated', pg_temp.g('userA'), 'site', t, null, u,
               '{"filename":"portrait.jpg","bytes":5555}');
  aid := split_part(res, '|', 3)::uuid;
  delete from public.site_images where asset_id = aid;
  res := vi.as('authenticated', pg_temp.g('userA'), 'site', t, null, u, jsonb_build_object(
    'derivatives', jsonb_build_object('400', kb || '/400.webp'), 'display_path', kb || '/400.webp',
    'width', 400, 'height', 300, 'bytes', 1, 'filename', 'renamed.jpg'));
  perform pg_temp.ok('site retry after the Uploads row was deleted succeeds', 'ok', pg_temp.st(res));
  perform pg_temp.ok('site: the recreated site_images row has the ASSET''s facts, not the retry''s',
    kb || '/1600.webp|' || kb || '/original.jpg|1600x1067|5555|portrait.jpg|3',
    (select storage_path || '|' || original_path || '|' || width || 'x' || height || '|' || bytes
            || '|' || filename || '|' || (select count(*) from jsonb_object_keys(derivatives))
       from public.site_images where asset_id = aid));

  -- ── Cover ───────────────────────────────────────────────────────────────
  u := pg_temp.u(); kb := vi.key_base('cover', t, a, u);
  perform vi.as('authenticated', pg_temp.g('userA'), 'cover', t, a, u);
  res := vi.as('authenticated', pg_temp.g('userA'), 'cover', t, a, u, jsonb_build_object(
    'derivatives', jsonb_build_object('400', kb || '/400.webp', '800', kb || '/800.webp'),
    'display_path', kb || '/800.webp', 'width', 800, 'height', 533));
  perform pg_temp.ok('cover: a same-SHA retry succeeds', 'ok', pg_temp.st(res));
  perform pg_temp.ok('cover: …and cannot move the cover away from the asset''s display path',
    kb || '/1600.webp',
    (select cover_custom_path from public.albums where id = a));
end $$;


-- ── Report, and undo everything ─────────────────────────────────────────────

do $$
declare
  report text;
  failed int;
  total  int;
begin
  select string_agg(
           format('%s  %-72s expected %-24s got %s',
                  case when coalesce(pass, false) then '  ok  ' else ' FAIL ' end,
                  step, expected, actual),
           E'\n' order by ord)
    into report
    from pi_res;

  select count(*), count(*) filter (where not coalesce(pass, false)) into total, failed from pi_res;

  raise exception E'\n\n%\n\n%\n\nNothing was kept — this transaction always rolls back.\n',
    report,
    case when failed = 0 then format('All %s checks passed.', total)
         else format('%s of %s check(s) failed. P2 is NOT ready.', failed, total) end;
end $$;

rollback;
