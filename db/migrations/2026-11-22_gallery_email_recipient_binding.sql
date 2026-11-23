-- ════════════════════════════════════════════════════════════════════════════
-- 2026-11-22 — Client gallery v2: bind the sent recipient to the reserved one
--
-- CANDIDATE — NOT DEPLOYED. A FORWARD correction of
-- db/migrations/2026-11-22_gallery_email_send_limits.sql (Supabase
-- 20261123001300, sha256 6460b642…26a0), which stays byte-for-byte as
-- deployed and is never edited.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- reserve_gallery_email_send() reads the client's address ITSELF and charges a
-- reservation to that address, but answers only 'reserved'. The application
-- then sends to an address it read on its own. Reading the client before and
-- after the call does not close the gap: with concurrent edits A → B → A, the
-- function can reserve B while both application reads see A, and the provider
-- is then called for A on B's reservation. Work's review of the first
-- migration names the same condition ("agreement between the normalized
-- address reserved and the recipient actually sent to").
--
-- ── What it changes — one expression ────────────────────────────────────────
-- The function's final line,
--     return 'reserved';
-- becomes
--     return 'reserved:' || pg_catalog.encode(v_hash, 'hex');
-- v_hash is the very value the same call inserted as the reservation's
-- recipient_hash: sha256(utf8(<tenant id> || ':' || lower(btrim(email)))),
-- computed once, from the one read of the client row the reservation was
-- charged on. So the answer names exactly the recipient that was charged.
--
-- Nothing else changes: the signature (uuid, uuid, uuid) → text and its
-- parameter names; SECURITY DEFINER, VOLATILE, search_path = '', lock_timeout
-- 5s; the owner; EXECUTE to authenticated only; the authorisation rule, the
-- client/gallery/share binding, the READ COMMITTED guard, the advisory lock,
-- retention, the 30-per-site and 3-per-recipient limits, every refusal's
-- SQLSTATE and message, and 'site_limited' / 'recipient_limited' verbatim
-- (they carry no hash). The table, its index, RLS and privileges are not
-- touched. This file checks all of that rather than asserting it (below).
--
-- ── The contract it gives the application (app code NOT in this change) ────
--   answer = 'reserved:' + 64 lowercase hex          → reserved; compare the hex
--                                                     with sha256hex(utf8(
--                                                     tenantId + ':' + the
--                                                     normalised address about
--                                                     to be sent to)); send ONLY
--                                                     on equality
--   answer = 'site_limited' | 'recipient_limited'    → no send
--   anything else, an error, a timeout               → no send
-- A bare 'reserved' is no longer returned. An application still written for
-- it ("send only on exactly 'reserved'") therefore refuses to send against
-- this function — it fails closed, never open. (Checked 2026-11-22: no code in
-- the working tree calls this function yet; lib/gallery-email-send.ts still
-- uses its in-memory limiter.)
--
-- A mismatch spends one reservation and sends nothing — the conservative
-- reading the first migration already takes for a failed provider call.
--
-- ── What the answer discloses ───────────────────────────────────────────────
-- Only to a caller who passed the function's own editor-of-this-site (or
-- platform admin) rule and named a client shared with this site's gallery —
-- someone who can already read that client's address. It is the same
-- pseudonymous, unsalted, tenant-keyed hash the table stores (its known
-- weakness is recorded in the first migration and in Work's review); it is
-- not an address, and no address is returned, stored or logged.
--
-- ── Collision and drift checks ──────────────────────────────────────────────
-- Before replacing anything, the existing objects are held to the shape the
-- first migration deployed — the table (columns, constraints, indexes, RLS, no
-- policy, no trigger, owner-only ACL) and the function (exactly one overload,
-- its signature, parameter names, attributes, config, its owner being the
-- table's owner, its exact ACL) — and the function's BODY must be EITHER the
-- deployed text (first run) OR that text with the one substitution above (a
-- re-run). The deployed text is carried below as a literal and the corrected
-- text is DERIVED from it by that single replace(), so the "one expression"
-- claim is itself checked. Any other body, owner, attribute or ACL refuses
-- (42P17 / 42710) and the transaction rolls back, changing nothing: drift is
-- investigated, never silently overwritten (Work's review, finding 7).
-- Carriage returns are ignored in the comparison (a CRLF checkout of either
-- file); nothing in the body carries a CR inside a literal.
--
-- ── Safe to run twice ───────────────────────────────────────────────────────
-- A second run finds the corrected body, re-installs it unchanged, re-states
-- the same ACL, and passes the same read-back.
-- ════════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = public, pg_catalog;

-- ── 0. The deployed body, and the corrected body derived from it ────────────
-- Copied from 2026-11-22_gallery_email_send_limits.sql, §3, between its
-- dollar quotes; the leading newline and the trailing 'end ' are part of it.

select pg_catalog.set_config('gel_fix.deployed_md5',
         pg_catalog.md5(pg_catalog.convert_to(pg_catalog.replace(b, E'\r', ''), 'UTF8')), true),
       pg_catalog.set_config('gel_fix.corrected_md5',
         pg_catalog.md5(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.replace(b, E'\r', ''),
           E'\n  return ''reserved'';\nend ',
           E'\n  return ''reserved:'' || pg_catalog.encode(v_hash, ''hex'');\nend '), 'UTF8')), true),
       pg_catalog.set_config('gel_fix.substitutions',
         ((pg_catalog.length(pg_catalog.replace(b, E'\r', ''))
           - pg_catalog.length(pg_catalog.replace(pg_catalog.replace(b, E'\r', ''), E'\n  return ''reserved'';\nend ', '')))
          / pg_catalog.length(E'\n  return ''reserved'';\nend '))::text, true)
  from (select $deployed$
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
end $deployed$::text as b) s;

-- ── 1. Preconditions: the table and the function as deployed ────────────────

do $$
declare
  v_rel   regclass := to_regclass('public.gallery_email_send_attempts');
  v_fn    regprocedure := to_regprocedure('public.reserve_gallery_email_send(uuid, uuid, uuid)');
  v_kind  "char";
  v_cols  text;
  v_cons  text;
  v_n     integer;
  v_body  text;
begin
  -- The derivation itself: exactly one occurrence of the line being replaced.
  if current_setting('gel_fix.substitutions') is distinct from '1' then
    raise exception 'the deployed body literal must contain the replaced line exactly once (found %)',
      current_setting('gel_fix.substitutions') using errcode = '42P17';
  end if;

  -- The table.
  select c.relkind into v_kind from pg_class c where c.oid = v_rel;
  if v_rel is null or v_kind is distinct from 'r' then
    raise exception 'public.gallery_email_send_attempts is missing or not an ordinary table' using errcode = '42P17';
  end if;

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
    raise exception 'gallery_email_send_attempts has drifted: %', v_cols using errcode = '42710';
  end if;

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

  if not exists (select 1 from pg_class c where c.oid = v_rel and c.relrowsecurity and not c.relforcerowsecurity)
     or exists (select 1 from pg_policy p where p.polrelid = v_rel)
     or exists (select 1 from pg_trigger t where t.tgrelid = v_rel and not t.tgisinternal)
     or exists (select 1
                  from pg_class c,
                       lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
                 where c.oid = v_rel and x.grantee <> c.relowner) then
    raise exception 'gallery_email_send_attempts: RLS, policies, triggers or ACL have drifted' using errcode = '42P17';
  end if;

  -- The function: exactly one, with the deployed signature and attributes,
  -- owned by the table's owner.
  select count(*) into v_n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'reserve_gallery_email_send';
  if v_fn is null or v_n <> 1 then
    raise exception 'public.reserve_gallery_email_send(uuid, uuid, uuid) must exist exactly once (found %)', v_n using errcode = '42710';
  end if;

  if not exists (
    select 1 from pg_proc p
     where p.oid = v_fn
       and p.prokind = 'f'
       and p.prosecdef
       and p.provolatile = 'v'
       and not p.proretset
       and not p.proisstrict
       and not p.proleakproof
       and p.prorettype = 'text'::regtype
       and p.proargnames = array['p_tenant', 'p_album', 'p_client']
       and p.proargmodes is null
       and p.pronargdefaults = 0
       and p.prolang = (select l.oid from pg_language l where l.lanname = 'plpgsql')
       and p.proconfig is not null
       and cardinality(p.proconfig) = 2
       and p.proconfig @> array['search_path=""', 'lock_timeout=5s']
       and p.proowner = (select c.relowner from pg_class c where c.oid = v_rel)
  ) then
    raise exception 'reserve_gallery_email_send has drifted from its deployed signature, attributes or owner' using errcode = '42P17';
  end if;

  if (select p.proacl from pg_proc p where p.oid = v_fn) is null
     or exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) x
                 where p.oid = v_fn
                   and (x.privilege_type <> 'EXECUTE'
                        or x.is_grantable
                        or x.grantee not in (p.proowner, 'authenticated'::regrole::oid)))
     or not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) x
                     where p.oid = v_fn and x.grantee = 'authenticated'::regrole::oid) then
    raise exception 'reserve_gallery_email_send has another ACL than deployed' using errcode = '42P17';
  end if;

  -- The body: the deployed text, or (a re-run) the corrected text. Nothing else.
  select pg_catalog.md5(pg_catalog.convert_to(pg_catalog.replace(p.prosrc, E'\r', ''), 'UTF8'))
    into v_body from pg_proc p where p.oid = v_fn;
  if v_body is distinct from current_setting('gel_fix.deployed_md5')
     and v_body is distinct from current_setting('gel_fix.corrected_md5') then
    raise exception 'reserve_gallery_email_send body is neither the deployed nor the corrected text (md5 %); investigate, nothing changed', v_body
      using errcode = '42P17';
  end if;

  perform set_config('gel_fix.owner', (select p.proowner::text from pg_proc p where p.oid = v_fn), true);
