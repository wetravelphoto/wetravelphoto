-- ════════════════════════════════════════════════════════════════════════════
-- 2026-11-22 — Client gallery v2: a durable send limit for "Your gallery is
-- ready" emails
--
-- CANDIDATE — NOT DEPLOYED. Not yet rehearsed: see the report that accompanies
-- it. .ai-handoff/client-gallery-v2-prompt.md, Part 3 item 11 ("Rate-limit
-- sends"). Separate from, and does not touch, 2026-11-22_album_cover_v2.sql and
-- 2026-11-22_album_layout_square.sql.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- lib/gallery-email.ts limits sends with a Map held in one server instance. On
-- Vercel each instance — and every cold start — counts from zero, so the limit
-- bounds a burst on one instance and nothing more. This puts the count in the
-- database, where every instance sees the same one.
--
-- ── What it adds ────────────────────────────────────────────────────────────
--   public.gallery_email_send_attempts        one row per RESERVED attempt
--     id              uuid         NOT NULL DEFAULT gen_random_uuid()  PK
--     tenant_id       uuid         NOT NULL  → tenants(id) ON DELETE CASCADE
--                                            (no tenant default: the writer
--                                            names the site)
--     recipient_hash  bytea        NOT NULL  exactly 32 bytes (sha256)
--     attempted_at    timestamptz  NOT NULL  (no default: the writer sets it)
--   one index (tenant_id, recipient_hash, attempted_at) — serves the site
--   count, the recipient count, the retention delete and the tenant cascade.
--
--   public.reserve_gallery_email_send(p_tenant uuid, p_album uuid, p_client uuid)
--     returns text: 'reserved' | 'site_limited' | 'recipient_limited'
--     SECURITY DEFINER, VOLATILE, search_path = '', lock_timeout = 5s,
--     EXECUTE to `authenticated` ONLY.
--
-- ── The limits ──────────────────────────────────────────────────────────────
-- At most 30 reserved attempts per site in any rolling hour, and at most 3 per
-- recipient per site in any rolling hour — the figures GALLERY_EMAIL_LIMITS
-- already carries. An attempt is reserved BEFORE the provider is called and is
-- never given back, so a send that then fails still counts: the limit is on
-- attempts, which is the conservative reading.
--
-- ── Who may call it ─────────────────────────────────────────────────────────
-- A definer function is not subject to row-level security, so it restates the
-- rule itself, NULL-safely (`(…) IS NOT TRUE` — the S3 hotfix lesson):
--   · the site exists, and
--   · the caller (auth.uid()) has a profile ON THAT SITE with an editing role —
--     ('owner', 'admin', 'editor'), the same list as lib/auth.ts EDIT_ROLES —
--     or is a platform admin, who passes every tenant check exactly as the
--     table policies let them. A caller with no identity, no profile, a profile
--     on another site, or a non-editing role is refused (42501).
-- The application calls it with the photographer's own Supabase client after
-- requireEditor(), as register_* and enqueue_jobs are called. service_role is
-- NOT granted EXECUTE: a service-role call carries no auth.uid(), so it could
-- only ever be refused, and granting it would widen the door for nothing.
--
-- ── The recipient is derived, never supplied ────────────────────────────────
-- The caller names a client by id. The function reads that client's address
-- itself, and only when the client is THIS site's, the gallery is THIS site's,
-- and the gallery is shared with that client (album_clients) — the same three
-- checks lib/gallery-email-send.ts makes, restated here because a definer
-- function cannot rely on its caller. "Does not exist", "another site's" and
-- "not shared" give one message, so the function cannot be used to ask whether
-- an id exists elsewhere.
--
-- ── No plaintext address is stored ──────────────────────────────────────────
-- recipient_hash = sha256(utf8(<tenant id> || ':' || lower(btrim(email)))).
-- Normalised, so two contacts on one site with the same address in different
-- case share one budget; keyed by the site, so one person's hashes on two sites
-- differ and cannot be joined across tenants. KNOWN WEAKNESS, recorded rather
-- than hidden: the key is not a secret, so anyone holding a row AND guessing an
-- address could confirm it (the same shape as visitor_hash, PROJECT-CONTEXT §8).
-- Nobody but the table owner can read a row (no grant to any application role),
-- and a row lives at most an hour (below).
--
-- ── Atomicity ───────────────────────────────────────────────────────────────
-- Count-then-insert is a race under READ COMMITTED unless serialised. Each call
-- takes a transaction-scoped advisory lock keyed by (this table, the site), so
-- two reservations on one site run one after the other; a different site never
-- waits. Each statement in a VOLATILE plpgsql function takes a fresh snapshot
-- under READ COMMITTED, so the count that follows the lock sees every
-- reservation committed before the lock was granted. Under REPEATABLE READ or
-- SERIALIZABLE the snapshot could predate the lock, so the function refuses to
-- run there (55000) rather than count from a stale picture. A hash collision
-- between two sites' lock keys only makes them queue behind each other — it
-- can never let two reservations on one site run together. lock_timeout 5s:
-- a wait longer than that fails (55P03) rather than hanging a server action.
--
-- ── Fail closed ─────────────────────────────────────────────────────────────
-- Every refusal and every fault is either an exception or a value other than
-- 'reserved'. The application contract (NOT implemented by this file; app code
-- is out of this change): send ONLY when the call returns exactly 'reserved';
-- an error, a missing function, a timeout or any other value means no send.
--
-- ── Retention, bounded and per site ─────────────────────────────────────────
-- Inside the lock, before counting, each call deletes ITS OWN SITE's rows older
-- than the window. Nothing ever deletes another site's rows: no cleanup job, no
-- cross-tenant statement. Because a site's rows are pruned on every call and a
-- call adds a row only while fewer than 30 are within the hour, a site holds at
-- most 30 rows at any time, however long it then stays quiet. Deleting a site
-- removes its rows by the tenant cascade.
--
-- ── Privileges, stated whole ────────────────────────────────────────────────
-- The table: RLS enabled with NO policy, and ALL revoked from public, anon,
-- authenticated and service_role (a grant is additive, and Supabase's default
-- privileges would otherwise hand out ALL). No role but the owner can read,
-- write or truncate it; the function is the whole interface, like jobs and
-- page_views. Neither uses a sequence.
-- The function: ALL revoked from public, anon, authenticated, service_role,
-- then EXECUTE to authenticated. anon has no access of any kind.
--
-- ── Safe to run twice ───────────────────────────────────────────────────────
-- CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, REVOKE/GRANT
-- (which re-narrow a widened ACL rather than refusing it — a narrowing only).
-- Everything is then read back and held to its exact shape before COMMIT: a
-- same-named table with another column, constraint, index, policy, trigger or
-- column ACL; a same-named function overload; or any extra privilege refuses
-- (42710 / 42P17) and the transaction rolls back, changing nothing.
-- ════════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- pg_get_constraintdef() writes a table's schema only when it is not on the
-- path; fixed for this transaction so the comparisons below are like for like.
set local search_path = public, pg_catalog;

-- ── 1. The table ────────────────────────────────────────────────────────────

create table if not exists public.gallery_email_send_attempts (
  id              uuid        not null default gen_random_uuid(),
  tenant_id       uuid        not null,
  recipient_hash  bytea       not null,
  attempted_at    timestamptz not null,
  constraint gallery_email_send_attempts_pkey primary key (id),
  constraint gallery_email_send_attempts_tenant_fk
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint gallery_email_send_attempts_hash_shape
    check (octet_length(recipient_hash) = 32)
);

create index if not exists gallery_email_send_attempts_tenant_recipient
  on public.gallery_email_send_attempts (tenant_id, recipient_hash, attempted_at);

alter table public.gallery_email_send_attempts enable row level security;

revoke all on table public.gallery_email_send_attempts from public, anon, authenticated, service_role;

-- ── 2. The table, held to its exact shape ───────────────────────────────────

do $$
declare
  v_rel   regclass := to_regclass('public.gallery_email_send_attempts');
  v_kind  "char";
  v_cols  text;
  v_cons  text;
  v_n     integer;
begin
  select c.relkind into v_kind from pg_class c where c.oid = v_rel;
  if v_rel is null or v_kind is distinct from 'r' then
    raise exception 'public.gallery_email_send_attempts is not an ordinary table' using errcode = '42710';
  end if;

  -- Columns: exactly these four, in this order, with these types, nullability
  -- and defaults, and no column ACL.
  select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                    || case when a.attnotnull then ' not null' else '' end
                    || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
                    || case when a.attacl is not null then ' +acl' else '' end,
                    ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from
     'id uuid not null default gen_random_uuid(), tenant_id uuid not null, recipient_hash bytea not null, attempted_at timestamp with time zone not null' then
    raise exception 'gallery_email_send_attempts exists with another shape: %', v_cols using errcode = '42710';
  end if;

  -- Constraints: exactly these three.
  select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' | ' order by c.conname)
    into v_cons
    from pg_constraint c
   where c.conrelid = v_rel;
  if v_cons is distinct from
     'gallery_email_send_attempts_hash_shape CHECK ((octet_length(recipient_hash) = 32))'
     || ' | gallery_email_send_attempts_pkey PRIMARY KEY (id)'
     || ' | gallery_email_send_attempts_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE' then
    raise exception 'gallery_email_send_attempts has other constraints: %', v_cons using errcode = '42710';
  end if;

  -- RLS on (not forced: the definer function runs as the owner), no policy at
  -- all, no trigger.
  if not exists (select 1 from pg_class c where c.oid = v_rel and c.relrowsecurity and not c.relforcerowsecurity) then
    raise exception 'gallery_email_send_attempts: row-level security is not enabled as defined' using errcode = '42P17';
  end if;
  select count(*) into v_n from pg_policy p where p.polrelid = v_rel;
  if v_n <> 0 then
    raise exception 'gallery_email_send_attempts has % policies; it must have none', v_n using errcode = '42710';
  end if;
  select count(*) into v_n from pg_trigger t where t.tgrelid = v_rel and not t.tgisinternal;
  if v_n <> 0 then
    raise exception 'gallery_email_send_attempts has % triggers; it must have none', v_n using errcode = '42710';
  end if;

  -- Table ACL: the owner and nobody else — no PUBLIC, anon, authenticated or
  -- service_role entry of any privilege.
  if exists (select 1
               from pg_class c,
                    lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
              where c.oid = v_rel and x.grantee <> c.relowner) then
    raise exception 'gallery_email_send_attempts grants a privilege to a role other than its owner' using errcode = '42P17';
  end if;
