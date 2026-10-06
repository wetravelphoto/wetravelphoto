-- Proof of P4's database half — db/migrations/2026-10-05_photo_backfill.sql:
-- the key grammar, the claim check, the two service-role reads, the legacy
-- writer and the flat-aware resolver.
--
--   psql -d wtp -f db/test-fixture.sql
--   psql -d wtp -f db/migrations/2026-10-05_photo_backfill.sql
--   psql -d wtp -f db/verify-photo-backfill.sql
--
-- (The fixture is production as reconciled after P3. P4 is NOT deployed, so it
-- is applied on top here; the fixture itself is not touched before
-- deployment.)
--
-- One transaction that ALWAYS ends by raising; nothing is kept. Every call to
-- a P4 function is made AS A REAL ROLE — service_role, authenticated, anon —
-- or deliberately as the owner without one, and every refusal asserts WHICH
-- LAYER refused: the grant ("permission denied for function"), the run-time
-- role check ("Only the backfill service …"), or the function's own rule.
-- What the backfill does end to end (the CLI, storage, the P3 rebuild, two
-- connections) is .mk/backfill.ts; the foreign keys are
-- db/verify-photo-assets-fk.sql and scripts/photo-assets-fk.mjs.
--
-- Portable run (Node + pg, its own scratch database on a loopback server):
--   node scripts/p4-local-db.mjs sql db/migrations/2026-10-05_photo_backfill.sql db/verify-photo-backfill.sql

begin;

create temp table pb_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);
grant all on pb_res to public;

create function pg_temp.ok(p_step text, p_expected text, p_actual text)
returns void language sql as $$
  insert into pb_res (step, expected, actual, pass)
  values (p_step, p_expected, coalesce(p_actual, '(null)'), p_expected = coalesce(p_actual, '(null)'));
$$;

-- Like ok(), but the actual value only has to START with the expected text.
create function pg_temp.starts(p_step text, p_expected text, p_actual text)
returns void language sql as $$
  insert into pb_res (step, expected, actual, pass)
  values (p_step, p_expected || '…', coalesce(p_actual, '(null)'), coalesce(p_actual, '') like p_expected || '%');
$$;

do $$ begin
  perform set_config('pb.owner', session_user, true);
  update public.profiles set is_platform_admin = false;
end $$;

-- Test ids. Uploads are ordinary lower-case uuids.
create function pg_temp.u(n int) returns text language sql immutable as
  $$ select '0a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0') $$;
