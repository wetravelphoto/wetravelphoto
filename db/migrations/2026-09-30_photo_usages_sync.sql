-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-30 — P3: the photo-usage projection gets its one writer
--
-- claude/photo-migration-plan.md, P3, and its design reconciliation (rulings
-- 1–20 and final amendments 1–22, 2026-09-30). Applied AFTER
-- 2026-09-30_album_cover_tenant_fk.sql, which is its prerequisite.
--
-- photo_usages is a DERIVED INDEX: drop every row, re-run the projection over
-- every saved document, and it comes back identical. This file adds:
--
--   1. the eighth kind, `page_share` — a page's EXPLICITLY stored share image
--      (`page_seo.<page>.image`), live and draft;
--   2. `sync_photo_usages`, the one writer, and `read_photo_usage_source` /
--      `list_photo_usage_parents`, the reads it needs — all three EXECUTE to
--      `service_role` ONLY, and each refusing any other effective role at run
--      time as well. No table grant changes: authenticated keeps SELECT only
--      on photo_usages, service_role still holds nothing on it;
--   3. four internal helpers nobody may call directly;
--   4. `register_gallery_photo` and `register_album_cover` (P2), replaced ONLY
--      to take the same album lock the projection takes. Nothing else about
--      them changes — .mk/usages.ts compares their bodies to P2's.
--
-- ── How one parent is projected ─────────────────────────────────────────────
--
-- A PARENT is the unit that is replaced at once:
--
--   live_page     one page's live usages (page_section, page_legacy, page_share)
--   draft         every draft usage of the site (the draft is one document)
--   album         the gallery rows of its photographs and both cover slots
--   post          story_cover and every story_block
--   catalog_item  the shop_listing of one catalogue entry, KEYED BY ITS
--                 PHOTOGRAPH'S ID (catalog_items_photo_id_key is unique; it is
--                 the identity every catalogue writer already uses)
--
-- The application (lib/photos/usages.ts, service role):
--
--   1. read_photo_usage_source(site, parent, key) → the saved source, as the
--      CANONICAL TEXT of one jsonb value: only what the document-shaped
--      references are extracted from;
--   2. extracts the references from that text (lib/photos/extract.ts — the
--      registry decides which settings hold photographs);
--   3. sync_photo_usages(site, parent, key, that same text, the references).
--
-- sync_photo_usages then, in one transaction:
--
--   a. takes the parent's advisory transaction lock;
--   b. rebuilds the source from the database NOW and compares it to the text
--      it was given. Different → it changes NOTHING and returns stale = true;
--      the caller re-reads and tries again. An older snapshot can therefore
--      never overwrite a projection of a newer saved document;
--   c. deletes the parent's rows;
--   d. inserts one row per document reference that is BOUND to the source —
--      the value at exactly that slot of the saved document is exactly that
--      path — and resolves to an asset on the SAME site;
--   e. reads the RELATIONAL sources itself, under the lock, and inserts their
--      rows: gallery (photos.asset_id), the album's chosen and custom covers,
--      a story's featured image, a catalogue entry's photograph, the legacy
--      page columns and the explicit share images. None of those is accepted
--      from the caller;
--   f. returns what it wrote and what did not resolve. An unresolved reference
--      is SKIPPED and counted — P3 mints no asset, queues no job, writes no
--      placeholder. P4's backfill mints assets; a rebuild then projects them.
--
-- ── The legacy rule ─────────────────────────────────────────────────────────
-- A live page with page_sections rows projects page_section and NEVER its
-- legacy site_settings columns, which are then only mirrors. A live page with
-- zero rows (home or about) projects its legacy columns as page_legacy. Both
-- halves are decided here, from the same read, so they cannot both happen.
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ══ 1. page_share ═══════════════════════════════════════════════════════════
--
-- kind = page_share · scope live | draft · parent page_key ·
-- field 'page_seo.image' · position 0 — one per (site, scope, page).
-- Only an EXPLICITLY stored image. The automatic fallback lib/seo.ts computes
-- (the first photograph on the page, then the homepage's) is never a usage.

alter table public.photo_usages drop constraint if exists photo_usages_kind_known;
alter table public.photo_usages add constraint photo_usages_kind_known check (kind in (
    'gallery','gallery_cover','page_section','page_legacy','page_share',
    'story_cover','story_block','shop_listing'
  ));

alter table public.photo_usages drop constraint if exists photo_usages_scope_by_kind;
alter table public.photo_usages add constraint photo_usages_scope_by_kind check (
    scope = 'live' or kind in ('page_section','page_legacy','page_share')
  );

alter table public.photo_usages drop constraint if exists photo_usages_one_parent;
alter table public.photo_usages add constraint photo_usages_one_parent check (
     (kind = 'gallery'
        and photo_id is not null and album_id is null and post_id is null
        and product_id is null and page_key is null)
  or (kind = 'gallery_cover'
        and album_id is not null and photo_id is null and post_id is null
        and product_id is null and page_key is null)
  or (kind in ('story_cover','story_block')
        and post_id is not null and photo_id is null and album_id is null
        and product_id is null and page_key is null)
  or (kind = 'shop_listing'
        and product_id is not null and photo_id is null and album_id is null
        and post_id is null and page_key is null)
  or (kind in ('page_section','page_legacy','page_share')
        and page_key is not null and photo_id is null and album_id is null
        and post_id is null and product_id is null)
  );

create unique index if not exists photo_usages_slot_share
  on public.photo_usages (tenant_id, scope, page_key) where kind = 'page_share';

-- A page has one share image, so a page_share has exactly one legal slot
-- shape. sync_photo_usages only ever writes it; the schema says so too.
alter table public.photo_usages drop constraint if exists photo_usages_share_slot;
alter table public.photo_usages add constraint photo_usages_share_slot check (
    kind <> 'page_share'
    or (field = 'page_seo.image' and position = 0)
  );


-- ══ 2. Internal helpers — EXECUTE to nobody ═════════════════════════════════
--
-- Each is SECURITY INVOKER: inside the definer functions below (and inside the
-- two P2 wrappers) it runs as the owner; nobody else holds EXECUTE on it.

-- The one lock per parent. Shared, for albums, with register_gallery_photo and
-- register_album_cover, so an album projection and an upload into that album
-- never interleave. `p_key` must already be canonical (a uuid's own text).
create or replace function public.photo_usage_lock(p_tenant uuid, p_parent text, p_key text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'photo_usages:' || p_tenant::text || ':' || p_parent || ':' || coalesce(p_key, ''), 0));
end $$;

-- Validates a parent and returns its CANONICAL key: a uuid as its own
-- lower-case text (so every caller hashes the same lock), a page key as given,
-- NULL for the draft. Anything else is refused.
create or replace function public.photo_usage_parent_key(p_tenant uuid, p_parent text, p_key text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'photo usages: there is no such site.' using errcode = '22023';
  end if;
  case p_parent
    when 'live_page' then
      -- Shape only. photo_usages_page_key_shape is the authority on WHICH keys
      -- exist; this keeps anything that is not a key out of the lock and the
      -- queries.
      if p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,31}$' then
        raise exception 'photo usages: "%" is not a page key.', p_key using errcode = '22023';
      end if;
      return p_key;
    when 'draft' then
      if p_key is not null then
        raise exception 'photo usages: the draft is the whole site; it takes no key.' using errcode = '22023';
      end if;
      return null;
    when 'album', 'post', 'catalog_item' then
      if p_key is null
         or p_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'photo usages: "%" is not an id.', p_key using errcode = '22023';
      end if;
      return p_key::uuid::text;
    else
      raise exception 'photo usages: there is no parent called "%".', p_parent using errcode = '22023';
  end case;
end $$;

-- THE SOURCE: the saved state the document-shaped references are extracted
-- from, and nothing else, in a deterministic jsonb shape. `p_key` canonical.
--
--   live_page  {"parent","page","sections":[{"type","settings"}…],"legacy","share"}
--              sections ordered by position, then id — the ORDINAL is the
--              slot, so two rows sharing a position (page_sections has no
--              unique on it) still get distinct, stable slots; `legacy` is the
--              page's legacy photograph columns ({} for pages that have none),
--              `share` its stored page_seo image (null when none)
--   draft      {"parent","exists","pages","page_seo"}  (site_draft verbatim)
--   post       {"parent","post","exists","blocks","featured"}
--              (blog_posts.blocks and featured_custom_path verbatim)
--   album      {"parent","album","exists","photos":[{"id","storage_path"}…]}
--              (the album's photographs, by id)
--   catalog_item {"parent","photo","exists","storage_path"}
--              (the storage path of the entry's photograph)
--
-- The legacy columns, share images, featured image and photograph paths are
-- here so the extractor can SEE them — it alone knows which paths are
-- built-in samples (isSamplePhoto) — and so a change to them makes an older
-- snapshot stale. They are still never accepted as references: the sync
-- projects every one of them itself. Covers are read inside the sync.
create or replace function public.photo_usage_source(p_tenant uuid, p_parent text, p_key text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v jsonb;
begin
  case p_parent
    when 'live_page' then
      select jsonb_build_object(
               'parent', 'live_page',
               'page', p_key,
               'sections', coalesce(
                 jsonb_agg(jsonb_build_object('type', s.type, 'settings', s.settings)
                           order by s."position", s.id),
                 '[]'::jsonb))
        into v
        from public.page_sections s
       where s.tenant_id = p_tenant and s.page = p_key;
      v := v || jsonb_build_object(
        'legacy', coalesce((
          select case p_key
                   when 'home' then jsonb_build_object('hero_image_path', st.hero_image_path,
                                                       'intro_image_path', st.intro_image_path,
                                                       'contact_image_path', st.contact_image_path)
                   when 'about' then jsonb_build_object('about_image_path', st.about_image_path)
                   else '{}'::jsonb
                 end
            from public.site_settings st where st.tenant_id = p_tenant), '{}'::jsonb),
        'share', (select st.page_seo -> p_key -> 'image'
                    from public.site_settings st where st.tenant_id = p_tenant));
    when 'draft' then
      select jsonb_build_object('parent', 'draft', 'exists', true, 'pages', d.pages, 'page_seo', d.page_seo)
        into v
        from public.site_draft d
       where d.tenant_id = p_tenant;
      v := coalesce(v, jsonb_build_object('parent', 'draft', 'exists', false));
    when 'post' then
      select jsonb_build_object('parent', 'post', 'post', p_key, 'exists', true, 'blocks', b.blocks,
                                'featured', b.featured_custom_path)
        into v
        from public.blog_posts b
       where b.id = p_key::uuid and b.tenant_id = p_tenant;
      v := coalesce(v, jsonb_build_object('parent', 'post', 'post', p_key, 'exists', false));
    when 'album' then
      v := jsonb_build_object('parent', 'album', 'album', p_key, 'exists',
             exists (select 1 from public.albums al where al.id = p_key::uuid and al.tenant_id = p_tenant),
             'photos', coalesce((
               select jsonb_agg(jsonb_build_object('id', ph.id, 'storage_path', ph.storage_path) order by ph.id)
                 from public.photos ph
                where ph.tenant_id = p_tenant and ph.album_id = p_key::uuid), '[]'::jsonb));
    when 'catalog_item' then
      v := jsonb_build_object('parent', 'catalog_item', 'photo', p_key, 'exists',
             exists (select 1 from public.catalog_items ci
                      where ci.photo_id = p_key::uuid and ci.tenant_id = p_tenant),
             'storage_path', (select ph.storage_path from public.photos ph
                               where ph.id = p_key::uuid and ph.tenant_id = p_tenant));
    else
      raise exception 'photo usages: there is no parent called "%".', p_parent using errcode = '22023';
  end case;
  return v;
end $$;

-- THE RESOLVER. A path resolves only to an asset of THIS SITE whose key base
-- is the path's own directory, and only if the path IS that asset's original,
-- its display file, or one of its sizes. No prefix guessing, no fuzzy match,
-- no other site. Anything else is NULL — unresolved.
create or replace function public.photo_usage_resolve_path(p_tenant uuid, p_path text)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id
    from public.photo_assets a
   where a.tenant_id = p_tenant
     and strpos(p_path, '/') > 0
     and a.key_base = left(p_path, length(p_path) - strpos(reverse(p_path), '/'))
     and (p_path = a.original_path
          or p_path = a.display_path
          or exists (select 1 from jsonb_each_text(a.derivatives) d where d.value = p_path))
   limit 1
$$;


-- ══ 3. The service-role interface ═══════════════════════════════════════════
--
-- EXECUTE to service_role only (below), AND a run-time check of the effective
-- role, so a grant added by mistake later still opens nothing. Measured on
-- PostgreSQL 17: inside a SECURITY DEFINER function `current_setting('role')`
-- still reports the CALLER's role (service_role / authenticated), while
-- current_user is the owner; a bare owner connection reports 'none' and is
-- refused too. PostgREST sets it with SET LOCAL ROLE, as record_page_view
-- already relies on.

create or replace function public.read_photo_usage_source(p_tenant uuid, p_parent text, p_key text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the projection service reads a usage source.' using errcode = '42501';
  end if;
  return public.photo_usage_source(
    p_tenant, p_parent, public.photo_usage_parent_key(p_tenant, p_parent, p_key))::text;
end $$;

-- Every parent of a site that could hold a usage, for rebuildUsages. Pages
-- are every key any source names — section rows, legacy home/about, stored
-- share images, the photographer's own pages — PLUS every page that still
-- holds a live usage, so a page whose source vanished is cleared too.
create or replace function public.list_photo_usage_parents(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seo    jsonb;
  v_custom jsonb;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Only the projection service lists usage parents.' using errcode = '42501';
  end if;
  perform public.photo_usage_parent_key(p_tenant, 'draft', null);

  select s.page_seo, s.custom_pages into v_seo, v_custom
    from public.site_settings s where s.tenant_id = p_tenant;

  return jsonb_build_object(
    'albums', coalesce((select jsonb_agg(al.id order by al.id)
                          from public.albums al where al.tenant_id = p_tenant), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(b.id order by b.id)
                         from public.blog_posts b where b.tenant_id = p_tenant), '[]'::jsonb),
    'catalog_items', coalesce((select jsonb_agg(ci.photo_id order by ci.photo_id)
                                 from public.catalog_items ci where ci.tenant_id = p_tenant), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(k order by k) from (
        select s.page as k from public.page_sections s where s.tenant_id = p_tenant
        union select 'home' union select 'about'
        union select e.key from jsonb_each(case when jsonb_typeof(v_seo) = 'object' then v_seo else '{}'::jsonb end) e
        union select c ->> 'key' from jsonb_array_elements(
                 case when jsonb_typeof(v_custom) = 'array' then v_custom else '[]'::jsonb end) c
               where jsonb_typeof(c -> 'key') = 'string'
        union select u.page_key from public.photo_usages u
               where u.tenant_id = p_tenant and u.scope = 'live' and u.page_key is not null
      ) keys where k ~ '^[a-z][a-z0-9_]{0,31}$'), '[]'::jsonb));
end $$;

-- THE ONE WRITER.
--
-- p_source_snapshot is the text read_photo_usage_source returned. p_refs is a
-- JSON array of the document references extracted from it:
--
--   page_section  {"kind","page_key","position","field","path","decorative"}
--   story_block   {"kind","position","field","path"}        ("decorative" false if present)
--   sample        a page:      {"kind","page_key","position":0,"field","path"}
--                              field: a legacy column or 'page_seo.image'
--                 a story:     {"kind","position":0,"field":"featured_custom_path","path"}
--                 an album or
--                 catalogue:   {"kind","photo_id","position":0,"field":"photo","path"}
--
-- and nothing else — every other kind is read here, never accepted.
--
-- A `sample` is NOT a usage. It declares that a source this function projects
-- itself holds one of the platform's BUILT-IN sample photographs, which never
-- become assets: a legacy column, a stored share image, a story's featured
-- image, or a photographs row (gallery membership, a chosen cover, a
-- catalogue entry). Each declaration is proved against the source before it
-- counts — the snapshot slot, or for a photograph the canonical photos row
-- (this site, this album or entry, exactly this storage_path) — and anything
-- else is refused (22023). A proved declaration only makes that one source
-- SKIPPED: no usage, not counted unresolved. It never creates a usage, never
-- chooses an asset, never names a parent and never removes another source's
-- row. Which paths are samples is the application's rule (isSamplePhoto,
-- lib/images.ts), stated once, there; this function never guesses it. Sample
-- section and story-block photographs are simply not sent.
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


-- ══ 4. The two P2 wrappers, with the album lock ═════════════════════════════
--
-- Copied from db/migrations/2026-09-30_photo_ingest.sql with ONE change each:
-- after the album is found on the site, they take the album's projection lock
-- (the three lines marked P3). Signatures, result types, SECURITY DEFINER,
-- search_path, validation, canonical-asset behaviour and returns are P2's,
-- character for character — .mk/usages.ts compares the bodies to P2's file.
--

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
  -- P3: the album's projection lock, shared with sync_photo_usages, so an
  -- album projection and this registration never interleave.
  perform public.photo_usage_lock(p_tenant, 'album', p_album::text);

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
--

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
  -- P3: the album's projection lock, shared with sync_photo_usages, so an
  -- album projection and this registration never interleave.
  perform public.photo_usage_lock(p_tenant, 'album', p_album::text);

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


-- ══ 5. Who may call what ════════════════════════════════════════════════════
--
-- A grant is additive: every function starts from nothing.

revoke all on function public.photo_usage_lock(uuid, text, text)            from public, anon, authenticated, service_role;
revoke all on function public.photo_usage_parent_key(uuid, text, text)      from public, anon, authenticated, service_role;
revoke all on function public.photo_usage_source(uuid, text, text)          from public, anon, authenticated, service_role;
revoke all on function public.photo_usage_resolve_path(uuid, text)          from public, anon, authenticated, service_role;
revoke all on function public.read_photo_usage_source(uuid, text, text)     from public, anon, authenticated, service_role;
revoke all on function public.list_photo_usage_parents(uuid)                from public, anon, authenticated, service_role;
revoke all on function public.sync_photo_usages(uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;

grant execute on function public.read_photo_usage_source(uuid, text, text)     to service_role;
grant execute on function public.list_photo_usage_parents(uuid)                to service_role;
grant execute on function public.sync_photo_usages(uuid, text, text, text, jsonb) to service_role;

-- The two P2 wrappers keep P2's privileges exactly: authenticated only.
revoke all on function public.register_gallery_photo(
  uuid, uuid, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb,
  double precision, double precision)
  from public, anon, authenticated, service_role;
revoke all on function public.register_album_cover(
  uuid, uuid, text, text, jsonb, integer, integer, bigint, text, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.register_gallery_photo(
  uuid, uuid, text, text, text, jsonb, integer, integer, bigint, text, text,
  timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb,
  double precision, double precision)
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
--   -- the P2 wrappers without the lock: re-run their definitions from
--   -- db/migrations/2026-09-30_photo_ingest.sql (create or replace), then
--   drop function if exists public.sync_photo_usages(uuid, text, text, text, jsonb);
--   drop function if exists public.list_photo_usage_parents(uuid);
--   drop function if exists public.read_photo_usage_source(uuid, text, text);
--   drop function if exists public.photo_usage_resolve_path(uuid, text);
--   drop function if exists public.photo_usage_source(uuid, text, text);
--   drop function if exists public.photo_usage_parent_key(uuid, text, text);
--   drop function if exists public.photo_usage_lock(uuid, text, text);
--   delete from public.photo_usages where kind = 'page_share';
--   drop index if exists public.photo_usages_slot_share;
--   -- and the three CHECKs restated exactly as in 2026-09-29_photo_assets.sql
--   commit;
--
-- The P2 wrappers must be restored BEFORE photo_usage_lock is dropped: they
-- call it. Usages written meanwhile are a projection; rows of the seven P1
-- kinds may stay, and nothing reads them before P5.