end $$;

-- Indexes: exactly the primary key's and the one below. `public` off the path
-- so pg_get_indexdef() names the table in full.
set local search_path = pg_catalog;

do $$
declare
  v_defs text;
begin
  select string_agg(pg_catalog.pg_get_indexdef(i.indexrelid)
                    || case when i.indisvalid then '' else ' (INVALID)' end, ' | ' order by c.relname)
    into v_defs
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
   where i.indrelid = 'public.gallery_email_send_attempts'::regclass;
  if v_defs is distinct from
     'CREATE UNIQUE INDEX gallery_email_send_attempts_pkey ON public.gallery_email_send_attempts USING btree (id)'
     || ' | CREATE INDEX gallery_email_send_attempts_tenant_recipient ON public.gallery_email_send_attempts USING btree (tenant_id, recipient_hash, attempted_at)' then
    raise exception 'gallery_email_send_attempts has other indexes: %', v_defs using errcode = '42710';
  end if;
end $$;

-- ── 3. The function ─────────────────────────────────────────────────────────

create or replace function public.reserve_gallery_email_send(
  p_tenant uuid,
  p_album  uuid,
  p_client uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  c_site_max      constant integer  := 30;
  c_recipient_max constant integer  := 3;
  c_window        constant interval := interval '1 hour';
  v_email     text;
  v_hash      bytea;
  v_now       timestamptz;
  v_site      integer;
  v_recipient integer;
begin
  if p_tenant is null or p_album is null or p_client is null then
    raise exception 'A send needs its site, its gallery and its client.' using errcode = '22023';
  end if;

  -- Who: an editor of THIS site, or a platform admin. NULL-safe.
  if not exists (select 1 from public.tenants t where t.id = p_tenant)
     or (exists (select 1 from public.profiles p
                  where p.id = auth.uid()
                    and p.tenant_id = p_tenant
                    and p.role in ('owner', 'admin', 'editor'))
         or public.is_platform_admin()) is not true then
    raise exception 'That is not your site.' using errcode = '42501';
  end if;

  -- The count below is only exact under READ COMMITTED (see the header).
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception 'A send can only be reserved under READ COMMITTED.' using errcode = '55000';
  end if;

  -- What: the recipient, read here — this site's client, on this site's
  -- gallery, which is shared with that client. One message for every miss.
  select c.email into v_email
    from public.clients c
    join public.album_clients ac on ac.client_id = c.id
    join public.albums al on al.id = ac.album_id
   where c.id = p_client and c.tenant_id = p_tenant
     and al.id = p_album and al.tenant_id = p_tenant;
  if not found then
    raise exception 'That client could not be found on this gallery.' using errcode = '42501';
  end if;

  v_email := pg_catalog.lower(pg_catalog.btrim(v_email));
  if v_email is null or v_email = '' then
    raise exception 'That client has no email address.' using errcode = '22023';
  end if;
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(p_tenant::text || ':' || v_email, 'UTF8'));

  -- One reservation per site at a time; released at the end of the caller's
  -- transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.gallery_email_send_attempts'),
    pg_catalog.hashtext(p_tenant::text));

  -- Read after the lock is granted, so it is never earlier than the previous
  -- holder's row.
  v_now := pg_catalog.clock_timestamp();

  -- Retention: this site's expired rows, and nobody else's.
  delete from public.gallery_email_send_attempts g
   where g.tenant_id = p_tenant
     and g.attempted_at <= v_now - c_window;

  select count(*), count(*) filter (where g.recipient_hash = v_hash)
    into v_site, v_recipient
    from public.gallery_email_send_attempts g
   where g.tenant_id = p_tenant
     and g.attempted_at > v_now - c_window;

  if v_site >= c_site_max then
    return 'site_limited';
  end if;
  if v_recipient >= c_recipient_max then
    return 'recipient_limited';
  end if;

  insert into public.gallery_email_send_attempts (tenant_id, recipient_hash, attempted_at)
  values (p_tenant, v_hash, v_now);
  return 'reserved';
