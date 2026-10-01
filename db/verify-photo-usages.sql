-- Proof that P3's projection boundary — sync_photo_usages and its two reads —
-- can be reached by the projection service and nobody else, writes only what a
-- SAVED source says, refuses an out-of-date source, and never resolves across
-- sites. Also the eighth kind, page_share, and the legacy rule.
--
-- P3 is DEPLOYED (Supabase 20261001005946 and 20261001010021, 2026-10-01) and
-- reconciled into db/test-fixture.sql, so the fixture alone is enough:
--
--   psql -d wtp -f db/test-fixture.sql
--   psql -d wtp -f db/verify-photo-usages.sql
--
-- (Applying either P3 migration on top is a no-op.)
--
-- One transaction that ALWAYS ends by raising; nothing is kept. Same shape as
-- db/verify-photo-ingest.sql.
--
-- ── As the real roles ───────────────────────────────────────────────────────
-- Every call to the three interface functions goes through `vu.as(role, sql)`,
-- which switches to the named role (or to NO role — 'none', a bare owner
-- connection), runs the statement, and reports `ok|<result>` or
-- `<SQLSTATE>|<message>`. Where a refusal is the point, the assertion names
-- WHICH LAYER refused: the grant ("permission denied for function") or the
-- function's own role check ("Only the projection service …").
--
-- What one transaction cannot show — the album lock shared with the two P2
-- wrappers, concurrent saves, the TypeScript extractor, the rebuild invariant —
-- is in .mk/usages.ts, with real connections.

begin;

create temp table vu_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

create function pg_temp.ok(p_step text, p_expected text, p_actual text)
returns void language sql as $$
  insert into vu_res (step, expected, actual, pass)
  values (p_step, p_expected, coalesce(p_actual, '(null)'), p_expected = coalesce(p_actual, '(null)'));
$$;

create function pg_temp.st(p text) returns text language sql immutable as $$
  select split_part(p, '|', 1);
$$;

do $$
begin
  perform set_config('vu.owner', session_user, true);
  perform set_config('vu.A', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  perform set_config('vu.B', 'aaaaaaaa-0000-0000-0000-000000000002', true);
  perform set_config('vu.album', 'bbbbbbbb-0000-0000-0000-000000000001', true);
  perform set_config('vu.album2', 'bbbbbbbb-0000-0000-0000-000000000002', true);
  perform set_config('vu.photo1', 'cccccccc-0000-0000-0000-000000000001', true);
  perform set_config('vu.photo2', 'cccccccc-0000-0000-0000-000000000002', true);
  perform set_config('vu.photo3', 'cccccccc-0000-0000-0000-000000000003', true);
  perform set_config('vu.post', 'dddddddd-0000-0000-0000-000000000001', true);
  update public.profiles set is_platform_admin = false;
end $$;

create function pg_temp.g(p text) returns uuid language sql stable as $$
  select current_setting('vu.' || p)::uuid;
$$;

-- ── Helpers, created and rolled back with this transaction ──────────────────

create schema vu;
grant usage on schema vu to anon, authenticated, service_role;

create function vu.as(p_role text, p_sql text) returns text language plpgsql as $$
declare res text; st text; msg text;
begin
  perform set_config('role', p_role, true);
  execute p_sql into res;
  perform set_config('role', current_setting('vu.owner'), true);
  return 'ok|' || coalesce(res, '');
exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text;
  return st || '|' || msg;
end $$;

-- The saved source, as the projection service reads it.
create function vu.src(t uuid, parent text, k text) returns text language plpgsql as $$
declare r text;
begin
  r := vu.as('service_role', format('select public.read_photo_usage_source(%L, %L, %L)', t, parent, k));
  if pg_temp.st(r) <> 'ok' then raise exception 'could not read the source: %', r; end if;
  return substr(r, 4);
end $$;

-- Read the source and sync it with these references, as the service.
create function vu.sync(t uuid, parent text, k text, refs jsonb) returns text language plpgsql as $$
begin
  return vu.as('service_role', format('select public.sync_photo_usages(%L, %L, %L, %L, %L)::text',
                                      t, parent, k, vu.src(t, parent, k), refs));
end $$;

-- The JSON a successful sync returned.
create function vu.j(r text) returns jsonb language sql immutable as $$
  select case when split_part(r, '|', 1) = 'ok' then substr(r, 4)::jsonb end;
$$;

grant execute on all functions in schema vu to anon, authenticated, service_role;

-- The usages of site A, as comparable text.
create function pg_temp.rows(p_where text) returns text language plpgsql as $$
declare r text;
begin
  execute 'select coalesce(string_agg(format(''%s/%s/%s/%s@%s%s%s'', u.scope, u.kind, coalesce(u.page_key, ''-''),
             u.field, u.position, case when u.decorative then '' dec'' else '''' end,
             case when u.alt_override is not null then '' alt='' || u.alt_override else '''' end),
             '', '' order by u.scope, u.kind, u.page_key, u.field, u.position), ''none'')
      from public.photo_usages u where u.tenant_id = current_setting(''vu.A'')::uuid and ' || p_where
    into r;
  return r;
end $$;

-- ── The cast: three photographs on site A, one on site B ────────────────────

create function pg_temp.kb(t uuid, n int) returns text language sql immutable as $$
  select 't/' || t || '/site-images/11111111-aaaa-4aaa-8aaa-' || lpad(n::text, 12, '0');
$$;
create function pg_temp.disp(t uuid, n int) returns text language sql immutable as $$
  select pg_temp.kb(t, n) || '/1600.webp';
$$;

do $$
declare
  a uuid := pg_temp.g('A');
  b uuid := pg_temp.g('B');
  n int;
begin
  foreach n in array array[1, 2, 3] loop
    insert into public.photo_assets (tenant_id, key_base, original_path, display_path, derivatives, state)
    values (a, pg_temp.kb(a, n), pg_temp.kb(a, n) || '/original.jpg', pg_temp.disp(a, n),
            jsonb_build_object('400', pg_temp.kb(a, n) || '/400.webp', '1600', pg_temp.disp(a, n)), 'derived');
  end loop;
  insert into public.photo_assets (tenant_id, key_base, original_path, display_path, derivatives, state)
  values (b, pg_temp.kb(b, 1), pg_temp.kb(b, 1) || '/original.jpg', pg_temp.disp(b, 1),
          jsonb_build_object('400', pg_temp.kb(b, 1) || '/400.webp', '1600', pg_temp.disp(b, 1)), 'derived');
  delete from public.page_sections where tenant_id = a;
  perform pg_temp.ok('photo_usages starts empty', '0', (select count(*)::text from public.photo_usages));
