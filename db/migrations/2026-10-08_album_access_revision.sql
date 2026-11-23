-- ════════════════════════════════════════════════════════════════════════════
-- P5 F1 — albums.access_revision: a database-managed revocation marker
-- ════════════════════════════════════════════════════════════════════════════
--
-- CANDIDATE. Rehearsed only on disposable loopback databases. NOT applied to
-- production; that needs its own Work `production_migration` review AND
-- Gonzalo's explicit approval, and it must name the write below.
--
-- Why. A password gallery's grant (lib/album-grant.ts) is an HMAC over the
-- site, the album, an expiry — and this revision. The revision is what makes a
-- grant die when the album's access policy changes. It cannot be the password
-- hash (anon-readable on a public album, and it survives a privacy round trip
-- because the settings writer keeps a saved password), nor `updated_at` (no
-- writer maintains it), nor an application-side epoch (a direct authenticated
-- PostgREST write, or any older writer, would skip it). So the DATABASE keeps
-- it: a UUID replaced on every insert and on every change of privacy_type,
-- password_hash, tenant_id or id — and on nothing else. Whatever value a
-- caller sends for it is ignored: no role can choose, roll back or replay one.
--
-- What it changes:
--
--   1. albums gains `access_revision uuid not null default gen_random_uuid()`.
--      THIS INITIALISES EXISTING ROWS: every album gets a fresh, distinct
--      revision, which is a write to album access metadata and a full table
--      rewrite under ACCESS EXCLUSIVE (volatile default). Measured locally
--      only; production size and lock duration are NOT measured.
--   2. public.albums_access_revision() — trigger function: plpgsql, SECURITY
--      INVOKER, `search_path = ''`, reads only NEW/OLD, writes nothing else,
--      EXECUTE revoked from PUBLIC and every application role. (A trigger
--      fires without its caller holding EXECUTE.)
--   3. Trigger albums_access_revision, BEFORE INSERT OR UPDATE, FOR EACH ROW.
--   4. REVOKE TRIGGER ON public.albums FROM PUBLIC, anon, authenticated,
--      service_role — on the FIRST run only. A NECESSARY ACL NARROWING, found
--      by Codex in local rehearsal: TRIGGER on the table lets a role CREATE OR
--      REPLACE TRIGGER albums_access_revision to point it at any function it
--      may execute, which disables (3) without ownership. Nothing in the
--      application creates triggers. SELECT/INSERT/UPDATE/DELETE/REFERENCES/
--      TRUNCATE, RLS, policies and ownership are NOT changed. Table ACLs are
--      therefore NOT byte-identical before and after: TRIGGER is gone from
--      four grantees.
--
-- No table, policy, index or other grant is added or widened.
--
-- Drift is refused, not overwritten. Either NONE of the three objects exists
-- (first run) or ALL of them exist exactly as defined here (re-run, a no-op
-- that keeps every revision AND changes no privilege); anything else — a
-- column of another type, default or nullability, a column-level grant on it,
-- a function with another body, owner, language, security, path or ACL, a
-- disabled or reshaped trigger, any OTHER user trigger on albums, or TRIGGER
-- on albums held again by PUBLIC, anon, authenticated or service_role
-- (directly or through a role they inherit) — raises before anything is
-- changed, and rolls everything back. A re-run never re-revokes a restored
-- TRIGGER grant: it refuses, and the grant stays exactly as it was for a
-- reviewer to see. The full target definition is checked again after either
-- run, before commit. Safe to run twice.
--
-- Limits, stated: a table owner or superuser can still disable the trigger or
-- run with session_replication_role = replica; a database RESTORE restores old
-- revisions too, so a restore must be answered by rotating the grant key
-- (ALBUM_ACCESS_SECRET). UUID collisions are improbable, not impossible.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- Bounded: never queue behind live traffic for long, never run unbounded.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Every check below and every change after it sees one state of the table.
lock table public.albums in access exclusive mode;

do $migration$
declare
  v_body constant text := $body$
begin
  if tg_op = 'INSERT' then
    new.access_revision := pg_catalog.gen_random_uuid();
  elsif new.privacy_type  is distinct from old.privacy_type
     or new.password_hash is distinct from old.password_hash
     or new.tenant_id     is distinct from old.tenant_id
     or new.id            is distinct from old.id then
    new.access_revision := pg_catalog.gen_random_uuid();
  else
    new.access_revision := old.access_revision;
  end if;
  return new;
