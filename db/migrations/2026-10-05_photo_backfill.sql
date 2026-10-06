-- ════════════════════════════════════════════════════════════════════════════
-- 2026-10-05 — P4, unit 1 of 2: the legacy photograph backfill's database half
--
-- claude/photo-migration-plan.md, P4 (as approved 2026-10-05), and
-- claude/photo-assets-design.md §10. Applied AFTER P3 (2026-09-30_*), whose
-- functions this file calls. Unit 2, 2026-10-05_photo_assets_fk.sql, comes
-- only after the backfill has run and its completeness has been proved.
--
-- P2 gave every NEW upload its asset. P3 projects every placement. What is
-- left is the photographs uploaded before P2: rows in `photos` and
-- `site_images` with no asset_id, and paths in saved documents (covers, story
-- images, page sections, legacy columns, share images) that resolve to no
-- asset. The CLI in lib/photos/backfill.ts finds them, verifies the files with
-- HEAD/GET only, and calls the ONE writer below for each. It never writes a
-- usage: P3's sync_photo_usages stays the only writer of photo_usages, and a
-- rebuild (scripts/rebuild-photo-usages.ts) runs separately, afterwards.
--
-- This file adds:
--
--   1. photo_backfill_key_base(path)       INTERNAL. The closed route grammar
--      — the SQL twin of keyBaseFor() in lib/photos/legacy-key.ts, held to it
--      by .mk/backfill.ts. NULL for anything it does not recognise.
--   2. photo_backfill_foreign_claim(...)   INTERNAL. Whether another site
--      already claims an unprefixed key.
--   3. read_photo_backfill_inventory(site) SERVICE ROLE ONLY. Everything the
--      backfill needs to plan one site, in one read.
--   4. read_photo_backfill_claims(site, keys) SERVICE ROLE ONLY. The foreign
--      claim check, so a dry run can report what apply would refuse.
--   5. register_legacy_photo_asset(...)    SERVICE ROLE ONLY. The writer.
--   6. photo_usage_resolve_path            REPLACED, narrowly: a flat legacy
--      file `<base>.jpg` now resolves to the asset whose key base is exactly
--      `<base>` and which lists that file; the folder rule is unchanged; two
--      candidates resolve to NOTHING (never LIMIT 1).
--
-- No table, column, index, policy or table grant changes. Every function:
-- `search_path = ''`, every object qualified; EXECUTE revoked from public,
-- anon, authenticated and service_role first, then granted to service_role
-- for 3–5 and to nobody for 1, 2 and 6. 3–5 also refuse, at run time, any
-- effective role other than service_role — the P3 pattern — so a grant added
-- by mistake later still opens nothing.
--
-- ── The writer, in one paragraph ────────────────────────────────────────────
--
-- The database binds everything that matters: the TENANT (named, never
-- defaulted, and the key's own prefix must agree), the SOURCE it is called for
-- (a photos row, a site_images row, an album's custom cover, or ONE image slot
-- of a saved document — each located by id, or by parent and slot, under the
-- same album or parent lock P3's projection takes, and checked against the path
-- the caller says it holds, so an older snapshot is answered `stale` and
-- changes nothing), and the STORAGE FACTS (every path inside the key, in the shape that
-- era actually wrote, and the caller's facts equal to the source row's). It
-- creates the asset or finds the one already at that key — `on conflict do
-- nothing`, then compares, never overwrites — and only then fills a NULL
-- asset_id on the source row, in the same transaction. A row that already has
-- an asset (every P2 upload) is left exactly as it is.
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ══ 1. The key grammar ═══════════════════════════════════════════════════════
--
-- A KEY BASE is one upload. The shapes every era of this application minted:
--
--   photos/<album>/<upload>          gallery, before the site prefix
--   covers/<album>/<upload>          custom cover, before the site prefix
--   journal/<upload>                 journal image, before the site prefix
--   t/<site>/photos/<album>/<upload>, t/<site>/covers/<album>/<upload>,
--   t/<site>/journal/<upload>, t/<site>/site-images/<upload>   since the prefix
--
-- every id a lower-case uuid. A PATH belongs to a base when it is the base
-- itself, `<base>/original.<jpg|png|webp|tif|avif>`, `<base>/<400|800|1600|
-- 2400>.webp` (the folder eras), or — for the three unprefixed routes only —
-- `<base>.jpg`, the FLAT era, which stored one resized JPEG and nothing else.
-- Anything else is NULL: a URL, a traversal, an encoded or upper-case id, a
-- shape no route ever minted, a sample, furniture, a video.

create or replace function public.photo_backfill_key_base(p_path text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  with r as (
    select replace('(t/U/)?(photos|covers)/U/U|(t/U/)?journal/U|t/U/site-images/U', 'U', u) as base,
           replace('(photos|covers)/U/U|journal/U', 'U', u) as flat
      from (select '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'::text as u) x
  )
  select case
           when p_path ~ ('^(' || r.base || ')$') then p_path
           when p_path ~ ('^(' || r.base || ')/(original\.(jpg|png|webp|tif|avif)|(400|800|1600|2400)\.webp)$')
             then left(p_path, length(p_path) - strpos(reverse(p_path), '/'))
           when p_path ~ ('^(' || r.flat || ')\.jpg$')
             then left(p_path, length(p_path) - 4)
         end
    from r
$$;


-- ══ 2. Another site's claim on an unprefixed key ════════════════════════════
--
-- An unprefixed key says nothing about whose it is. For a gallery photograph
-- or a cover the album in the key decides (it belongs to exactly one site).
-- A journal key names no album, so for it EVERY place a site keeps a path is
-- searched on every OTHER site — rows, covers, stories (blocks, featured image
-- and the old rich-text content), sections, the draft, the legacy columns,
-- share images, and frozen history. Any mention is a claim, and a claim
-- refuses: a false positive costs a manual review, a false negative would file
-- one photographer's photograph under another's site. `p_documents = false`
-- checks only for another site's asset at the same key.

create or replace function public.photo_backfill_foreign_claim(p_tenant uuid, p_key_base text, p_documents boolean)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.photo_assets a
                  where a.key_base = p_key_base and a.tenant_id <> p_tenant)
      or (p_documents and (
            exists (select 1 from public.photos ph where ph.tenant_id <> p_tenant
                     and strpos(concat_ws(' ', ph.storage_path, ph.original_path, ph.derivatives::text), p_key_base) > 0)
         or exists (select 1 from public.site_images si where si.tenant_id <> p_tenant
                     and strpos(concat_ws(' ', si.storage_path, si.original_path, si.derivatives::text), p_key_base) > 0)
         or exists (select 1 from public.albums al where al.tenant_id <> p_tenant
                     and strpos(coalesce(al.cover_custom_path, ''), p_key_base) > 0)
         or exists (select 1 from public.blog_posts b where b.tenant_id <> p_tenant
                     and strpos(concat_ws(' ', b.featured_custom_path, b.blocks::text, b.content::text), p_key_base) > 0)
         or exists (select 1 from public.page_sections s where s.tenant_id <> p_tenant
                     and strpos(s.settings::text, p_key_base) > 0)
         or exists (select 1 from public.site_draft d where d.tenant_id <> p_tenant
                     and strpos(concat_ws(' ', d.pages::text, d.page_seo::text), p_key_base) > 0)
         or exists (select 1 from public.site_settings st where st.tenant_id <> p_tenant
                     and strpos(concat_ws(' ', st.hero_image_path, st.intro_image_path, st.contact_image_path,
                                          st.about_image_path, st.page_seo::text), p_key_base) > 0)
         or exists (select 1 from public.site_versions v where v.tenant_id <> p_tenant
                     and strpos(v.snapshot::text, p_key_base) > 0)
         or exists (select 1 from public.site_draft_steps ds where ds.tenant_id <> p_tenant
                     and strpos(ds.snapshot::text, p_key_base) > 0)))
$$;


-- ══ 3. The inventory — service role only ════════════════════════════════════
--
-- One site, everything the plan needs: its photographs and Uploads (every
-- row, used or not), its albums' custom covers, the assets it already has, and
-- the SAVED SOURCE of every live page, the draft and every story — exactly the
-- text P3's projection reads, so the CLI runs P3's own extractor over it
-- (hidden sections, mobile twins, backgrounds and video posters included; the
-- hero video excluded by key). Frozen history is not read.

create or replace function public.read_photo_backfill_inventory(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parents jsonb;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the backfill service reads the photograph inventory.' using errcode = '42501';
  end if;
  -- Refuses a missing site (22023), and lists every page, post and album
  -- exactly as the projection does.
  v_parents := public.list_photo_usage_parents(p_tenant);

  return jsonb_build_object(
    'tenant', p_tenant,
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ph.id, 'album_id', ph.album_id, 'storage_path', ph.storage_path,
               'original_path', ph.original_path, 'derivatives', ph.derivatives,
               'width', ph.width, 'height', ph.height, 'tags', to_jsonb(ph.tags),
               'asset_id', ph.asset_id) order by ph.id)
        from public.photos ph where ph.tenant_id = p_tenant), '[]'::jsonb),
    'site_images', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', si.id, 'storage_path', si.storage_path, 'original_path', si.original_path,
               'derivatives', si.derivatives, 'width', si.width, 'height', si.height,
               'filename', si.filename, 'asset_id', si.asset_id) order by si.id)
        from public.site_images si where si.tenant_id = p_tenant), '[]'::jsonb),
    'albums', coalesce((
      select jsonb_agg(jsonb_build_object('id', al.id, 'cover_custom_path', al.cover_custom_path) order by al.id)
        from public.albums al where al.tenant_id = p_tenant), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'key_base', a.key_base, 'original_path', a.original_path,
               'display_path', a.display_path, 'derivatives', a.derivatives,
               'width', a.width, 'height', a.height, 'original_bytes', a.original_bytes,
               'content_sha256', a.content_sha256, 'content_type', a.content_type,
               'archived', a.archived_at is not null, 'deleted', a.deleted_at is not null) order by a.key_base)
        from public.photo_assets a where a.tenant_id = p_tenant), '[]'::jsonb),
    'sources',
      coalesce((select jsonb_agg(jsonb_build_object('parent', 'live_page', 'key', k,
                                   'source', public.photo_usage_source(p_tenant, 'live_page', k)) order by k)
                  from jsonb_array_elements_text(v_parents -> 'pages') k), '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('parent', 'draft', 'key', null,
                             'source', public.photo_usage_source(p_tenant, 'draft', null)))
      || coalesce((select jsonb_agg(jsonb_build_object('parent', 'post', 'key', k,
                                      'source', public.photo_usage_source(p_tenant, 'post', k)) order by k)
                     from jsonb_array_elements_text(v_parents -> 'posts') k), '[]'::jsonb)
  );