end $$;


-- ── 1. Privileges, from the catalogue ───────────────────────────────────────

do $$
declare
  fn   text;
  r    text;
  want text;
begin
  foreach fn in array array['sync_photo_usages', 'read_photo_usage_source', 'list_photo_usage_parents',
                            'photo_usage_lock', 'photo_usage_parent_key', 'photo_usage_source',
                            'photo_usage_resolve_path'] loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      want := case when r = 'service_role'
                    and fn in ('sync_photo_usages', 'read_photo_usage_source', 'list_photo_usage_parents')
                   then 'EXECUTE' else 'none' end;
      perform pg_temp.ok(format('%s: %s may %s', fn, r, lower(want)), want,
        (select case when bool_or(has_function_privilege(r, p.oid, 'EXECUTE')) then 'EXECUTE' else 'none' end
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn));
    end loop;
    perform pg_temp.ok(format('%s: PUBLIC holds nothing', fn), 'none',
      (select coalesce(string_agg(a.privilege_type, ','), 'none')
         from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.pronamespace = 'public'::regnamespace and p.proname = fn and a.grantee = 0));
    perform pg_temp.ok(format('%s: search_path is empty', fn), '{"search_path=\"\""}',
      (select proconfig::text from pg_proc where pronamespace = 'public'::regnamespace and proname = fn));
    perform pg_temp.ok(format('%s: security', fn),
      case when fn in ('sync_photo_usages', 'read_photo_usage_source', 'list_photo_usage_parents')
           then 'definer' else 'invoker' end,
      (select case when prosecdef then 'definer' else 'invoker' end
         from pg_proc where pronamespace = 'public'::regnamespace and proname = fn));
  end loop;

  -- No table grant moved: authenticated reads, nobody writes.
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    perform pg_temp.ok(format('table photo_usages: %s holds', r),
      case r when 'authenticated' then 'SELECT' else 'none' end,
      (select coalesce(string_agg(p, ',' order by p), 'none')
         from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
        where has_table_privilege(r, 'public.photo_usages', p)));
  end loop;

  -- The two P2 wrappers keep P2's privileges and attributes exactly.
  foreach fn in array array['register_gallery_photo', 'register_album_cover'] loop
    perform pg_temp.ok(format('%s: one overload', fn), '1',
      (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = fn));
    perform pg_temp.ok(format('%s: DEFINER, search_path empty', fn), 'true {"search_path=\"\""}',
      (select prosecdef::text || ' ' || proconfig::text from pg_proc
        where pronamespace = 'public'::regnamespace and proname = fn));
    perform pg_temp.ok(format('%s: EXECUTE as P2 left it (the same ACL as register_site_image)', fn),
      (select proacl::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'register_site_image'),
      (select proacl::text from pg_proc where pronamespace = 'public'::regnamespace and proname = fn));
    perform pg_temp.ok(format('%s: takes the album''s projection lock, once', fn), '1',
      (select ((length(prosrc) - length(replace(prosrc, 'public.photo_usage_lock(p_tenant, ''album'', p_album::text)', '')))
               / length('public.photo_usage_lock(p_tenant, ''album'', p_album::text)'))::text
         from pg_proc where pronamespace = 'public'::regnamespace and proname = fn));
  end loop;
end $$;


-- ── 2. Who may call — and WHICH LAYER refuses ───────────────────────────────

do $$
declare
  a    uuid := pg_temp.g('A');
  call text := format('select public.sync_photo_usages(%L, ''draft'', null, ''{}'', ''[]'')::text', a);
  read text := format('select public.read_photo_usage_source(%L, ''draft'', null)', a);
  r    text;
begin
  r := vu.as('authenticated', call);
  perform pg_temp.ok('authenticated → sync: refused BY THE GRANT', '42501|permission denied for function sync_photo_usages', r);
  r := vu.as('anon', call);
  perform pg_temp.ok('anon → sync: refused by the grant', '42501|permission denied for function sync_photo_usages', r);
  r := vu.as('authenticated', read);
  perform pg_temp.ok('authenticated → read source: refused by the grant', '42501|permission denied for function read_photo_usage_source', r);
  r := vu.as('authenticated', format('select public.list_photo_usage_parents(%L)::text', a));
  perform pg_temp.ok('authenticated → list parents: refused by the grant', '42501|permission denied for function list_photo_usage_parents', r);
  r := vu.as('authenticated', format('select public.photo_usage_resolve_path(%L, ''x/y'')::text', a));
  perform pg_temp.ok('authenticated → the resolver: refused', '42501|permission denied for function photo_usage_resolve_path', r);

  -- A bare owner connection (no SET ROLE): the grant would let the owner in,
  -- so it is the function's own role check that refuses.
  r := vu.as('none', call);
  perform pg_temp.ok('owner with NO role set → sync: refused BY THE ROLE CHECK',
    '42501|Only the projection service writes photo usages.', r);
  r := vu.as('none', read);
  perform pg_temp.ok('owner with NO role set → read source: refused by the role check',
    '42501|Only the projection service reads a usage source.', r);

  -- A grant added by mistake later opens nothing: the role check still holds.
  grant execute on function public.sync_photo_usages(uuid, text, text, text, jsonb) to authenticated;
  r := vu.as('authenticated', call);
  perform pg_temp.ok('with a MISTAKEN grant, authenticated → sync: still refused, by the role check',
    '42501|Only the projection service writes photo usages.', r);
  revoke execute on function public.sync_photo_usages(uuid, text, text, text, jsonb) from authenticated;

  -- And the service itself is let in.
  r := vu.as('service_role', call);
  perform pg_temp.ok('service_role → sync: let in (its answer: the source is stale)', 'ok|true',
    pg_temp.st(r) || '|' || coalesce((vu.j(r) ->> 'stale'), r));

  -- Nobody writes the table directly, the service included.
  r := vu.as('authenticated', format(
    'insert into public.photo_usages (tenant_id, asset_id, kind, page_key, field) select %L, id, ''page_share'', ''home'', ''page_seo.image'' from public.photo_assets limit 1 returning 1', a));
  perform pg_temp.ok('authenticated cannot INSERT a usage', '42501', pg_temp.st(r));
  r := vu.as('authenticated', 'delete from public.photo_usages returning 1');
  perform pg_temp.ok('authenticated cannot DELETE usages', '42501', pg_temp.st(r));
  r := vu.as('service_role', 'delete from public.photo_usages returning 1');
  perform pg_temp.ok('service_role cannot DELETE usages directly', '42501', pg_temp.st(r));
