-- Proof that the durable gallery-email send limit holds. Run AFTER
-- db/migrations/2026-11-22_gallery_email_send_limits.sql, on a scratch
-- database carrying db/test-fixture.sql:
--
--   node scripts/p4-local-db.mjs sql \
--     db/migrations/2026-11-22_gallery_email_send_limits.sql \
--     db/migrations/2026-11-22_gallery_email_send_limits.sql \
--     db/verify-gallery-email-limits.sql
--
-- Same shape as db/verify-draft.sql: everything happens inside one
-- transaction that ALWAYS ends by raising, so the report is the exception
-- message and nothing is kept. Every site, account, gallery, client and
-- address below is synthetic (`.invalid`), created and rolled back here.
--
-- What it checks, in plain terms:
--   1. Only an editor of the site (or a platform admin) can reserve a send;
--      anon and service_role are refused by the function's ACL, everybody
--      else by the function's own tenant rule — and each refusal is asserted
--      by WHICH layer gave it, and writes nothing.
--   2. Nobody reaches the table directly: every application role is refused
--      by privilege (not by an empty result).
--   3. The recipient comes from the client row on this site's shared gallery;
--      a client or gallery of another site, or an unshared one, is refused.
--   4. 3 per recipient per site per hour, by ADDRESS (two contacts with the
--      same address share a budget), and per site (the same address on
--      another site has its own).
--   5. 30 per site per hour; the site limit is checked first.
--   6. The window slides; a site's expired rows are deleted by its own calls
--      and never another site's.
--   7. No plaintext address is stored; the hash is the documented derivation.
--   8. Deleting a site removes its rows.
--
-- NOT covered here (they need more than one transaction): concurrency, the
-- READ COMMITTED guard and lock_timeout — see .mk/gallery-email-limits-db.ts.

begin;

create temp table gel_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

create function pg_temp.ok(p_step text, p_expected text, p_actual text, p_pass boolean)
returns void language sql as $f$
  insert into gel_res (step, expected, actual, pass) values (p_step, p_expected, p_actual, p_pass);
$f$;

-- A call to the function as a real role with a fake JWT `sub`. Returns the
-- function's answer, or ERR:<sqlstate>:<message> — the message says which
-- layer refused ("permission denied for function" is the ACL; "That is not
-- your site." is the function's own rule).
create function pg_temp.call_as(p_role text, p_sub uuid, p_tenant uuid, p_album uuid, p_client uuid)
returns text language plpgsql as $f$
declare
  v text;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('sub', p_sub, 'role', p_role)::text end, true);
  begin
    execute format('set local role %I', p_role);
    v := public.reserve_gallery_email_send(p_tenant, p_album, p_client);
    execute 'reset role';
  exception when others then
    v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;

-- A statement as a real role: ok:<rows> or ERR:<sqlstate>:<message>.
create function pg_temp.probe(p_role text, p_sql text)
returns text language plpgsql as $f$
declare
  v text;
  n bigint;
begin
  begin
    execute format('set local role %I', p_role);
    execute p_sql;
    get diagnostics n = row_count;
    execute 'reset role';
    v := 'ok:' || n;
  exception when others then
    v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  return v;
end $f$;