create function pg_temp.ta() returns text language sql immutable as $$ select 'aaaaaaaa-0000-0000-0000-000000000001' $$;
create function pg_temp.tb() returns text language sql immutable as $$ select 'aaaaaaaa-0000-0000-0000-000000000002' $$;
create function pg_temp.aa() returns text language sql immutable as $$ select 'bbbbbbbb-0000-0000-0000-000000000001' $$;
create function pg_temp.ab() returns text language sql immutable as $$ select 'bbbbbbbb-0000-0000-0000-000000000003' $$;
create function pg_temp.pid(n int) returns uuid language sql immutable as
  $$ select ('cccccccc-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
create function pg_temp.lad(base text, variadic sizes text[]) returns jsonb language sql immutable as
  $$ select coalesce(jsonb_object_agg(s, base || '/' || s || '.webp'), '{}'::jsonb) from unnest(sizes) s $$;

-- Runs one SQL expression returning text AS a role, then returns to the
-- owner. 'ERR <sqlstate> <message>' on a refusal. p_role = 'owner' runs as the
-- owner with role set to itself — i.e. without service_role.
create function pg_temp.as_role(p_role text, p_sql text) returns text language plpgsql as $$
declare v text; st text; msg text;
begin
  perform set_config('role', case when p_role = 'owner' then current_setting('pb.owner') else p_role end, true);
  if p_role in ('authenticated', 'anon') then
    perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  end if;
  execute 'select (' || p_sql || ')::text' into v;
  perform set_config('role', current_setting('pb.owner'), true);
  return v;
exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text;
  perform set_config('role', current_setting('pb.owner'), true);
  return 'ERR ' || st || ' ' || msg;
end $$;

-- One call to the writer. `p` names the parameters without their p_ prefix;
-- anything not named is NULL ({} for the two jsonb ones, false for provenance).
-- Returns the status, or 'ERR <sqlstate> <message>'.
--
-- For a 'photo' source with no 'source_tags' given, the row's CURRENT tags are
-- sent (read as the owner first), and no 'keywords' means an empty list — so a
-- check about something else is not refused for the tags. Section 5a tests the
-- tag binding itself, explicitly.
create function pg_temp.reg(p jsonb, p_role text default 'service_role') returns text language plpgsql as $$
declare r jsonb; st text; msg text; v_tags text[];
begin
  if p ->> 'source' = 'photo' then
    if p ? 'source_tags' then
      v_tags := case when jsonb_typeof(p -> 'source_tags') = 'array'
                     then array(select jsonb_array_elements_text(p -> 'source_tags')) end;
    else
      v_tags := coalesce((select ph.tags from public.photos ph where ph.id = (p ->> 'source_id')::uuid), '{}');
    end if;
    if not p ? 'keywords' then
      p := p || '{"keywords": []}'::jsonb;
    end if;
  end if;
  perform set_config('role', case when p_role = 'owner' then current_setting('pb.owner') else p_role end, true);
  if p_role in ('authenticated', 'anon') then
    perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  end if;
  select public.register_legacy_photo_asset(
    p_tenant => (p ->> 'tenant')::uuid,
    p_source => p ->> 'source',
    p_source_id => (p ->> 'source_id')::uuid,
    p_parent => p ->> 'parent',
    p_parent_key => p ->> 'parent_key',
    p_slot => p ->> 'slot',
    p_source_path => p ->> 'source_path',
    p_key_base => p ->> 'key_base',
    p_original_path => p ->> 'original_path',
    p_display_path => p ->> 'display_path',
    p_derivatives => coalesce(p -> 'derivatives', '{}'::jsonb),
    p_width => (p ->> 'width')::integer,
    p_height => (p ->> 'height')::integer,
    p_original_bytes => (p ->> 'original_bytes')::bigint,
    p_content_sha256 => p ->> 'sha',
    p_content_type => p ->> 'content_type',
    p_taken_at => (p ->> 'taken_at')::timestamptz,
    p_camera_make => p ->> 'camera_make',
    p_camera_model => null, p_lens => null,
    p_iso => (p ->> 'iso')::integer,
    p_aperture => null, p_shutter => null, p_focal_length => null,
    p_keywords => case when jsonb_typeof(p -> 'keywords') = 'array' then array(select jsonb_array_elements_text(p -> 'keywords')) end,
    p_source_tags => v_tags,
    p_exif => coalesce(p -> 'exif', '{}'::jsonb),
    p_provenance_reviewed => coalesce((p ->> 'provenance')::boolean, false))
    into r;
  perform set_config('role', current_setting('pb.owner'), true);
  return r ->> 'status';
exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text;
  perform set_config('role', current_setting('pb.owner'), true);
  return 'ERR ' || st || ' ' || msg;
end $$;

create function pg_temp.assets() returns text language sql as
  $$ select count(*)::text from public.photo_assets $$;


-- ══ 0. Synthetic legacy data, one row per era ═══════════════════════════════
--
-- Site A (album aa):  a FLAT photograph with an old-job ladder; an unprefixed
-- FOLDER photograph with its original; a PREFIXED folder photograph; a SAMPLE;
-- a P2 photograph (asset already linked); two rows of one upload; an Uploads
-- row; a flat custom cover; a story whose featured image is a flat journal
-- file; a home page holding a flat gallery path and a folder derivative.
-- Site B (album ab): a page naming an unprefixed journal file — a foreign claim.

do $$
declare
  a text := pg_temp.aa();
  b text := pg_temp.ab();
  ta uuid := pg_temp.ta()::uuid;
  tb uuid := pg_temp.tb()::uuid;
  flat text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(1);
  fold text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(2);
  pref text := 't/' || pg_temp.ta() || '/photos/' || pg_temp.aa() || '/' || pg_temp.u(3);
  dup  text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(8);
  p2   text := 't/' || pg_temp.ta() || '/photos/' || pg_temp.aa() || '/' || pg_temp.u(9);
  site text := 't/' || pg_temp.ta() || '/site-images/' || pg_temp.u(4);
  v_asset uuid;
begin
  insert into public.photos (id, tenant_id, album_id, storage_path, original_path, derivatives, width, height,
                             sort_order, taken_at, latitude, longitude, tags) values
    (pg_temp.pid(161), ta, a::uuid, flat || '.jpg', null, pg_temp.lad(flat, '400', '1600'), 2400, 1600, 10,
     '2019-07-01T06:00:00Z', -1.5, 35.1, array['kenya', 'lion', '', 'bad' || chr(1) || 'tag']),
    (pg_temp.pid(162), ta, a::uuid, fold || '/2400.webp', fold || '/original.jpg', pg_temp.lad(fold, '400', '800', '1600', '2400'),
     6000, 4000, 11, null, null, null, '{}'),
    (pg_temp.pid(163), ta, a::uuid, pref || '/1600.webp', pref || '/original.png', pg_temp.lad(pref, '400', '800', '1600'),
     1800, 1200, 12, null, null, null, '{}'),
    (pg_temp.pid(164), ta, a::uuid, '/samples/wildlife/lion.webp', null, '{}', 1600, 1067, 13, null, null, null, '{}'),
    (pg_temp.pid(168), ta, a::uuid, dup || '.jpg', null, '{}', 800, 600, 14, null, null, null, '{}'),
    (pg_temp.pid(169), ta, 'bbbbbbbb-0000-0000-0000-000000000002', dup || '.jpg', null, '{}', 800, 600, 15, null, null, null, '{}');

  -- A P2 photograph: asset first, row pointing at it, gallery usage — as
  -- register_gallery_photo leaves them.
  insert into public.photo_assets (tenant_id, key_base, original_path, display_path, derivatives, width, height,
                                   original_bytes, content_sha256, content_type, state, derived_at)
  values (ta, p2, p2 || '/original.jpg', p2 || '/800.webp', pg_temp.lad(p2, '400', '800'), 800, 533,
          4096, repeat('ab', 32), 'image/jpeg', 'derived', now())
  returning id into v_asset;
  insert into public.photos (id, tenant_id, album_id, storage_path, original_path, original_bytes, derivatives,
                             width, height, sort_order, asset_id)
  values (pg_temp.pid(170), ta, a::uuid, p2 || '/800.webp', p2 || '/original.jpg', 4096, pg_temp.lad(p2, '400', '800'),
          800, 533, 16, v_asset);
  insert into public.photo_usages (tenant_id, asset_id, kind, photo_id, field)
  values (ta, v_asset, 'gallery', pg_temp.pid(170), 'photo');

  insert into public.site_images (id, tenant_id, storage_path, original_path, derivatives, width, height, bytes, filename)
  values ('eeeeeeee-0000-0000-0000-0000000000a4', ta, site || '/800.webp', site || '/original.webp',
          pg_temp.lad(site, '400', '800'), 900, 600, 12345, 'harbour.webp');

  update public.albums set cover_custom_path = 'covers/' || a || '/' || pg_temp.u(5) || '.jpg'
   where id = a::uuid;
  update public.blog_posts set featured_custom_path = 'journal/' || pg_temp.u(6) || '.jpg',
         blocks = jsonb_build_array(jsonb_build_object('id', 'x', 'type', 'image',
                   'image', jsonb_build_object('path', fold || '/1600.webp', 'alt', '')))
   where id = 'dddddddd-0000-0000-0000-000000000001';
  update public.site_settings set hero_image_path = flat || '.jpg' where tenant_id = ta;

  -- Site B's home page names an unprefixed journal file: B claims it.
  insert into public.page_sections (tenant_id, page, type, position, settings)
  values (tb, 'home', 'intro', 0, jsonb_build_object('image_path', 'journal/' || pg_temp.u(7) || '/1600.webp'));
  -- And site A's draft names the same file.
  update public.site_draft set pages = jsonb_build_object('home', jsonb_build_array(
           jsonb_build_object('type', 'intro', 'settings',
             jsonb_build_object('image_path', 'journal/' || pg_temp.u(7) || '/1600.webp'))))
   where tenant_id = ta;
end $$;


-- ══ 1. The catalogue: security, search_path, who may EXECUTE ════════════════

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('photo_backfill_key_base(text)',                       'invoker', 'none'),
      ('photo_backfill_foreign_claim(uuid, text, boolean)',   'invoker', 'none'),
      ('photo_usage_resolve_path(uuid, text)',                'invoker', 'none'),
      ('read_photo_backfill_inventory(uuid)',                 'definer', 'service_role'),
      ('read_photo_backfill_claims(uuid, text[])',            'definer', 'service_role'),
      ('register_legacy_photo_asset(uuid, text, uuid, text, text, text, text, text, text, text, jsonb, integer, integer, bigint, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], text[], jsonb, boolean)',
                                                              'definer', 'service_role')
    ) v(sig, sec, who)
  loop
    perform pg_temp.ok(r.sig || ': ' || r.sec, r.sec,
      (select case when p.prosecdef then 'definer' else 'invoker' end from pg_proc p
        where p.oid = ('public.' || r.sig)::regprocedure));
    perform pg_temp.ok(r.sig || ': search_path is empty', 'search_path=""',
      (select array_to_string(p.proconfig, ',') from pg_proc p where p.oid = ('public.' || r.sig)::regprocedure));
    perform pg_temp.ok(r.sig || ': EXECUTE held by', r.who,
      coalesce((select string_agg(x, ',' order by x) from unnest(array['anon', 'authenticated', 'service_role']) x
                 where has_function_privilege(x, ('public.' || r.sig)::regprocedure, 'execute')), 'none'));
    perform pg_temp.ok(r.sig || ': not executable by PUBLIC', 'false',
      has_function_privilege('public', ('public.' || r.sig)::regprocedure, 'execute')::text);
  end loop;
end $$;

do $$ begin
  perform pg_temp.ok('the writer has no parameter for state, alt, lifecycle or created_by', '0',
    (select count(*)::text from pg_proc p, unnest(p.proargnames) a
      where p.proname = 'register_legacy_photo_asset'
        and a in ('p_state', 'p_alt_text', 'p_alt_source', 'p_alt_reviewed_at', 'p_archived_at',
                  'p_deleted_at', 'p_original_purged_at', 'p_created_by', 'p_derived_at',
                  'p_latitude', 'p_longitude', 'p_filename')));
  perform pg_temp.ok('no table grant changed: service_role still holds nothing on photo_assets', 'false',
    has_table_privilege('service_role', 'public.photo_assets', 'insert,select,update,delete')::text);
  perform pg_temp.ok('…nor on photo_usages', 'false',
    has_table_privilege('service_role', 'public.photo_usages', 'insert,select,update,delete')::text);
  perform pg_temp.ok('…and authenticated still only SELECTs photo_assets', 'false',
    has_table_privilege('authenticated', 'public.photo_assets', 'insert,update,delete')::text);
end $$;


-- ══ 2. The grammar ══════════════════════════════════════════════════════════

do $$
declare
  t text := pg_temp.ta();
  a text := pg_temp.aa();
  u text := pg_temp.u(1);
  r record;