end $$;

-- For each key base asked about: does another site claim it? Bounded, and
-- every key must be one the grammar recognises.
create or replace function public.read_photo_backfill_claims(p_tenant uuid, p_key_bases text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_out jsonb := '{}'::jsonb;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the backfill service reads key claims.' using errcode = '42501';
  end if;
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'photo backfill: there is no such site.' using errcode = '22023';
  end if;
  if p_key_bases is null or coalesce(array_length(p_key_bases, 1), 0) > 1000 then
    raise exception 'photo backfill: between 0 and 1000 keys at a time.' using errcode = '22023';
  end if;
  foreach v_key in array p_key_bases loop
    if v_key is null or public.photo_backfill_key_base(v_key) is distinct from v_key then
      raise exception 'photo backfill: "%" is not a key base.', v_key using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object(v_key, public.photo_backfill_foreign_claim(p_tenant, v_key, true));
  end loop;
  return v_out;
end $$;


-- ══ 4. The writer — service role only ═══════════════════════════════════════
--
-- p_source and its locator:
--
--   'photo'       p_source_id = photos.id        p_source_path = its storage_path
--   'site_image'  p_source_id = site_images.id   p_source_path = its storage_path
--   'album_cover' p_source_id = albums.id        p_source_path = its cover_custom_path
--   'document'    p_parent, p_parent_key (as P3 names a parent: live_page + page
--                 key, draft + NULL, post + id) and p_slot, the ONE image slot
--                 of that saved source the path is in:
--
--     live_page  sections/<n>/<setting>   a section's setting (P3's page_section)
--                legacy/<column>          hero/intro/contact/about_image_path —
--                                         only while the page has NO section rows,
--                                         exactly P3's fallback; otherwise refused
--                share                    the page's stored share image
--     draft      pages/<page>/<n>/<setting>, page_seo/<page>
--     post       featured                 the story's featured image
--                blocks/<i>/image | left | right | images/<j>
--                                         an image slot of a block of the type
--                                         that has it (image / image_pair /
--                                         gallery, masonry) — never a caption
--
--   Which SETTING of a section is a photograph is the registry's to say, in
--   TypeScript (lib/photos/extract.ts); this function does not keep a second
--   copy of it, exactly as sync_photo_usages does not. It binds the path to the
--   slot of the saved source, under the parent's projection lock.
--
-- Returns {status, asset_id, linked}:
--
--   created         a new asset; a row source had its NULL asset_id filled
--   reused          the asset already at this key, its facts identical; a row
--                   source was linked to it
--   already_linked  the row already has an asset — nothing was touched
--   stale           the source no longer holds what the caller read — nothing
--                   was touched; re-read and plan again
--   gone            the source row no longer exists — nothing was touched
--
-- and RAISES (nothing kept) for anything that is not a legacy file of this
-- site in a shape its era wrote, or that disagrees with the asset already at
-- its key: 42501 ownership, 22023 a bad or conflicting value, 23502 a missing
-- one, 55000 an archived or deleted asset.
--
-- What the caller may NOT say: state (always 'derived' — the backfill read and
-- decoded the display file before calling), derived_at (NULL: when the sizes
-- were made is not known), created_by (NULL: nobody uploaded anything now),
-- alt text, any lifecycle column. For a 'photo' source the capture date and the
-- place are taken from the ROW, under its lock, at the moment of the write (the
-- caller's p_taken_at must be NULL). Its KEYWORDS are the row's tags put
-- through the ONE keyword normaliser, normalizeKeywords() in lib/photos/exif.ts
-- (trim, lower-case, control characters out, each cut to 200, empties dropped,
-- the first 25) — computed by the caller, never restated here. What binds them
-- to the row is p_source_tags: the raw `photos.tags` the caller normalised. It
-- must equal the row's tags under the lock, or the answer is `stale` and
-- nothing is written; p_keywords is then held to the asset's bounds like any
-- other source's. The row's tags themselves are never rewritten. For every
-- other source p_source_tags must be NULL.
--
-- An absent ladder is `{}`. A row whose `derivatives` holds JSON null counts as
-- `{}` here and in the backfill alike, so a valid display-only row is never
-- "stale" for ever.

create or replace function public.register_legacy_photo_asset(
  p_tenant              uuid,
  p_source              text,
  p_source_id           uuid,
  p_parent              text,
  p_parent_key          text,
  p_slot                text,
  p_source_path         text,
  p_key_base            text,
  p_original_path       text,
  p_display_path        text,
  p_derivatives         jsonb,
  p_width               integer,
  p_height              integer,
  p_original_bytes      bigint,
  p_content_sha256      text,
  p_content_type        text,
  p_taken_at            timestamptz,
  p_camera_make         text,
  p_camera_model        text,
  p_lens                text,
  p_iso                 integer,
  p_aperture            numeric,
  p_shutter             text,
  p_focal_length        numeric,
  p_keywords            text[],
  p_source_tags         text[],
  p_exif                jsonb,
  p_provenance_reviewed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_sizes     constant text[] := array['400', '800', '1600', '2400'];
  v_exif      jsonb := coalesce(p_exif, '{}'::jsonb);
  v_prefixed  boolean;
  v_route     text;
  v_album     uuid;
  v_flat      boolean;
  v_key       text;
  v_value     jsonb;
  v_kw        text;
  v_row       record;
  v_row_album uuid;
  v_cover     text;
  v_pkey      text;
  v_src       jsonb;
  v_slot      jsonb;
  v_block     jsonb;
  v_img       jsonb;
  v_keywords  text[];
  v_taken     timestamptz;
  v_lat       double precision;
  v_lng       double precision;
  v_filename  text;
  v_asset     uuid;
  v_status    text;
  v_old       record;
  v_n         integer;
begin
  -- ── 1. Who ────────────────────────────────────────────────────────────────
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the backfill service registers legacy photographs.' using errcode = '42501';
  end if;
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'photo backfill: there is no such site.' using errcode = '22023';
  end if;

  -- ── 2. The key, and whose it is ───────────────────────────────────────────
  if p_key_base is null or public.photo_backfill_key_base(p_key_base) is distinct from p_key_base then
    raise exception 'photo backfill: "%" is not a key any upload route minted.', p_key_base using errcode = '22023';
  end if;
  if p_source_path is null or public.photo_backfill_key_base(p_source_path) is distinct from p_key_base then
    raise exception 'photo backfill: the source path is not a file of this key.' using errcode = '22023';
  end if;
  v_prefixed := left(p_key_base, 2) = 't/';
  if v_prefixed and split_part(p_key_base, '/', 2) <> p_tenant::text then
    raise exception 'photo backfill: that key is under another site''s prefix.' using errcode = '42501';
  end if;
  v_route := split_part(p_key_base, '/', case when v_prefixed then 3 else 1 end);
  if v_route in ('photos', 'covers') then
    v_album := split_part(p_key_base, '/', case when v_prefixed then 4 else 2 end)::uuid;
  end if;
  if not v_prefixed then
    -- One unprefixed key, one site: serialise the claim check and the insert
    -- across sites, not only within one.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photo_backfill_key:' || p_key_base, 0));
    if v_route in ('photos', 'covers')
       and not exists (select 1 from public.albums al where al.id = v_album and al.tenant_id = p_tenant) then
      raise exception 'photo backfill: the album in that key is not this site''s.' using errcode = '42501';
    end if;
    if v_route = 'journal' and p_provenance_reviewed is not true then
      raise exception 'photo backfill: an unprefixed journal key needs reviewed provenance for this site.'
        using errcode = '42501';
    end if;
    if public.photo_backfill_foreign_claim(p_tenant, p_key_base, v_route = 'journal') then
      raise exception 'photo backfill: another site claims that key.' using errcode = '42501';
    end if;
  end if;

  -- ── 3. The files: every path inside the key, in its era's shape ──────────
  if p_display_path is null or p_derivatives is null then
    raise exception 'photo backfill: a photograph needs its display path and its sizes ({} for none).'
      using errcode = '23502';
  end if;
  if jsonb_typeof(p_derivatives) <> 'object' then
    raise exception 'photo backfill: the sizes must be an object.' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(p_derivatives) loop
    if not (v_key = any (c_sizes)) then
      raise exception 'photo backfill: there is no display size called "%".', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(v_value) <> 'string' or (v_value #>> '{}') <> p_key_base || '/' || v_key || '.webp' then
      raise exception 'photo backfill: size % is not where this key says it is.', v_key using errcode = '22023';
    end if;
  end loop;

  -- The display file must itself be a file of this key by the grammar —
  -- checked on its own, not inferred from the source path: a prefixed key has
  -- no flat file, so `<prefixed base>.jpg` is refused here.
  if public.photo_backfill_key_base(p_display_path) is distinct from p_key_base then
    raise exception 'photo backfill: the display path is not a file of this key.' using errcode = '22023';
  end if;
  -- It is the flat era's single JPEG or one of the recorded sizes.
  v_flat := p_display_path = p_key_base || '.jpg';
  if not v_flat and not exists (select 1 from jsonb_each_text(p_derivatives) d where d.value = p_display_path) then
    raise exception 'photo backfill: the display path must be the flat file or one of the recorded sizes.'
      using errcode = '22023';
  end if;

  if p_original_path is not null then
    -- A flat-era file is a resized JPEG, and a `<base>/original.jpg` beside it
    -- was written by the old derivative job FROM that JPEG: neither is the
    -- photographer's original. A cover never kept one.
    if v_flat then
      raise exception 'photo backfill: a flat-era photograph has no known original.' using errcode = '22023';
    end if;
    if v_route = 'covers' then
      raise exception 'photo backfill: a cover keeps no original.' using errcode = '22023';
    end if;
    if not (left(p_original_path, length(p_key_base) + 10) = p_key_base || '/original.'
            and substr(p_original_path, length(p_key_base) + 11) in ('jpg', 'png', 'webp', 'tif', 'avif')) then
      raise exception 'photo backfill: the original is not where this key says it is.' using errcode = '22023';
    end if;
    if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'photo backfill: an original''s hash is 64 lower-case hex characters.' using errcode = '22023';
    end if;
    if p_original_bytes is null or p_original_bytes <= 0 then
      raise exception 'photo backfill: an original has more than zero bytes.' using errcode = '22023';
    end if;
    if p_content_type is not null and p_content_type not in
         ('image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif', 'image/heif') then
      raise exception 'photo backfill: unknown content type "%".', p_content_type using errcode = '22023';
    end if;
  elsif p_content_sha256 is not null or p_original_bytes is not null or p_content_type is not null then
    -- The hash, size and type are facts ABOUT the original. With no original
    -- there is nothing they could truthfully describe.
    raise exception 'photo backfill: original facts without an original.' using errcode = '22023';
  end if;

  if (p_width is null) <> (p_height is null) or p_width <= 0 or p_height <= 0 then
    raise exception 'photo backfill: dimensions are both known and positive, or both unknown.' using errcode = '22023';
  end if;

  -- NULL-safe: with no original, `p_source_path = p_original_path` is NULL,
  -- and `not (false or NULL or false)` is NULL — which an IF does not raise on.
  -- `is not true` refuses NULL as well as false.
  if (p_source_path = p_display_path
      or p_source_path = p_original_path
      or exists (select 1 from jsonb_each_text(p_derivatives) d where d.value = p_source_path)) is not true then
    raise exception 'photo backfill: the source path is not one of this photograph''s files.' using errcode = '22023';
  end if;

  -- ── 4. Capture: P2's normalised, bounded shape ───────────────────────────
  if length(p_camera_make)  > 64 or p_camera_make  ~ '[[:cntrl:]]'
  or length(p_camera_model) > 64 or p_camera_model ~ '[[:cntrl:]]'
  or length(p_lens)         > 96 or p_lens         ~ '[[:cntrl:]]' then
    raise exception 'photo backfill: camera and lens names are at most 64 / 64 / 96 plain characters.'
      using errcode = '22023';
  end if;
  if p_iso is not null and (p_iso < 1 or p_iso > 1000000) then
    raise exception 'photo backfill: ISO % is out of range.', p_iso using errcode = '22023';
  end if;
  if p_aperture is not null and (p_aperture < 0.5 or p_aperture > 99.9 or p_aperture <> round(p_aperture, 1)) then
    raise exception 'photo backfill: aperture % is out of range.', p_aperture using errcode = '22023';
  end if;
  if p_shutter is not null and p_shutter !~ '^(1/[1-9][0-9]{0,5}|[0-9]{1,4}(\.[0-9])?s)$' then
    raise exception 'photo backfill: shutter "%" is not in the normalised form.', p_shutter using errcode = '22023';
  end if;
  if p_focal_length is not null and (p_focal_length < 0.1 or p_focal_length > 9999.9
                                     or p_focal_length <> round(p_focal_length, 1)) then
    raise exception 'photo backfill: focal length % is out of range.', p_focal_length using errcode = '22023';
  end if;
  if p_keywords is not null then
    if coalesce(array_length(p_keywords, 1), 0) > 25 then
      raise exception 'photo backfill: at most 25 keywords.' using errcode = '22023';
    end if;
    foreach v_kw in array p_keywords loop
      if v_kw is null or v_kw = '' or length(v_kw) > 200 or v_kw ~ '[[:cntrl:]]' then
        raise exception 'photo backfill: a keyword is 1 to 200 plain characters.' using errcode = '22023';
      end if;
    end loop;
  end if;
  if jsonb_typeof(v_exif) <> 'object' then
    raise exception 'photo backfill: exif must be an object.' using errcode = '22023';
  end if;
  if octet_length(v_exif::text) > 1024 then
    raise exception 'photo backfill: exif is over 1024 bytes.' using errcode = '22023';
  end if;
  if v_exif <> '{}'::jsonb and (v_exif -> 'v') is distinct from '1'::jsonb then
    raise exception 'photo backfill: exif must say it is version 1.' using errcode = '22023';
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
      raise exception 'photo backfill: exif "%" is not an allowed key, or not an allowed value for it.', v_key
        using errcode = '22023';
    end if;
  end loop;

  -- ── 5. The source: located, locked, and still holding what was read ──────
  v_taken := p_taken_at;
  v_keywords := p_keywords;
  if p_source <> 'document' and p_slot is not null then
    raise exception 'photo backfill: only a document source names a slot.' using errcode = '22023';
  end if;
  if p_source <> 'photo' and p_source_tags is not null then
    raise exception 'photo backfill: only a photograph source carries its row''s tags.' using errcode = '22023';
  end if;
  case p_source
    when 'photo' then
      if p_source_id is null then
        raise exception 'photo backfill: a photograph source names its row.' using errcode = '23502';
      end if;
      if p_parent is not null or p_parent_key is not null or p_taken_at is not null then
        raise exception 'photo backfill: a photograph''s date, place and parent are its row''s.' using errcode = '22023';
      end if;
      if p_source_tags is null or p_keywords is null then
        raise exception 'photo backfill: a photograph source sends the row''s tags as read and their normalised keywords.'
          using errcode = '23502';
      end if;
      select ph.album_id into v_row_album from public.photos ph
       where ph.id = p_source_id and ph.tenant_id = p_tenant;
      if not found then
        return jsonb_build_object('status', 'gone', 'asset_id', null, 'linked', false);
      end if;
      -- The album's projection lock first — the order register_gallery_photo
      -- and sync_photo_usages already use — then the row.
      perform public.photo_usage_lock(p_tenant, 'album', v_row_album::text);
      select ph.* into v_row from public.photos ph
       where ph.id = p_source_id and ph.tenant_id = p_tenant
         for update;
      if not found then
        return jsonb_build_object('status', 'gone', 'asset_id', null, 'linked', false);
      end if;
      if v_row.asset_id is not null then
        return jsonb_build_object('status', 'already_linked', 'asset_id', v_row.asset_id, 'linked', false);
      end if;
      if v_row.album_id is distinct from v_row_album
         or v_row.storage_path is distinct from p_source_path
         or coalesce(nullif(v_row.derivatives, 'null'::jsonb), '{}'::jsonb) is distinct from p_derivatives
         or v_row.width is distinct from p_width or v_row.height is distinct from p_height
         or (v_row.original_path is not null and v_row.original_path is distinct from p_original_path)
         -- The keywords were normalised from THESE tags; another set is stale.
         or v_row.tags is distinct from p_source_tags then
        return jsonb_build_object('status', 'stale', 'asset_id', null, 'linked', false);
      end if;
      if p_display_path <> v_row.storage_path then
        raise exception 'photo backfill: a photograph''s display path is its storage_path, exactly.' using errcode = '22023';
      end if;
      v_taken := v_row.taken_at;
      if v_row.latitude between -90 and 90 and v_row.longitude between -180 and 180 then
        v_lat := v_row.latitude;
        v_lng := v_row.longitude;
      end if;

    when 'site_image' then
      if p_source_id is null then
        raise exception 'photo backfill: an Uploads source names its row.' using errcode = '23502';
      end if;
      if p_parent is not null or p_parent_key is not null then
        raise exception 'photo backfill: an Uploads row has no parent.' using errcode = '22023';
      end if;
      select si.* into v_row from public.site_images si
       where si.id = p_source_id and si.tenant_id = p_tenant
         for update;
      if not found then
        return jsonb_build_object('status', 'gone', 'asset_id', null, 'linked', false);
      end if;
      if v_row.asset_id is not null then
        return jsonb_build_object('status', 'already_linked', 'asset_id', v_row.asset_id, 'linked', false);
      end if;
      if v_row.storage_path is distinct from p_source_path
         or coalesce(nullif(v_row.derivatives, 'null'::jsonb), '{}'::jsonb) is distinct from p_derivatives
         or v_row.width is distinct from p_width or v_row.height is distinct from p_height
         or (v_row.original_path is not null and v_row.original_path is distinct from p_original_path) then
        return jsonb_build_object('status', 'stale', 'asset_id', null, 'linked', false);
      end if;
      if p_display_path <> v_row.storage_path then
        raise exception 'photo backfill: an Uploads row''s display path is its storage_path, exactly.' using errcode = '22023';
      end if;
      if v_row.filename is not null and length(v_row.filename) between 1 and 120 and v_row.filename !~ '[[:cntrl:]]' then
        v_filename := v_row.filename;
      end if;

    when 'album_cover' then
      if p_source_id is null then
        raise exception 'photo backfill: a cover source names its album.' using errcode = '23502';
      end if;
      if p_parent is not null or p_parent_key is not null then
        raise exception 'photo backfill: a cover has no other parent.' using errcode = '22023';
      end if;
      if not exists (select 1 from public.albums al where al.id = p_source_id and al.tenant_id = p_tenant) then
        return jsonb_build_object('status', 'gone', 'asset_id', null, 'linked', false);
      end if;
      perform public.photo_usage_lock(p_tenant, 'album', p_source_id::text);
      select al.cover_custom_path into v_cover from public.albums al
       where al.id = p_source_id and al.tenant_id = p_tenant
         for share;
      if not found then
        return jsonb_build_object('status', 'gone', 'asset_id', null, 'linked', false);
      end if;
      if v_cover is distinct from p_source_path then
        return jsonb_build_object('status', 'stale', 'asset_id', null, 'linked', false);
      end if;

    when 'document' then
      if p_source_id is not null or p_parent is null or p_parent not in ('live_page', 'draft', 'post')
         or p_slot is null then
        raise exception 'photo backfill: a document source is a live page, the draft or a story, and one slot of it.'
          using errcode = '22023';
      end if;
      v_pkey := public.photo_usage_parent_key(p_tenant, p_parent, p_parent_key);
      -- The parent's PROJECTION lock — the one sync_photo_usages takes — so
      -- this binding and a projection of the same parent never interleave.
      perform public.photo_usage_lock(p_tenant, p_parent, v_pkey);
      v_src := public.photo_usage_source(p_tenant, p_parent, v_pkey);

      if p_parent = 'live_page' then
        if p_slot ~ '^sections/(0|[1-9][0-9]{0,8})/[a-z][a-z0-9_]{0,63}$' then
          v_slot := v_src -> 'sections' -> split_part(p_slot, '/', 2)::integer -> 'settings' -> split_part(p_slot, '/', 3);
        elsif p_slot in ('legacy/hero_image_path', 'legacy/intro_image_path',
                         'legacy/contact_image_path', 'legacy/about_image_path') then
          -- P3's fallback, exactly: with section rows the legacy columns are
          -- mirrors, and a mirror is not a placement.
          if jsonb_array_length(v_src -> 'sections') = 0 then
            v_slot := v_src -> 'legacy' -> split_part(p_slot, '/', 2);
          end if;
        elsif p_slot = 'share' then
          v_slot := v_src -> 'share';
        else
          raise exception 'photo backfill: "%" is not an image slot of a live page.', p_slot using errcode = '22023';
        end if;
      elsif p_parent = 'draft' then
        if p_slot ~ '^pages/[a-z][a-z0-9_]{0,31}/(0|[1-9][0-9]{0,8})/[a-z][a-z0-9_]{0,63}$' then
          v_slot := v_src -> 'pages' -> split_part(p_slot, '/', 2) -> split_part(p_slot, '/', 3)::integer
                          -> 'settings' -> split_part(p_slot, '/', 4);
        elsif p_slot ~ '^page_seo/[a-z][a-z0-9_]{0,31}$' then
          v_slot := v_src -> 'page_seo' -> split_part(p_slot, '/', 2) -> 'image';
        else
          raise exception 'photo backfill: "%" is not an image slot of the draft.', p_slot using errcode = '22023';
        end if;
      else
        if p_slot = 'featured' then
          v_slot := v_src -> 'featured';
        elsif p_slot ~ '^blocks/(0|[1-9][0-9]{0,8})/(image|left|right|images/(0|[1-9][0-9]{0,8}))$' then
          v_block := v_src -> 'blocks' -> split_part(p_slot, '/', 2)::integer;
          v_img := case
            when jsonb_typeof(v_block) <> 'object' then null
            when split_part(p_slot, '/', 3) = 'image' and v_block ->> 'type' = 'image' then v_block -> 'image'
            when split_part(p_slot, '/', 3) in ('left', 'right') and v_block ->> 'type' = 'image_pair'
              then v_block -> split_part(p_slot, '/', 3)
            when split_part(p_slot, '/', 3) = 'images' and v_block ->> 'type' in ('gallery', 'masonry')
              then v_block -> 'images' -> split_part(p_slot, '/', 4)::integer
          end;
          v_slot := case when jsonb_typeof(v_img) = 'object' then v_img -> 'path' end;
        else
          raise exception 'photo backfill: "%" is not an image slot of a story.', p_slot using errcode = '22023';
        end if;
      end if;
      if v_slot is null or jsonb_typeof(v_slot) <> 'string' or (v_slot #>> '{}') <> p_source_path then
        return jsonb_build_object('status', 'stale', 'asset_id', null, 'linked', false);
      end if;

    else
      raise exception 'photo backfill: there is no source called "%".', p_source using errcode = '22023';
  end case;

  -- ── 6. The asset: created, or the one already there — never rewritten ────
  insert into public.photo_assets (
    tenant_id, key_base, original_path, display_path, derivatives,
    original_bytes, content_type, filename, content_sha256, width, height,
    taken_at, latitude, longitude, camera_make, camera_model, lens, iso,
    aperture, shutter, focal_length, keywords, exif,
    state, derived_at, created_by
  ) values (
    p_tenant, p_key_base, p_original_path, p_display_path, p_derivatives,
    p_original_bytes, p_content_type, v_filename, p_content_sha256, p_width, p_height,
    v_taken, v_lat, v_lng, p_camera_make, p_camera_model, p_lens, p_iso,
    p_aperture, p_shutter, p_focal_length, coalesce(v_keywords, '{}'::text[]), v_exif,
    'derived', null, null
  )
  on conflict (tenant_id, key_base) do nothing
  returning id into v_asset;

  if v_asset is not null then
    v_status := 'created';
  else
    select a.id, a.original_path, a.display_path, a.derivatives, a.width, a.height,
           a.original_bytes, a.content_sha256, a.content_type, a.archived_at, a.deleted_at
      into v_old
      from public.photo_assets a
     where a.tenant_id = p_tenant and a.key_base = p_key_base
       for update;
    if v_old.display_path is distinct from p_display_path
       or v_old.original_path is distinct from p_original_path
       or v_old.derivatives is distinct from p_derivatives
       or v_old.width is distinct from p_width or v_old.height is distinct from p_height
       or v_old.original_bytes is distinct from p_original_bytes
       or v_old.content_sha256 is distinct from p_content_sha256
       or v_old.content_type is distinct from p_content_type then
      raise exception 'photo backfill: the asset already at this key records different files.' using errcode = '22023';
    end if;
    if v_old.archived_at is not null or v_old.deleted_at is not null then
      raise exception 'photo backfill: the asset at this key has been archived or deleted.' using errcode = '55000';
    end if;
    v_asset := v_old.id;
    v_status := 'reused';
  end if;

  -- ── 7. The link: a NULL asset_id filled, in this same transaction ────────
  if p_source = 'photo' then
    update public.photos ph set asset_id = v_asset
     where ph.id = p_source_id and ph.tenant_id = p_tenant and ph.asset_id is null;
    get diagnostics v_n = row_count;
  elsif p_source = 'site_image' then
    update public.site_images si set asset_id = v_asset
     where si.id = p_source_id and si.tenant_id = p_tenant and si.asset_id is null;
    get diagnostics v_n = row_count;
  end if;
  if p_source in ('photo', 'site_image') and v_n <> 1 then
    -- Impossible while the row lock is held; refuse rather than half-write.
    raise exception 'photo backfill: the source row could not be linked.' using errcode = '55000';
  end if;

  return jsonb_build_object('status', v_status, 'asset_id', v_asset,
                            'linked', p_source in ('photo', 'site_image'));
end $$;


-- ══ 5. The resolver, extended for the flat era — narrowly ═══════════════════
--
-- P3's rule, unchanged: a path resolves to an asset of THIS SITE whose key
-- base is the path's own directory and which lists the path as its original,
-- display file or one of its sizes. Added: a path ending `.jpg` also
-- resolves to an asset of this site whose key base is EXACTLY the path
-- without those four characters and which lists the path the same way — the
-- flat era's `photos/<album>/<upload>.jpg` and its asset `photos/<album>/
-- <upload>`. No alias table, no document rewrite, no prefix guessing. If the
-- two rules found two different assets the path resolves to NOTHING: an
-- ambiguous reference is unresolved, never a guess.

create or replace function public.photo_usage_resolve_path(p_tenant uuid, p_path text)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  with m as (
    select a.id
      from public.photo_assets a
     where a.tenant_id = p_tenant
       and strpos(p_path, '/') > 0
       and a.key_base = left(p_path, length(p_path) - strpos(reverse(p_path), '/'))
       and (p_path = a.original_path
            or p_path = a.display_path
            or exists (select 1 from jsonb_each_text(a.derivatives) d where d.value = p_path))
    union
    select a.id
      from public.photo_assets a
     where a.tenant_id = p_tenant
       and length(p_path) > 4
       and right(p_path, 4) = '.jpg'
       and a.key_base = left(p_path, length(p_path) - 4)
       and (p_path = a.original_path
            or p_path = a.display_path
            or exists (select 1 from jsonb_each_text(a.derivatives) d where d.value = p_path))
  )
  select case when count(*) = 1 then (array_agg(m.id))[1] end from m
$$;


-- ══ 6. Who may call what ════════════════════════════════════════════════════

revoke all on function public.photo_backfill_key_base(text)                       from public, anon, authenticated, service_role;
revoke all on function public.photo_backfill_foreign_claim(uuid, text, boolean)   from public, anon, authenticated, service_role;
revoke all on function public.read_photo_backfill_inventory(uuid)                 from public, anon, authenticated, service_role;
revoke all on function public.read_photo_backfill_claims(uuid, text[])            from public, anon, authenticated, service_role;
revoke all on function public.register_legacy_photo_asset(
  uuid, text, uuid, text, text, text, text, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], text[], jsonb, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.photo_usage_resolve_path(uuid, text)                from public, anon, authenticated, service_role;

grant execute on function public.read_photo_backfill_inventory(uuid)      to service_role;
grant execute on function public.read_photo_backfill_claims(uuid, text[]) to service_role;
grant execute on function public.register_legacy_photo_asset(
  uuid, text, uuid, text, text, text, text, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], text[], jsonb, boolean)
  to service_role;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Do NOT revert the application. No web runtime calls these functions — only
-- the operator CLI (scripts/backfill-photo-assets.ts) does — and the
-- application deployment that retired the old derivative writer (the
-- `photo.derivatives` handler that wrote ladder files and photos columns, and
-- its admin control) stays deployed: re-enabling that writer is not a
-- rollback step. Instead: stop any backfill CLI run, and do not start one.
-- Assets the backfill created STAY, and so do the asset_ids it filled — they are not
-- inert: P3's projection (sync_photo_usages, rebuildUsages) already resolves
-- through them, so photo_usages rows may point at them (photo_usages.asset_id
-- is ON DELETE RESTRICT), and gallery usages read photos.asset_id. Removing
-- them would change P3's projection, and is not part of this rollback. Then:
--
--   begin;
--   -- P3's resolver, exactly: re-run its definition from
--   -- db/migrations/2026-09-30_photo_usages_sync.sql (create or replace), then
--   drop function if exists public.register_legacy_photo_asset(uuid, text, uuid, text, text, text, text, text, text, text, jsonb, integer, integer, bigint, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], text[], jsonb, boolean);
--   drop function if exists public.read_photo_backfill_claims(uuid, text[]);
--   drop function if exists public.read_photo_backfill_inventory(uuid);
--   drop function if exists public.photo_backfill_foreign_claim(uuid, text, boolean);
--   drop function if exists public.photo_backfill_key_base(text);
--   commit;
--
-- Reverting the resolver un-resolves flat-era paths; a P3 rebuild then drops
-- their usages. Deleting the backfilled assets is NOT part of this rollback:
-- once unit 2's foreign keys exist it would be refused, and before that it
-- would be a data change to decide on its own.
