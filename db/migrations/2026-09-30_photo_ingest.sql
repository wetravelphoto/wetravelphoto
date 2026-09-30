-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-30 — P2: one way in for a photograph
--
-- claude/photo-assets-design.md §9 (revision 7) is the design and
-- claude/photo-migration-plan.md, P2, the phase. This file adds FUNCTIONS and
-- their grants. It changes no table, no column, no index, no policy and no
-- table grant: `authenticated` still holds SELECT only on photo_assets and
-- photo_usages, and anon and service_role still hold nothing.
--
-- ── Why functions, and why four ─────────────────────────────────────────────
--
-- Four upload routes make a photograph: a gallery upload (A), a photograph
-- uploaded from the editor's picker (B), a journal image (C) and a custom
-- gallery cover (D). All four run as the SIGNED-IN PHOTOGRAPHER, through their
-- own Supabase client, and stay that way — no upload moves to the service role.
--
-- A photographer could not be given INSERT on photo_assets: row-level security
-- decides WHICH ROWS, not WHAT VALUES (S3's lesson), so a browser posting
-- straight to PostgREST could write `state = 'derived'`, `alt_source = 'ai'`,
-- a key under another site's prefix, or a created_by that is not them.
--
-- So each route gets its own narrow SECURITY DEFINER wrapper, granted to
-- `authenticated` alone, which accepts ONLY what that route may set. There is
-- no parameter for state, alt_text, alt_source, alt_reviewed_at, archived_at,
-- deleted_at, original_purged_at or created_by: the caller cannot say them.
-- Latitude and longitude exist on the gallery wrapper only — the one route
-- that stored them before P2. The cover wrapper has no original path: a cover
-- keeps no original, and never has.
--
-- The shared work — validation and the upsert — lives in one INTERNAL helper,
-- `upsert_photo_asset`, which is SECURITY INVOKER and executable by no
-- application role. It runs only inside a wrapper, i.e. as the owner.
--
-- ── What every wrapper checks, in order ─────────────────────────────────────
--
--   1. the site: it exists, and it is the caller's own
--      (`current_tenant_id()`) — or the caller is a platform admin, who edits
--      the site at the address they are on. The established rule.
--   2. the album (A, D): it exists ON THAT SITE. A foreign album and a missing
--      one get the same answer, so this cannot be used to probe.
--   3. the storage key, as the exact string the route mints:
--        A  t/<site>/photos/<album>/<uuid>
--        B  t/<site>/site-images/<uuid>
--        C  t/<site>/journal/<uuid>
--        D  t/<site>/covers/<album>/<uuid>
--   4. (helper) every path is inside that key, the facts are sane, and the
--      capture metadata is the approved, normalised, bounded shape.
--
-- ── One transaction, and safe to repeat ─────────────────────────────────────
--
-- The asset and the route's own row (the photos membership and its gallery
-- usage, the site_images row, the album's cover) are written in ONE
-- transaction — the function call. The asset is upserted `on conflict
-- (tenant_id, key_base) do nothing` and then LOCKED (`for update`), so two
-- registrations of one upload serialise on that row; the relationship is looked
-- up after the lock, sees the winner's committed row, and is reused. No new
-- uniqueness constraint on photos or site_images is needed. A retry never
-- rewrites anything on an existing asset — created_by included; a different
-- file at the same key, or an archived or deleted asset, is refused. And a
-- relationship row the retry has to (re)create — the photos membership, the
-- site_images row, the album's cover path — takes its file facts from the
-- CANONICAL asset row, never from the retry's own arguments, so it always
-- agrees with the asset it points at.
--
-- Every function: `search_path = ''`, every object qualified; EXECUTE revoked
-- from public, anon, authenticated and service_role FIRST (a grant is
-- additive, and Supabase's default privileges hand functions out), then
-- granted to `authenticated` for the four wrappers and to nobody for the
-- helper.
--
-- Safe to run twice. Rehearse against db/test-fixture.sql, which does not
-- contain P2 until production does.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── The internal helper ─────────────────────────────────────────────────────
--
-- Validates everything that does not depend on which route is asking, then
-- creates or reuses the asset and returns its id. INVOKER: inside a wrapper it
-- runs as the owner; anybody else would have neither EXECUTE on it nor any
-- write privilege on photo_assets.

create or replace function public.upsert_photo_asset(
  p_tenant          uuid,
  p_key_base        text,
  p_original_path   text,
  p_display_path    text,
  p_derivatives     jsonb,
  p_width           integer,
  p_height          integer,
  p_original_bytes  bigint,
  p_content_sha256  text,
  p_content_type    text,
  p_filename        text,
  p_taken_at        timestamptz,
  p_camera_make     text,
  p_camera_model    text,
  p_lens            text,
  p_iso             integer,
  p_aperture        numeric,
  p_shutter         text,
  p_focal_length    numeric,
  p_keywords        text[],
  p_exif            jsonb,
  p_latitude        double precision,
  p_longitude       double precision,
  p_created_by      uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_sizes   constant text[] := array['400', '800', '1600', '2400'];
  v_exif    jsonb := coalesce(p_exif, '{}'::jsonb);
  v_key     text;
  v_value   jsonb;
  v_largest text;
  v_kw      text;
  v_id      uuid;
  v_sha     text;
  v_archived timestamptz;
  v_deleted  timestamptz;
begin
  -- ── Paths: all inside the key ─────────────────────────────────────────────
  if p_key_base is null or p_display_path is null or p_derivatives is null then
    raise exception 'A photograph needs its key, its display path and its sizes.'
      using errcode = '23502';
  end if;

  -- The original, when the route keeps one, is `<key>/original.<ext>` and
  -- nothing else. Compared as strings, not as a pattern, so nothing in the key
  -- can act as a wildcard.
  if p_original_path is not null and not (
       left(p_original_path, length(p_key_base) + 10) = p_key_base || '/original.'
       and substr(p_original_path, length(p_key_base) + 11) in ('jpg', 'png', 'webp', 'tif', 'avif')
     ) then
    raise exception 'The original is not where this upload''s key says it is.'
      using errcode = '22023';
  end if;

  -- The sizes: an object of "<size>": "<key>/<size>.webp", sizes from the
  -- ladder only, 400 always — exactly what lib/derivatives.ts produces.
  if jsonb_typeof(p_derivatives) <> 'object' then
    raise exception 'The sizes must be an object.' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(p_derivatives) loop
    if not (v_key = any (c_sizes)) then
      raise exception 'There is no display size called "%".', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(v_value) <> 'string'
       or (v_value #>> '{}') <> p_key_base || '/' || v_key || '.webp' then
      raise exception 'Size % is not where this upload''s key says it is.', v_key
        using errcode = '22023';
    end if;
  end loop;
  if not (p_derivatives ? '400') then
    raise exception 'Every photograph has a 400 size.' using errcode = '22023';
  end if;
  select s into v_largest
    from unnest(c_sizes) with ordinality as z(s, n)
   where p_derivatives ? s
   order by n desc
   limit 1;
  if p_display_path <> p_derivatives ->> v_largest then
    raise exception 'The display path must be the largest size, %.', v_largest
      using errcode = '22023';
  end if;

  -- ── Facts the server measured ─────────────────────────────────────────────
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'The content hash must be 64 lower-case hex characters.' using errcode = '22023';
  end if;
  if p_original_bytes is null or p_original_bytes <= 0 then
    raise exception 'A photograph has more than zero bytes.' using errcode = '22023';
  end if;
  -- A photograph that was really processed has real dimensions, and the
  -- asset and its row must agree on them — so a zero is a failure, not a NULL.
  if p_width is null or p_height is null or p_width <= 0 or p_height <= 0 then
    raise exception 'A processed photograph has a width and a height.' using errcode = '22023';
  end if;
  -- NULL when the processor decoded the pixels but not as one of these. The
  -- helper allows it; the wrappers decide per route: the three signed-upload
  -- routes (gallery, site, journal) refuse a NULL, and only a custom cover —
  -- which arrives in the form and may be any format sharp reads — may keep
  -- one. Never used to authorise anything.
  if p_content_type is not null and p_content_type not in
       ('image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif', 'image/heif') then
    raise exception 'Unknown content type "%".', p_content_type using errcode = '22023';
  end if;
  if p_filename is not null and (length(p_filename) > 120 or p_filename ~ '[[:cntrl:]]') then
    raise exception 'A file name is at most 120 characters, with no control characters.'
      using errcode = '22023';
  end if;

  -- ── Capture metadata: the normalised shape, bounded ──────────────────────
  if length(p_camera_make)  > 64 or p_camera_make  ~ '[[:cntrl:]]'
  or length(p_camera_model) > 64 or p_camera_model ~ '[[:cntrl:]]'
  or length(p_lens)         > 96 or p_lens         ~ '[[:cntrl:]]' then
    raise exception 'Camera and lens names are at most 64 / 64 / 96 plain characters.'
      using errcode = '22023';
  end if;
  if p_iso is not null and (p_iso < 1 or p_iso > 1000000) then
    raise exception 'ISO % is out of range.', p_iso using errcode = '22023';
  end if;
  if p_aperture is not null and (p_aperture < 0.5 or p_aperture > 99.9 or p_aperture <> round(p_aperture, 1)) then
    raise exception 'Aperture % is out of range.', p_aperture using errcode = '22023';
  end if;
  if p_shutter is not null and p_shutter !~ '^(1/[1-9][0-9]{0,5}|[0-9]{1,4}(\.[0-9])?s)$' then
    raise exception 'Shutter "%" is not in the normalised form.', p_shutter using errcode = '22023';
  end if;
  if p_focal_length is not null and (p_focal_length < 0.1 or p_focal_length > 9999.9
                                     or p_focal_length <> round(p_focal_length, 1)) then
    raise exception 'Focal length % is out of range.', p_focal_length using errcode = '22023';
  end if;
  if p_keywords is not null then
    if coalesce(array_length(p_keywords, 1), 0) > 25 then
      raise exception 'At most 25 keywords.' using errcode = '22023';
    end if;
    foreach v_kw in array p_keywords loop
      if v_kw is null or v_kw = '' or length(v_kw) > 200 or v_kw ~ '[[:cntrl:]]' then
        raise exception 'A keyword is 1 to 200 plain characters.' using errcode = '22023';
      end if;
    end loop;
  end if;
  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90)
  or p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    raise exception 'That is not a place on Earth.' using errcode = '22023';
  end if;
  -- Both or neither: half a coordinate is not a place. The application's
  -- normaliser already guarantees it; this makes it true of every writer.
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'A place needs both a latitude and a longitude.' using errcode = '22023';
  end if;

  -- The `exif` subset: an object, version 1, allowlisted keys of allowlisted
  -- types and ranges, at most 1024 bytes. '{}' means nothing was worth keeping.
  if jsonb_typeof(v_exif) <> 'object' then
    raise exception 'exif must be an object.' using errcode = '22023';
  end if;
  if octet_length(v_exif::text) > 1024 then
    raise exception 'exif is over 1024 bytes.' using errcode = '22023';
  end if;
  if v_exif <> '{}'::jsonb and (v_exif -> 'v') is distinct from '1'::jsonb then
    raise exception 'exif must say it is version 1.' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(v_exif) loop
    if not (case v_key
      when 'v'                 then v_value = '1'::jsonb
      when 'orientation'       then jsonb_typeof(v_value) = 'number'
                                    and (v_value #>> '{}')::numeric in (1, 2, 3, 4, 5, 6, 7, 8)
      when 'offset_time'       then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') ~ '^[+-][0-9]{2}:[0-9]{2}$'
      when 'exposure_program'  then jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') in
                                    ('manual', 'program', 'aperture_priority', 'shutter_priority',
                                     'creative', 'action', 'portrait', 'landscape', 'other')
      when 'exposure_mode'     then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') in ('auto', 'manual', 'bracket')
      when 'exposure_bias_ev'  then jsonb_typeof(v_value) = 'number'
                                    and (v_value #>> '{}')::numeric between -20 and 20
      when 'metering_mode'     then jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') in
                                    ('average', 'center_weighted', 'spot', 'multi_spot',
                                     'pattern', 'partial', 'other')
      when 'flash_fired'       then jsonb_typeof(v_value) = 'boolean'
      when 'white_balance'     then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') in ('auto', 'manual')
      when 'focal_length_35mm' then jsonb_typeof(v_value) = 'number'
                                    and (v_value #>> '{}')::numeric between 1 and 5000
                                    and (v_value #>> '{}')::numeric = trunc((v_value #>> '{}')::numeric)
      when 'lens_make'         then jsonb_typeof(v_value) = 'string'
                                    and length(v_value #>> '{}') between 1 and 64
                                    and (v_value #>> '{}') !~ '[[:cntrl:]]'
      when 'color_space'       then jsonb_typeof(v_value) = 'string'
                                    and (v_value #>> '{}') in ('srgb', 'adobe_rgb', 'uncalibrated')
      when 'software'          then jsonb_typeof(v_value) = 'string'
                                    and length(v_value #>> '{}') between 1 and 64
                                    and (v_value #>> '{}') !~ '[[:cntrl:]]'
      else false
    end) then
      raise exception 'exif "%" is not an allowed key, or not an allowed value for it.', v_key
        using errcode = '22023';
    end if;
  end loop;

  -- ── Create, or find and LOCK ──────────────────────────────────────────────
  --
  -- State and derived_at are the database's to set: P2 ingestion is
  -- synchronous, so the sizes exist before this is called. created_by is the
  -- caller's identity, set once and never rewritten by a retry.
  insert into public.photo_assets (
    tenant_id, key_base, original_path, display_path, derivatives,
    original_bytes, content_type, filename, content_sha256, width, height,
    taken_at, latitude, longitude, camera_make, camera_model, lens, iso,
    aperture, shutter, focal_length, keywords, exif,
    state, derived_at, created_by
  ) values (
    p_tenant, p_key_base, p_original_path, p_display_path, p_derivatives,
    p_original_bytes, p_content_type, p_filename, p_content_sha256, p_width, p_height,
    p_taken_at, p_latitude, p_longitude, p_camera_make, p_camera_model, p_lens, p_iso,
    p_aperture, p_shutter, p_focal_length, coalesce(p_keywords, '{}'::text[]), v_exif,
    'derived', now(), p_created_by
  )
  on conflict (tenant_id, key_base) do nothing;

  select a.id, a.content_sha256, a.archived_at, a.deleted_at
    into v_id, v_sha, v_archived, v_deleted
    from public.photo_assets a
   where a.tenant_id = p_tenant and a.key_base = p_key_base
     for update;

  if v_sha is distinct from p_content_sha256 then
    raise exception 'That upload key already holds a different file.' using errcode = '22023';
  end if;
  if v_archived is not null or v_deleted is not null then
    raise exception 'That photograph has been archived or deleted.' using errcode = '55000';
  end if;

  return v_id;
end $$;


-- ── The tenant rule, restated in every wrapper ──────────────────────────────
--
-- A definer function is not subject to row-level security, so each wrapper
-- says the policy's rule itself. `current_tenant_id()` is the caller's OWN
-- site; a platform admin working on another site's address passes through
-- `is_platform_admin()`, exactly as the table policies let them.
--
-- WRITTEN `(…) IS NOT TRUE`, NOT `NOT (…)`. For a caller with no profile — a
-- signed-in account not attached to any site, or no identity at all —
-- `current_tenant_id()` is NULL, so `p_tenant = current_tenant_id()` is NULL,
-- `NULL or false` is NULL, and `if not (NULL)` does NOT raise: the check
-- silently passes. db/verify-photo-ingest.sql caught exactly that in the first
-- draft of this file. `is not true` refuses NULL as well as false.

-- ── A. A gallery photograph ─────────────────────────────────────────────────

create or replace function public.register_gallery_photo(
  p_tenant          uuid,
  p_album           uuid,
  p_key_base        text,
  p_original_path   text,
  p_display_path    text,
  p_derivatives     jsonb,
  p_width           integer,
  p_height          integer,
  p_original_bytes  bigint,
  p_content_sha256  text,
  p_content_type    text,
  p_taken_at        timestamptz,
  p_camera_make     text,
  p_camera_model    text,
  p_lens            text,
  p_iso             integer,
  p_aperture        numeric,
  p_shutter         text,
  p_focal_length    numeric,
  p_keywords        text[],
  p_exif            jsonb,
  p_latitude        double precision,
  p_longitude       double precision
)
returns table (photo_id uuid, asset_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_prefix text;
  v_asset  uuid;
  v_photo  uuid;
  v_sort   integer;
begin
  if p_tenant is null or p_album is null then
    raise exception 'A gallery photograph needs its site and its gallery.' using errcode = '23502';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant)
     or (p_tenant = public.current_tenant_id() or public.is_platform_admin()) is not true then
    raise exception 'That is not your site.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.albums al where al.id = p_album and al.tenant_id = p_tenant) then
    raise exception 'There is no such gallery on this site.' using errcode = '42501';
  end if;

  v_prefix := 't/' || p_tenant::text || '/photos/' || p_album::text || '/';
  if left(p_key_base, length(v_prefix)) is distinct from v_prefix
     or substr(p_key_base, length(v_prefix) + 1)
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'That upload does not belong to this gallery.' using errcode = '42501';
  end if;
  if p_original_path is null then
    raise exception 'A gallery photograph keeps its original.' using errcode = '23502';
  end if;
  -- A signed upload came through /api/upload-url, which accepts exactly five
  -- image types; the server identified the bytes. Anything else — NULL (not
  -- recognised) or HEIF (recognised, but not an upload type) — fails here.
  -- Only a custom cover may be HEIF or unrecognised. Never used to authorise
  -- anything.
  if p_content_type is null or p_content_type not in
       ('image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif') then
    raise exception 'A gallery photograph must be one of the five upload image types.' using errcode = '22023';
  end if;

  v_asset := public.upsert_photo_asset(
    p_tenant, p_key_base, p_original_path, p_display_path, p_derivatives,
    p_width, p_height, p_original_bytes, p_content_sha256, p_content_type, null,
    p_taken_at, p_camera_make, p_camera_model, p_lens, p_iso, p_aperture,
    p_shutter, p_focal_length, p_keywords, p_exif, p_latitude, p_longitude,
    auth.uid());

  -- The membership: reused if this upload is already in this gallery (a
  -- retry), otherwise written with exactly the columns registerPhoto wrote
  -- before P2, plus asset_id. sort_order is "after the last", as it was.
  select ph.id into v_photo
    from public.photos ph
   where ph.tenant_id = p_tenant and ph.album_id = p_album and ph.asset_id = v_asset
   order by ph.created_at, ph.id
   limit 1;

  if v_photo is null then
    select coalesce(max(ph.sort_order), -1) + 1 into v_sort
      from public.photos ph
     where ph.tenant_id = p_tenant and ph.album_id = p_album;

    -- Every file fact comes from the CANONICAL ASSET, not from this call's
    -- arguments. On a first registration they are the same values. On a
    -- retry against an asset that already exists (its membership deleted
    -- meanwhile) the helper did not rewrite the asset — and the recreated row
    -- must agree with the asset, not with whatever the retry sent.
    insert into public.photos (
      tenant_id, album_id, storage_path, original_path, original_bytes,
      derivatives, width, height, sort_order, tags, taken_at, latitude, longitude,
      asset_id
    )
    select p_tenant, p_album, pa.display_path, pa.original_path, pa.original_bytes,
           pa.derivatives, pa.width, pa.height, v_sort, pa.keywords,
           pa.taken_at, pa.latitude, pa.longitude,
           pa.id
      from public.photo_assets pa
     where pa.id = v_asset and pa.tenant_id = p_tenant
    returning id into v_photo;
  end if;

  -- The one usage P2 writes: the gallery membership's, beside its row, and
  -- removed with it by cascade.
  insert into public.photo_usages (tenant_id, asset_id, kind, photo_id, field)
  values (p_tenant, v_asset, 'gallery', v_photo, 'photo')
  on conflict (photo_id) where kind = 'gallery' do nothing;

  return query select v_photo, v_asset;
end $$;


-- ── B. A photograph uploaded from the editor's picker ───────────────────────

create or replace function public.register_site_image(
  p_tenant          uuid,
  p_key_base        text,
  p_original_path   text,
  p_display_path    text,
  p_derivatives     jsonb,
  p_width           integer,
  p_height          integer,
  p_original_bytes  bigint,
  p_content_sha256  text,
  p_content_type    text,
  p_filename        text,
  p_taken_at        timestamptz,
  p_camera_make     text,
  p_camera_model    text,
  p_lens            text,
  p_iso             integer,
  p_aperture        numeric,
  p_shutter         text,
  p_focal_length    numeric,
  p_keywords        text[],
  p_exif            jsonb
)
returns table (site_image_id uuid, asset_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_prefix text;
  v_asset  uuid;
  v_image  uuid;
begin
  if p_tenant is null then
    raise exception 'A photograph needs its site.' using errcode = '23502';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant)
     or (p_tenant = public.current_tenant_id() or public.is_platform_admin()) is not true then
    raise exception 'That is not your site.' using errcode = '42501';
  end if;

  v_prefix := 't/' || p_tenant::text || '/site-images/';
  if left(p_key_base, length(v_prefix)) is distinct from v_prefix
     or substr(p_key_base, length(v_prefix) + 1)
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'That upload does not belong to this site''s uploads.' using errcode = '42501';
  end if;
  if p_original_path is null then
    raise exception 'An uploaded photograph keeps its original.' using errcode = '23502';
  end if;
  -- A signed upload came through /api/upload-url, which accepts exactly five
  -- image types; the server identified the bytes. Anything else — NULL (not
  -- recognised) or HEIF (recognised, but not an upload type) — fails here.
  -- Only a custom cover may be HEIF or unrecognised. Never used to authorise
  -- anything.
  if p_content_type is null or p_content_type not in
       ('image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif') then
    raise exception 'An uploaded photograph must be one of the five upload image types.' using errcode = '22023';
  end if;

  -- No latitude or longitude: this route never stored them.
  v_asset := public.upsert_photo_asset(
    p_tenant, p_key_base, p_original_path, p_display_path, p_derivatives,
    p_width, p_height, p_original_bytes, p_content_sha256, p_content_type, p_filename,
    p_taken_at, p_camera_make, p_camera_model, p_lens, p_iso, p_aperture,
    p_shutter, p_focal_length, p_keywords, p_exif, null, null,
    auth.uid());

  select si.id into v_image
    from public.site_images si
   where si.tenant_id = p_tenant and si.asset_id = v_asset
   order by si.created_at, si.id
   limit 1;

  if v_image is null then
    -- The columns registerSiteImage wrote before P2, plus asset_id — each
    -- taken from the CANONICAL ASSET, never from a retry's arguments (see the
    -- note in register_gallery_photo).
    insert into public.site_images (
      tenant_id, storage_path, original_path, derivatives, width, height,
      bytes, filename, asset_id
    )
    select p_tenant, pa.display_path, pa.original_path, pa.derivatives, pa.width, pa.height,
           pa.original_bytes, pa.filename, pa.id
      from public.photo_assets pa
     where pa.id = v_asset and pa.tenant_id = p_tenant
    returning id into v_image;
  end if;

  return query select v_image, v_asset;
end $$;


-- ── C. A journal / story photograph ─────────────────────────────────────────
--
-- The asset only. The post the photograph goes into owns its placement; P3
-- projects it from there.

create or replace function public.register_journal_image(
  p_tenant          uuid,
  p_key_base        text,
  p_original_path   text,
  p_display_path    text,
  p_derivatives     jsonb,
  p_width           integer,
  p_height          integer,
  p_original_bytes  bigint,
  p_content_sha256  text,
  p_content_type    text,
  p_taken_at        timestamptz,
  p_camera_make     text,
  p_camera_model    text,
  p_lens            text,
  p_iso             integer,
  p_aperture        numeric,
  p_shutter         text,
  p_focal_length    numeric,
  p_keywords        text[],
  p_exif            jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
begin
  if p_tenant is null then
    raise exception 'A photograph needs its site.' using errcode = '23502';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant)
     or (p_tenant = public.current_tenant_id() or public.is_platform_admin()) is not true then
    raise exception 'That is not your site.' using errcode = '42501';
  end if;

  v_prefix := 't/' || p_tenant::text || '/journal/';
  if left(p_key_base, length(v_prefix)) is distinct from v_prefix
     or substr(p_key_base, length(v_prefix) + 1)
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'That upload does not belong to this site''s journal.' using errcode = '42501';
  end if;
  if p_original_path is null then
    raise exception 'A journal photograph keeps its original.' using errcode = '23502';
  end if;
  -- A signed upload came through /api/upload-url, which accepts exactly five
  -- image types; the server identified the bytes. Anything else — NULL (not
  -- recognised) or HEIF (recognised, but not an upload type) — fails here.
  -- Only a custom cover may be HEIF or unrecognised. Never used to authorise
  -- anything.
  if p_content_type is null or p_content_type not in
       ('image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif') then
    raise exception 'A journal photograph must be one of the five upload image types.' using errcode = '22023';
  end if;

  return public.upsert_photo_asset(
    p_tenant, p_key_base, p_original_path, p_display_path, p_derivatives,
    p_width, p_height, p_original_bytes, p_content_sha256, p_content_type, null,
    p_taken_at, p_camera_make, p_camera_model, p_lens, p_iso, p_aperture,
    p_shutter, p_focal_length, p_keywords, p_exif, null, null,
    auth.uid());
end $$;


-- ── D. A custom gallery cover ───────────────────────────────────────────────
--
-- No original path: uploadCustomCover has never kept an original, only the
-- sizes, and P2 does not start. The album's cover changes in the same
-- transaction, exactly as uploadCustomCover changed it before. The
-- gallery_cover usage is P3's to project.

create or replace function public.register_album_cover(
  p_tenant          uuid,
  p_album           uuid,
  p_key_base        text,
  p_display_path    text,
  p_derivatives     jsonb,
  p_width           integer,
  p_height          integer,
  p_original_bytes  bigint,
  p_content_sha256  text,
  p_content_type    text,
  p_filename        text,
  p_taken_at        timestamptz,
  p_camera_make     text,
  p_camera_model    text,
  p_lens            text,
  p_iso             integer,
  p_aperture        numeric,
  p_shutter         text,
  p_focal_length    numeric,
  p_keywords        text[],
  p_exif            jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix  text;
  v_asset   uuid;
  v_updated integer;
begin
  if p_tenant is null or p_album is null then
    raise exception 'A cover needs its site and its gallery.' using errcode = '23502';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant)
     or (p_tenant = public.current_tenant_id() or public.is_platform_admin()) is not true then
    raise exception 'That is not your site.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.albums al where al.id = p_album and al.tenant_id = p_tenant) then
    raise exception 'There is no such gallery on this site.' using errcode = '42501';
  end if;

  v_prefix := 't/' || p_tenant::text || '/covers/' || p_album::text || '/';
  if left(p_key_base, length(v_prefix)) is distinct from v_prefix
     or substr(p_key_base, length(v_prefix) + 1)
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'That upload does not belong to this gallery''s cover.' using errcode = '42501';
  end if;

  v_asset := public.upsert_photo_asset(
    p_tenant, p_key_base, null, p_display_path, p_derivatives,
    p_width, p_height, p_original_bytes, p_content_sha256, p_content_type, p_filename,
    p_taken_at, p_camera_make, p_camera_model, p_lens, p_iso, p_aperture,
    p_shutter, p_focal_length, p_keywords, p_exif, null, null,
    auth.uid());

  -- The cover path is the CANONICAL ASSET's display path, not this call's: a
  -- same-SHA retry cannot point the album anywhere the asset does not.
  update public.albums al
     set cover_custom_path = pa.display_path,
         cover_photo_id    = null
    from public.photo_assets pa
   where al.id = p_album and al.tenant_id = p_tenant
     and pa.id = v_asset and pa.tenant_id = p_tenant;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'The gallery''s cover could not be set.' using errcode = '42501';
  end if;

  return v_asset;
end $$;


-- ── Who may call what ───────────────────────────────────────────────────────

revoke all on function public.upsert_photo_asset(
  uuid, text, text, text, jsonb, integer, integer, bigint, text, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb,
  double precision, double precision, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.register_gallery_photo(
  uuid, uuid, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb,
  double precision, double precision)
  from public, anon, authenticated, service_role;

revoke all on function public.register_site_image(
  uuid, text, text, text, jsonb, integer, integer, bigint, text, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.register_journal_image(
  uuid, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.register_album_cover(
  uuid, uuid, text, text, jsonb, integer, integer, bigint, text, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  from public, anon, authenticated, service_role;

-- The four upload routes run as the signed-in photographer, so the four
-- wrappers are theirs. Nobody gets the helper.
grant execute on function public.register_gallery_photo(
  uuid, uuid, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb,
  double precision, double precision)
  to authenticated;

grant execute on function public.register_site_image(
  uuid, text, text, text, jsonb, integer, integer, bigint, text, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  to authenticated;

grant execute on function public.register_journal_image(
  uuid, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  to authenticated;

grant execute on function public.register_album_cover(
  uuid, uuid, text, text, jsonb, integer, integer, bigint, text, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  to authenticated;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Revert the application first (it calls these), then:
--
--   begin;
--   drop function if exists public.register_gallery_photo(uuid, uuid, text, text, text, jsonb, integer, integer, bigint, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb, double precision, double precision);
--   drop function if exists public.register_site_image(uuid, text, text, text, jsonb, integer, integer, bigint, text, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb);
--   drop function if exists public.register_journal_image(uuid, text, text, text, jsonb, integer, integer, bigint, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb);
--   drop function if exists public.register_album_cover(uuid, uuid, text, text, jsonb, integer, integer, bigint, text, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb);
--   drop function if exists public.upsert_photo_asset(uuid, text, text, text, jsonb, integer, integer, bigint, text, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb, double precision, double precision, uuid);
--   commit;
--
-- Assets written meanwhile stay, harmless: nothing reads them yet, and the P4
-- backfill is idempotent over them.