end $$;

revoke all on function public.reserve_gallery_email_send(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_gallery_email_send(uuid, uuid, uuid)
  to authenticated;

-- ── 4. The function, held to its exact shape ────────────────────────────────

do $$
declare
  v_fn  regprocedure := to_regprocedure('public.reserve_gallery_email_send(uuid, uuid, uuid)');
  v_n   integer;
begin
  select count(*) into v_n
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'reserve_gallery_email_send';
  if v_fn is null or v_n <> 1 then
    raise exception 'public.reserve_gallery_email_send must exist exactly once (found %)', v_n using errcode = '42710';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
     where p.oid = v_fn
       and p.prosecdef
       and p.provolatile = 'v'
       and p.prorettype = 'text'::regtype
       and p.prolang = (select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql')
       and p.proconfig is not null
       and pg_catalog.cardinality(p.proconfig) = 2
       and p.proconfig @> array['search_path=""', 'lock_timeout=5s']
  ) then
    raise exception 'reserve_gallery_email_send does not have the attributes defined' using errcode = '42P17';
  end if;

  -- ACL: the owner's EXECUTE and authenticated's EXECUTE, nothing else; no
  -- grant option; no PUBLIC entry (a NULL proacl would mean PUBLIC EXECUTE).
  if (select p.proacl from pg_catalog.pg_proc p where p.oid = v_fn) is null
     or exists (select 1 from pg_catalog.pg_proc p, lateral pg_catalog.aclexplode(p.proacl) x
                 where p.oid = v_fn
                   and (x.privilege_type <> 'EXECUTE'
                        or x.is_grantable
                        or x.grantee not in (p.proowner, 'authenticated'::regrole::oid)))
     or not exists (select 1 from pg_catalog.pg_proc p, lateral pg_catalog.aclexplode(p.proacl) x
                     where p.oid = v_fn and x.grantee = 'authenticated'::regrole::oid) then
    raise exception 'reserve_gallery_email_send has another ACL' using errcode = '42P17';
  end if;

  if pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'reserve_gallery_email_send: effective EXECUTE is not authenticated-only' using errcode = '42P17';
  end if;

  -- And no application role reaches the table by any route.
  if pg_catalog.has_table_privilege('anon', 'public.gallery_email_send_attempts', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or pg_catalog.has_table_privilege('authenticated', 'public.gallery_email_send_attempts', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or pg_catalog.has_table_privilege('service_role', 'public.gallery_email_send_attempts', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception 'an application role holds a privilege on gallery_email_send_attempts' using errcode = '42P17';
  end if;
end $$;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Roll the application back FIRST (an application that calls a missing
-- function must refuse to send, by the contract above — which is safe, but it
-- means no gallery email can be sent until it is rolled back too). Then, under
-- its own approval:
--
--   begin;
--   drop function if exists public.reserve_gallery_email_send(uuid, uuid, uuid);
--   drop table if exists public.gallery_email_send_attempts;
--   commit;
--
-- Dropping the table discards only rate-limit counters, each at most an hour
-- old; no photographer or client data lives in it.