create function pg_temp.ca(n int) returns uuid language sql immutable as $f$
  select ('e3a00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$f$;

create function pg_temp.rows_of(p_tenant uuid) returns int language sql as $f$
  select count(*)::int from public.gallery_email_send_attempts where tenant_id = p_tenant
$f$;

-- ── 0. Synthetic sites, accounts, galleries and clients ─────────────────────
--
--   TA  e0a0…  site A          TB  e0b0…  site B          TX e0f0… (no such site)
--   UA  e1a0…  editor on A     UB  e1b0…  editor on B
--   UADM e1ad… profile on B, platform admin (flag toggled below)
--   UNOP e100… signed in, no profile
--   AA  e2a0…01 A's gallery, shared with CA01..CA12 and CADUP
--   AA2 e2a0…02 A's gallery, shared with nobody
--   AB  e2b0…01 B's gallery, shared with CB1
--   CA01..CA12  recipient<n>@example.invalid on A
--   CADUP       '  RECIPIENT1@Example.INVALID ' on A — CA01's address, another contact
--   CAUNS       unshared@example.invalid on A, not shared with AA
--   CB1         recipient1@example.invalid on B — CA01's address, another site

do $$
begin
  insert into public.tenants (id, name, domain) values
    ('e0a00000-0000-4000-8000-000000000001', 'GEL site A — rolled back', 'gel-a.invalid'),
    ('e0b00000-0000-4000-8000-000000000001', 'GEL site B — rolled back', 'gel-b.invalid');

  insert into auth.users (id) values
    ('e1a00000-0000-4000-8000-000000000001'),
    ('e1b00000-0000-4000-8000-000000000001'),
    ('e1ad0000-0000-4000-8000-000000000001'),
    ('e1000000-0000-4000-8000-000000000000');

  insert into public.profiles (id, tenant_id, email, role, is_platform_admin) values
    ('e1a00000-0000-4000-8000-000000000001', 'e0a00000-0000-4000-8000-000000000001', 'editor-a@example.invalid', 'editor', false),
    ('e1b00000-0000-4000-8000-000000000001', 'e0b00000-0000-4000-8000-000000000001', 'editor-b@example.invalid', 'owner',  false),
    ('e1ad0000-0000-4000-8000-000000000001', 'e0b00000-0000-4000-8000-000000000001', 'admin@example.invalid',    'editor', false);

  insert into public.albums (id, tenant_id, title, slug) values
    ('e2a00000-0000-4000-8000-000000000001', 'e0a00000-0000-4000-8000-000000000001', 'GEL A', 'gel-a'),
    ('e2a00000-0000-4000-8000-000000000002', 'e0a00000-0000-4000-8000-000000000001', 'GEL A2', 'gel-a2'),
    ('e2b00000-0000-4000-8000-000000000001', 'e0b00000-0000-4000-8000-000000000001', 'GEL B', 'gel-b');

  insert into public.clients (id, tenant_id, name, email)
  select pg_temp.ca(n), 'e0a00000-0000-4000-8000-000000000001', 'Client ' || n, 'recipient' || n || '@example.invalid'
    from generate_series(1, 12) n;
  insert into public.clients (id, tenant_id, name, email) values
    ('e3a00000-0000-4000-8000-0000000000d1', 'e0a00000-0000-4000-8000-000000000001', 'Duplicate', '  RECIPIENT1@Example.INVALID '),
    ('e3a00000-0000-4000-8000-0000000000e1', 'e0a00000-0000-4000-8000-000000000001', 'Unshared',  'unshared@example.invalid'),
    ('e3b00000-0000-4000-8000-000000000001', 'e0b00000-0000-4000-8000-000000000001', 'Client B',  'recipient1@example.invalid');

  insert into public.album_clients (album_id, client_id)
  select 'e2a00000-0000-4000-8000-000000000001', pg_temp.ca(n) from generate_series(1, 12) n;
  insert into public.album_clients (album_id, client_id) values
    ('e2a00000-0000-4000-8000-000000000001', 'e3a00000-0000-4000-8000-0000000000d1'),
    ('e2b00000-0000-4000-8000-000000000001', 'e3b00000-0000-4000-8000-000000000001');
end $$;


-- ── 1. The catalogue, asserted independently of the migration's own checks ──

do $$
declare
  v_fn regprocedure := to_regprocedure('public.reserve_gallery_email_send(uuid, uuid, uuid)');
  v_n  int;
begin
  perform pg_temp.ok('function is SECURITY DEFINER', 'true',
    (select prosecdef::text from pg_proc where oid = v_fn),
    (select prosecdef from pg_proc where oid = v_fn));
  perform pg_temp.ok('function config', 'search_path="", lock_timeout=5s',
    (select array_to_string(proconfig, ', ') from pg_proc where oid = v_fn),
    (select proconfig @> array['search_path=""', 'lock_timeout=5s'] and cardinality(proconfig) = 2 from pg_proc where oid = v_fn));
  perform pg_temp.ok('EXECUTE: anon / service_role / authenticated', 'f/f/t',
    has_function_privilege('anon', v_fn, 'EXECUTE')::text || '/' ||
    has_function_privilege('service_role', v_fn, 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', v_fn, 'EXECUTE')::text,
    not has_function_privilege('anon', v_fn, 'EXECUTE')
    and not has_function_privilege('service_role', v_fn, 'EXECUTE')
    and has_function_privilege('authenticated', v_fn, 'EXECUTE'));
  select count(*) into v_n from pg_proc p, lateral aclexplode(p.proacl) x where p.oid = v_fn and x.grantee = 0;
  perform pg_temp.ok('no PUBLIC EXECUTE entry', '0', v_n::text,
    v_n = 0 and (select proacl is not null from pg_proc where oid = v_fn));

  perform pg_temp.ok('table RLS on, no policy', 'true/0',
    (select relrowsecurity::text from pg_class where oid = 'public.gallery_email_send_attempts'::regclass) || '/' ||
    (select count(*)::text from pg_policy where polrelid = 'public.gallery_email_send_attempts'::regclass),
    (select relrowsecurity from pg_class where oid = 'public.gallery_email_send_attempts'::regclass)
    and (select count(*) from pg_policy where polrelid = 'public.gallery_email_send_attempts'::regclass) = 0);
  select count(*) into v_n
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
   where c.oid = 'public.gallery_email_send_attempts'::regclass and x.grantee <> c.relowner;
  perform pg_temp.ok('table ACL: owner only', '0 other entries', v_n || ' other entries', v_n = 0);
  perform pg_temp.ok('tenant key cascades', 'c',
    (select confdeltype::text from pg_constraint where conname = 'gallery_email_send_attempts_tenant_fk'),
    (select confdeltype = 'c' from pg_constraint where conname = 'gallery_email_send_attempts_tenant_fk'));
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'gallery_email_send_attempts'
     and data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'citext');
  perform pg_temp.ok('no column can hold a plaintext address', '0 text columns', v_n || ' text columns', v_n = 0);
end $$;


-- ── 2. Who may call it — and which layer refuses ────────────────────────────

do $$
declare
  TA  constant uuid := 'e0a00000-0000-4000-8000-000000000001';
  TB  constant uuid := 'e0b00000-0000-4000-8000-000000000001';
  TX  constant uuid := 'e0f00000-0000-4000-8000-000000000001';
  UA  constant uuid := 'e1a00000-0000-4000-8000-000000000001';
  UB  constant uuid := 'e1b00000-0000-4000-8000-000000000001';
  UADM constant uuid := 'e1ad0000-0000-4000-8000-000000000001';
  UNOP constant uuid := 'e1000000-0000-4000-8000-000000000000';
  AA  constant uuid := 'e2a00000-0000-4000-8000-000000000001';
  AB  constant uuid := 'e2b00000-0000-4000-8000-000000000001';
  CB1 constant uuid := 'e3b00000-0000-4000-8000-000000000001';
  v   text;
begin
  v := pg_temp.call_as('anon', UA, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('anon: refused by the ACL', 'permission denied for function', v,
    v like 'ERR:42501:permission denied for function%');

  v := pg_temp.call_as('service_role', UA, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('service_role: refused by the ACL', 'permission denied for function', v,
    v like 'ERR:42501:permission denied for function%');

  v := pg_temp.call_as('authenticated', null, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('no identity: the tenant rule', 'not your site', v, v = 'ERR:42501:That is not your site.');

  v := pg_temp.call_as('authenticated', UNOP, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('no profile: the tenant rule', 'not your site', v, v = 'ERR:42501:That is not your site.');

  v := pg_temp.call_as('authenticated', UB, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('editor of B on A: refused', 'not your site', v, v = 'ERR:42501:That is not your site.');

  v := pg_temp.call_as('authenticated', UA, TB, AB, CB1);
  perform pg_temp.ok('editor of A on B: refused', 'not your site', v, v = 'ERR:42501:That is not your site.');

  v := pg_temp.call_as('authenticated', UA, TX, AA, pg_temp.ca(1));
  perform pg_temp.ok('no such site: refused', 'not your site', v, v = 'ERR:42501:That is not your site.');

  v := pg_temp.call_as('authenticated', UADM, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('admin flag off, profile on B: refused', 'not your site', v, v = 'ERR:42501:That is not your site.');

  -- A non-editing role. profiles_role_check admits only owner/editor today, so
  -- the check is dropped INSIDE this rolled-back transaction to show the
  -- function's own role list refuses one if the check ever widens.
  alter table public.profiles drop constraint profiles_role_check;
  update public.profiles set role = 'viewer' where id = UA;
  v := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('non-editing role: refused', 'not your site', v, v = 'ERR:42501:That is not your site.');
  update public.profiles set role = 'editor' where id = UA;

  v := pg_temp.call_as('authenticated', UA, null, AA, pg_temp.ca(1));
  perform pg_temp.ok('missing site argument', '22023', v, v like 'ERR:22023:%');
  v := pg_temp.call_as('authenticated', UA, TA, AA, null);
  perform pg_temp.ok('missing client argument', '22023', v, v like 'ERR:22023:%');

  perform pg_temp.ok('refusals wrote nothing', '0/0',
    pg_temp.rows_of(TA) || '/' || pg_temp.rows_of(TB), pg_temp.rows_of(TA) = 0 and pg_temp.rows_of(TB) = 0);
end $$;


-- ── 3. Nobody reaches the table directly ────────────────────────────────────

do $$
declare
  r text;
  v text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    v := pg_temp.probe(r, 'select * from public.gallery_email_send_attempts');
    perform pg_temp.ok(r || ' cannot SELECT', 'permission denied for table', v,
      v like 'ERR:42501:permission denied for table%');
    v := pg_temp.probe(r, $q$insert into public.gallery_email_send_attempts (tenant_id, recipient_hash, attempted_at)
                            values ('e0a00000-0000-4000-8000-000000000001', sha256('x'::bytea), now())$q$);
    perform pg_temp.ok(r || ' cannot INSERT', 'permission denied for table', v,
      v like 'ERR:42501:permission denied for table%');
    v := pg_temp.probe(r, 'delete from public.gallery_email_send_attempts');
    perform pg_temp.ok(r || ' cannot DELETE', 'permission denied for table', v,
      v like 'ERR:42501:permission denied for table%');
  end loop;
end $$;


-- ── 4. The recipient is this site's shared client ───────────────────────────

do $$
declare
  TA  constant uuid := 'e0a00000-0000-4000-8000-000000000001';
  UA  constant uuid := 'e1a00000-0000-4000-8000-000000000001';
  AA  constant uuid := 'e2a00000-0000-4000-8000-000000000001';
  AA2 constant uuid := 'e2a00000-0000-4000-8000-000000000002';
  AB  constant uuid := 'e2b00000-0000-4000-8000-000000000001';
  CB1 constant uuid := 'e3b00000-0000-4000-8000-000000000001';
  CAUNS constant uuid := 'e3a00000-0000-4000-8000-0000000000e1';
  c_nf constant text := 'ERR:42501:That client could not be found on this gallery.';
  v   text;
begin
  v := pg_temp.call_as('authenticated', UA, TA, AB, pg_temp.ca(1));
  perform pg_temp.ok('another site''s gallery', 'not found', v, v = c_nf);
  v := pg_temp.call_as('authenticated', UA, TA, AA, CB1);
  perform pg_temp.ok('another site''s client', 'not found', v, v = c_nf);
  v := pg_temp.call_as('authenticated', UA, TA, AA, CAUNS);
  perform pg_temp.ok('client not shared with the gallery', 'not found', v, v = c_nf);
  v := pg_temp.call_as('authenticated', UA, TA, AA2, pg_temp.ca(1));
  perform pg_temp.ok('gallery not shared with the client', 'not found', v, v = c_nf);
  perform pg_temp.ok('still nothing written', '0', pg_temp.rows_of(TA)::text, pg_temp.rows_of(TA) = 0);
end $$;


-- ── 5. Three per recipient per site, by address ─────────────────────────────

do $$
declare
  TA  constant uuid := 'e0a00000-0000-4000-8000-000000000001';
  TB  constant uuid := 'e0b00000-0000-4000-8000-000000000001';
  UA  constant uuid := 'e1a00000-0000-4000-8000-000000000001';
  UB  constant uuid := 'e1b00000-0000-4000-8000-000000000001';
  AA  constant uuid := 'e2a00000-0000-4000-8000-000000000001';
  AB  constant uuid := 'e2b00000-0000-4000-8000-000000000001';
  CB1 constant uuid := 'e3b00000-0000-4000-8000-000000000001';
  CADUP constant uuid := 'e3a00000-0000-4000-8000-0000000000d1';
  v   text;
  got text := '';
  v_want bytea;
begin
  for i in 1..3 loop
    got := got || pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(1)) || ' ';
  end loop;
  perform pg_temp.ok('first three to one recipient', 'reserved x3', btrim(got),
    btrim(got) = 'reserved reserved reserved');

  v := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('fourth to that recipient', 'recipient_limited', v, v = 'recipient_limited');

  v := pg_temp.call_as('authenticated', UA, TA, AA, CADUP);
  perform pg_temp.ok('same address, other contact', 'recipient_limited', v, v = 'recipient_limited');

  v := pg_temp.call_as('authenticated', UB, TB, AB, CB1);
  perform pg_temp.ok('same address on another site', 'reserved', v, v = 'reserved');

  perform pg_temp.ok('rows: A / B', '3/1',
    pg_temp.rows_of(TA) || '/' || pg_temp.rows_of(TB), pg_temp.rows_of(TA) = 3 and pg_temp.rows_of(TB) = 1);

  -- The documented derivation, and nothing plaintext.
  v_want := sha256(convert_to(TA::text || ':' || 'recipient1@example.invalid', 'UTF8'));
  perform pg_temp.ok('hash = sha256(site:normalised address)', '3 rows match',
    (select count(*) from public.gallery_email_send_attempts where tenant_id = TA and recipient_hash = v_want) || ' rows match',
    (select count(*) from public.gallery_email_send_attempts where tenant_id = TA and recipient_hash = v_want) = 3);
  perform pg_temp.ok('site B''s hash for the same address differs', 'differs',
    case when (select recipient_hash from public.gallery_email_send_attempts where tenant_id = TB) <> v_want then 'differs' else 'equal' end,
    (select recipient_hash from public.gallery_email_send_attempts where tenant_id = TB) <> v_want);
  perform pg_temp.ok('no row stores the address bytes', '0',
    (select count(*) from public.gallery_email_send_attempts
      where recipient_hash in (convert_to('recipient1@example.invalid', 'UTF8'),
                               sha256(convert_to('recipient1@example.invalid', 'UTF8'))))::text,
    (select count(*) from public.gallery_email_send_attempts
      where recipient_hash in (convert_to('recipient1@example.invalid', 'UTF8'),
                               sha256(convert_to('recipient1@example.invalid', 'UTF8')))) = 0);
end $$;


-- ── 6. Thirty per site; the site limit first ────────────────────────────────

do $$
declare
  TA  constant uuid := 'e0a00000-0000-4000-8000-000000000001';
  TB  constant uuid := 'e0b00000-0000-4000-8000-000000000001';
  UA  constant uuid := 'e1a00000-0000-4000-8000-000000000001';
  UB  constant uuid := 'e1b00000-0000-4000-8000-000000000001';
  AA  constant uuid := 'e2a00000-0000-4000-8000-000000000001';
  AB  constant uuid := 'e2b00000-0000-4000-8000-000000000001';
  CB1 constant uuid := 'e3b00000-0000-4000-8000-000000000001';
  n_ok int := 0;
  v   text;
begin
  for c in 2..10 loop
    for i in 1..3 loop
      if pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(c)) = 'reserved' then n_ok := n_ok + 1; end if;
    end loop;
  end loop;
  perform pg_temp.ok('27 more across nine recipients', '27 reserved', n_ok || ' reserved', n_ok = 27);
  perform pg_temp.ok('site A holds 30', '30', pg_temp.rows_of(TA)::text, pg_temp.rows_of(TA) = 30);

  v := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(11));
  perform pg_temp.ok('31st, fresh recipient', 'site_limited', v, v = 'site_limited');
  v := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('31st, exhausted recipient: site first', 'site_limited', v, v = 'site_limited');
  perform pg_temp.ok('site A still 30', '30', pg_temp.rows_of(TA)::text, pg_temp.rows_of(TA) = 30);

  v := pg_temp.call_as('authenticated', UB, TB, AB, CB1);
  perform pg_temp.ok('site B unaffected by A''s limit', 'reserved', v, v = 'reserved');
end $$;


-- ── 7. The window slides; retention is per site ─────────────────────────────

do $$
declare
  TA  constant uuid := 'e0a00000-0000-4000-8000-000000000001';
  TB  constant uuid := 'e0b00000-0000-4000-8000-000000000001';
  UA  constant uuid := 'e1a00000-0000-4000-8000-000000000001';
  AA  constant uuid := 'e2a00000-0000-4000-8000-000000000001';
  v   text;
  n_b int;
begin
  -- 59 minutes old: still inside the hour.
  update public.gallery_email_send_attempts
     set attempted_at = clock_timestamp() - interval '59 minutes' where tenant_id = TA;
  v := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(11));
  perform pg_temp.ok('59-minute-old rows still count', 'site_limited', v, v = 'site_limited');
  perform pg_temp.ok('and are not pruned', '30', pg_temp.rows_of(TA)::text, pg_temp.rows_of(TA) = 30);

  -- Another site's long-expired row, which A's calls must never touch.
  insert into public.gallery_email_send_attempts (tenant_id, recipient_hash, attempted_at)
  values (TB, sha256('gel-stale'::bytea), clock_timestamp() - interval '2 hours');
  n_b := pg_temp.rows_of(TB);

  -- 61 minutes old: outside the hour.
  update public.gallery_email_send_attempts
     set attempted_at = clock_timestamp() - interval '61 minutes' where tenant_id = TA;
  v := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(11));
  perform pg_temp.ok('expired rows free the budget', 'reserved', v, v = 'reserved');
  perform pg_temp.ok('A''s expired rows pruned by A''s call', '1', pg_temp.rows_of(TA)::text, pg_temp.rows_of(TA) = 1);
  perform pg_temp.ok('B''s rows untouched by A''s call', n_b::text, pg_temp.rows_of(TB)::text, pg_temp.rows_of(TB) = n_b);
end $$;


-- ── 8. A platform admin passes, as everywhere ───────────────────────────────

do $$
declare
  TA  constant uuid := 'e0a00000-0000-4000-8000-000000000001';
  UADM constant uuid := 'e1ad0000-0000-4000-8000-000000000001';
  AA  constant uuid := 'e2a00000-0000-4000-8000-000000000001';
  v   text;
begin
  update public.profiles set is_platform_admin = true where id = UADM;
  v := pg_temp.call_as('authenticated', UADM, TA, AA, pg_temp.ca(12));
  perform pg_temp.ok('platform admin on another site', 'reserved', v, v = 'reserved');
  update public.profiles set is_platform_admin = false where id = UADM;
end $$;


-- ── 9. Deleting a site removes its rows ─────────────────────────────────────

do $$
declare
  TB  constant uuid := 'e0b00000-0000-4000-8000-000000000001';
  n_before int := pg_temp.rows_of(TB);
begin
  delete from public.album_clients where album_id in (select id from public.albums where tenant_id = TB);
  delete from public.albums   where tenant_id = TB;
  delete from public.clients  where tenant_id = TB;
  delete from public.profiles where tenant_id = TB;
  delete from public.tenants  where id = TB;
  perform pg_temp.ok('site deleted: its rows go by cascade', n_before || ' -> 0',
    n_before || ' -> ' || pg_temp.rows_of(TB), n_before > 0 and pg_temp.rows_of(TB) = 0);
end $$;


-- ── Report, then abort ──────────────────────────────────────────────────────

do $$
declare
  report text := '';
  r      record;
  failed int;
  total  int;
begin
  for r in select * from gel_res order by ord loop
    report := report || chr(10) ||
      case when coalesce(r.pass, false) then '  PASS  ' else '  FAIL  ' end ||
      rpad(r.step, 46) || ' expected ' || rpad(r.expected, 30) || ' got ' || coalesce(r.actual, '(null)');
  end loop;

  select count(*) filter (where not coalesce(pass, false)), count(*) into failed, total from gel_res;

  raise exception e'Gallery email send limits — ROLLED BACK, nothing was kept.\n%',
    report || chr(10) || chr(10) ||
    case when failed = 0
      then 'All ' || total || ' checks passed.'
      else failed::text || ' of ' || total || ' CHECK(S) FAILED.'
    end;
end $$;

rollback;
