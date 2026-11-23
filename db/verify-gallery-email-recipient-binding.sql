-- Proof that reserve_gallery_email_send() names the recipient it charged.
-- Run AFTER the deployed limiter AND its forward correction, on a scratch
-- database carrying db/test-fixture.sql:
--
--   node scripts/p4-local-db.mjs sql \
--     db/migrations/2026-11-22_gallery_email_send_limits.sql \
--     db/migrations/2026-11-22_gallery_email_recipient_binding.sql \
--     db/migrations/2026-11-22_gallery_email_recipient_binding.sql \
--     db/verify-gallery-email-recipient-binding.sql
--
-- (The harness runs the files in order on one scratch database; the
-- correction runs twice.) Same shape as db/verify-gallery-email-limits.sql:
-- one transaction that ALWAYS ends by raising; every site, account, gallery,
-- client and address is synthetic (`.invalid`) and rolled back.
--
-- db/verify-gallery-email-limits.sql is the PRE-correction contract (it
-- asserts a bare 'reserved') and is left as it was reviewed; it describes the
-- database before this correction and fails after it, by design.
--
-- What it checks:
--   1. Signature, attributes, owner and ACL as deployed; the body returns the
--      hash and never a bare 'reserved'.
--   2. Every refusal keeps its layer, SQLSTATE and message.
--   3. 'reserved:' + 64 lowercase hex, equal to sha256(site:normalised
--      address) AND to the row the same call inserted; no address in it.
--   4. Case and surrounding spaces normalise to the same hash.
--   5. The hash is keyed by the site the reservation is for — another site's
--      hash differs, and a platform admin gets the TARGET site's hash.
--   6. A → B → A: an address changed and changed back around the call is
--      caught only by the returned hash, which names B.
--   7. 'recipient_limited' and 'site_limited' come back verbatim (no hash) and
--      write nothing; the limits are still 3 and 30.
-- The exact hash is ALSO checked against an independent implementation
-- (Node's crypto) in .mk/gallery-email-recipient-binding-db.ts.

begin;

create temp table gerb_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

create function pg_temp.ok(p_step text, p_expected text, p_actual text, p_pass boolean)
returns void language sql as $f$
  insert into gerb_res (step, expected, actual, pass) values (p_step, p_expected, p_actual, p_pass);
$f$;

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

-- The hash an application would compute for the address it is about to send to.
create function pg_temp.want(p_tenant uuid, p_address text) returns text language sql immutable as $f$
  select encode(sha256(convert_to(p_tenant::text || ':' || lower(btrim(p_address)), 'UTF8')), 'hex')
$f$;

create function pg_temp.hex_of(p_answer text) returns text language sql immutable as $f$
  select case when p_answer ~ '^reserved:[0-9a-f]{64}$' then substr(p_answer, 10) end
$f$;

create function pg_temp.ca(n int) returns uuid language sql immutable as $f$
  select ('e3a00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$f$;

create function pg_temp.rows_of(p_tenant uuid) returns int language sql as $f$
  select count(*)::int from public.gallery_email_send_attempts where tenant_id = p_tenant
$f$;

-- ── 0. Synthetic sites, accounts, galleries and clients ─────────────────────
--   TA e0a0… site A · TB e0b0… site B · TX e0f0… no such site
--   UA editor on A · UB owner on B · UADM profile on B, platform admin (toggled)
--   UNOP signed in, no profile
--   AA A's gallery, shared with CA01..CA12, CADUP, CABLANK · AB B's, shared with CB1
--   CADUP '  RECIPIENT1@Example.INVALID ' on A · CABLANK '   ' on A
--   CB1 recipient1@example.invalid on B

do $$
begin
  insert into public.tenants (id, name, domain) values
    ('e0a00000-0000-4000-8000-000000000001', 'GERB site A — rolled back', 'gerb-a.invalid'),
    ('e0b00000-0000-4000-8000-000000000001', 'GERB site B — rolled back', 'gerb-b.invalid');

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
    ('e2a00000-0000-4000-8000-000000000001', 'e0a00000-0000-4000-8000-000000000001', 'GERB A', 'gerb-a'),
    ('e2b00000-0000-4000-8000-000000000001', 'e0b00000-0000-4000-8000-000000000001', 'GERB B', 'gerb-b');

  insert into public.clients (id, tenant_id, name, email)
  select pg_temp.ca(n), 'e0a00000-0000-4000-8000-000000000001', 'Client ' || n, 'recipient' || n || '@example.invalid'
    from generate_series(1, 12) n;
  insert into public.clients (id, tenant_id, name, email) values
    ('e3a00000-0000-4000-8000-0000000000d1', 'e0a00000-0000-4000-8000-000000000001', 'Duplicate', '  RECIPIENT1@Example.INVALID '),
    ('e3a00000-0000-4000-8000-0000000000b1', 'e0a00000-0000-4000-8000-000000000001', 'Blank',     '   '),
    ('e3b00000-0000-4000-8000-000000000001', 'e0b00000-0000-4000-8000-000000000001', 'Client B',  'recipient1@example.invalid');

  insert into public.album_clients (album_id, client_id)
  select 'e2a00000-0000-4000-8000-000000000001', pg_temp.ca(n) from generate_series(1, 12) n;
  insert into public.album_clients (album_id, client_id) values
    ('e2a00000-0000-4000-8000-000000000001', 'e3a00000-0000-4000-8000-0000000000d1'),
    ('e2a00000-0000-4000-8000-000000000001', 'e3a00000-0000-4000-8000-0000000000b1'),
    ('e2b00000-0000-4000-8000-000000000001', 'e3b00000-0000-4000-8000-000000000001');
end $$;


-- ── 1. The catalogue ────────────────────────────────────────────────────────

do $$
declare
  v_fn regprocedure := to_regprocedure('public.reserve_gallery_email_send(uuid, uuid, uuid)');
  v_n  int;
  v_src text;
begin
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'reserve_gallery_email_send';
  perform pg_temp.ok('exactly one overload, (uuid, uuid, uuid)', '1', v_n::text, v_fn is not null and v_n = 1);
  perform pg_temp.ok('returns text; parameter names unchanged', 'text {p_tenant,p_album,p_client}',
    (select prorettype::regtype::text || ' ' || proargnames::text from pg_proc where oid = v_fn),
    (select prorettype = 'text'::regtype and proargnames = array['p_tenant', 'p_album', 'p_client'] from pg_proc where oid = v_fn));
  perform pg_temp.ok('SECURITY DEFINER, VOLATILE', 'true/v',
    (select prosecdef::text || '/' || provolatile::text from pg_proc where oid = v_fn),
    (select prosecdef and provolatile = 'v' from pg_proc where oid = v_fn));
  perform pg_temp.ok('config', 'search_path="", lock_timeout=5s',
    (select array_to_string(proconfig, ', ') from pg_proc where oid = v_fn),
    (select proconfig @> array['search_path=""', 'lock_timeout=5s'] and cardinality(proconfig) = 2 from pg_proc where oid = v_fn));
  perform pg_temp.ok('owner is the table''s owner', 'same',
    (select pg_get_userbyid(proowner) from pg_proc where oid = v_fn),
    (select proowner from pg_proc where oid = v_fn) = (select relowner from pg_class where oid = 'public.gallery_email_send_attempts'::regclass));
  perform pg_temp.ok('EXECUTE: anon / service_role / authenticated', 'f/f/t',
    has_function_privilege('anon', v_fn, 'EXECUTE')::text || '/' ||
    has_function_privilege('service_role', v_fn, 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', v_fn, 'EXECUTE')::text,
    not has_function_privilege('anon', v_fn, 'EXECUTE')
    and not has_function_privilege('service_role', v_fn, 'EXECUTE')
    and has_function_privilege('authenticated', v_fn, 'EXECUTE'));
  select count(*) into v_n from pg_proc p, lateral aclexplode(p.proacl) x
   where p.oid = v_fn and x.grantee not in (p.proowner, 'authenticated'::regrole::oid);
  perform pg_temp.ok('ACL: owner and authenticated only', '0 others', v_n || ' others',
    v_n = 0 and (select proacl is not null from pg_proc where oid = v_fn));

  select prosrc into v_src from pg_proc where oid = v_fn;
  perform pg_temp.ok('body returns the bound hash', 'present',
    case when position($q$return 'reserved:' || pg_catalog.encode(v_hash, 'hex');$q$ in v_src) > 0 then 'present' else 'absent' end,
    position($q$return 'reserved:' || pg_catalog.encode(v_hash, 'hex');$q$ in v_src) > 0);
  perform pg_temp.ok('body never returns a bare reserved', 'absent',
    case when position($q$return 'reserved';$q$ in v_src) > 0 then 'present' else 'absent' end,
    position($q$return 'reserved';$q$ in v_src) = 0);

  select count(*) into v_n
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
   where c.oid = 'public.gallery_email_send_attempts'::regclass and x.grantee <> c.relowner;
  perform pg_temp.ok('table ACL still owner only', '0 other entries', v_n || ' other entries', v_n = 0);
end $$;


-- ── 2. Every refusal keeps its layer, SQLSTATE and message ──────────────────

do $$
declare
  TA  constant uuid := 'e0a00000-0000-4000-8000-000000000001';
  TB  constant uuid := 'e0b00000-0000-4000-8000-000000000001';
  TX  constant uuid := 'e0f00000-0000-4000-8000-000000000001';
  UA  constant uuid := 'e1a00000-0000-4000-8000-000000000001';
  UB  constant uuid := 'e1b00000-0000-4000-8000-000000000001';
  UNOP constant uuid := 'e1000000-0000-4000-8000-000000000000';
  AA  constant uuid := 'e2a00000-0000-4000-8000-000000000001';
  AB  constant uuid := 'e2b00000-0000-4000-8000-000000000001';
  CB1 constant uuid := 'e3b00000-0000-4000-8000-000000000001';
  CABLANK constant uuid := 'e3a00000-0000-4000-8000-0000000000b1';
  c_site constant text := 'ERR:42501:That is not your site.';
  c_nf   constant text := 'ERR:42501:That client could not be found on this gallery.';
  v   text;
begin
  v := pg_temp.call_as('anon', UA, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('anon: the ACL', 'permission denied for function', v, v like 'ERR:42501:permission denied for function%');
  v := pg_temp.call_as('service_role', UA, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('service_role: the ACL', 'permission denied for function', v, v like 'ERR:42501:permission denied for function%');
  v := pg_temp.call_as('authenticated', null, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('no identity: the tenant rule', c_site, v, v = c_site);
  v := pg_temp.call_as('authenticated', UNOP, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('no profile: the tenant rule', c_site, v, v = c_site);
  v := pg_temp.call_as('authenticated', UB, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('editor of B on A: the tenant rule', c_site, v, v = c_site);
  v := pg_temp.call_as('authenticated', UA, TX, AA, pg_temp.ca(1));
  perform pg_temp.ok('no such site: the tenant rule', c_site, v, v = c_site);
  v := pg_temp.call_as('authenticated', UA, null, AA, pg_temp.ca(1));
  perform pg_temp.ok('missing site argument', 'ERR:22023:A send needs…', v,
    v = 'ERR:22023:A send needs its site, its gallery and its client.');
  v := pg_temp.call_as('authenticated', UA, TA, AB, pg_temp.ca(1));
  perform pg_temp.ok('another site''s gallery', c_nf, v, v = c_nf);
  v := pg_temp.call_as('authenticated', UA, TA, AA, CB1);
  perform pg_temp.ok('another site''s client', c_nf, v, v = c_nf);
  v := pg_temp.call_as('authenticated', UA, TA, AA, CABLANK);
  perform pg_temp.ok('blank address', 'ERR:22023:…no email address.', v, v = 'ERR:22023:That client has no email address.');
  perform pg_temp.ok('refusals wrote nothing', '0/0',
    pg_temp.rows_of(TA) || '/' || pg_temp.rows_of(TB), pg_temp.rows_of(TA) = 0 and pg_temp.rows_of(TB) = 0);
end $$;


-- ── 3–5. The hash: exact, bound to the charged row, normalised, per site ────

do $$
declare
  TA  constant uuid := 'e0a00000-0000-4000-8000-000000000001';
  TB  constant uuid := 'e0b00000-0000-4000-8000-000000000001';
  UA  constant uuid := 'e1a00000-0000-4000-8000-000000000001';
  UB  constant uuid := 'e1b00000-0000-4000-8000-000000000001';
  UADM constant uuid := 'e1ad0000-0000-4000-8000-000000000001';
  AA  constant uuid := 'e2a00000-0000-4000-8000-000000000001';
  AB  constant uuid := 'e2b00000-0000-4000-8000-000000000001';
  CB1 constant uuid := 'e3b00000-0000-4000-8000-000000000001';
  CADUP constant uuid := 'e3a00000-0000-4000-8000-0000000000d1';
  v1 text; v2 text; v3 text; v4 text; vb text; va text;
  w_a text := pg_temp.want(TA, 'recipient1@example.invalid');
  w_b text := pg_temp.want(TB, 'recipient1@example.invalid');
begin
  v1 := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('reserved answer shape', 'reserved:<64 lowercase hex>', v1, v1 ~ '^reserved:[0-9a-f]{64}$');
  perform pg_temp.ok('hash = sha256(site:normalised address)', w_a, coalesce(pg_temp.hex_of(v1), '(none)'), pg_temp.hex_of(v1) = w_a);
  perform pg_temp.ok('hash = the row this call charged', '1 row',
    (select count(*) from public.gallery_email_send_attempts where tenant_id = TA and recipient_hash = decode(pg_temp.hex_of(v1), 'hex')) || ' row',
    pg_temp.rows_of(TA) = 1
    and (select recipient_hash from public.gallery_email_send_attempts where tenant_id = TA) = decode(pg_temp.hex_of(v1), 'hex'));
  perform pg_temp.ok('no address in the answer', 'no @ / no local part',
    v1, position('@' in v1) = 0 and position('recipient' in v1) = 0);

  -- Same address, other case and spaces, other contact.
  v2 := pg_temp.call_as('authenticated', UA, TA, AA, CADUP);
  perform pg_temp.ok('case and spaces normalise to the same hash', w_a, coalesce(pg_temp.hex_of(v2), v2), pg_temp.hex_of(v2) = w_a);
  v3 := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('third to the address: same hash', w_a, coalesce(pg_temp.hex_of(v3), v3), pg_temp.hex_of(v3) = w_a);
  v4 := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(1));
  perform pg_temp.ok('fourth: recipient_limited, verbatim', 'recipient_limited', v4, v4 = 'recipient_limited');
  perform pg_temp.ok('limited call wrote nothing', '3', pg_temp.rows_of(TA)::text, pg_temp.rows_of(TA) = 3);

  -- The site the reservation is for.
  vb := pg_temp.call_as('authenticated', UB, TB, AB, CB1);
  perform pg_temp.ok('same address on site B: B''s hash', w_b, coalesce(pg_temp.hex_of(vb), vb), pg_temp.hex_of(vb) = w_b);
  perform pg_temp.ok('site B''s hash differs from site A''s', 'differs',
    case when pg_temp.hex_of(vb) <> w_a then 'differs' else 'equal' end, pg_temp.hex_of(vb) <> w_a);

  update public.profiles set is_platform_admin = true where id = UADM;
  va := pg_temp.call_as('authenticated', UADM, TA, AA, pg_temp.ca(2));
  update public.profiles set is_platform_admin = false where id = UADM;
  perform pg_temp.ok('platform admin (profile on B) on A: A''s hash',
    pg_temp.want(TA, 'recipient2@example.invalid'), coalesce(pg_temp.hex_of(va), va),
    pg_temp.hex_of(va) = pg_temp.want(TA, 'recipient2@example.invalid')
    and pg_temp.hex_of(va) <> pg_temp.want(TB, 'recipient2@example.invalid'));
end $$;


-- ── 6. A → B → A ────────────────────────────────────────────────────────────
-- Sequential stand-in for the race (the concurrent version, on real
-- connections, is in the TS harness): the application reads A, the address
-- becomes B, the call reserves, the address returns to A, the application
-- reads A again. Both reads agree; only the answer names B.

do $$
declare
  TA  constant uuid := 'e0a00000-0000-4000-8000-000000000001';
  UA  constant uuid := 'e1a00000-0000-4000-8000-000000000001';
  AA  constant uuid := 'e2a00000-0000-4000-8000-000000000001';
  read1 text; read2 text; v text;
begin
  select email into read1 from public.clients where id = pg_temp.ca(3);
  update public.clients set email = 'swapped3@example.invalid' where id = pg_temp.ca(3);
  v := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(3));
  update public.clients set email = 'recipient3@example.invalid' where id = pg_temp.ca(3);
  select email into read2 from public.clients where id = pg_temp.ca(3);

  perform pg_temp.ok('A→B→A: both application reads agree', read1, read2, read1 = read2);
  perform pg_temp.ok('A→B→A: the answer names B', pg_temp.want(TA, 'swapped3@example.invalid'),
    coalesce(pg_temp.hex_of(v), v), pg_temp.hex_of(v) = pg_temp.want(TA, 'swapped3@example.invalid'));
  perform pg_temp.ok('A→B→A: the comparison with A fails closed', 'mismatch',
    case when pg_temp.hex_of(v) is distinct from pg_temp.want(TA, read2) then 'mismatch' else 'match' end,
    pg_temp.hex_of(v) is distinct from pg_temp.want(TA, read2));
  perform pg_temp.ok('A→B→A: B was charged, A was not', '1/0',
    (select count(*) from public.gallery_email_send_attempts where tenant_id = TA and recipient_hash = decode(pg_temp.want(TA, 'swapped3@example.invalid'), 'hex'))
    || '/' ||
    (select count(*) from public.gallery_email_send_attempts where tenant_id = TA and recipient_hash = decode(pg_temp.want(TA, 'recipient3@example.invalid'), 'hex')),
    (select count(*) from public.gallery_email_send_attempts where tenant_id = TA and recipient_hash = decode(pg_temp.want(TA, 'swapped3@example.invalid'), 'hex')) = 1
    and (select count(*) from public.gallery_email_send_attempts where tenant_id = TA and recipient_hash = decode(pg_temp.want(TA, 'recipient3@example.invalid'), 'hex')) = 0);
end $$;


-- ── 7. The site limit, verbatim ─────────────────────────────────────────────

do $$
declare
  TA  constant uuid := 'e0a00000-0000-4000-8000-000000000001';
  UA  constant uuid := 'e1a00000-0000-4000-8000-000000000001';
  AA  constant uuid := 'e2a00000-0000-4000-8000-000000000001';
  n_before int := pg_temp.rows_of(TA);
  n_ok int := 0;
  n_bad int := 0;
  v text;
begin
  -- A holds 5 (3 to recipient1, recipient2 by the admin, swapped3). Fill to 30.
  for c in 4..12 loop
    for i in 1..3 loop
      exit when pg_temp.rows_of(TA) >= 30;
      v := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(c));
      if pg_temp.hex_of(v) = pg_temp.want(TA, 'recipient' || c || '@example.invalid') then n_ok := n_ok + 1; else n_bad := n_bad + 1; end if;
    end loop;
  end loop;
  perform pg_temp.ok('fill to 30: every answer bound to its own recipient', (30 - n_before) || ' bound, 0 other',
    n_ok || ' bound, ' || n_bad || ' other', n_ok = 30 - n_before and n_bad = 0);
  perform pg_temp.ok('site A holds 30', '30', pg_temp.rows_of(TA)::text, pg_temp.rows_of(TA) = 30);
  v := pg_temp.call_as('authenticated', UA, TA, AA, pg_temp.ca(12));
  perform pg_temp.ok('31st: site_limited, verbatim', 'site_limited', v, v = 'site_limited');
  perform pg_temp.ok('still 30', '30', pg_temp.rows_of(TA)::text, pg_temp.rows_of(TA) = 30);
end $$;


-- ── Report, then abort ──────────────────────────────────────────────────────

do $$
declare
  report text := '';
  r      record;
  failed int;
  total  int;
begin
  for r in select * from gerb_res order by ord loop
    report := report || chr(10) ||
      case when coalesce(r.pass, false) then '  PASS  ' else '  FAIL  ' end ||
      rpad(r.step, 52) || ' expected ' || rpad(r.expected, 30) || ' got ' || coalesce(r.actual, '(null)');
  end loop;

  select count(*) filter (where not coalesce(pass, false)), count(*) into failed, total from gerb_res;

  raise exception e'Gallery email recipient binding — ROLLED BACK, nothing was kept.\n%',
    report || chr(10) || chr(10) ||
    case when failed = 0
      then 'All ' || total || ' checks passed.'
      else failed::text || ' of ' || total || ' CHECK(S) FAILED.'
    end;
end $$;

rollback;
