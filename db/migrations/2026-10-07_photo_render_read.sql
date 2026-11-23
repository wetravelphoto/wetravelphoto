-- ════════════════════════════════════════════════════════════════════════════
-- 2026-10-07 — P5: the canonical photograph read for rendering, and section
-- alt text in the projection
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ CANDIDATE — NOT DEPLOYED. Rehearsed only on disposable loopback scratch  │
-- │ databases built from db/test-fixture.sql. It needs its own Work review   │
-- │ (production_migration) AND Gonzalo's explicit approval before it is      │
-- │ applied anywhere. db/schema-2026-09.sql, db/test-fixture.sql,            │
-- │ db/schema-verified.md and the drift guard are deliberately NOT updated:  │
-- │ that bookkeeping follows a deployment, never precedes it.                │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Gate P5-20261006-public-asset-read-01 (approved by Work and Gonzalo):
-- .ai-handoff/REVIEW.md, p5-architecture-review.md, p5-orientation-reviewed.md.
-- Applied AFTER P4 unit 2 (2026-10-05_photo_assets_fk.sql). This file adds:
--
--   1. read_photo_render_assets(site, references) — SERVICE ROLE ONLY. The one
--      way a public render learns what a photograph IS: its safe display file,
--      its validated sizes, dimensions only when they can be trusted, and its
--      canonical alt text. For ONE site and an explicit, finite list of at
--      most 200 references. It is not a library browser: there is no "list"
--      form, no search, and nothing about any asset no reference named.
--   2. sync_photo_usages REPLACED, narrowly: a page_section usage now mirrors
--      the section's own alt text (`<field>_alt`, `<base>_alt_mobile` for a
--      phone twin) from the SAME saved settings its path was verified in. The
--      lines are marked `P5 ▼ … P5 ▲`; with them removed the function is the
--      deployed P3 function character for character (.mk/render-read.ts
--      asserts it).
--
-- No table, column, index, policy or table grant changes. photo_assets and
-- photo_usages keep P1's privileges exactly: authenticated SELECT only; anon,
-- service_role and PUBLIC nothing. The rendering service still cannot read
-- either table — it can only ask this function about named references.
--
-- ── Who decides what may be shown ───────────────────────────────────────────
--
-- The APPLICATION decides which source a visitor may see (a published page,
-- a gallery past its access gate, a published story …) and resolves the site
-- from the request's Host. Only then does it collect that source's references
-- and ask. This function constrains what it CAN answer — one site, the named
-- references, rendering facts only — and is not itself proof that a visitor
-- may see anything. photo_usages is not consulted, and is not authorisation.
--
-- ── One reference, one answer ───────────────────────────────────────────────
--
-- A reference is {"asset_id"}, {"path"}, or both. Answers, in input order:
--
--   ok           the asset, below
--   missing      no asset of THIS site has that id, or that path. Another
--                site's asset is "missing" too: nothing says it exists.
--   mismatch     both given, the id is this site's, and the path is not one of
--                that asset's display files. There is NO fallback to either
--                half: a stale or forged pair never selects a different asset.
--   ambiguous    a path alone that two assets claim. Never a guess.
--   invalid      not a uuid, or not a RENDERABLE file of a key any upload
--                route minted (the P4 grammar): a size `<base>/<n>.webp` or
--                the flat era's `<base>.jpg`. A key base (a folder), an
--                original, a URL, a sample: invalid. Nothing is looked up.
--   unavailable  the asset exists but may not be rendered from: reason
--                deleted | archived | pending | failed | malformed (its own
--                key, display file or sizes are not in a shape any writer
--                produces, or its key belongs to another site — below).
--
-- A path binds only to an asset's DISPLAY file or one of its sizes — never its
-- original (P3's projection resolver also accepts the original; a render never
-- needs to, and this keeps the original's address out of every answer).
--
-- ── Whose key it is ─────────────────────────────────────────────────────────
--
-- A prefixed key (`t/<site>/…`) names its site, and must name this one. An
-- unprefixed gallery or cover key (`photos|covers/<album>/<upload>`) names an
-- album instead: if that album EXISTS and belongs to another site, the key is
-- that site's storage and the asset is `malformed` — whatever row claims it,
-- this site never renders another site's file. An album that no longer exists
-- refuses nothing: an asset outlives the gallery it was uploaded to (P4 gave
-- identity to files whose album was since deleted), and only the album's own
-- row could say whose it was. One primary-key read per asset, nothing more.
-- An unprefixed journal key names no album; its ownership is the canonical
-- row P4 registered after an operator-reviewed provenance check, and is not
-- re-inferred here.
--
-- ── What leaves ─────────────────────────────────────────────────────────────
--
-- Per asset: id, display_path, derivatives (only `400|800|1600|2400` keys whose
-- value is exactly `<key_base>/<size>.webp`; anything else in the stored JSON
-- is dropped, never echoed), width and height ONLY when trusted (below), and
-- alt_text (below). Never: the original's path, filename, size or hash,
-- content type, key base, capture metadata, GPS, EXIF, keywords, lifecycle
-- timestamps, creator, or any other row.
--
-- ── Dimensions ──────────────────────────────────────────────────────────────
--
-- A size's NAME is its long edge, not its width, so a renderer can only write
-- honest `w` descriptors from the photograph's real upright size. Which rows
-- record one:
--
--   P2  register_* insert `derived_at = now()`, with width/height from
--       `sharp().rotate().metadata()` — which describes the STORED, un-rotated
--       image, so for EXIF orientations 5–8 the two are swapped. Trusted only
--       when the recorded orientation is ABSENT or a JSON number equal to 1, 2,
--       3 or 4 (none of which swaps the axes). 6.0 is 6; "6" (a string), null,
--       or any other value is not proof of anything and is untrusted. The
--       value is compared as a number only after jsonb_typeof says it is one,
--       so no text is ever cast.
--   P4  register_legacy_photo_asset inserts `derived_at = NULL`. Its width and
--       height are EITHER the legacy row's own recorded values, copied
--       unchecked (lib/photos/backfill.ts, "A row keeps the dimensions it
--       has"), OR — only when no row named the upload — the original's
--       measured upright size. An original's presence proves the FILE was
--       read, not which of the two the row holds, and nothing on the asset
--       records which. So no P4 dimension is trusted.
--
-- Trusted means: derived_at set, both values in 1..65535 (the largest edge
-- any of these formats can hold), and the orientation rule above. Otherwise
-- both are NULL and the renderer must not emit `w` descriptors. Nothing here
-- repairs a row; re-measuring legacy photographs is a separate decision.
--
-- ── Alt text ────────────────────────────────────────────────────────────────
--
-- The canonical description, verbatim, when it is non-blank and at most 1000
-- characters; otherwise NULL (the renderer then treats it as missing). Blank
-- means made only of these characters — the ONE blank rule P5 uses for
-- placement and canonical descriptions alike, mirrored by ALT_BLANK_CHARS in
-- lib/photos/image.ts (.mk/render-read.ts asserts the two are identical):
--
--   \t \n \v \f \r, space, U+0085, U+00A0, U+1680, U+180E, U+2000–U+200D,
--   U+2028, U+2029, U+202F, U+205F, U+2060, U+3000, U+FEFF
--
-- i.e. every Unicode space separator and line break plus the invisible
-- zero-width marks, so a description of a lone no-break space is not one.
-- P3's Story mirror keeps its own deployed `[^[:space:]]` rule, unchanged.
--
-- ── How big an answer can be ────────────────────────────────────────────────
--
-- Every path that leaves is a file of a grammar key (≤ 130 characters), so
-- one asset is at most ~7 KB even with a 1000-character description fully
-- \u-escaped; 200 assets and 200 results stay well under 2 MiB, which
-- lib/photos/image.ts refuses to exceed (RENDER_MAX_REPLY_BYTES).
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ══ 1. The rendering read — service role only ═══════════════════════════════

create or replace function public.read_photo_render_assets(p_tenant uuid, p_refs jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_max_refs  constant integer := 200;
  c_max_bytes constant integer := 262144;
  c_max_path  constant integer := 1024;
  c_max_alt   constant integer := 1000;
  c_max_side  constant integer := 65535;
  c_sizes     constant text[]  := array['400', '800', '1600', '2400'];
  c_uuid      constant text    := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  -- Non-blank: at least one character outside the shared blank set (header).
  c_text      constant text    := '[^\t\n\v\f\r \u0085\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]';
  v_ref       jsonb;
  v_n         bigint;
  v_id        text;
  v_path      text;
  v_kb        text;
  v_found     uuid[];
  v_asset     uuid;
  v_a         record;
  v_d         record;
  v_outcome   text;
  v_reason    text;
  v_derivs    jsonb;
  v_album     text;
  v_upright   boolean;
  v_trusted   boolean;
  v_results   jsonb := '[]'::jsonb;
  v_assets    jsonb := '{}'::jsonb;
begin
  -- ── 1. Who ────────────────────────────────────────────────────────────────
  -- EXECUTE is granted to service_role only (below), AND the effective role is
  -- checked here, so a grant added by mistake later still opens nothing — the
  -- P3 pattern (`current_setting('role')` reports the caller's role inside a
  -- definer function; a bare owner connection reports 'none').
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the rendering service reads photograph metadata.' using errcode = '42501';
  end if;
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'photo render: there is no such site.' using errcode = '22023';
  end if;

  -- ── 2. The request, bounded and typed before anything is looked up ────────
  if p_refs is null or jsonb_typeof(p_refs) <> 'array' then
    raise exception 'photo render: the references must be an array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_refs) > c_max_refs then
    raise exception 'photo render: at most % references a call.', c_max_refs using errcode = '22023';
  end if;
  if octet_length(p_refs::text) > c_max_bytes then
    raise exception 'photo render: the references are larger than % bytes.', c_max_bytes using errcode = '22023';
  end if;
  for v_ref in select e from jsonb_array_elements(p_refs) e loop
    if jsonb_typeof(v_ref) <> 'object' then
      raise exception 'photo render: a reference must be an object.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_object_keys(v_ref) k where k not in ('asset_id', 'path'))
       or not (v_ref ? 'asset_id' or v_ref ? 'path')
       or (v_ref ? 'asset_id' and jsonb_typeof(v_ref -> 'asset_id') <> 'string')
       or (v_ref ? 'path' and jsonb_typeof(v_ref -> 'path') <> 'string') then
      raise exception 'photo render: a reference is {"asset_id"}, {"path"} or both, as strings.' using errcode = '22023';
    end if;
  end loop;

  -- ── 3. Each reference, in order ───────────────────────────────────────────
  for v_ref, v_n in select x.e, x.n from jsonb_array_elements(p_refs) with ordinality x(e, n) order by x.n loop
    v_id      := v_ref ->> 'asset_id';
    v_path    := v_ref ->> 'path';
    v_asset   := null;
    v_outcome := null;
    v_reason  := null;
    v_kb      := case when v_path is not null and length(v_path) between 1 and c_max_path
                      then public.photo_backfill_key_base(v_path) end;

    if v_id is not null and v_id !~* c_uuid then
      v_outcome := 'invalid';
    elsif v_path is not null
          and (v_kb is null
               or v_path not in (v_kb || '/400.webp', v_kb || '/800.webp', v_kb || '/1600.webp',
                                 v_kb || '/2400.webp', v_kb || '.jpg')) then
      -- Not a RENDERABLE file of any key an upload route ever minted: a bare
      -- key base is a folder and an original is never served. A URL, a
      -- traversal, a sample, furniture, a video. (`<base>.jpg` is only ever
      -- the grammar's answer for the three unprefixed flat-era routes.)
      v_outcome := 'invalid';
    elsif v_id is not null then
      -- By id: this site's asset or nothing. The path, when given, must be one
      -- of THAT asset's display files; it is never used to find another.
      select a.id into v_asset
        from public.photo_assets a
       where a.id = v_id::uuid and a.tenant_id = p_tenant;
      if v_asset is null then
        v_outcome := 'missing';
      elsif v_path is not null and not exists (
              select 1 from public.photo_assets a
               where a.id = v_asset and a.tenant_id = p_tenant
                 and (a.display_path = v_path
                      or exists (select 1 from jsonb_each(case when jsonb_typeof(a.derivatives) = 'object'
                                                               then a.derivatives else '{}'::jsonb end) d
                                  where jsonb_typeof(d.value) = 'string' and (d.value #>> '{}') = v_path))) then
        v_outcome := 'mismatch';
        v_asset := null;
      end if;
    else
      -- By path alone: the projection's own two identity rules (P3's folder
      -- rule and P4's flat rule), on this site only, minus the original. Two
      -- candidates is ambiguous, never a guess.
      select array_agg(distinct a.id) into v_found
        from public.photo_assets a
       where a.tenant_id = p_tenant
         and (a.key_base = left(v_path, length(v_path) - strpos(reverse(v_path), '/'))
              or (right(v_path, 4) = '.jpg' and a.key_base = left(v_path, length(v_path) - 4)))
         and (a.display_path = v_path
              or exists (select 1 from jsonb_each(case when jsonb_typeof(a.derivatives) = 'object'
                                                       then a.derivatives else '{}'::jsonb end) d
                          where jsonb_typeof(d.value) = 'string' and (d.value #>> '{}') = v_path));
      if coalesce(cardinality(v_found), 0) = 0 then
        v_outcome := 'missing';
      elsif cardinality(v_found) > 1 then
        v_outcome := 'ambiguous';
      else
        v_asset := v_found[1];
      end if;
    end if;

    if v_asset is not null then
      -- Only the columns a decision below needs; nothing else of the row —
      -- not even whether it has an original — is selected.
      select a.id, a.key_base, a.display_path, a.derivatives, a.width, a.height,
             jsonb_typeof(a.exif) as exif_type, a.exif -> 'orientation' as orientation,
             a.alt_text, a.state, a.derived_at is not null as ingested,
             a.archived_at, a.deleted_at
        into v_a
        from public.photo_assets a
       where a.id = v_asset and a.tenant_id = p_tenant;

      if v_a.deleted_at is not null then
        v_outcome := 'unavailable'; v_reason := 'deleted';
      elsif v_a.archived_at is not null then
        v_outcome := 'unavailable'; v_reason := 'archived';
      elsif v_a.state is distinct from 'derived' then
        v_outcome := 'unavailable';
        v_reason := case when v_a.state in ('pending', 'failed') then v_a.state else 'malformed' end;
      else
        -- The sizes: only the four rungs, each exactly where its key says.
        v_derivs := '{}'::jsonb;
        for v_d in select d.key, d.value
                     from jsonb_each(case when jsonb_typeof(v_a.derivatives) = 'object'
                                          then v_a.derivatives else '{}'::jsonb end) d loop
          if v_d.key = any (c_sizes) and jsonb_typeof(v_d.value) = 'string'
             and (v_d.value #>> '{}') = v_a.key_base || '/' || v_d.key || '.webp' then
            v_derivs := v_derivs || jsonb_build_object(v_d.key, v_d.value);
          end if;
        end loop;

        -- The album an unprefixed gallery or cover key names. Only read once
        -- the key is known to be in the grammar, so the uuid cast is safe.
        v_album := case when public.photo_backfill_key_base(v_a.key_base) = v_a.key_base
                             and v_a.key_base ~ '^(photos|covers)/'
                        then split_part(v_a.key_base, '/', 2) end;

        if public.photo_backfill_key_base(v_a.key_base) is distinct from v_a.key_base
           -- A prefixed key names its site; it must be this one.
           or (left(v_a.key_base, 2) = 't/' and split_part(v_a.key_base, '/', 2) <> p_tenant::text)
           -- An unprefixed key whose album is another site's (header).
           or (v_album is not null
               and exists (select 1 from public.albums al
                            where al.id = v_album::uuid and al.tenant_id <> p_tenant))
           -- The display file: one of the validated sizes, or the flat era's
           -- single JPEG (the grammar admits that only for unprefixed keys).
           or not ((v_a.display_path = v_a.key_base || '.jpg'
                    and public.photo_backfill_key_base(v_a.display_path) = v_a.key_base)
                   or exists (select 1 from jsonb_each_text(v_derivs) d where d.value = v_a.display_path))
           -- The path that found it must itself survive the allowlist.
           or (v_path is not null and v_path <> v_a.display_path
               and not exists (select 1 from jsonb_each_text(v_derivs) d where d.value = v_path)) then
          v_outcome := 'unavailable'; v_reason := 'malformed';
        else
          v_outcome := 'ok';
          -- Dimensions (header): P2 ingestion only, both sides in range, and
          -- an orientation that is absent or a NUMBER equal to 1–4. CASE fixes
          -- the order, so the numeric comparison only ever sees a JSON number.
          v_upright := case
            when v_a.exif_type is distinct from 'object' then false
            when v_a.orientation is null then true
            when jsonb_typeof(v_a.orientation) <> 'number' then false
            else (v_a.orientation)::numeric in (1, 2, 3, 4)
          end;
          v_trusted := v_a.ingested
                       and coalesce(v_a.width between 1 and c_max_side and v_a.height between 1 and c_max_side, false)
                       and v_upright;
          if not (v_assets ? v_a.id::text) then
            v_assets := v_assets || jsonb_build_object(v_a.id::text, jsonb_build_object(
              'id',           v_a.id,
              'display_path', v_a.display_path,
              'derivatives',  v_derivs,
              'width',        case when v_trusted then v_a.width end,
              'height',       case when v_trusted then v_a.height end,
              'alt_text',     case when char_length(v_a.alt_text) > c_max_alt then null
                                   when v_a.alt_text ~ c_text then v_a.alt_text end));
          end if;
        end if;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(
      case when v_outcome = 'ok' then jsonb_build_object('outcome', 'ok', 'asset_id', v_a.id)
           when v_outcome = 'unavailable' then jsonb_build_object('outcome', 'unavailable', 'reason', v_reason)
           else jsonb_build_object('outcome', v_outcome) end);
  end loop;

  return jsonb_build_object('v', 1, 'results', v_results, 'assets', v_assets);
end $$;


-- ══ 2. The projection, with section alt text ════════════════════════════════
--
-- sync_photo_usages as deployed by 2026-09-30_photo_usages_sync.sql (Supabase
-- 20261001010021), with two marked additions and nothing else: two variables,
-- and in the page_section branch — after the slot is verified against the
-- saved source — the section's own alt text. Signature, SECURITY DEFINER,
-- search_path, the role check, the parent lock, the snapshot comparison, the
-- reference allowlist (no `alt` key is accepted from a caller), the ceilings,
-- samples, stories and every relational source are unchanged.

create or replace function public.sync_photo_usages(
  p_tenant           uuid,
  p_parent           text,
  p_key              text,
  p_source_snapshot  text,
  p_refs             jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_list_cap  constant integer := 50;
  v_key       text;
  v_scope     text := case when p_parent = 'draft' then 'draft' else 'live' end;
  v_current   jsonb;
  v_text      text;
  v_uuid      uuid;
  v_n         integer;
  v_leaves    integer;
  v_ref       jsonb;
  v_kind      text;
  v_field     text;
  v_pos       integer;
  v_page      text;
  v_path      text;
  v_dec       boolean;
  v_alt       text;
  -- P5 ▼ the section's own alt sibling, and the shared blank rule (the reader's)
  c_alt_text  constant text := '[^\t\n\v\f\r \u0085\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]';
  v_alt_key   text;
  v_alt_src   jsonb;
  -- P5 ▲
  v_slot      jsonb;
  v_block     jsonb;
  v_img       jsonb;
  v_asset     uuid;
  v_written   integer := 0;
  v_missed    integer := 0;
  v_list      jsonb := '[]'::jsonb;
  v_skip      text[] := '{}';
  v_samples   uuid[] := '{}';
  v_photo     uuid;
  v_album     record;
  v_constraint text;
  r           record;
begin
  -- ── 1. Who, and what ──────────────────────────────────────────────────────
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the projection service writes photo usages.' using errcode = '42501';
  end if;
  v_key := public.photo_usage_parent_key(p_tenant, p_parent, p_key);
  if p_source_snapshot is null then
    raise exception 'photo usages: a sync needs the source it was extracted from.' using errcode = '22023';
  end if;
  if p_refs is null or jsonb_typeof(p_refs) <> 'array' then
    raise exception 'photo usages: the references must be an array.' using errcode = '22023';
  end if;
  if p_parent in ('album', 'post', 'catalog_item') then
    v_uuid := v_key::uuid;
  end if;

  -- ── 2. One at a time, per parent ──────────────────────────────────────────
  perform public.photo_usage_lock(p_tenant, p_parent, v_key);

  -- ── 3. Fresh, or nothing ──────────────────────────────────────────────────
  v_current := public.photo_usage_source(p_tenant, p_parent, v_key);
  v_text := v_current::text;
  if v_text is distinct from p_source_snapshot then
    return jsonb_build_object('stale', true, 'written', 0,
                              'unresolved', '[]'::jsonb, 'unresolved_count', 0);
  end if;

  -- ── 4. Resource ceilings, relative to the saved source ────────────────────
  -- Every legitimate reference is one distinct STRING value of the source (the
  -- slot it names), so there are never more references than string values.
  -- And each serialises as at most 320 bytes of structure plus its path —
  -- itself a string of the source — so the whole array is never longer than
  -- 320 bytes a reference plus the source's own text. Neither can refuse a
  -- document the editor could save; both refuse a payload no document made.
  v_n := jsonb_array_length(p_refs);
  if v_n > 0 then
    select count(*) into v_leaves
      from jsonb_path_query(v_current, 'strict $.**') x(v)
     where jsonb_typeof(x.v) = 'string';
    if v_n > v_leaves then
      raise exception 'photo usages: % references for a source holding % values.', v_n, v_leaves
        using errcode = '22023';
    end if;
    if octet_length(p_refs::text) > 320 * v_n + octet_length(v_text) + 2 then
      raise exception 'photo usages: the references are larger than their source could produce.'
        using errcode = '22023';
    end if;
  end if;

  -- ── 5. Out with the parent's rows ─────────────────────────────────────────
  -- For a parent with a ROW, that row (and, for an album, its photographs) is
  -- locked FOR KEY SHARE first, so a concurrent delete of it waits for this
  -- transaction instead of deadlocking against the rows deleted here.
  case p_parent
    when 'live_page' then
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.scope = 'live' and u.page_key = v_key
         and u.kind in ('page_section', 'page_legacy', 'page_share');
    when 'draft' then
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.scope = 'draft'
         and u.kind in ('page_section', 'page_legacy', 'page_share');
    when 'album' then
      perform 1 from public.albums al
        where al.id = v_uuid and al.tenant_id = p_tenant for key share;
      perform 1 from public.photos ph
        where ph.tenant_id = p_tenant
          and (ph.album_id = v_uuid
               or ph.id = (select al.cover_photo_id from public.albums al
                            where al.id = v_uuid and al.tenant_id = p_tenant))
        order by ph.id for key share;
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.kind = 'gallery'
         and u.photo_id in (select ph.id from public.photos ph
                             where ph.tenant_id = p_tenant and ph.album_id = v_uuid);
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.kind = 'gallery_cover' and u.album_id = v_uuid;
    when 'post' then
      perform 1 from public.blog_posts b
        where b.id = v_uuid and b.tenant_id = p_tenant for key share;
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.post_id = v_uuid
         and u.kind in ('story_cover', 'story_block');
    when 'catalog_item' then
      perform 1 from public.catalog_items ci
        where ci.photo_id = v_uuid and ci.tenant_id = p_tenant for key share;
      delete from public.photo_usages u
       where u.tenant_id = p_tenant and u.kind = 'shop_listing'
         and u.product_id in (select ci.id from public.catalog_items ci
                               where ci.tenant_id = p_tenant and ci.photo_id = v_uuid);
  end case;

  -- ── 6. The document references, each bound to the saved source ───────────
  for v_ref in select e from jsonb_array_elements(p_refs) e loop
    if jsonb_typeof(v_ref) <> 'object' then
      raise exception 'photo usages: a reference must be an object.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_object_keys(v_ref) k
                where k not in ('kind', 'page_key', 'position', 'field', 'path', 'decorative', 'photo_id')) then
      raise exception 'photo usages: a reference carries a key it may not.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_ref -> 'kind') is distinct from 'string'
       or jsonb_typeof(v_ref -> 'field') is distinct from 'string'
       or jsonb_typeof(v_ref -> 'path') is distinct from 'string'
       or jsonb_typeof(v_ref -> 'position') is distinct from 'number'
       or (v_ref ? 'decorative' and jsonb_typeof(v_ref -> 'decorative') <> 'boolean') then
      raise exception 'photo usages: a reference needs a kind, field, path and position.' using errcode = '22023';
    end if;
    if (v_ref ->> 'position') !~ '^(0|[1-9][0-9]{0,8})$' then
      raise exception 'photo usages: a position is a whole number from 0.' using errcode = '22023';
    end if;

    v_kind  := v_ref ->> 'kind';
    v_field := v_ref ->> 'field';
    v_pos   := (v_ref ->> 'position')::integer;
    v_path  := v_ref ->> 'path';
    v_dec   := coalesce((v_ref ->> 'decorative')::boolean, false);
    v_page  := null;
    v_alt   := null;
    if v_ref ? 'photo_id' and not (v_kind = 'sample' and p_parent in ('album', 'catalog_item')) then
      raise exception 'photo usages: only an album or catalogue sample names a photograph.' using errcode = '22023';
    end if;

    if v_kind = 'page_section' and p_parent in ('live_page', 'draft') then
      if v_field !~ '^[a-z][a-z0-9_]{0,63}$' then
        raise exception 'photo usages: "%" is not a setting.', v_field using errcode = '22023';
      end if;
      if jsonb_typeof(v_ref -> 'page_key') is distinct from 'string' then
        raise exception 'photo usages: a section reference names its page.' using errcode = '22023';
      end if;
      v_page := v_ref ->> 'page_key';
      if p_parent = 'live_page' then
        if v_page <> v_key then
          raise exception 'photo usages: a reference to another page.' using errcode = '22023';
        end if;
        -- Zero rows → sections is [] → no slot, so a live page on its legacy
        -- columns can never take a page_section as well.
        v_slot := v_current -> 'sections' -> v_pos -> 'settings' -> v_field;
      else
        if v_page !~ '^[a-z][a-z0-9_]{0,31}$' then
          raise exception 'photo usages: "%" is not a page key.', v_page using errcode = '22023';
        end if;
        v_slot := v_current -> 'pages' -> v_page -> v_pos -> 'settings' -> v_field;
      end if;
      if v_slot is null or jsonb_typeof(v_slot) <> 'string' or (v_slot #>> '{}') <> v_path then
        raise exception 'photo usages: the reference does not match the saved source.' using errcode = '22023';
      end if;
      -- P5 ▼ The section's own alt text, read from the SAME saved settings the
      -- slot was just verified in — never from the caller, whose references
      -- may not carry it. Its key is the image key's sibling under the
      -- editor's naming, deviceKey(base + '_alt', device): image_path →
      -- image_path_alt, and the phone twin image_path_mobile →
      -- image_path_alt_mobile (never image_path_mobile_alt). A phone
      -- photograph reads only its own phone alt, so it never borrows a
      -- description written for a different desktop photograph. Not a
      -- string, or blank under P5's one blank rule (c_alt_text: every Unicode
      -- space and line break plus the zero-width marks — a lone no-break
      -- space is blank), is NULL; anything else verbatim. Stories keep their
      -- own deployed rule below, unchanged.
      v_alt_key := case when v_field ~ '_mobile$'
                        then left(v_field, length(v_field) - 7) || '_alt_mobile'
                        else v_field || '_alt' end;
      v_alt_src := case when p_parent = 'live_page'
                        then v_current -> 'sections' -> v_pos -> 'settings' -> v_alt_key
                        else v_current -> 'pages' -> v_page -> v_pos -> 'settings' -> v_alt_key end;
      if jsonb_typeof(v_alt_src) = 'string' and (v_alt_src #>> '{}') ~ c_alt_text then
        v_alt := v_alt_src #>> '{}';
      end if;
      -- P5 ▲

    elsif v_kind = 'story_block' and p_parent = 'post' then
      if v_field !~ '^block:(0|[1-9][0-9]{0,8})$' then
        raise exception 'photo usages: "%" is not a block slot.', v_field using errcode = '22023';
      end if;
      if v_dec then
        raise exception 'photo usages: a story photograph is not decorative.' using errcode = '22023';
      end if;
      v_block := v_current -> 'blocks' -> (substr(v_field, 7)::integer);
      v_img := case
        when jsonb_typeof(v_block) <> 'object' then null
        when v_block ->> 'type' = 'image' and v_pos = 0 then v_block -> 'image'
        when v_block ->> 'type' = 'image_pair' and v_pos = 0 then v_block -> 'left'
        when v_block ->> 'type' = 'image_pair' and v_pos = 1 then v_block -> 'right'
        when v_block ->> 'type' in ('gallery', 'masonry') then v_block -> 'images' -> v_pos
      end;
      if v_img is null or jsonb_typeof(v_img) <> 'object'
         or jsonb_typeof(v_img -> 'path') is distinct from 'string'
         or (v_img ->> 'path') <> v_path then
        raise exception 'photo usages: the reference does not match the saved story.' using errcode = '22023';
      end if;
      -- The block's own alt, mirrored as it is: blank or whitespace is NULL,
      -- anything else verbatim. Read from the source, never from the caller.
      if jsonb_typeof(v_img -> 'alt') = 'string' and (v_img ->> 'alt') ~ '[^[:space:]]' then
        v_alt := v_img ->> 'alt';
      end if;

    elsif v_kind = 'sample' and p_parent in ('live_page', 'draft') then
      if v_pos <> 0 or v_dec then
        raise exception 'photo usages: a sample slot is position 0 and not decorative.' using errcode = '22023';
      end if;
      if jsonb_typeof(v_ref -> 'page_key') is distinct from 'string' then
        raise exception 'photo usages: a sample names its page.' using errcode = '22023';
      end if;
      v_page := v_ref ->> 'page_key';
      if p_parent = 'live_page' then
        if v_page <> v_key then
          raise exception 'photo usages: a reference to another page.' using errcode = '22023';
        end if;
        v_slot := case
          when v_field = 'page_seo.image' then v_current -> 'share'
          when v_field in ('hero_image_path', 'intro_image_path', 'contact_image_path', 'about_image_path')
            then v_current -> 'legacy' -> v_field
        end;
      else
        v_slot := case when v_field = 'page_seo.image'
                       then v_current -> 'page_seo' -> v_page -> 'image' end;
      end if;
      if v_slot is null or jsonb_typeof(v_slot) <> 'string' or (v_slot #>> '{}') <> v_path then
        raise exception 'photo usages: the reference does not match the saved source.' using errcode = '22023';
      end if;
      v_skip := v_skip || (v_page || '|' || v_field);
      continue;

    elsif v_kind = 'sample' and p_parent = 'post' then
      -- The story's featured image, as the snapshot holds it.
      if v_field <> 'featured_custom_path' or v_pos <> 0 or v_dec or v_ref ? 'page_key' then
        raise exception 'photo usages: a story sample is its featured image, position 0.' using errcode = '22023';
      end if;
      v_slot := v_current -> 'featured';
      if v_slot is null or jsonb_typeof(v_slot) <> 'string' or (v_slot #>> '{}') <> v_path then
        raise exception 'photo usages: the reference does not match the saved story.' using errcode = '22023';
      end if;
      v_skip := v_skip || 'story_cover|featured_custom_path'::text;
      continue;

    elsif v_kind = 'sample' and p_parent in ('album', 'catalog_item') then
      -- A photographs row, proved against the CANONICAL row: this site, this
      -- album (or, for a catalogue entry, the entry's own photograph), and
      -- exactly this stored path.
      if v_field <> 'photo' or v_pos <> 0 or v_dec or v_ref ? 'page_key' then
        raise exception 'photo usages: a photograph sample is field "photo", position 0.' using errcode = '22023';
      end if;
      if jsonb_typeof(v_ref -> 'photo_id') is distinct from 'string'
         or (v_ref ->> 'photo_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'photo usages: a photograph sample names its photograph.' using errcode = '22023';
      end if;
      v_photo := (v_ref ->> 'photo_id')::uuid;
      if not exists (
           select 1 from public.photos ph
            where ph.id = v_photo
              and ph.tenant_id = p_tenant
              and ph.storage_path = v_path
              and case when p_parent = 'album' then ph.album_id = v_uuid else ph.id = v_uuid end) then
        raise exception 'photo usages: the sample does not match a photograph of this %.',
          case when p_parent = 'album' then 'album' else 'catalogue entry' end
          using errcode = '22023';
      end if;
      v_samples := v_samples || v_photo;
      continue;

    else
      raise exception 'photo usages: a % reference is not accepted for a %.', v_kind, p_parent
        using errcode = '22023';
    end if;

    v_asset := case when length(v_path) between 1 and 1024
                    then public.photo_usage_resolve_path(p_tenant, v_path) end;
    if v_asset is null then
      v_missed := v_missed + 1;
      if v_missed <= c_list_cap then
        v_list := v_list || jsonb_build_object('kind', v_kind, 'page_key', v_page, 'field', v_field,
          'position', v_pos, 'path', left(v_path, 200),
          'reason', case when length(v_path) between 1 and 1024 then 'no_asset' else 'bad_shape' end);
      end if;
      continue;
    end if;

    begin
      insert into public.photo_usages
        (tenant_id, asset_id, scope, kind, post_id, page_key, field, position, alt_override, decorative)
      values
        (p_tenant, v_asset, v_scope, v_kind,
         case when v_kind = 'story_block' then v_uuid end,
         v_page, v_field, v_pos, v_alt, v_dec);
      v_written := v_written + 1;
    exception when check_violation then
      -- Only a page key the CHECK does not know is caught: count it, and let
      -- the rest of the page project. Any other CHECK is a defect — raise it.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'photo_usages_page_key_shape' then
        raise;
      end if;
      v_missed := v_missed + 1;
      if v_missed <= c_list_cap then
        v_list := v_list || jsonb_build_object('kind', v_kind, 'page_key', v_page, 'field', v_field,
          'position', v_pos, 'path', left(v_path, 200), 'reason', 'bad_page_key');
      end if;
    end;
  end loop;

  -- ── 7. The relational sources, read here under the lock ───────────────────
  -- The legacy columns and share images are projected from the SNAPSHOT just
  -- compared — the same values the extractor saw — skipping any slot it
  -- declared a built-in sample.
  if p_parent = 'live_page' then
    -- Legacy columns: only while the page has no section rows. `legacy` is {}
    -- for every page but home and about.
    if jsonb_array_length(v_current -> 'sections') = 0 then
      for r in
        select e.key as field, e.value #>> '{}' as path
          from jsonb_each(v_current -> 'legacy') e
         where jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') <> ''
           and not ((v_key || '|' || e.key) = any (v_skip))
         order by e.key
      loop
        v_asset := public.photo_usage_resolve_path(p_tenant, r.path);
        if v_asset is null then
          v_missed := v_missed + 1;
          if v_missed <= c_list_cap then
            v_list := v_list || jsonb_build_object('kind', 'page_legacy', 'page_key', v_key,
              'field', r.field, 'position', 0, 'path', left(r.path, 200), 'reason', 'no_asset');
          end if;
        else
          insert into public.photo_usages (tenant_id, asset_id, scope, kind, page_key, field)
          values (p_tenant, v_asset, 'live', 'page_legacy', v_key, r.field);
          v_written := v_written + 1;
        end if;
      end loop;
    end if;

    -- The explicitly stored share image, and only that.
    if jsonb_typeof(v_current -> 'share') = 'string'
       and (v_current ->> 'share') <> ''
       and not ((v_key || '|page_seo.image') = any (v_skip)) then
      v_path := v_current ->> 'share';
      v_asset := public.photo_usage_resolve_path(p_tenant, v_path);
      if v_asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'page_share', 'page_key', v_key,
            'field', 'page_seo.image', 'position', 0, 'path', left(v_path, 200), 'reason', 'no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, scope, kind, page_key, field)
        values (p_tenant, v_asset, 'live', 'page_share', v_key, 'page_seo.image');
        v_written := v_written + 1;
      end if;
    end if;

  elsif p_parent = 'draft' then
    -- The draft's explicitly stored share images. NULL page_seo means the
    -- draft has not touched search and sharing: nothing to project.
    for r in
      select e.key as page, e.value ->> 'image' as path
        from jsonb_each(case when jsonb_typeof(v_current -> 'page_seo') = 'object'
                             then v_current -> 'page_seo' else '{}'::jsonb end) e
       where jsonb_typeof(e.value -> 'image') = 'string' and (e.value ->> 'image') <> ''
         and not ((e.key || '|page_seo.image') = any (v_skip))
       order by e.key
    loop
      v_asset := public.photo_usage_resolve_path(p_tenant, r.path);
      if v_asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'page_share', 'page_key', r.page,
            'field', 'page_seo.image', 'position', 0, 'path', left(r.path, 200), 'reason', 'no_asset');
        end if;
        continue;
      end if;
      begin
        insert into public.photo_usages (tenant_id, asset_id, scope, kind, page_key, field)
        values (p_tenant, v_asset, 'draft', 'page_share', r.page, 'page_seo.image');
        v_written := v_written + 1;
      exception when check_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'photo_usages_page_key_shape' then
          raise;
        end if;
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'page_share', 'page_key', r.page,
            'field', 'page_seo.image', 'position', 0, 'path', left(r.path, 200), 'reason', 'bad_page_key');
        end if;
      end;
    end loop;

  elsif p_parent = 'album' then
    -- Gallery membership: every photograph of the album that has an asset of
    -- this site. The same logical row register_gallery_photo writes on upload.
    -- A photograph PROVED to be a built-in sample (above) is skipped silently.
    for r in
      select ph.id as photo, a.id as asset
        from public.photos ph
        left join public.photo_assets a on a.id = ph.asset_id and a.tenant_id = p_tenant
       where ph.tenant_id = p_tenant and ph.album_id = v_uuid
         and not (ph.id = any (v_samples))
       order by ph.id
    loop
      if r.asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'gallery', 'field', 'photo', 'position', 0,
            'photo_id', r.photo, 'reason', 'photo_has_no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, kind, photo_id, field)
        values (p_tenant, r.asset, 'gallery', r.photo, 'photo');
        v_written := v_written + 1;
      end if;
    end loop;

    select al.cover_photo_id, al.cover_custom_path into v_album
      from public.albums al where al.id = v_uuid and al.tenant_id = p_tenant;

    -- The chosen cover. The implicit one (the first photograph when none is
    -- chosen) is NOT a usage, and a chosen cover that is a proved sample is
    -- skipped silently.
    if v_album.cover_photo_id is not null and not (v_album.cover_photo_id = any (v_samples)) then
      select a.id into v_asset
        from public.photos ph
        join public.photo_assets a on a.id = ph.asset_id and a.tenant_id = p_tenant
       where ph.id = v_album.cover_photo_id and ph.tenant_id = p_tenant;
      if v_asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'gallery_cover', 'field', 'cover_photo_id',
            'position', 0, 'photo_id', v_album.cover_photo_id, 'reason', 'photo_has_no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, kind, album_id, field)
        values (p_tenant, v_asset, 'gallery_cover', v_uuid, 'cover_photo_id');
        v_written := v_written + 1;
      end if;
    end if;

    if v_album.cover_custom_path is not null and v_album.cover_custom_path <> '' then
      v_asset := public.photo_usage_resolve_path(p_tenant, v_album.cover_custom_path);
      if v_asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'gallery_cover', 'field', 'cover_custom_path',
            'position', 0, 'path', left(v_album.cover_custom_path, 200), 'reason', 'no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, kind, album_id, field)
        values (p_tenant, v_asset, 'gallery_cover', v_uuid, 'cover_custom_path');
        v_written := v_written + 1;
      end if;
    end if;

  elsif p_parent = 'post' then
    -- The featured image, from the snapshot just compared; skipped silently
    -- when it was proved a sample.
    v_path := v_current ->> 'featured';
    if jsonb_typeof(v_current -> 'featured') = 'string' and v_path <> ''
       and not ('story_cover|featured_custom_path' = any (v_skip)) then
      v_asset := public.photo_usage_resolve_path(p_tenant, v_path);
      if v_asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'story_cover', 'field', 'featured_custom_path',
            'position', 0, 'path', left(v_path, 200), 'reason', 'no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, kind, post_id, field)
        values (p_tenant, v_asset, 'story_cover', v_uuid, 'featured_custom_path');
        v_written := v_written + 1;
      end if;
    end if;

  elsif p_parent = 'catalog_item' then
    for r in
      select ci.id as item, a.id as asset
        from public.catalog_items ci
        join public.photos ph on ph.id = ci.photo_id and ph.tenant_id = p_tenant
        left join public.photo_assets a on a.id = ph.asset_id and a.tenant_id = p_tenant
       where ci.photo_id = v_uuid and ci.tenant_id = p_tenant
         and not (ci.photo_id = any (v_samples))
    loop
      if r.asset is null then
        v_missed := v_missed + 1;
        if v_missed <= c_list_cap then
          v_list := v_list || jsonb_build_object('kind', 'shop_listing', 'field', 'photo', 'position', 0,
            'photo_id', v_uuid, 'reason', 'photo_has_no_asset');
        end if;
      else
        insert into public.photo_usages (tenant_id, asset_id, kind, product_id, field)
        values (p_tenant, r.asset, 'shop_listing', r.item, 'photo');
        v_written := v_written + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('stale', false, 'written', v_written,
                            'unresolved', v_list, 'unresolved_count', v_missed);
end $$;


-- ══ 3. Who may call what ════════════════════════════════════════════════════
--
-- A grant is additive: stated whole. sync_photo_usages keeps P3's exactly.

revoke all on function public.read_photo_render_assets(uuid, jsonb)            from public, anon, authenticated, service_role;
revoke all on function public.sync_photo_usages(uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;

grant execute on function public.read_photo_render_assets(uuid, jsonb)            to service_role;
grant execute on function public.sync_photo_usages(uuid, text, text, text, jsonb) to service_role;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Revert the application first (it calls the reader), then:
--
--   begin;
--   drop function if exists public.read_photo_render_assets(uuid, jsonb);
--   -- and sync_photo_usages exactly as deployed: re-run its definition from
--   -- db/migrations/2026-09-30_photo_usages_sync.sql (create or replace)
--   commit;
--
-- Applying this file writes no row. Section alt text reaches photo_usages
-- only as each page or draft is next synced; a rebuild would mirror existing
-- `_alt` settings at once, and is a separate, separately approved step. After
-- a rollback, alt_override values already mirrored stay until their parent's
-- next sync clears them — a projection, which nothing reads for authority.