begin
  for r in
    select * from (values
      -- recognised: every era
      ('photos/' || a || '/' || u,                          'photos/' || a || '/' || u),
      ('photos/' || a || '/' || u || '.jpg',                'photos/' || a || '/' || u),
      ('photos/' || a || '/' || u || '/original.tif',       'photos/' || a || '/' || u),
      ('photos/' || a || '/' || u || '/2400.webp',          'photos/' || a || '/' || u),
      ('covers/' || a || '/' || u || '.jpg',                'covers/' || a || '/' || u),
      ('covers/' || a || '/' || u || '/800.webp',           'covers/' || a || '/' || u),
      ('journal/' || u || '.jpg',                           'journal/' || u),
      ('journal/' || u || '/1600.webp',                     'journal/' || u),
      ('t/' || t || '/photos/' || a || '/' || u || '/400.webp', 't/' || t || '/photos/' || a || '/' || u),
      ('t/' || t || '/covers/' || a || '/' || u || '/400.webp', 't/' || t || '/covers/' || a || '/' || u),
      ('t/' || t || '/journal/' || u || '/original.jpg',    't/' || t || '/journal/' || u),
      ('t/' || t || '/site-images/' || u || '/800.webp',    't/' || t || '/site-images/' || u),
      ('t/' || t || '/site-images/' || u,                   't/' || t || '/site-images/' || u),
      -- refused
      ('t/' || t || '/photos/' || a || '/' || u || '.jpg',  null),  -- the flat era had no prefix
      ('site-images/' || u || '/800.webp',                  null),  -- nor site-images without one
      ('journal/' || u || '.png',                           null),
      ('journal/' || u || '/original.gif',                  null),
      ('journal/' || u || '/1200.webp',                     null),
      ('journal/' || upper(u) || '/400.webp',               null),
      ('photos/' || a || '/not-a-uuid/400.webp',            null),
      ('photos/' || u || '.jpg',                            null),
      ('/samples/wildlife/lion.webp',                       null),
      ('https://cdn.example/photos/' || a || '/' || u || '.jpg', null),
      ('photos/' || a || '/../' || u || '/400.webp',        null),
      ('photos/' || a || '//' || u || '/400.webp',          null),
      ('photos/' || a || '/' || u || '%2F400.webp',         null),
      ('photos/' || a || '/' || u || '/400.webp?v=2',       null),
      ('photos/' || a || '/' || u || '/400.webp' || chr(10), null),
      ('branding/logo-' || u || '.png',                     null),
      ('covers/' || a || '/' || u || '.mp4',                null),
      ('t/one/photos/a/1/2400.webp',                        null),
      ('',                                                  null)
    ) v(path, want)
  loop
    perform pg_temp.ok('key base of ' || replace(r.path, chr(10), '\n'), coalesce(r.want, '(null)'),
                       public.photo_backfill_key_base(r.path));
  end loop;
  perform pg_temp.ok('key base is idempotent on a flat base', 'photos/' || a || '/' || u,
    public.photo_backfill_key_base(public.photo_backfill_key_base('photos/' || a || '/' || u || '.jpg')));
end $$;


-- ══ 3. Who may call: the grant, then the run-time check ═════════════════════

do $$
declare
  args jsonb := jsonb_build_object('tenant', pg_temp.ta(), 'source', 'photo', 'source_id', pg_temp.pid(161),
    'source_path', 'photos/' || pg_temp.aa() || '/' || pg_temp.u(1) || '.jpg',
    'key_base', 'photos/' || pg_temp.aa() || '/' || pg_temp.u(1),
    'display_path', 'photos/' || pg_temp.aa() || '/' || pg_temp.u(1) || '.jpg',
    'derivatives', pg_temp.lad('photos/' || pg_temp.aa() || '/' || pg_temp.u(1), '400', '1600'),
    'width', 2400, 'height', 1600);
begin
  perform pg_temp.starts('writer as authenticated: refused by the GRANT', 'ERR 42501 permission denied for function',
    pg_temp.reg(args, 'authenticated'));
  perform pg_temp.starts('writer as anon: refused by the GRANT', 'ERR 42501 permission denied for function',
    pg_temp.reg(args, 'anon'));
  perform pg_temp.starts('writer as the owner without service_role: refused by the RUN-TIME check',
    'ERR 42501 Only the backfill service', pg_temp.reg(args, 'owner'));
  perform pg_temp.starts('inventory as authenticated: refused by the GRANT', 'ERR 42501 permission denied for function',
    pg_temp.as_role('authenticated', format('public.read_photo_backfill_inventory(%L)', pg_temp.ta())));
  perform pg_temp.starts('inventory as the owner without service_role: refused by the RUN-TIME check',
    'ERR 42501 Only the backfill service', pg_temp.as_role('owner', format('public.read_photo_backfill_inventory(%L)', pg_temp.ta())));
  perform pg_temp.starts('claims as anon: refused by the GRANT', 'ERR 42501 permission denied for function',
    pg_temp.as_role('anon', format('public.read_photo_backfill_claims(%L, ''{}'')', pg_temp.ta())));
  perform pg_temp.starts('the key grammar as service_role: refused by the GRANT (internal)', 'ERR 42501 permission denied for function',
    pg_temp.as_role('service_role', 'public.photo_backfill_key_base(''journal/x'')'));
  perform pg_temp.starts('the claim check as service_role: refused by the GRANT (internal)', 'ERR 42501 permission denied for function',
    pg_temp.as_role('service_role', format('public.photo_backfill_foreign_claim(%L, ''journal/x'', true)', pg_temp.ta())));
  perform pg_temp.ok('…and none of those wrote anything', '1', pg_temp.assets());
end $$;

-- A MISTAKEN grant: the run-time check still refuses.
grant execute on function public.register_legacy_photo_asset(
  uuid, text, uuid, text, text, text, text, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], text[], jsonb, boolean) to authenticated;
do $$ begin
  perform pg_temp.starts('with a MISTAKEN grant to authenticated, the run-time check still refuses',
    'ERR 42501 Only the backfill service',
    pg_temp.reg(jsonb_build_object('tenant', pg_temp.ta(), 'source', 'photo', 'source_id', pg_temp.pid(161)), 'authenticated'));
end $$;
revoke execute on function public.register_legacy_photo_asset(
  uuid, text, uuid, text, text, text, text, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], text[], jsonb, boolean) from authenticated;


-- ══ 4. The inventory and the claims ═════════════════════════════════════════

do $$
declare
  inv jsonb;
  claims jsonb;
begin
  inv := pg_temp.as_role('service_role', format('public.read_photo_backfill_inventory(%L)', pg_temp.ta()))::jsonb;
  perform pg_temp.ok('inventory: every photos row of the site, used or not (3 fixture + 7 here)', '10',
    jsonb_array_length(inv -> 'photos')::text);
  perform pg_temp.ok('inventory: none of another site''s rows', '0',
    (select count(*)::text from jsonb_array_elements(inv -> 'photos') p
      where (p ->> 'id')::uuid in (select id from public.photos where tenant_id = pg_temp.tb()::uuid)));
  perform pg_temp.ok('inventory: the Uploads row', '1', jsonb_array_length(inv -> 'site_images')::text);
  perform pg_temp.ok('inventory: the albums with their covers', '2', jsonb_array_length(inv -> 'albums')::text);
  perform pg_temp.ok('inventory: the existing (P2) asset', '1', jsonb_array_length(inv -> 'assets')::text);
  perform pg_temp.ok('inventory: sources — live pages, the draft, the story',
    'draft,live_page:about,live_page:home,post:dddddddd-0000-0000-0000-000000000001',
    (select string_agg(s ->> 'parent' || coalesce(':' || (s ->> 'key'), ''), ','
                       order by s ->> 'parent' || coalesce(':' || (s ->> 'key'), ''))
       from jsonb_array_elements(inv -> 'sources') s));
  perform pg_temp.ok('inventory: a source is P3''s own source text', 'true',
    ((select s -> 'source' from jsonb_array_elements(inv -> 'sources') s where s ->> 'parent' = 'post')
      = public.photo_usage_source(pg_temp.ta()::uuid, 'post', 'dddddddd-0000-0000-0000-000000000001'))::text);
  perform pg_temp.starts('inventory of a site that does not exist is refused', 'ERR 22023',
    pg_temp.as_role('service_role', 'public.read_photo_backfill_inventory(''aaaaaaaa-0000-0000-0000-00000000ffff'')'));

  claims := pg_temp.as_role('service_role', format('public.read_photo_backfill_claims(%L, %L)', pg_temp.ta(),
              array['journal/' || pg_temp.u(7), 'journal/' || pg_temp.u(6)]::text))::jsonb;
  perform pg_temp.ok('claims: a journal key site B''s page names is claimed by another site', 'true',
    claims ->> ('journal/' || pg_temp.u(7)));
  perform pg_temp.ok('claims: a journal key only this site names is not', 'false',
    claims ->> ('journal/' || pg_temp.u(6)));
  perform pg_temp.ok('claims: …and from B''s side, A''s draft claims the same key', 'true',
    (pg_temp.as_role('service_role', format('public.read_photo_backfill_claims(%L, %L)', pg_temp.tb(),
       array['journal/' || pg_temp.u(7)]::text))::jsonb) ->> ('journal/' || pg_temp.u(7)));
  perform pg_temp.starts('claims: a non-key is refused', 'ERR 22023',
    pg_temp.as_role('service_role', format('public.read_photo_backfill_claims(%L, %L)', pg_temp.ta(), array['journal/../x']::text)));
  perform pg_temp.starts('claims: more than 1000 keys is refused', 'ERR 22023',
    pg_temp.as_role('service_role', format('public.read_photo_backfill_claims(%L, array_fill(%L::text, array[1001]))',
      pg_temp.ta(), 'journal/' || pg_temp.u(6))));