end $$;


-- ── 3. page_share, the eighth kind ──────────────────────────────────────────

do $$
declare
  a  uuid := pg_temp.g('A');
  as1 uuid := (select id from public.photo_assets where key_base = pg_temp.kb(pg_temp.g('A'), 1));
  as2 uuid := (select id from public.photo_assets where key_base = pg_temp.kb(pg_temp.g('A'), 2));
  e  text;
begin
  insert into public.photo_usages (tenant_id, asset_id, kind, page_key, field)
  values (a, as1, 'page_share', 'home', 'page_seo.image');
  begin
    insert into public.photo_usages (tenant_id, asset_id, kind, page_key, field)
    values (a, as2, 'page_share', 'home', 'page_seo.image');
    e := 'accepted';
  exception when others then
    get stacked diagnostics e = constraint_name;
  end;
  perform pg_temp.ok('page_share: one per page and scope', 'photo_usages_slot_share', e);

  begin
    insert into public.photo_usages (tenant_id, asset_id, scope, kind, page_key, field)
    values (a, as2, 'draft', 'page_share', 'home', 'page_seo.image');
    e := 'accepted';
  exception when others then get stacked diagnostics e = constraint_name; end;
  perform pg_temp.ok('page_share: the draft has its own', 'accepted', e);

  begin
    insert into public.photo_usages (tenant_id, asset_id, kind, album_id, page_key, field)
    values (a, as2, 'page_share', pg_temp.g('album'), 'about', 'page_seo.image');
    e := 'accepted';
  exception when others then get stacked diagnostics e = constraint_name; end;
  perform pg_temp.ok('page_share: a page, and no other parent', 'photo_usages_one_parent', e);

  begin
    insert into public.photo_usages (tenant_id, asset_id, kind, field)
    values (a, as2, 'page_share', 'page_seo.image');
    e := 'accepted';
  exception when others then get stacked diagnostics e = constraint_name; end;
  perform pg_temp.ok('page_share: never without its page', 'photo_usages_one_parent', e);

  -- Its one legal slot shape, enforced by the schema itself.
  perform pg_temp.ok('photo_usages_share_slot is present, as designed',
    'CHECK (((kind <> ''page_share''::text) OR ((field = ''page_seo.image''::text) AND ("position" = 0))))',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'photo_usages_share_slot'
        and conrelid = 'public.photo_usages'::regclass));
  begin
    insert into public.photo_usages (tenant_id, asset_id, kind, page_key, field, position)
    values (a, as2, 'page_share', 'about', 'page_seo.image', 0);
    e := 'accepted';
  exception when others then get stacked diagnostics e = constraint_name; end;
  perform pg_temp.ok('page_share: field page_seo.image at position 0 is accepted', 'accepted', e);
  begin
    insert into public.photo_usages (tenant_id, asset_id, kind, page_key, field, position)
    values (a, as2, 'page_share', 'contact', 'image_path', 0);
    e := 'accepted';
  exception when others then get stacked diagnostics e = constraint_name; end;
  perform pg_temp.ok('page_share: any other field is refused, by the share-slot CHECK', 'photo_usages_share_slot', e);
  begin
    insert into public.photo_usages (tenant_id, asset_id, kind, page_key, field, position)
    values (a, as2, 'page_share', 'contact', 'page_seo.image', 1);
    e := 'accepted';
  exception when others then get stacked diagnostics e = constraint_name; end;
  perform pg_temp.ok('page_share: a nonzero position is refused, by the share-slot CHECK', 'photo_usages_share_slot', e);

  -- The draft legacy capability stays (amendment 6), though nothing writes one.
  begin
    insert into public.photo_usages (tenant_id, asset_id, scope, kind, page_key, field)
    values (a, as2, 'draft', 'page_legacy', 'home', 'hero_image_path');
    e := 'accepted';
  exception when others then get stacked diagnostics e = constraint_name; end;
  perform pg_temp.ok('draft page_legacy is still allowed by the schema', 'accepted', e);

  delete from public.photo_usages where tenant_id = a;
end $$;


-- ── 4. The resolver: this site, this upload's own files, nothing else ───────

do $$
declare
  a   uuid := pg_temp.g('A');
  b   uuid := pg_temp.g('B');
  as1 uuid := (select id from public.photo_assets where key_base = pg_temp.kb(pg_temp.g('A'), 1));
begin
  perform pg_temp.ok('resolves the display file', as1::text, public.photo_usage_resolve_path(a, pg_temp.disp(a, 1))::text);
  perform pg_temp.ok('resolves a size', as1::text, public.photo_usage_resolve_path(a, pg_temp.kb(a, 1) || '/400.webp')::text);
  perform pg_temp.ok('resolves the original', as1::text, public.photo_usage_resolve_path(a, pg_temp.kb(a, 1) || '/original.jpg')::text);
  perform pg_temp.ok('not a file this upload has', '(null)', public.photo_usage_resolve_path(a, pg_temp.kb(a, 1) || '/800.webp')::text);
  perform pg_temp.ok('not the key base itself', '(null)', public.photo_usage_resolve_path(a, pg_temp.kb(a, 1))::text);
  perform pg_temp.ok('no fuzzy matching: a prefix of the path', '(null)', public.photo_usage_resolve_path(a, pg_temp.disp(a, 1) || 'x')::text);
  perform pg_temp.ok('no directory, no asset', '(null)', public.photo_usage_resolve_path(a, 'heron.jpg')::text);
  perform pg_temp.ok('ANOTHER SITE''s photograph never resolves', '(null)', public.photo_usage_resolve_path(a, pg_temp.disp(b, 1))::text);
  perform pg_temp.ok('…and does for its own site', 'resolved',
    case when public.photo_usage_resolve_path(b, pg_temp.disp(b, 1)) is not null then 'resolved' end);
end $$;


-- ── 5. A live page: bound to its source, fresh, and never on both halves ────