end
$body$;
  v_rel      oid := 'public.albums'::regclass;
  v_owner    oid;
  v_col      record;
  v_fn       record;
  v_trg      record;
  v_has_col  boolean;
  v_has_fn   boolean;
  v_has_trg  boolean;
  v_others   int;
begin
  select c.relowner into v_owner from pg_catalog.pg_class c where c.oid = v_rel;

  -- ── what is there ─────────────────────────────────────────────────────────
  select a.attnum, a.atttypid, a.attnotnull, a.attidentity, a.attgenerated, a.attacl,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid) as def
    into v_col
    from pg_catalog.pg_attribute a
    left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = v_rel and a.attname = 'access_revision' and not a.attisdropped;
  v_has_col := found;

  select p.oid, p.proowner, p.prosecdef, p.provolatile, p.proconfig, p.proacl, p.prosrc,
         p.pronargs, p.prorettype, l.lanname
    into v_fn
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
   where p.pronamespace = 'public'::regnamespace and p.proname = 'albums_access_revision';
  v_has_fn := found;
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'albums_access_revision') > 1 then
    raise exception 'album access revision: more than one public.albums_access_revision function — refusing';
  end if;

  select t.tgfoid, t.tgenabled, t.tgtype, t.tgattr::text as tgattr, t.tgqual, t.tgnargs
    into v_trg
    from pg_catalog.pg_trigger t
   where t.tgrelid = v_rel and t.tgname = 'albums_access_revision' and not t.tgisinternal;
  v_has_trg := found;

  select count(*) into v_others
    from pg_catalog.pg_trigger t
   where t.tgrelid = v_rel and not t.tgisinternal and t.tgname <> 'albums_access_revision';
  if v_others > 0 then
    raise exception 'album access revision: % other user trigger(s) on public.albums — refusing to proceed over unreviewed drift', v_others;
  end if;

  -- ── all or nothing ────────────────────────────────────────────────────────
  if v_has_col <> v_has_fn or v_has_fn <> v_has_trg then
    raise exception 'album access revision: partial state (column %, function %, trigger %) — refusing',
      v_has_col, v_has_fn, v_has_trg;
  end if;

  if v_has_col then
    -- RE-RUN: everything must already be exactly this migration's.
    if v_col.atttypid <> 'pg_catalog.uuid'::regtype or not v_col.attnotnull
       or v_col.attidentity <> '' or v_col.attgenerated <> ''
       or v_col.def is distinct from 'gen_random_uuid()' or v_col.attacl is not null then
      raise exception 'album access revision: albums.access_revision exists with another definition — refusing';
    end if;
    if v_fn.lanname <> 'plpgsql' or v_fn.prosecdef or v_fn.provolatile <> 'v'
       or v_fn.pronargs <> 0 or v_fn.prorettype <> 'pg_catalog.trigger'::regtype
       or v_fn.proconfig is distinct from array['search_path=""']
       or v_fn.proowner <> v_owner
       or pg_catalog.replace(v_fn.prosrc, E'\r', '') <> pg_catalog.replace(v_body, E'\r', '') then
      raise exception 'album access revision: public.albums_access_revision() exists with another definition — refusing';
    end if;
    if v_fn.proacl is null or exists (
         select 1 from pg_catalog.aclexplode(v_fn.proacl) x where x.grantee <> v_fn.proowner) then
      raise exception 'album access revision: public.albums_access_revision() is executable beyond its owner — refusing';
    end if;
    -- tgtype 23 = ROW(1) | BEFORE(2) | INSERT(4) | UPDATE(16); no column list, no WHEN, no arguments.
    if v_trg.tgfoid <> v_fn.oid or v_trg.tgenabled <> 'O' or v_trg.tgtype <> 23
       or v_trg.tgattr <> '' or v_trg.tgqual is not null or v_trg.tgnargs <> 0 then
      raise exception 'album access revision: trigger albums_access_revision is disabled or reshaped — refusing';
    end if;
    -- The narrowing must still hold. A re-run REFUSES a restored TRIGGER
    -- grant rather than silently revoking it again: an ACL that moved after
    -- review is drift for a person to look at, not for this file to repair.
    if exists (select 1 from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
                where c.oid = v_rel and x.privilege_type = 'TRIGGER'
                  and (x.grantee = 0 or x.grantee in (select r.oid from pg_catalog.pg_roles r
                                                       where r.rolname in ('anon', 'authenticated', 'service_role'))))
       or pg_catalog.has_table_privilege('anon', 'public.albums', 'TRIGGER')
       or pg_catalog.has_table_privilege('authenticated', 'public.albums', 'TRIGGER')
       or pg_catalog.has_table_privilege('service_role', 'public.albums', 'TRIGGER') then
      raise exception 'album access revision: TRIGGER on public.albums is held again by PUBLIC or an application role — refusing (not re-revoked)';
    end if;
  else
    -- FIRST RUN: create all three. The volatile default gives every existing
    -- row its own revision (one rewrite).
    alter table public.albums
      add column access_revision uuid not null default pg_catalog.gen_random_uuid();

    execute pg_catalog.format(
      'create function public.albums_access_revision() returns trigger language plpgsql '
      'security invoker volatile set search_path = %L as %L',
      '', pg_catalog.replace(v_body, E'\r', ''));
    revoke all on function public.albums_access_revision() from public, anon, authenticated, service_role;

    create trigger albums_access_revision
      before insert or update on public.albums
      for each row execute function public.albums_access_revision();

    -- The ACL narrowing (4), first run only.
    revoke trigger on table public.albums from public, anon, authenticated, service_role;
  end if;