end $$;


-- ══ 5. The writer: each era, linked, never overwriting ══════════════════════

do $$
declare
  ta text := pg_temp.ta();
  a text := pg_temp.aa();
  flat text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(1);
  fold text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(2);
  pref text := 't/' || pg_temp.ta() || '/photos/' || pg_temp.aa() || '/' || pg_temp.u(3);
  site text := 't/' || pg_temp.ta() || '/site-images/' || pg_temp.u(4);
  cover text := 'covers/' || pg_temp.aa() || '/' || pg_temp.u(5);
  jfl text := 'journal/' || pg_temp.u(6);
  dup text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(8);
  flat_args jsonb;
  ar record;
  p2_before text;
begin
  -- 5a. The FLAT photograph: display is the flat JPEG, exactly; its ladder is
  -- recorded; no original (a resized JPEG is not one); the row's date, place
  -- and keywords.
  flat_args := jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(161),
    'source_path', flat || '.jpg', 'key_base', flat, 'display_path', flat || '.jpg',
    'derivatives', pg_temp.lad(flat, '400', '1600'), 'width', 2400, 'height', 1600);
  -- Keywords: normalised by the ONE normaliser (normalizeKeywords, in the
  -- caller) from the row's tags as read; the database binds them to the row by
  -- that raw snapshot. The row holds kenya, lion, '' and 'bad<U+0001>tag'.
  perform pg_temp.starts('a photograph source without its tags snapshot: refused', 'ERR 23502 photo backfill: a photograph source sends the row''s tags',
    pg_temp.reg(flat_args || jsonb_build_object('source_tags', null, 'keywords', jsonb_build_array('kenya'))));
  perform pg_temp.ok('keywords normalised from tags the row NO LONGER has: stale, nothing written', 'stale',
    pg_temp.reg(flat_args || jsonb_build_object('source_tags', jsonb_build_array('Kenya'), 'keywords', jsonb_build_array('kenya'))));
  perform pg_temp.starts('keywords out of the asset''s bounds (26 of them): refused', 'ERR 22023 photo backfill: at most 25 keywords',
    pg_temp.reg(flat_args || jsonb_build_object('keywords', (select jsonb_agg('k' || g) from generate_series(1, 26) g))));
  perform pg_temp.ok('flat photograph: created', 'created',
    pg_temp.reg(flat_args || jsonb_build_object('keywords', jsonb_build_array('kenya', 'lion', 'badtag'))));
  select a2.* into ar from public.photo_assets a2 where a2.tenant_id = ta::uuid and a2.key_base = flat;
  perform pg_temp.ok('flat: display_path is the row''s storage_path, exactly', flat || '.jpg', ar.display_path);
  perform pg_temp.ok('flat: the ladder is the row''s', pg_temp.lad(flat, '400', '1600')::text, ar.derivatives::text);
  perform pg_temp.ok('flat: no original, no hash, no size, no type',
    '(null)|(null)|(null)|(null)', concat_ws('|', coalesce(ar.original_path, '(null)'), coalesce(ar.content_sha256, '(null)'),
      coalesce(ar.original_bytes::text, '(null)'), coalesce(ar.content_type, '(null)')));
  perform pg_temp.ok('flat: the row''s dimensions', '2400x1600', ar.width || 'x' || ar.height);
  perform pg_temp.ok('flat: derived, derived_at unknown, created_by nobody', 'derived|(null)|(null)',
    concat_ws('|', ar.state, coalesce(ar.derived_at::text, '(null)'), coalesce(ar.created_by::text, '(null)')));
  perform pg_temp.ok('flat: the row''s date and place', '2019-07-01 06:00:00+00|-1.5|35.1',
    concat_ws('|', (ar.taken_at at time zone 'UTC')::text || '+00', ar.latitude, ar.longitude));
  perform pg_temp.ok('flat: keywords are the normalised ones the caller bound to the row''s tags',
    '{kenya,lion,badtag}', ar.keywords::text);
  perform pg_temp.ok('flat: …and the row''s own tags are untouched', 'true',
    ((select tags from public.photos where id = pg_temp.pid(161)) = array['kenya', 'lion', '', 'bad' || chr(1) || 'tag'])::text);
  perform pg_temp.ok('flat: the row is linked to it', ar.id::text,
    (select asset_id::text from public.photos where id = pg_temp.pid(161)));
  perform pg_temp.ok('flat: no usage was written (P3 is the only usage writer)', '1',
    (select count(*)::text from public.photo_usages));

  perform pg_temp.ok('flat again: already_linked', 'already_linked', pg_temp.reg(flat_args));
  perform pg_temp.ok('…and still one asset at that key', '1',
    (select count(*)::text from public.photo_assets where key_base = flat));

  -- 5b. Unprefixed FOLDER photograph with its original, hashed by the caller.
  perform pg_temp.ok('unprefixed folder photograph with its original: created', 'created',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(162),
      'source_path', fold || '/2400.webp', 'key_base', fold, 'display_path', fold || '/2400.webp',
      'original_path', fold || '/original.jpg', 'derivatives', pg_temp.lad(fold, '400', '800', '1600', '2400'),
      'width', 6000, 'height', 4000, 'original_bytes', 9000000, 'sha', repeat('cd', 32), 'content_type', 'image/jpeg',
      'camera_make', 'Sony', 'iso', 800,
      'exif', jsonb_build_object('v', 1, 'orientation', 1))));
  perform pg_temp.ok('folder: the original and its facts', fold || '/original.jpg|' || repeat('cd', 32) || '|9000000|image/jpeg|Sony|800',
    (select concat_ws('|', original_path, content_sha256, original_bytes, content_type, camera_make, iso)
       from public.photo_assets where key_base = fold));

  -- 5c. A PREFIXED folder photograph whose original the row names.
  perform pg_temp.ok('prefixed folder photograph: created', 'created',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(163),
      'source_path', pref || '/1600.webp', 'key_base', pref, 'display_path', pref || '/1600.webp',
      'original_path', pref || '/original.png', 'derivatives', pg_temp.lad(pref, '400', '800', '1600'),
      'width', 1800, 'height', 1200, 'original_bytes', 7000, 'sha', repeat('ef', 32), 'content_type', 'image/png')));

  -- 5d. An Uploads row: linked; its file name is the row's.
  perform pg_temp.ok('Uploads row: created', 'created',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'site_image', 'source_id', 'eeeeeeee-0000-0000-0000-0000000000a4',
      'source_path', site || '/800.webp', 'key_base', site, 'display_path', site || '/800.webp',
      'original_path', site || '/original.webp', 'derivatives', pg_temp.lad(site, '400', '800'),
      'width', 900, 'height', 600, 'original_bytes', 12345, 'sha', repeat('12', 32), 'content_type', 'image/webp')));
  perform pg_temp.ok('Uploads: linked, with the row''s file name', 'harbour.webp|true',
    (select a2.filename || '|' || (si.asset_id = a2.id)::text from public.site_images si
       join public.photo_assets a2 on a2.key_base = site where si.id = 'eeeeeeee-0000-0000-0000-0000000000a4'));

  -- 5e. A flat CUSTOM COVER: an asset, no row to link.
  perform pg_temp.ok('flat custom cover: created', 'created',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'album_cover', 'source_id', a,
      'source_path', cover || '.jpg', 'key_base', cover, 'display_path', cover || '.jpg')));
  perform pg_temp.ok('cover: no original, no ladder, unknown size', '(null)|{}|(null)',
    (select concat_ws('|', coalesce(original_path, '(null)'), derivatives::text, coalesce(width::text, '(null)'))
       from public.photo_assets where key_base = cover));

  -- 5f. A flat journal file named by a story — only with reviewed provenance.
  perform pg_temp.starts('unprefixed journal WITHOUT reviewed provenance: refused', 'ERR 42501 photo backfill: an unprefixed journal key needs reviewed provenance',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'document', 'parent', 'post', 'slot', 'featured',
      'parent_key', 'dddddddd-0000-0000-0000-000000000001', 'source_path', jfl || '.jpg', 'key_base', jfl,
      'display_path', jfl || '.jpg')));
  perform pg_temp.ok('unprefixed journal WITH reviewed provenance: created', 'created',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'document', 'parent', 'post', 'slot', 'featured',
      'parent_key', 'dddddddd-0000-0000-0000-000000000001', 'source_path', jfl || '.jpg', 'key_base', jfl,
      'display_path', jfl || '.jpg', 'provenance', true)));

  -- 5g. Two rows of one upload: the second REUSES the first's asset.
  perform pg_temp.ok('first of two rows of one upload: created', 'created',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(168),
      'source_path', dup || '.jpg', 'key_base', dup, 'display_path', dup || '.jpg', 'width', 800, 'height', 600)));
  perform pg_temp.ok('second row of the same upload: reused', 'reused',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(169),
      'source_path', dup || '.jpg', 'key_base', dup, 'display_path', dup || '.jpg', 'width', 800, 'height', 600)));
  perform pg_temp.ok('…both rows point at one asset', '1',
    (select count(distinct asset_id)::text from public.photos where id in (pg_temp.pid(168), pg_temp.pid(169))));

  -- 5h. The P2 row: already linked — and NOTHING about it changed.
  p2_before := (select to_jsonb(p)::text from public.photos p where p.id = pg_temp.pid(170))
            || (select to_jsonb(x)::text from public.photo_assets x
                 where x.id = (select asset_id from public.photos where id = pg_temp.pid(170)))
            || (select string_agg(to_jsonb(u)::text, '' order by u.id) from public.photo_usages u);
  perform pg_temp.ok('a P2 photograph: already_linked', 'already_linked',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(170),
      'source_path', 't/' || ta || '/photos/' || a || '/' || pg_temp.u(9) || '/800.webp',
      'key_base', 't/' || ta || '/photos/' || a || '/' || pg_temp.u(9),
      'display_path', 't/' || ta || '/photos/' || a || '/' || pg_temp.u(9) || '/800.webp',
      'derivatives', pg_temp.lad('t/' || ta || '/photos/' || a || '/' || pg_temp.u(9), '400', '800'),
      'width', 800, 'height', 533)));
  perform pg_temp.ok('…its row, its asset and every usage byte-for-byte unchanged', p2_before,
    (select to_jsonb(p)::text from public.photos p where p.id = pg_temp.pid(170))
    || (select to_jsonb(x)::text from public.photo_assets x
         where x.id = (select asset_id from public.photos where id = pg_temp.pid(170)))
    || (select string_agg(to_jsonb(u)::text, '' order by u.id) from public.photo_usages u));
