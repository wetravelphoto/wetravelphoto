-- ════════════════════════════════════════════════════════════════════════════
-- 2026-10-08 — P5-R1: read_photo_render_assets without an unassigned record
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ CANDIDATE — NOT DEPLOYED. A forward correction to a DEPLOYED function.   │
-- │ Rehearsed only on disposable loopback scratch databases. It needs its    │
-- │ own Work review (production_migration) AND Gonzalo's explicit approval   │
-- │ before it is applied anywhere. db/schema-2026-09.sql,                    │
-- │ db/test-fixture.sql, db/schema-verified.md and the drift guard are       │
-- │ deliberately NOT updated: that bookkeeping follows a deployment.         │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- What is deployed. 2026-10-07_photo_render_read.sql (Supabase
-- 20261008154343, sha256 fa2e0594…7128b — that file is NOT edited; its bytes
-- are the deployment's identity) created read_photo_render_assets. Its result
-- line
--
--     case when v_outcome = 'ok' then jsonb_build_object('outcome', 'ok', 'asset_id', v_a.id)
--
-- names a field of `v_a`, an untyped RECORD that is only assigned when a
-- reference reaches the asset lookup. PL/pgSQL needs that field's TYPE to
-- prepare the expression, whichever CASE branch runs, so the first reference
-- of a session's first call that is invalid, missing, foreign, mismatched or
-- ambiguous raises SQLSTATE 55000 `record "v_a" is not assigned yet` — and
-- the application's reader turns that into an error for the WHOLE batch.
-- Once any call in the backend has prepared the expression with v_a assigned,
-- the cached plan no longer asks, which is why a warm session or a batch
-- that begins with a good asset hid it (Work, post-deployment smoke,
-- `.ai-handoff/REVIEW.md`, finding P5-R1).
--
-- The change: that one expression names `v_asset` — the uuid scalar the row
-- was selected BY — instead of `v_a.id`. Nothing else in the body changes,
-- character for character. Why it is the same answer:
--
--   · v_asset is reset to NULL at the top of every reference, and is only
--     non-NULL when a lookup found this site's asset;
--   · `ok` is reached only inside `if v_asset is not null`, after
--     `select … into v_a … where a.id = v_asset and a.tenant_id = p_tenant`,
--     and v_asset is not assigned again before the result line;
--   · if that select found no row, v_a is all NULL, `v_a.state is distinct
--     from 'derived'`, and the outcome is `unavailable`, never `ok` — so on
--     every `ok`, v_a.id = v_asset; both are uuid, so the JSON is identical.
--
-- Routing, ceilings, tenant predicates, the allowlist, the role check, the
-- signature, STABLE, SECURITY DEFINER, `search_path = ''`, the owner and the
-- ACL are unchanged. sync_photo_usages (the projector) is not touched. No
-- table, column, index, policy, trigger or grant changes; no row is written.
-- CREATE OR REPLACE keeps the owner and the ACL, so no grant is restated.
--
-- Drift is refused, not overwritten. The function must exist exactly once,
-- with the deployed signature and attributes and ACL, and its body must be
-- EITHER the deployed body (md5 of prosrc 0f73aec4d8bb7c12b6c10fbabe9bdfb6,
-- the figure Work recorded from production) OR this file's corrected body
-- (afb20e567041072e63324eb5f13b2940) — a re-run. Anything else raises before
-- anything changes. The projector's body must be the deployed one
-- (74102d2413a429873f9c8ea52706a8d5) before and after. The full target is
-- checked again before commit. Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── Preflight: exactly the deployed function, or exactly this correction ────

do $$
declare
  c_old   constant text := '0f73aec4d8bb7c12b6c10fbabe9bdfb6';
  c_new   constant text := 'afb20e567041072e63324eb5f13b2940';
  c_sync  constant text := '74102d2413a429873f9c8ea52706a8d5';
  v_n     integer;
  v_p     record;
begin
  select count(*) into v_n
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'read_photo_render_assets';
  if v_n <> 1 then
    raise exception 'photo render fix: % public.read_photo_render_assets function(s), expected exactly the deployed one — refusing', v_n;
  end if;

  select p.prokind, pg_catalog.pg_get_function_arguments(p.oid) as args, p.prorettype, p.proretset,
         l.lanname, p.provolatile, p.prosecdef, p.proleakproof, p.proisstrict, p.proparallel,
         p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner,
         (select array_agg(a::text order by a::text) from unnest(p.proacl) a) as acl,
         pg_catalog.md5(p.prosrc) as body
    into v_p
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
   where p.pronamespace = 'public'::regnamespace and p.proname = 'read_photo_render_assets';

  if v_p.prokind <> 'f' or v_p.args <> 'p_tenant uuid, p_refs jsonb'
     or v_p.prorettype <> 'jsonb'::regtype or v_p.proretset
     or v_p.lanname <> 'plpgsql' or v_p.provolatile <> 's' or not v_p.prosecdef
     or v_p.proleakproof or v_p.proisstrict or v_p.proparallel <> 'u'
     or v_p.proconfig is distinct from array['search_path=""']
     or v_p.owner <> 'postgres' then
    raise exception 'photo render fix: read_photo_render_assets differs from the deployed signature or attributes — refusing';
  end if;
  if v_p.acl is distinct from array['postgres=X/postgres', 'service_role=X/postgres'] then
    raise exception 'photo render fix: read_photo_render_assets has another ACL (%) — refusing', v_p.acl;
  end if;
  if v_p.body not in (c_old, c_new) then
    raise exception 'photo render fix: read_photo_render_assets has an unreviewed body (md5 %) — refusing', v_p.body;
  end if;

  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.sync_photo_usages(uuid, text, text, text, jsonb)')) is distinct from c_sync then
    raise exception 'photo render fix: sync_photo_usages is not the deployed projector — refusing';
  end if;
end $$;


-- ── The reader, with the one expression corrected ───────────────────────────
--
-- Identical to 2026-10-07_photo_render_read.sql §1, character for character,
-- except `v_a.id` → `v_asset` in the result line near the end (no marker
-- comment inside the body, so the body differs by that one token alone;
-- .mk/render-cold-session.ts asserts it).

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
      case when v_outcome = 'ok' then jsonb_build_object('outcome', 'ok', 'asset_id', v_asset)
           when v_outcome = 'unavailable' then jsonb_build_object('outcome', 'unavailable', 'reason', v_reason)
           else jsonb_build_object('outcome', v_outcome) end);
  end loop;

  return jsonb_build_object('v', 1, 'results', v_results, 'assets', v_assets);