do $$
declare
  a    uuid := pg_temp.g('A');
  b    uuid := pg_temp.g('B');
  refs jsonb;
  src  text;
  r    text;
  ok   jsonb;
begin
  insert into public.page_sections (tenant_id, page, type, position, settings) values
    (a, 'home', 'hero', 0, jsonb_build_object('image_path', pg_temp.disp(a, 1),
                                             'image_path_mobile', pg_temp.kb(a, 2) || '/400.webp',
                                             'video_path', pg_temp.kb(a, 3) || '/original.jpg')),
    (a, 'home', 'intro', 1, jsonb_build_object('image_path', pg_temp.disp(a, 2),
                                              'bg_image', pg_temp.disp(b, 1), 'heading', 'Hello'));
  -- Legacy columns set too: with rows present they are mirrors, never usages.
  update public.site_settings set hero_image_path = pg_temp.disp(a, 3) where tenant_id = a;

  refs := jsonb_build_array(
    jsonb_build_object('kind', 'page_section', 'page_key', 'home', 'position', 0, 'field', 'image_path', 'path', pg_temp.disp(a, 1), 'decorative', false),
    jsonb_build_object('kind', 'page_section', 'page_key', 'home', 'position', 0, 'field', 'image_path_mobile', 'path', pg_temp.kb(a, 2) || '/400.webp', 'decorative', false),
    jsonb_build_object('kind', 'page_section', 'page_key', 'home', 'position', 1, 'field', 'image_path', 'path', pg_temp.disp(a, 2), 'decorative', false),
    jsonb_build_object('kind', 'page_section', 'page_key', 'home', 'position', 1, 'field', 'bg_image', 'path', pg_temp.disp(b, 1), 'decorative', true));
  r := vu.sync(a, 'live_page', 'home', refs);
  ok := vu.j(r);
  perform pg_temp.ok('live home: synced', 'ok', pg_temp.st(r));
  perform pg_temp.ok('live home: three written, the foreign one unresolved', '3/1',
    (ok ->> 'written') || '/' || (ok ->> 'unresolved_count'));
  perform pg_temp.ok('live home: exactly the section slots — no legacy mirror, no video',
    'live/page_section/home/image_path@0, live/page_section/home/image_path@1, live/page_section/home/image_path_mobile@0',
    pg_temp.rows('true'));
  perform pg_temp.ok('the unresolved reference says why', 'no_asset', ok -> 'unresolved' -> 0 ->> 'reason');

  -- Bound to the source: every way of naming something the source does not say.
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(refs -> 0 || jsonb_build_object('path', pg_temp.disp(a, 3))));
  perform pg_temp.ok('a path the slot does not hold is refused', '22023|photo usages: the reference does not match the saved source.', r);
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(refs -> 2 || jsonb_build_object('field', 'heading', 'path', 'Hello')));
  perform pg_temp.ok('…a non-photograph setting that does match is accepted but resolves nothing', 'ok|0',
    pg_temp.st(r) || '|' || coalesce(vu.j(r) ->> 'written', r));
  -- (That sync REPLACED the page's projection with nothing; put it back.)
  r := vu.sync(a, 'live_page', 'home', refs);
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(refs -> 0 || jsonb_build_object('position', 5)));
  perform pg_temp.ok('a slot that does not exist is refused', '22023|photo usages: the reference does not match the saved source.', r);
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(refs -> 0 || jsonb_build_object('page_key', 'about')));
  perform pg_temp.ok('a reference to another page is refused', '22023|photo usages: a reference to another page.', r);
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(refs -> 0 || jsonb_build_object('alt', 'x')));
  perform pg_temp.ok('a key a reference may not carry is refused', '22023|photo usages: a reference carries a key it may not.', r);
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(refs -> 0 || jsonb_build_object('position', -1)));
  perform pg_temp.ok('a negative position is refused', '22023', pg_temp.st(r));
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(refs -> 0 || jsonb_build_object('position', 1.5)));
  perform pg_temp.ok('a fractional position is refused', '22023', pg_temp.st(r));
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(refs -> 0 || jsonb_build_object('kind', 'page_share')));
  perform pg_temp.ok('a page_share is never accepted from the caller', '22023', pg_temp.st(r));
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(refs -> 0 || jsonb_build_object('kind', 'page_legacy')));
  perform pg_temp.ok('a page_legacy is never accepted from the caller', '22023', pg_temp.st(r));
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(refs -> 0 || jsonb_build_object('kind', 'gallery')));
  perform pg_temp.ok('a gallery row is never accepted from the caller', '22023', pg_temp.st(r));
  perform pg_temp.ok('…and none of those refusals changed anything',
    'live/page_section/home/image_path@0, live/page_section/home/image_path@1, live/page_section/home/image_path_mobile@0',
    pg_temp.rows('true'));

  -- The ceilings, relative to the source.
  r := vu.sync(a, 'live_page', 'home', (select jsonb_agg(refs -> 0) from generate_series(1, 40)));
  perform pg_temp.ok('more references than the source has values is refused', '22023',
    pg_temp.st(r) || case when r like '%references for a source holding%' then '' else ' (' || r || ')' end);
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(refs -> 0 || jsonb_build_object('path', repeat('x', 100000))));
  perform pg_temp.ok('a payload larger than its source could produce is refused', '22023|photo usages: the references are larger than their source could produce.', r);

  -- FRESHNESS: an older snapshot never overwrites a newer saved document.
  src := vu.src(a, 'live_page', 'home');
  update public.page_sections set settings = settings || jsonb_build_object('image_path', pg_temp.disp(a, 3))
   where tenant_id = a and page = 'home' and type = 'hero';
  r := vu.as('service_role', format('select public.sync_photo_usages(%L, ''live_page'', ''home'', %L, %L)::text', a, src, refs));
  perform pg_temp.ok('an OLD snapshot after a newer save: stale, and nothing written', 'true/0',
    (vu.j(r) ->> 'stale') || '/' || (vu.j(r) ->> 'written'));
  perform pg_temp.ok('…the projection is untouched by it', pg_temp.disp(a, 1),
    (select pa.display_path from public.photo_usages u join public.photo_assets pa on pa.id = u.asset_id
      where u.tenant_id = a and u.kind = 'page_section' and u.position = 0 and u.field = 'image_path'));
  r := vu.sync(a, 'live_page', 'home', jsonb_set(refs, '{0,path}', to_jsonb(pg_temp.disp(a, 3))));
  perform pg_temp.ok('…and the NEW snapshot projects the new photograph', pg_temp.disp(a, 3),
    (select pa.display_path from public.photo_usages u join public.photo_assets pa on pa.id = u.asset_id
      where u.tenant_id = a and u.kind = 'page_section' and u.position = 0 and u.field = 'image_path'));
  perform pg_temp.ok('the stale-detection text is the canonical jsonb text', 'true',
    (vu.src(a, 'live_page', 'home') = public.photo_usage_source(a, 'live_page', 'home')::text)::text);