end $$;


-- ══ 6. Stale, gone, and conflicts — each writing NOTHING ════════════════════

do $$
declare
  ta text := pg_temp.ta();
  a text := pg_temp.aa();
  n int;
  pf text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(20);
begin
  insert into public.photos (id, tenant_id, album_id, storage_path, derivatives, width, height, sort_order)
  values (pg_temp.pid(180), ta::uuid, a::uuid, pf || '.jpg', '{}', 1000, 750, 30);
  n := (select count(*) from public.photo_assets);

  perform pg_temp.ok('a photograph whose path moved since it was read: stale', 'stale',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(180),
      'source_path', pf || '/400.webp', 'key_base', pf, 'display_path', pf || '/400.webp',
      'derivatives', pg_temp.lad(pf, '400'), 'width', 1000, 'height', 750)));
  perform pg_temp.ok('a photograph whose dimensions changed since it was read: stale', 'stale',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(180),
      'source_path', pf || '.jpg', 'key_base', pf, 'display_path', pf || '.jpg', 'width', 1001, 'height', 750)));
  perform pg_temp.ok('a photograph that no longer exists: gone', 'gone',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(4000),
      'source_path', pf || '.jpg', 'key_base', pf, 'display_path', pf || '.jpg')));
  -- Site B naming site A's row, with a key that is B's own: the row is not
  -- found ON B, so "another site's row" and "no row" give the same answer.
  perform pg_temp.ok('a photograph of ANOTHER site, named by id: gone (no site is probed)', 'gone',
    pg_temp.reg(jsonb_build_object('tenant', pg_temp.tb(), 'source', 'photo', 'source_id', pg_temp.pid(180),
      'source_path', 't/' || pg_temp.tb() || '/photos/' || pg_temp.ab() || '/' || pg_temp.u(21) || '/400.webp',
      'key_base', 't/' || pg_temp.tb() || '/photos/' || pg_temp.ab() || '/' || pg_temp.u(21),
      'display_path', 't/' || pg_temp.tb() || '/photos/' || pg_temp.ab() || '/' || pg_temp.u(21) || '/400.webp',
      'derivatives', pg_temp.lad('t/' || pg_temp.tb() || '/photos/' || pg_temp.ab() || '/' || pg_temp.u(21), '400'),
      'width', 1000, 'height', 750)));
  perform pg_temp.ok('…and site A''s row is still unlinked', '(null)',
    (select asset_id::text from public.photos where id = pg_temp.pid(180)));
  perform pg_temp.ok('a story that no longer holds the path: stale', 'stale',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'document', 'parent', 'post', 'slot', 'featured',
      'parent_key', 'dddddddd-0000-0000-0000-000000000001', 'source_path', pf || '.jpg', 'key_base', pf,
      'display_path', pf || '.jpg')));
  perform pg_temp.ok('a cover the album no longer has: stale', 'stale',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'album_cover', 'source_id', a,
      'source_path', pf || '.jpg', 'key_base', pf, 'display_path', pf || '.jpg')));
  perform pg_temp.ok('…none of those wrote an asset', n::text, pg_temp.assets());
  perform pg_temp.ok('…or linked the row', '(null)', (select asset_id::text from public.photos where id = pg_temp.pid(180)));

  -- An asset already at the key that records DIFFERENT files: refused, nothing overwritten.
  insert into public.photo_assets (tenant_id, key_base, display_path, derivatives, state)
  values (ta::uuid, pf, pf || '.jpg', pg_temp.lad(pf, '400'), 'derived');
  perform pg_temp.starts('an asset at the key with different files: refused', 'ERR 22023 photo backfill: the asset already at this key records different files',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(180),
      'source_path', pf || '.jpg', 'key_base', pf, 'display_path', pf || '.jpg', 'width', 1000, 'height', 750)));
  perform pg_temp.ok('…the existing asset is untouched', pg_temp.lad(pf, '400')::text || '|(null)',
    (select derivatives::text || '|' || coalesce(width::text, '(null)') from public.photo_assets where key_base = pf));
  perform pg_temp.ok('…and the row still unlinked', '(null)', (select asset_id::text from public.photos where id = pg_temp.pid(180)));

  -- The same asset, retired: refused with the lifecycle code.
  update public.photo_assets set derivatives = '{}', width = 1000, height = 750, deleted_at = now()
   where tenant_id = ta::uuid and key_base = pf;
  perform pg_temp.starts('an asset at the key that is deleted: refused', 'ERR 55000',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(180),
      'source_path', pf || '.jpg', 'key_base', pf, 'display_path', pf || '.jpg', 'width', 1000, 'height', 750)));
  perform pg_temp.ok('…its deletion is not undone', 'true',
    (select (deleted_at is not null)::text from public.photo_assets where key_base = pf));
end $$;


-- ══ 6b. Document slots, P3's legacy fallback, a JSON-null ladder ════════════