end
$migration$;

-- ── postconditions: refuse to commit anything that is not exactly the target ─
-- The same definition the re-run branch demands, checked after EITHER run.
do $post$
declare
  v_rel   oid := 'public.albums'::regclass;
  v_owner oid;
  v_fn    oid;
  r       text;
begin
  select c.relowner into v_owner from pg_catalog.pg_class c where c.oid = v_rel;

  if not exists (select 1 from pg_catalog.pg_attribute a
                   join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                  where a.attrelid = v_rel and a.attname = 'access_revision' and not a.attisdropped
                    and a.atttypid = 'pg_catalog.uuid'::regtype and a.attnotnull
                    and a.attidentity = '' and a.attgenerated = '' and a.attacl is null
                    and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'gen_random_uuid()') then
    raise exception 'album access revision: albums.access_revision is not exactly the target after migration';
  end if;

  select p.oid into v_fn
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
   where p.pronamespace = 'public'::regnamespace and p.proname = 'albums_access_revision'
     and l.lanname = 'plpgsql' and not p.prosecdef and p.provolatile = 'v'
     and p.pronargs = 0 and p.prorettype = 'pg_catalog.trigger'::regtype
     and p.proconfig = array['search_path=""']
     and p.proowner = v_owner
     and p.proacl is not null
     and not exists (select 1 from pg_catalog.aclexplode(p.proacl) x where x.grantee <> p.proowner);
  if v_fn is null or (select count(*) from pg_catalog.pg_proc p
                       where p.pronamespace = 'public'::regnamespace and p.proname = 'albums_access_revision') <> 1 then
    raise exception 'album access revision: public.albums_access_revision() is not exactly the target (owner, language, security, path, ACL) after migration';
  end if;

  if not exists (select 1 from pg_catalog.pg_trigger t
                  where t.tgrelid = v_rel and t.tgname = 'albums_access_revision' and not t.tgisinternal
                    and t.tgfoid = v_fn and t.tgenabled = 'O' and t.tgtype = 23
                    and t.tgattr::text = '' and t.tgqual is null and t.tgnargs = 0)
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = v_rel and not t.tgisinternal and t.tgname <> 'albums_access_revision') then
    raise exception 'album access revision: trigger missing, not enabled, reshaped or not alone after migration';
  end if;
  if exists (select 1 from public.albums where access_revision is null) then
    raise exception 'album access revision: a row without a revision after migration';
  end if;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_table_privilege(r, 'public.albums', 'TRIGGER') then
      raise exception 'album access revision: % still holds TRIGGER on public.albums', r;
    end if;
    if pg_catalog.has_function_privilege(r, 'public.albums_access_revision()', 'EXECUTE') then
      raise exception 'album access revision: % may execute public.albums_access_revision()', r;
    end if;
  end loop;
  if exists (select 1 from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
              where c.oid = v_rel and x.grantee = 0 and x.privilege_type = 'TRIGGER') then
    raise exception 'album access revision: PUBLIC still holds TRIGGER on public.albums';
  end if;
end
$post$;

commit;

-- ── Rollback (each step its own approval; NOT automatic) ────────────────────
-- Only once no deployed application reads access_revision (an application
-- that does fails CLOSED without it: password galleries lock). Keep the
-- revision for as long as revision-bound grants are in use. Do NOT restore
-- TRIGGER on public.albums as part of any rollback that keeps revision-based
-- grants; restoring it is a separate, explicitly approved decision.
--   drop trigger if exists albums_access_revision on public.albums;
--   drop function if exists public.albums_access_revision();
--   alter table public.albums drop column if exists access_revision;