end $$;


-- ── Postflight: exactly the corrected function, nothing else moved ──────────

do $$
declare
  c_new   constant text := 'afb20e567041072e63324eb5f13b2940';
  c_sync  constant text := '74102d2413a429873f9c8ea52706a8d5';
  v_n     integer;
  v_p     record;
begin
  select count(*) into v_n
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'read_photo_render_assets';
  select p.prokind, pg_catalog.pg_get_function_arguments(p.oid) as args, p.prorettype, p.proretset,
         l.lanname, p.provolatile, p.prosecdef, p.proleakproof, p.proisstrict, p.proparallel,
         p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner,
         (select array_agg(a::text order by a::text) from unnest(p.proacl) a) as acl,
         pg_catalog.md5(p.prosrc) as body
    into v_p
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
   where p.pronamespace = 'public'::regnamespace and p.proname = 'read_photo_render_assets';

  if v_n <> 1 or v_p.prokind <> 'f' or v_p.args <> 'p_tenant uuid, p_refs jsonb'
     or v_p.prorettype <> 'jsonb'::regtype or v_p.proretset
     or v_p.lanname <> 'plpgsql' or v_p.provolatile <> 's' or not v_p.prosecdef
     or v_p.proleakproof or v_p.proisstrict or v_p.proparallel <> 'u'
     or v_p.proconfig is distinct from array['search_path=""']
     or v_p.owner <> 'postgres'
     or v_p.acl is distinct from array['postgres=X/postgres', 'service_role=X/postgres']
     or v_p.body <> c_new then
    raise exception 'photo render fix: read_photo_render_assets is not exactly the corrected target after migration';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.sync_photo_usages(uuid, text, text, text, jsonb)')) is distinct from c_sync then
    raise exception 'photo render fix: sync_photo_usages changed during migration';
  end if;
end $$;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Not recommended: it restores the defect. If ever needed, re-run §1 of
-- 2026-10-07_photo_render_read.sql (create or replace; owner and ACL are
-- kept) — and only that section, never its §2 or §3.