do $$
declare
  ta text := pg_temp.ta();
  a text := pg_temp.aa();
  post uuid := 'dddddddd-0000-0000-0000-00000000000b';
  j text := 't/' || pg_temp.ta() || '/journal/';
  doc jsonb;
  nl text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(25);
  ab text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(63);
  n int;
begin
  insert into public.blog_posts (id, tenant_id, title, slug, status, blocks) values
    (post, ta::uuid, 'Slots', 'slots', 'draft', jsonb_build_array(
      jsonb_build_object('id', 'a', 'type', 'image', 'image', jsonb_build_object('path', j || pg_temp.u(60) || '/400.webp'),
                         'caption', j || pg_temp.u(61) || '/400.webp'),
      jsonb_build_object('id', 'b', 'type', 'image_pair', 'left', jsonb_build_object('path', j || pg_temp.u(64) || '/400.webp'),
                         'right', jsonb_build_object('path', j || pg_temp.u(65) || '/400.webp')),
      jsonb_build_object('id', 'c', 'type', 'gallery', 'images', jsonb_build_array(
        jsonb_build_object('path', j || pg_temp.u(66) || '/400.webp'), jsonb_build_object('path', j || pg_temp.u(67) || '/400.webp')))));
  doc := jsonb_build_object('tenant', ta, 'source', 'document', 'parent', 'post', 'parent_key', post);

  perform pg_temp.ok('slot blocks/0/image: the block''s image', 'created',
    pg_temp.reg(doc || jsonb_build_object('slot', 'blocks/0/image', 'key_base', j || pg_temp.u(60),
      'source_path', j || pg_temp.u(60) || '/400.webp', 'display_path', j || pg_temp.u(60) || '/400.webp',
      'derivatives', pg_temp.lad(j || pg_temp.u(60), '400'))));
  n := (select count(*) from public.photo_assets);
  perform pg_temp.starts('slot blocks/0/caption: a CAPTION is not an image slot, even holding a path', 'ERR 22023',
    pg_temp.reg(doc || jsonb_build_object('slot', 'blocks/0/caption', 'key_base', j || pg_temp.u(61),
      'source_path', j || pg_temp.u(61) || '/400.webp', 'display_path', j || pg_temp.u(61) || '/400.webp',
      'derivatives', pg_temp.lad(j || pg_temp.u(61), '400'))));
  perform pg_temp.ok('slot blocks/1/image on an image PAIR: not that block''s slot → stale', 'stale',
    pg_temp.reg(doc || jsonb_build_object('slot', 'blocks/1/image', 'key_base', j || pg_temp.u(64),
      'source_path', j || pg_temp.u(64) || '/400.webp', 'display_path', j || pg_temp.u(64) || '/400.webp',
      'derivatives', pg_temp.lad(j || pg_temp.u(64), '400'))));
  perform pg_temp.ok('slot blocks/0/image naming block 1''s photograph → stale', 'stale',
    pg_temp.reg(doc || jsonb_build_object('slot', 'blocks/0/image', 'key_base', j || pg_temp.u(64),
      'source_path', j || pg_temp.u(64) || '/400.webp', 'display_path', j || pg_temp.u(64) || '/400.webp',
      'derivatives', pg_temp.lad(j || pg_temp.u(64), '400'))));
  perform pg_temp.ok('…none of those three wrote anything', n::text, pg_temp.assets());
  perform pg_temp.ok('slot blocks/1/right: the pair''s right image', 'created',
    pg_temp.reg(doc || jsonb_build_object('slot', 'blocks/1/right', 'key_base', j || pg_temp.u(65),
      'source_path', j || pg_temp.u(65) || '/400.webp', 'display_path', j || pg_temp.u(65) || '/400.webp',
      'derivatives', pg_temp.lad(j || pg_temp.u(65), '400'))));
  perform pg_temp.ok('slot blocks/2/images/1: a gallery''s second image', 'created',
    pg_temp.reg(doc || jsonb_build_object('slot', 'blocks/2/images/1', 'key_base', j || pg_temp.u(67),
      'source_path', j || pg_temp.u(67) || '/400.webp', 'display_path', j || pg_temp.u(67) || '/400.webp',
      'derivatives', pg_temp.lad(j || pg_temp.u(67), '400'))));

  -- P3's legacy fallback. Home HAS section rows, so its legacy hero column
  -- (set in section 0) is a mirror — not a placement, not a source.
  perform pg_temp.ok('legacy column of a page WITH section rows: a mirror → stale, nothing written', 'stale',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'document', 'parent', 'live_page', 'parent_key', 'home',
      'slot', 'legacy/hero_image_path', 'key_base', 'photos/' || a || '/' || pg_temp.u(1),
      'source_path', 'photos/' || a || '/' || pg_temp.u(1) || '.jpg', 'display_path', 'photos/' || a || '/' || pg_temp.u(1) || '.jpg')));
  -- About has none, so its legacy column IS the placement.
  update public.site_settings set about_image_path = ab || '.jpg' where tenant_id = ta::uuid;
  perform pg_temp.ok('legacy column of a page with NO section rows: the placement → created', 'created',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'document', 'parent', 'live_page', 'parent_key', 'about',
      'slot', 'legacy/about_image_path', 'key_base', ab, 'source_path', ab || '.jpg', 'display_path', ab || '.jpg')));
  perform pg_temp.ok('a section slot that holds no photograph → stale', 'stale',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'document', 'parent', 'live_page', 'parent_key', 'home',
      'slot', 'sections/0/image_path', 'key_base', ab, 'source_path', ab || '.jpg', 'display_path', ab || '.jpg')));

  -- A row whose `derivatives` holds JSON null: absent ladder, i.e. {} — not
  -- stale for ever.
  insert into public.photos (id, tenant_id, album_id, storage_path, derivatives, sort_order)
  values (pg_temp.pid(165), ta::uuid, 'bbbbbbbb-0000-0000-0000-000000000002', nl || '.jpg', 'null'::jsonb, 20);
  perform pg_temp.ok('a display-only row whose ladder is JSON null, size unknown: created', 'created',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(165),
      'source_path', nl || '.jpg', 'key_base', nl, 'display_path', nl || '.jpg')));
  perform pg_temp.ok('…sparse: {} ladder, no size, no original; linked', '{}|(null)|(null)|true',
    (select concat_ws('|', a2.derivatives::text, coalesce(a2.width::text, '(null)'), coalesce(a2.original_path, '(null)'),
            (p.asset_id = a2.id)::text)
       from public.photo_assets a2 join public.photos p on p.id = pg_temp.pid(165) where a2.key_base = nl));
end $$;


-- ══ 7. Refusals: whose key, which shape, which facts ════════════════════════

do $$
declare
  ta text := pg_temp.ta();
  tb text := pg_temp.tb();
  a text := pg_temp.aa();
  b text := pg_temp.ab();
  r record;
  n int := (select count(*) from public.photo_assets);
  base jsonb;
  f text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(30);
  j7 text := 'journal/' || pg_temp.u(7);