end $$;


-- ── 6. The legacy rule: zero rows → legacy columns; any rows → sections ─────

do $$
declare
  a uuid := pg_temp.g('A');
  r text;
begin
  update public.site_settings set about_image_path = pg_temp.disp(a, 1) where tenant_id = a;
  r := vu.sync(a, 'live_page', 'about', '[]');
  perform pg_temp.ok('about with NO rows: its legacy column is the usage', 'live/page_legacy/about/about_image_path@0',
    pg_temp.rows('page_key = ''about'''));
  r := vu.sync(a, 'live_page', 'about', jsonb_build_array(jsonb_build_object('kind', 'page_section',
         'page_key', 'about', 'position', 0, 'field', 'image_path', 'path', pg_temp.disp(a, 1))));
  perform pg_temp.ok('…and a page_section cannot be claimed for it', '22023|photo usages: the reference does not match the saved source.', r);

  insert into public.page_sections (tenant_id, page, type, position, settings)
  values (a, 'about', 'about', 0, jsonb_build_object('image_path', pg_temp.disp(a, 2)));
  r := vu.sync(a, 'live_page', 'about', jsonb_build_array(jsonb_build_object('kind', 'page_section',
         'page_key', 'about', 'position', 0, 'field', 'image_path', 'path', pg_temp.disp(a, 2))));
  perform pg_temp.ok('about WITH a row: the section is the usage, the legacy column is not',
    'live/page_section/about/image_path@0', pg_temp.rows('page_key = ''about'''));
  perform pg_temp.ok('never both, on any live page', '0',
    (select count(*)::text from (
       select page_key from public.photo_usages where tenant_id = a and scope = 'live' and kind = 'page_section'
       intersect
       select page_key from public.photo_usages where tenant_id = a and scope = 'live' and kind = 'page_legacy') x));
  delete from public.page_sections where tenant_id = a and page = 'about';
  r := vu.sync(a, 'live_page', 'about', '[]');
  perform pg_temp.ok('rows removed again: back to the legacy column', 'live/page_legacy/about/about_image_path@0',
    pg_temp.rows('page_key = ''about'''));
end $$;


-- ── 7. Share images: the explicit one only ──────────────────────────────────

do $$
declare
  a uuid := pg_temp.g('A');
  r text;
begin
  -- Home has section photographs and NO stored share image: lib/seo.ts would
  -- fall back to the first of them, and that fallback is not a usage.
  update public.site_settings set page_seo = '{}' where tenant_id = a;
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(jsonb_build_object('kind', 'page_section',
         'page_key', 'home', 'position', 1, 'field', 'image_path', 'path', pg_temp.disp(a, 2))));
  perform pg_temp.ok('no stored share image: no page_share, whatever the page shows', '0',
    (select count(*)::text from public.photo_usages where tenant_id = a and kind = 'page_share'));

  update public.site_settings
     set page_seo = jsonb_build_object('home', jsonb_build_object('title', 'Home', 'image', pg_temp.disp(a, 3)))
   where tenant_id = a;
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(jsonb_build_object('kind', 'page_section',
         'page_key', 'home', 'position', 1, 'field', 'image_path', 'path', pg_temp.disp(a, 2))));
  perform pg_temp.ok('a stored share image is the page''s page_share', 'live/page_share/home/page_seo.image@0',
    pg_temp.rows('kind = ''page_share'''));
  update public.site_settings set page_seo = '{}' where tenant_id = a;
  r := vu.sync(a, 'live_page', 'home', jsonb_build_array(jsonb_build_object('kind', 'page_section',
         'page_key', 'home', 'position', 1, 'field', 'image_path', 'path', pg_temp.disp(a, 2))));
  perform pg_temp.ok('…and removing it removes the usage', 'none', pg_temp.rows('kind = ''page_share'''));
end $$;


-- ── 8. The draft: one document, its own scope, gone when it is ──────────────

do $$
declare
  a uuid := pg_temp.g('A');
  r text;
begin
  update public.site_draft
     set pages = jsonb_build_object('home', jsonb_build_array(
                   jsonb_build_object('id', 's1', 'type', 'hero', 'settings', jsonb_build_object('image_path', pg_temp.disp(a, 2))))),
         page_seo = jsonb_build_object('about', jsonb_build_object('image', pg_temp.disp(a, 1)))
   where tenant_id = a;
  r := vu.sync(a, 'draft', null, jsonb_build_array(jsonb_build_object('kind', 'page_section',
         'page_key', 'home', 'position', 0, 'field', 'image_path', 'path', pg_temp.disp(a, 2))));
  perform pg_temp.ok('draft: its sections and its share images, scoped draft',
    'draft/page_section/home/image_path@0, draft/page_share/about/page_seo.image@0', pg_temp.rows('scope = ''draft'''));
  perform pg_temp.ok('draft: the live projection is untouched by it', 'live/page_section/home/image_path@1',
    pg_temp.rows('scope = ''live'' and page_key = ''home'''));
  r := vu.as('service_role', format('select public.sync_photo_usages(%L, ''draft'', ''home'', ''{}'', ''[]'')::text', a));
  perform pg_temp.ok('the draft takes no key', '22023|photo usages: the draft is the whole site; it takes no key.', r);

  delete from public.site_draft where tenant_id = a;
  r := vu.sync(a, 'draft', null, '[]');
  perform pg_temp.ok('draft deleted: no draft usages', 'none', pg_temp.rows('scope = ''draft'''));
  r := vu.sync(a, 'draft', null, jsonb_build_array(jsonb_build_object('kind', 'page_section',
         'page_key', 'home', 'position', 0, 'field', 'image_path', 'path', pg_temp.disp(a, 2))));
  perform pg_temp.ok('…and a reference into the deleted draft is refused', '22023', pg_temp.st(r));