end $$;

-- Indexes: exactly the primary key's and the deployed one, compared as the
-- deployed file compares them — `public` off the path, so the definitions are
-- written in full (public.gallery_email_send_attempts) whatever the caller's
-- path was. The path is put back for everything after.
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

set local search_path = public, pg_catalog;

-- ── 2. The correction ───────────────────────────────────────────────────────
-- The deployed function with its final line changed, and nothing else.
-- CREATE OR REPLACE keeps the owner and the ACL; the ACL is re-stated anyway.

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
  return 'reserved:' || pg_catalog.encode(v_hash, 'hex');
end $$;

revoke all on function public.reserve_gallery_email_send(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_gallery_email_send(uuid, uuid, uuid)
  to authenticated;

-- ── 3. Read-back: the corrected function, and nothing else moved ────────────

do $$
declare
  v_fn  regprocedure := to_regprocedure('public.reserve_gallery_email_send(uuid, uuid, uuid)');
  v_n   integer;
begin
  select count(*) into v_n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'reserve_gallery_email_send';
  if v_fn is null or v_n <> 1 then
    raise exception 'public.reserve_gallery_email_send must exist exactly once (found %)', v_n using errcode = '42710';
  end if;

  -- The installed body is exactly the derived corrected text.
  if (select pg_catalog.md5(pg_catalog.convert_to(pg_catalog.replace(p.prosrc, E'\r', ''), 'UTF8'))
        from pg_proc p where p.oid = v_fn) is distinct from current_setting('gel_fix.corrected_md5') then
    raise exception 'the installed body is not the deployed body with its one substitution' using errcode = '42P17';
  end if;

  if not exists (
    select 1 from pg_proc p
     where p.oid = v_fn
       and p.prokind = 'f'
       and p.prosecdef
       and p.provolatile = 'v'
       and not p.proretset
       and not p.proisstrict
       and not p.proleakproof
       and p.prorettype = 'text'::regtype
       and p.proargnames = array['p_tenant', 'p_album', 'p_client']
       and p.proargmodes is null
       and p.pronargdefaults = 0
       and cardinality(p.proconfig) = 2
       and p.proconfig @> array['search_path=""', 'lock_timeout=5s']
       and p.proowner::text = current_setting('gel_fix.owner')
  ) then
    raise exception 'reserve_gallery_email_send lost a deployed attribute or its owner' using errcode = '42P17';
  end if;

  if (select p.proacl from pg_proc p where p.oid = v_fn) is null
     or exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) x
                 where p.oid = v_fn
                   and (x.privilege_type <> 'EXECUTE'
                        or x.is_grantable
                        or x.grantee not in (p.proowner, 'authenticated'::regrole::oid)))
     or has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('service_role', v_fn, 'EXECUTE')
     or not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'reserve_gallery_email_send: EXECUTE is not authenticated-only' using errcode = '42P17';
  end if;

  if has_table_privilege('anon', 'public.gallery_email_send_attempts', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.gallery_email_send_attempts', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('service_role', 'public.gallery_email_send_attempts', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception 'an application role holds a privilege on gallery_email_send_attempts' using errcode = '42P17';
  end if;
end $$;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Roll the application back FIRST (an application that expects the hash must
-- refuse a bare 'reserved' — safe, but no gallery email is sent until the
-- function is rolled back too, or the application is). Then, under its own
-- approval, re-run 2026-11-22_gallery_email_send_limits.sql as deployed: it is
-- safe to run twice, leaves the table and its rows as they are (CREATE … IF NOT
-- EXISTS; its shape checks pass), re-installs the deployed body with CREATE OR
-- REPLACE (owner kept) and re-states and reads back the same ACL.