begin
  -- A document source the draft really holds, so only the rule under test can refuse.
  base := jsonb_build_object('tenant', ta, 'source', 'document', 'parent', 'draft', 'slot', 'page_seo/home');
  for r in
    select * from (values
      ('a key no route minted (the fixture''s)',  'ERR 22023',
        jsonb_build_object('key_base', 't/one/photos/a/1', 'source_path', 't/one/photos/a/1/2400.webp', 'display_path', 't/one/photos/a/1/2400.webp')),
      ('a key under ANOTHER site''s prefix',       'ERR 42501 photo backfill: that key is under another site',
        jsonb_build_object('key_base', 't/' || tb || '/photos/' || b || '/' || pg_temp.u(31),
          'source_path', 't/' || tb || '/photos/' || b || '/' || pg_temp.u(31) || '/400.webp',
          'display_path', 't/' || tb || '/photos/' || b || '/' || pg_temp.u(31) || '/400.webp',
          'derivatives', pg_temp.lad('t/' || tb || '/photos/' || b || '/' || pg_temp.u(31), '400'))),
      ('an unprefixed key in ANOTHER site''s album', 'ERR 42501 photo backfill: the album in that key is not this site',
        jsonb_build_object('key_base', 'photos/' || b || '/' || pg_temp.u(32), 'source_path', 'photos/' || b || '/' || pg_temp.u(32) || '.jpg',
          'display_path', 'photos/' || b || '/' || pg_temp.u(32) || '.jpg')),
      ('a journal key another site claims, even with provenance', 'ERR 42501 photo backfill: another site claims that key',
        jsonb_build_object('key_base', j7, 'source_path', j7 || '/1600.webp', 'display_path', j7 || '/1600.webp',
          'derivatives', pg_temp.lad(j7, '400', '1600'), 'provenance', true)),
      ('a URL', 'ERR 22023',
        jsonb_build_object('key_base', 'https://x.example/' || f, 'source_path', 'https://x.example/' || f || '.jpg', 'display_path', 'https://x.example/' || f || '.jpg')),
      ('a source path outside the key', 'ERR 22023 photo backfill: the source path is not a file of this key',
        jsonb_build_object('key_base', f, 'source_path', 'photos/' || a || '/' || pg_temp.u(33) || '.jpg', 'display_path', f || '.jpg')),
      ('a flat file with an "original"', 'ERR 22023 photo backfill: a flat-era photograph has no known original',
        jsonb_build_object('key_base', f, 'source_path', f || '.jpg', 'display_path', f || '.jpg',
          'original_path', f || '/original.jpg', 'sha', repeat('aa', 32), 'original_bytes', 10, 'content_type', 'image/jpeg')),
      ('a cover with an original', 'ERR 22023 photo backfill: a cover keeps no original',
        jsonb_build_object('key_base', 'covers/' || a || '/' || pg_temp.u(34), 'source_path', 'covers/' || a || '/' || pg_temp.u(34) || '/400.webp',
          'display_path', 'covers/' || a || '/' || pg_temp.u(34) || '/400.webp',
          'derivatives', pg_temp.lad('covers/' || a || '/' || pg_temp.u(34), '400'),
          'original_path', 'covers/' || a || '/' || pg_temp.u(34) || '/original.jpg', 'sha', repeat('aa', 32), 'original_bytes', 10)),
      ('a hash without an original', 'ERR 22023 photo backfill: original facts without an original',
        jsonb_build_object('key_base', f, 'source_path', f || '.jpg', 'display_path', f || '.jpg', 'sha', repeat('aa', 32))),
      ('an original without a hash', 'ERR 22023 photo backfill: an original''s hash',
        jsonb_build_object('key_base', f, 'source_path', f || '/400.webp', 'display_path', f || '/400.webp',
          'derivatives', pg_temp.lad(f, '400'), 'original_path', f || '/original.jpg', 'original_bytes', 10)),
      ('a size outside the key', 'ERR 22023 photo backfill: size 400 is not where this key says it is',
        jsonb_build_object('key_base', f, 'source_path', f || '.jpg', 'display_path', f || '.jpg',
          'derivatives', jsonb_build_object('400', 'photos/' || a || '/' || pg_temp.u(35) || '/400.webp'))),
      ('a size off the ladder', 'ERR 22023 photo backfill: there is no display size called "1200"',
        jsonb_build_object('key_base', f, 'source_path', f || '.jpg', 'display_path', f || '.jpg',
          'derivatives', jsonb_build_object('1200', f || '/1200.webp'))),
      ('a display file that is neither flat nor a recorded size', 'ERR 22023 photo backfill: the display path must be',
        jsonb_build_object('key_base', f, 'source_path', f || '/800.webp', 'display_path', f || '/800.webp',
          'derivatives', pg_temp.lad(f, '400'))),
      -- Regressions found in review. With no original, a source size the
      -- asset does not record used to slip past a NOT (… OR NULL …).
      ('a source size the asset does not record, with NO original', 'ERR 22023 photo backfill: the source path is not one of',
        jsonb_build_object('key_base', f, 'source_path', f || '/800.webp', 'display_path', f || '/400.webp',
          'derivatives', pg_temp.lad(f, '400'))),
      -- A prefixed key has no flat file; the display path is checked by itself.
      ('a prefixed key with a flat display file', 'ERR 22023 photo backfill: the display path is not a file of this key',
        jsonb_build_object('key_base', 't/' || ta || '/photos/' || a || '/' || pg_temp.u(36),
          'source_path', 't/' || ta || '/photos/' || a || '/' || pg_temp.u(36) || '/800.webp',
          'display_path', 't/' || ta || '/photos/' || a || '/' || pg_temp.u(36) || '.jpg',
          'derivatives', pg_temp.lad('t/' || ta || '/photos/' || a || '/' || pg_temp.u(36), '800'))),
      ('a display path of ANOTHER key', 'ERR 22023 photo backfill: the display path is not a file of this key',
        jsonb_build_object('key_base', f, 'source_path', f || '.jpg', 'display_path', 'photos/' || a || '/' || pg_temp.u(37) || '.jpg')),
      ('a slot that is not an image slot of the draft', 'ERR 22023 photo backfill: "pages/home/0/" is not an image slot',
        jsonb_build_object('key_base', f, 'source_path', f || '.jpg', 'display_path', f || '.jpg', 'slot', 'pages/home/0/')),
      ('half a size', 'ERR 22023 photo backfill: dimensions are both known',
        jsonb_build_object('key_base', f, 'source_path', f || '.jpg', 'display_path', f || '.jpg', 'width', 10)),
      ('an exif key off the allowlist', 'ERR 22023 photo backfill: exif "serial"',
        jsonb_build_object('key_base', f, 'source_path', f || '.jpg', 'display_path', f || '.jpg',
          'exif', jsonb_build_object('v', 1, 'serial', 'X1')))
    ) v(what, want, extra)
  loop
    perform pg_temp.starts('refused: ' || r.what, r.want, pg_temp.reg(base || r.extra));
  end loop;

  perform pg_temp.starts('refused: a photograph source with a caller-supplied date', 'ERR 22023 photo backfill: a photograph''s date',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'photo', 'source_id', pg_temp.pid(161),
      'key_base', f, 'source_path', f || '.jpg', 'display_path', f || '.jpg', 'taken_at', '2020-01-01T00:00:00Z')));
  perform pg_temp.starts('refused: a source nobody defined', 'ERR 22023 photo backfill: there is no source called',
    pg_temp.reg(jsonb_build_object('tenant', ta, 'source', 'library', 'key_base', f, 'source_path', f || '.jpg', 'display_path', f || '.jpg')));
  perform pg_temp.starts('refused: no site', 'ERR 22023 photo backfill: there is no such site',
    pg_temp.reg(jsonb_build_object('source', 'photo', 'key_base', f, 'source_path', f || '.jpg', 'display_path', f || '.jpg')));
  perform pg_temp.ok('…and not one refusal wrote an asset', n::text, pg_temp.assets());
end $$;


-- ══ 8. The resolver: the flat era resolves; P3''s rule unchanged; never a guess ═

do $$
declare
  ta uuid := pg_temp.ta()::uuid;
  tb uuid := pg_temp.tb()::uuid;
  a text := pg_temp.aa();
  flat text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(1);
  fold text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(2);
  flat_id uuid := (select id from public.photo_assets where tenant_id = ta and key_base = 'photos/' || pg_temp.aa() || '/' || pg_temp.u(1));
  amb text := 'photos/' || pg_temp.aa() || '/' || pg_temp.u(40);