end $$;


-- ── 9. An album: read here, never accepted ──────────────────────────────────

do $$
declare
  a   uuid := pg_temp.g('A');
  al  uuid := pg_temp.g('album');
  as1 uuid := (select id from public.photo_assets where key_base = pg_temp.kb(pg_temp.g('A'), 1));
  r   text;
begin
  update public.photos set asset_id = as1 where id = pg_temp.g('photo1');
  update public.albums set cover_photo_id = pg_temp.g('photo1'), cover_custom_path = pg_temp.disp(a, 2) where id = al;
  r := vu.sync(a, 'album', al::text, '[]');
  perform pg_temp.ok('album: its asset-backed photograph, its chosen and custom covers',
    'live/gallery/-/photo@0, live/gallery_cover/-/cover_custom_path@0, live/gallery_cover/-/cover_photo_id@0',
    pg_temp.rows('(photo_id is not null or album_id is not null)'));
  perform pg_temp.ok('album: the photograph with no asset yet is counted, not written', '1',
    vu.j(r) ->> 'unresolved_count');
  r := vu.sync(a, 'album', upper(al::text), '[]');
  perform pg_temp.ok('album: an upper-case id is the same album (one lock, one projection)', 'ok|3',
    pg_temp.st(r) || '|' || (select count(*)::text from public.photo_usages where tenant_id = a and (photo_id is not null or album_id is not null)));
  r := vu.sync(a, 'album', al::text, jsonb_build_array(jsonb_build_object('kind', 'gallery',
         'position', 0, 'field', 'photo', 'path', pg_temp.disp(a, 1))));
  perform pg_temp.ok('album: a caller cannot supply a gallery row', '22023', pg_temp.st(r));
  r := vu.sync(a, 'album', pg_temp.g('album2')::text, '[]');
  perform pg_temp.ok('album: another album''s sync leaves this one alone', '3',
    (select count(*)::text from public.photo_usages where tenant_id = a and (photo_id is not null or album_id is not null)));
  r := vu.sync(a, 'album', 'bbbbbbbb-0000-0000-0000-000000000003', '[]');
  perform pg_temp.ok('album: a FOREIGN site''s album writes nothing here', 'ok|0',
    pg_temp.st(r) || '|' || (vu.j(r) ->> 'written'));

  -- The chosen cover goes: its usage goes with the next sync (deletePhoto's hook).
  update public.albums set cover_photo_id = null where id = al;
  r := vu.sync(a, 'album', al::text, '[]');
  perform pg_temp.ok('album: cover cleared → its cover usage cleared',
    'live/gallery/-/photo@0, live/gallery_cover/-/cover_custom_path@0',
    pg_temp.rows('(photo_id is not null or album_id is not null)'));
end $$;


-- ── 10. A story: blocks by INDEX, alt mirrored from the source ──────────────

do $$
declare
  a    uuid := pg_temp.g('A');
  p    uuid := pg_temp.g('post');
  refs jsonb;
  r    text;
begin
  update public.blog_posts
     set featured_custom_path = pg_temp.disp(a, 1),
         blocks = jsonb_build_array(
           jsonb_build_object('id', 'dup', 'type', 'image', 'image', jsonb_build_object('path', pg_temp.disp(a, 2), 'alt', '   ')),
           jsonb_build_object('id', 'dup', 'type', 'image_pair',
             'left', jsonb_build_object('path', pg_temp.disp(a, 1), 'alt', 'A heron, fishing'),
             'right', jsonb_build_object('path', pg_temp.kb(a, 2) || '/400.webp')),
           jsonb_build_object('id', 'g', 'type', 'gallery', 'images', jsonb_build_array(
             jsonb_build_object('path', 'photos/legacy/1.jpg'),
             jsonb_build_object('path', pg_temp.disp(a, 3)))),
           jsonb_build_object('id', 't', 'type', 'text', 'html', '<p>words</p>'))
   where id = p;
  refs := jsonb_build_array(
    jsonb_build_object('kind', 'story_block', 'field', 'block:0', 'position', 0, 'path', pg_temp.disp(a, 2)),
    jsonb_build_object('kind', 'story_block', 'field', 'block:1', 'position', 0, 'path', pg_temp.disp(a, 1)),
    jsonb_build_object('kind', 'story_block', 'field', 'block:1', 'position', 1, 'path', pg_temp.kb(a, 2) || '/400.webp'),
    jsonb_build_object('kind', 'story_block', 'field', 'block:2', 'position', 0, 'path', 'photos/legacy/1.jpg'),
    jsonb_build_object('kind', 'story_block', 'field', 'block:2', 'position', 1, 'path', pg_temp.disp(a, 3)));
  r := vu.sync(a, 'post', p::text, refs);
  perform pg_temp.ok('story: cover and blocks — two blocks sharing an id are still two slots',
    'live/story_block/-/block:0@0, live/story_block/-/block:1@0 alt=A heron, fishing, live/story_block/-/block:1@1, live/story_block/-/block:2@1, live/story_cover/-/featured_custom_path@0',
    pg_temp.rows('post_id is not null'));
  perform pg_temp.ok('story: the legacy path is counted, not written', '1', vu.j(r) ->> 'unresolved_count');
  r := vu.sync(a, 'post', p::text, jsonb_build_array(refs -> 0 || jsonb_build_object('field', 'block:dup')));
  perform pg_temp.ok('story: a block named by its browser id is refused', '22023|photo usages: "block:dup" is not a block slot.', r);
  r := vu.sync(a, 'post', p::text, jsonb_build_array(refs -> 1 || jsonb_build_object('position', 2)));
  perform pg_temp.ok('story: a pair has no third image', '22023|photo usages: the reference does not match the saved story.', r);
  r := vu.sync(a, 'post', p::text, jsonb_build_array(refs -> 0 || jsonb_build_object('field', 'block:3')));
  perform pg_temp.ok('story: a text block holds no photograph', '22023|photo usages: the reference does not match the saved story.', r);
  r := vu.sync(a, 'post', p::text, jsonb_build_array(refs -> 0 || jsonb_build_object('decorative', true)));
  perform pg_temp.ok('story: a story photograph is not decorative', '22023|photo usages: a story photograph is not decorative.', r);
end $$;


-- ── 11. A catalogue entry, named by its photograph ──────────────────────────

do $$
declare
  a    uuid := pg_temp.g('A');
  item uuid;
  r    text;
begin
  insert into public.catalog_items (tenant_id, photo_id) values (a, pg_temp.g('photo1')) returning id into item;
  r := vu.sync(a, 'catalog_item', pg_temp.g('photo1')::text, '[]');
  perform pg_temp.ok('catalogue: the entry lists its photograph', 'live/shop_listing/-/photo@0',
    pg_temp.rows('product_id is not null'));
  perform pg_temp.ok('catalogue: parented on the entry', item::text,
    (select product_id::text from public.photo_usages where tenant_id = a and kind = 'shop_listing'));
  delete from public.catalog_items where id = item;
  perform pg_temp.ok('catalogue: deleting the entry cascades its usage', 'none', pg_temp.rows('product_id is not null'));
end $$;


-- ── 12. The parents a rebuild walks ─────────────────────────────────────────

do $$
declare
  a uuid := pg_temp.g('A');
  r text;
begin
  r := vu.as('service_role', format('select public.list_photo_usage_parents(%L)::text', a));
  perform pg_temp.ok('parents: albums, posts and the pages any source names',
    '["about", "home"] 2 1',
    (vu.j(r) ->> 'pages') || ' ' || jsonb_array_length(vu.j(r) -> 'albums') || ' ' || jsonb_array_length(vu.j(r) -> 'posts'));
end $$;


-- ── 13. Built-in samples: skipped when DECLARED, counted when not ───────────
--
-- The database does not know which paths are samples (isSamplePhoto is the
-- application's rule). The extractor declares a sample slot; the sync binds
-- the declaration to the snapshot and skips the slot — no usage, nothing
-- unresolved. Undeclared, the same path is just an unresolved path.

do $$
declare
  a      uuid := pg_temp.g('A');
  sample text := '/samples/church/1600.webp';
  r      text;
  decl   jsonb;
begin
  delete from public.page_sections where tenant_id = a;
  update public.site_settings
     set about_image_path = sample,
         hero_image_path = 'photos/2019/old-hero.jpg',
         page_seo = jsonb_build_object('about', jsonb_build_object('image', sample))
   where tenant_id = a;

  decl := jsonb_build_array(
    jsonb_build_object('kind', 'sample', 'page_key', 'about', 'position', 0, 'field', 'about_image_path', 'path', sample),
    jsonb_build_object('kind', 'sample', 'page_key', 'about', 'position', 0, 'field', 'page_seo.image', 'path', sample));
  r := vu.sync(a, 'live_page', 'about', decl);
  perform pg_temp.ok('sample legacy column and sample share image, declared: no usage, nothing unresolved',
    'none / 0', pg_temp.rows('page_key = ''about''') || ' / ' || (vu.j(r) ->> 'unresolved_count'));

  r := vu.sync(a, 'live_page', 'about', '[]');
  perform pg_temp.ok('…the same paths UNdeclared are simply unresolved (the database guesses nothing)',
    'none / 2', pg_temp.rows('page_key = ''about''') || ' / ' || (vu.j(r) ->> 'unresolved_count'));

  r := vu.sync(a, 'live_page', 'home', '[]');
  perform pg_temp.ok('an old NON-sample legacy path is still counted unresolved', '1', vu.j(r) ->> 'unresolved_count');

  r := vu.sync(a, 'live_page', 'about', jsonb_build_array(decl -> 0 || jsonb_build_object('path', '/samples/other/1600.webp')));
  perform pg_temp.ok('a sample declaration for a value the slot does not hold is refused',
    '22023|photo usages: the reference does not match the saved source.', r);
  r := vu.sync(a, 'live_page', 'about', jsonb_build_array(decl -> 0 || jsonb_build_object('field', 'image_path')));
  perform pg_temp.ok('a sample declaration may only name a legacy column or the share image', '22023', pg_temp.st(r));
  r := vu.sync(a, 'live_page', 'about', jsonb_build_array(decl -> 0 || jsonb_build_object('position', 1)));
  perform pg_temp.ok('a sample declaration is position 0', '22023', pg_temp.st(r));
  r := vu.sync(a, 'post', pg_temp.g('post')::text, jsonb_build_array(decl -> 0));
  perform pg_temp.ok('a sample declaration is not accepted for a story', '22023', pg_temp.st(r));

  -- The draft's stored share image.
  insert into public.site_draft (tenant_id, pages, page_seo)
  values (a, '{}', jsonb_build_object('contact', jsonb_build_object('image', sample)))
  on conflict (tenant_id) do update set pages = excluded.pages, page_seo = excluded.page_seo;
  r := vu.sync(a, 'draft', null, jsonb_build_array(jsonb_build_object('kind', 'sample', 'page_key', 'contact',
         'position', 0, 'field', 'page_seo.image', 'path', sample)));
  perform pg_temp.ok('a sample draft share image, declared: no usage, nothing unresolved', 'none / 0',
    pg_temp.rows('scope = ''draft''') || ' / ' || (vu.j(r) ->> 'unresolved_count'));
end $$;


-- ── 14. Sample photographs rows and a sample story cover ────────────────────
--
-- Gallery rows, covers and catalogue entries stay the database's to read. A
-- declaration only names a photographs row the extractor found to be a sample;
-- it is proved against the CANONICAL row (this site, this album / entry,
-- exactly this storage_path) or refused.

do $$
declare
  a      uuid := pg_temp.g('A');
  b      uuid := pg_temp.g('B');
  al     uuid := pg_temp.g('album');
  sample text := '/samples/church/1600.webp';
  s1     uuid := 'cccccccc-0000-0000-0000-0000000005a1';
  sB     uuid := 'cccccccc-0000-0000-0000-0000000005b1';
  as1    uuid := (select id from public.photo_assets where key_base = pg_temp.kb(pg_temp.g('A'), 1));
  as2    uuid := (select id from public.photo_assets where key_base = pg_temp.kb(pg_temp.g('A'), 2));
  decl   jsonb;
  r      text;
  before int;
  item   uuid;
begin
  insert into public.photos (id, tenant_id, album_id, storage_path, sort_order) values
    (s1, a, al, sample, 9),
    (sB, b, 'bbbbbbbb-0000-0000-0000-000000000003', sample, 0);
  update public.photos set asset_id = as1 where id = pg_temp.g('photo1');
  update public.photos set asset_id = as2 where id = pg_temp.g('photo2');
  update public.albums set cover_photo_id = s1, cover_custom_path = null where id = al;
  decl := jsonb_build_array(jsonb_build_object('kind', 'sample', 'photo_id', s1, 'position', 0, 'field', 'photo', 'path', sample));

  -- MIXED: two canonical (asset-backed) photographs + a sample, which is also the chosen cover.
  r := vu.sync(a, 'album', al::text, decl);
  perform pg_temp.ok('mixed album: canonical gallery usages only — none for the sample, no cover usage, 0 unresolved',
    'live/gallery/-/photo@0, live/gallery/-/photo@0 / 0 / 0',
    pg_temp.rows('(photo_id is not null or album_id = ''' || al || ''')') || ' / '
      || (select count(*) from public.photo_usages where photo_id = s1 or (album_id = al and field = 'cover_photo_id'))
      || ' / ' || (vu.j(r) ->> 'unresolved_count'));
  r := vu.sync(a, 'album', al::text, '[]');
  perform pg_temp.ok('…the same sample UNdeclared counts (gallery + chosen cover): the database guesses nothing', '2',
    vu.j(r) ->> 'unresolved_count');

  -- A non-sample pre-P2 photograph (asset_id NULL) is still unresolved.
  update public.photos set asset_id = null where id = pg_temp.g('photo2');
  r := vu.sync(a, 'album', al::text, decl);
  perform pg_temp.ok('a non-sample photograph with no asset is still counted', '1', vu.j(r) ->> 'unresolved_count');

  -- Every way a declaration can fail to match the canonical row is refused.
  before := (select count(*) from public.photo_usages where tenant_id = a);
  r := vu.sync(a, 'album', al::text, jsonb_set(decl, '{0,photo_id}', to_jsonb(gen_random_uuid())));
  perform pg_temp.ok('a sample naming a photograph that does not exist is refused', '22023|photo usages: the sample does not match a photograph of this album.', r);
  update public.photos set storage_path = sample where id = pg_temp.g('photo3');
  r := vu.sync(a, 'album', al::text, jsonb_set(decl, '{0,photo_id}', to_jsonb(pg_temp.g('photo3'))));
  perform pg_temp.ok('a sample naming ANOTHER ALBUM''s photograph is refused', '22023|photo usages: the sample does not match a photograph of this album.', r);
  r := vu.sync(a, 'album', al::text, jsonb_set(decl, '{0,photo_id}', to_jsonb(sB)));
  perform pg_temp.ok('a sample naming ANOTHER SITE''s photograph is refused', '22023|photo usages: the sample does not match a photograph of this album.', r);
  r := vu.sync(a, 'album', al::text, jsonb_set(decl, '{0,photo_id}', to_jsonb(pg_temp.g('photo1'))));
  perform pg_temp.ok('a sample whose path is not the row''s storage_path is refused (a real photograph cannot be hidden)',
    '22023|photo usages: the sample does not match a photograph of this album.', r);
  r := vu.sync(a, 'album', al::text, jsonb_set(decl, '{0,photo_id}', '"not-a-uuid"'));
  perform pg_temp.ok('a sample whose photo_id is not an id is refused', '22023|photo usages: a photograph sample names its photograph.', r);
  r := vu.sync(a, 'album', al::text, jsonb_set(decl, '{0,field}', '"cover_photo_id"'));
  perform pg_temp.ok('a photograph sample is field "photo" only', '22023', pg_temp.st(r));
  r := vu.sync(a, 'live_page', 'home', decl);
  perform pg_temp.ok('a photo_id is not accepted on a page', '22023|photo usages: only an album or catalogue sample names a photograph.', r);
  perform pg_temp.ok('…and no refusal changed a single row', before::text,
    (select count(*)::text from public.photo_usages where tenant_id = a));

  -- The catalogue: an entry made from a sample photograph.
  insert into public.catalog_items (tenant_id, photo_id) values (a, s1) returning id into item;
  r := vu.sync(a, 'catalog_item', s1::text, decl);
  perform pg_temp.ok('a catalogue entry made from a sample: no shop_listing, 0 unresolved', '0 / 0',
    (select count(*) from public.photo_usages where product_id = item) || ' / ' || (vu.j(r) ->> 'unresolved_count'));
  r := vu.sync(a, 'catalog_item', s1::text, jsonb_set(decl, '{0,photo_id}', to_jsonb(pg_temp.g('photo1'))));
  perform pg_temp.ok('a catalogue sample naming another photograph is refused',
    '22023|photo usages: the sample does not match a photograph of this catalogue entry.', r);
  delete from public.catalog_items where id = item;

  -- The story's featured image.
  update public.blog_posts set featured_custom_path = sample, blocks = '[]' where id = pg_temp.g('post');
  r := vu.sync(a, 'post', pg_temp.g('post')::text, jsonb_build_array(jsonb_build_object(
         'kind', 'sample', 'position', 0, 'field', 'featured_custom_path', 'path', sample)));
  perform pg_temp.ok('a sample featured image, declared: no story_cover, 0 unresolved', 'none / 0',
    pg_temp.rows('post_id is not null') || ' / ' || (vu.j(r) ->> 'unresolved_count'));
  r := vu.sync(a, 'post', pg_temp.g('post')::text, jsonb_build_array(jsonb_build_object(
         'kind', 'sample', 'position', 0, 'field', 'featured_custom_path', 'path', '/samples/other/1600.webp')));
  perform pg_temp.ok('a story sample that is not the saved featured path is refused',
    '22023|photo usages: the reference does not match the saved story.', r);
  update public.blog_posts set featured_custom_path = 'journal/2018/old-cover.jpg' where id = pg_temp.g('post');
  r := vu.sync(a, 'post', pg_temp.g('post')::text, '[]');
  perform pg_temp.ok('an old NON-sample featured path is still counted', '1', vu.j(r) ->> 'unresolved_count');
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
    from vu_res;

  select count(*), count(*) filter (where not coalesce(pass, false)) into total, failed from vu_res;

  raise exception E'\n\n%\n\n%\n\nNothing was kept — this transaction always rolls back.\n',
    report,
    case when failed = 0 then format('All %s checks passed.', total)
         else format('%s of %s check(s) failed. P3 is NOT ready.', failed, total) end;
end $$;

rollback;