begin
  perform pg_temp.ok('resolver: a flat file resolves to its extensionless asset', flat_id::text,
    public.photo_usage_resolve_path(ta, flat || '.jpg')::text);
  perform pg_temp.ok('resolver: …and so does that asset''s old-job size (P3''s folder rule)', flat_id::text,
    public.photo_usage_resolve_path(ta, flat || '/1600.webp')::text);
  perform pg_temp.ok('resolver: a size the asset does not record resolves to nothing', '(null)',
    public.photo_usage_resolve_path(ta, flat || '/800.webp')::text);
  perform pg_temp.ok('resolver: the flat era''s fake original.jpg is not a member', '(null)',
    public.photo_usage_resolve_path(ta, flat || '/original.jpg')::text);
  perform pg_temp.ok('resolver: ANOTHER site never resolves it', '(null)',
    public.photo_usage_resolve_path(tb, flat || '.jpg')::text);
  perform pg_temp.ok('resolver: P3''s folder rule unchanged — a folder display file',
    (select id::text from public.photo_assets where key_base = fold),
    public.photo_usage_resolve_path(ta, fold || '/2400.webp')::text);
  perform pg_temp.ok('resolver: the flat rule does not reach a .png', '(null)',
    public.photo_usage_resolve_path(ta, flat || '.png')::text);

  -- AMBIGUITY: two assets each claim the same path by different rules. The
  -- grammar never makes a key base like 'photos/<album>', but the owner can,
  -- and the resolver must answer NOTHING rather than pick one.
  insert into public.photo_assets (tenant_id, key_base, display_path, derivatives, state)
  values (ta, amb, amb || '.jpg', '{}', 'derived'),
         (ta, 'photos/' || a, amb || '.jpg', '{}', 'derived');
  perform pg_temp.ok('resolver: a path two assets claim resolves to NOTHING (never LIMIT 1)', '(null)',
    public.photo_usage_resolve_path(ta, amb || '.jpg')::text);
  delete from public.photo_assets where tenant_id = ta and key_base = 'photos/' || a;
  perform pg_temp.ok('resolver: …and with one claimant it resolves',
    (select id::text from public.photo_assets where key_base = amb),
    public.photo_usage_resolve_path(ta, amb || '.jpg')::text);
end $$;


-- ══ 9. P3, unchanged, now resolves what the backfill created ════════════════

do $$
declare
  ta text := pg_temp.ta();
  src text;
  r jsonb;
begin
  src := pg_temp.as_role('service_role', format('public.read_photo_usage_source(%L, ''album'', %L)', ta, pg_temp.aa()));
  r := pg_temp.as_role('service_role', format('public.sync_photo_usages(%L, ''album'', %L, %L, %L)', ta, pg_temp.aa(), src,
         jsonb_build_array(jsonb_build_object('kind', 'sample', 'photo_id', pg_temp.pid(164), 'position', 0,
           'field', 'photo', 'path', '/samples/wildlife/lion.webp'))))::jsonb;
  perform pg_temp.ok('album sync: the backfilled gallery photographs and the flat cover are projected', 'false',
    (r ->> 'stale'));
  -- Album aa: flat, folder, prefixed, the first duplicate, the P2 photograph
  -- (5 gallery rows) and the flat custom cover (1). The sample, the conflicted
  -- row and the fixture's two unshaped rows project nothing.
  perform pg_temp.ok('album sync: gallery rows for every linked photograph, the cover, and nothing for the sample', '6',
    (select count(*)::text from public.photo_usages
      where tenant_id = ta::uuid and (kind = 'gallery' or (kind = 'gallery_cover' and album_id = pg_temp.aa()::uuid))));
  perform pg_temp.ok('album sync: the flat cover resolved', '1',
    (select count(*)::text from public.photo_usages where kind = 'gallery_cover' and field = 'cover_custom_path'));

  src := pg_temp.as_role('service_role', format('public.read_photo_usage_source(%L, ''post'', %L)', ta, 'dddddddd-0000-0000-0000-000000000001'));
  r := pg_temp.as_role('service_role', format('public.sync_photo_usages(%L, ''post'', %L, %L, %L)', ta,
         'dddddddd-0000-0000-0000-000000000001', src,
         jsonb_build_array(jsonb_build_object('kind', 'story_block', 'field', 'block:0', 'position', 0,
           'path', 'photos/' || pg_temp.aa() || '/' || pg_temp.u(2) || '/1600.webp'))))::jsonb;
  perform pg_temp.ok('story sync: the flat journal featured image and the folder block both resolve', '2|0',
    (r ->> 'written') || '|' || (r ->> 'unresolved_count'));

  src := pg_temp.as_role('service_role', format('public.read_photo_usage_source(%L, ''live_page'', ''home'')', ta));
  r := pg_temp.as_role('service_role', format('public.sync_photo_usages(%L, ''live_page'', ''home'', %L, ''[]'')', ta, src))::jsonb;
  perform pg_temp.ok('home sync: the page has section rows, so its flat legacy column is a mirror (not projected)', '0|0',
    (r ->> 'written') || '|' || (r ->> 'unresolved_count'));
end $$;


-- ══ 10. A site holding backfilled photographs can still be deleted ══════════
--
-- In deleteSite's order (app/actions/sites.ts): its rows leaves-first —
-- photos, then albums — then the site, which cascades site_images,
-- photo_assets and photo_usages in one statement. A throwaway site, so the
-- fixture's two are left alone.

do $$
declare
  tc uuid := 'aaaaaaaa-0000-0000-0000-0000000000c1';
  ac uuid := 'bbbbbbbb-0000-0000-0000-0000000000c1';
  cf text := 'photos/bbbbbbbb-0000-0000-0000-0000000000c1/' || pg_temp.u(50);
  cs text := 't/aaaaaaaa-0000-0000-0000-0000000000c1/site-images/' || pg_temp.u(51);
  before_a int := (select count(*) from public.photo_assets where tenant_id = pg_temp.ta()::uuid);
  n_deleted int;
begin
  insert into public.tenants (id, name, domain) values (tc, 'Throwaway', 'c.example');
  insert into public.albums (id, tenant_id, title, slug, privacy_type) values (ac, tc, 'C', 'c', 'public');
  insert into public.photos (id, tenant_id, album_id, storage_path, derivatives, width, height, sort_order)
  values (pg_temp.pid(190), tc, ac, cf || '.jpg', '{}', 640, 480, 0);
  insert into public.site_images (id, tenant_id, storage_path, derivatives, width, height)
  values ('eeeeeeee-0000-0000-0000-0000000000c1', tc, cs || '/400.webp', pg_temp.lad(cs, '400'), 400, 300);
  perform pg_temp.ok('site C''s flat photograph: created', 'created',
    pg_temp.reg(jsonb_build_object('tenant', tc, 'source', 'photo', 'source_id', pg_temp.pid(190),
      'source_path', cf || '.jpg', 'key_base', cf, 'display_path', cf || '.jpg', 'width', 640, 'height', 480)));
  perform pg_temp.ok('site C''s Uploads row: created', 'created',
    pg_temp.reg(jsonb_build_object('tenant', tc, 'source', 'site_image', 'source_id', 'eeeeeeee-0000-0000-0000-0000000000c1',
      'source_path', cs || '/400.webp', 'key_base', cs, 'display_path', cs || '/400.webp',
      'derivatives', pg_temp.lad(cs, '400'), 'width', 400, 'height', 300)));

  delete from public.photos where tenant_id = tc;
  delete from public.albums where tenant_id = tc;
  delete from public.tenants where id = tc;
  get diagnostics n_deleted = row_count;
  perform pg_temp.ok('deleting site C succeeds', '1', n_deleted::text);
  perform pg_temp.ok('…its assets and its Uploads row went with it', '0|0',
    (select count(*) from public.photo_assets where tenant_id = tc) || '|' ||
    (select count(*) from public.site_images where tenant_id = tc));
  perform pg_temp.ok('…and site A''s assets were not touched', before_a::text,
    (select count(*)::text from public.photo_assets where tenant_id = pg_temp.ta()::uuid));
end $$;


-- ── Report, and undo everything ─────────────────────────────────────────────

do $$
declare
  report text;
  failed int;
  total  int;
begin
  select string_agg(
           format('%s  %-92s expected %-40s got %s',
                  case when coalesce(pass, false) then '  ok  ' else ' FAIL ' end,
                  step, expected, actual),
           E'\n' order by ord)
    into report
    from pb_res;

  select count(*), count(*) filter (where not coalesce(pass, false)) into total, failed from pb_res;

  raise exception E'\n\n%\n\n%\n\nNothing was kept — this transaction always rolls back.\n',
    report,
    case when failed = 0 then format('All %s checks passed.', total)
         else format('%s of %s check(s) failed. The backfill''s database half is NOT ready.', failed, total) end;
end $$;

rollback;
