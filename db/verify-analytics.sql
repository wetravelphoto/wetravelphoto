-- Proof that analytics records what it should, refuses what it should, and
-- cannot be written to by anybody it should not be.
--
-- `db/test-fixture.sql` alone is enough since the S4 deployment was reconciled
-- into it — applying db/migrations/2026-09-29_analytics.sql on top as well is
-- safe (it is idempotent) but no longer needed.
--
--   PGHOST=/tmp PGPORT=5433 PGUSER=postgres psql -d wtp -f db/verify-analytics.sql
--
-- ── It cannot leave anything behind ─────────────────────────────────────────
--
-- One transaction that ALWAYS ends by raising, which aborts it. The report is
-- the exception message. No path through this file commits, so the views it
-- invents and the custom page it adds to a site's settings are rolled back
-- whether it passes, fails, or falls over halfway. Same shape as
-- db/verify-jobs.sql and db/verify-tenant-isolation.sql.
--
-- ── Run as the real roles, not as the owner ─────────────────────────────────
--
-- The blocks about privilege set `role` first. This is not a detail: S3's first
-- migration left `claim_jobs` SECURITY INVOKER and granted `service_role`
-- nothing, and its suite passed, because it was connecting as the table's owner
-- — who holds every privilege and bypasses row-level security. A harness that
-- runs as the owner cannot see a grant problem, and grants are half of what
-- there is to see here.
--
-- ── What is NOT tested here ────────────────────────────────────────────────
--
-- Everything above the database: that a page fires once, that the editor fires
-- not at all, that a pathname is reduced before it is sent, that a session id
-- lives in sessionStorage and nowhere else. That is `.mk/analytics.ts`, which
-- is the other half of this file.

begin;

create temp table an_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

create temp view t as
  select 'aaaaaaaa-0000-0000-0000-000000000001'::uuid as a,
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid as b,
         'bbbbbbbb-0000-0000-0000-000000000001'::uuid as album_a,   -- public
         'bbbbbbbb-0000-0000-0000-000000000002'::uuid as locked_a,  -- client_only
         'bbbbbbbb-0000-0000-0000-000000000003'::uuid as album_b,   -- other site
         'dddddddd-0000-0000-0000-000000000001'::uuid as post_a,
         '11111111-1111-1111-1111-111111111111'::uuid as owner_a,
         '22222222-2222-2222-2222-222222222222'::uuid as owner_b,
         repeat('e', 32) as visitor,
         repeat('0', 32) as session;

-- The harness's own two tables are readable and writable by the roles the
-- blocks below impersonate. Without this, `set role anon` makes a block fail on
-- `insert into an_res` rather than on the thing it is testing — which looks
-- exactly like the test passing for the wrong reason.
grant select, insert on an_res to anon, authenticated, service_role;
grant select on t to anon, authenticated, service_role;

-- The two rows the fixture seeds are the whole of "what was here before S4".
-- Every count below that cares distinguishes them by having no `path`.
create temp table before_s4 as
  select id, album_id, post_id, visitor_hash, viewed_at, tenant_id
    from page_views;


-- ════════════════════════════════════════════════════════════════════════════
-- 1. WHAT IT RECORDS
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1a. the homepage, which has never been counted before today ─────────────
do $$
declare v record; new_id uuid;
begin
  select * into v from t;
  new_id := public.record_page_view(v.a, '/', v.visitor, v.session, 'phone', 'home');

  insert into an_res (step, expected, actual, pass)
  select 'the homepage records a view', 'home / phone',
         format('%s %s %s', p.page_key, p.path, p.device),
         p.page_key = 'home' and p.path = '/' and p.device = 'phone'
           and p.tenant_id = v.a and p.album_id is null and p.post_id is null
    from page_views p where p.id = new_id;
end $$;

-- ── 1b. an ordinary built-in page ───────────────────────────────────────────
do $$
declare v record; new_id uuid;
begin
  select * into v from t;
  new_id := public.record_page_view(v.a, '/about', v.visitor, v.session, 'desktop', 'about');

  insert into an_res (step, expected, actual, pass)
  select 'an ordinary page records a view', 'about /about',
         format('%s %s', p.page_key, p.path), p.page_key = 'about' and p.path = '/about'
    from page_views p where p.id = new_id;
end $$;

-- ── 1c. one of the photographer's own pages, by its stable key ──────────────
--
-- The key, not the address: a page's sections, its SEO and now its views are
-- all filed under `p_xxxxxxxx`, so renaming `/weddings` to `/celebrations`
-- keeps its history rather than starting a second page.
do $$
declare v record; new_id uuid; n int;
begin
  select * into v from t;

  update site_settings
     set custom_pages = '[{"key":"p_a1b2c3d4","slug":"weddings","title":"Weddings"}]'::jsonb
   where tenant_id = v.a;

  new_id := public.record_page_view(v.a, '/weddings', v.visitor, v.session, 'tablet', 'p_a1b2c3d4');

  insert into an_res (step, expected, actual, pass)
  select 'a custom page records its stable page_key', 'p_a1b2c3d4 /weddings',
         format('%s %s', p.page_key, p.path),
         p.page_key = 'p_a1b2c3d4' and p.path = '/weddings'
    from page_views p where p.id = new_id;

  -- And the address is read from the stored list, not taken on trust: the same
  -- key at a different address is a mismatch.
  begin
    perform public.record_page_view(v.a, '/celebrations', v.visitor, v.session, 'tablet', 'p_a1b2c3d4');
    insert into an_res (step, expected, actual, pass)
    values ('a custom page at the wrong address is refused', 'refused', 'accepted', false);
  exception when others then
    insert into an_res (step, expected, actual, pass)
    values ('a custom page at the wrong address is refused', 'refused', 'refused', true);
  end;

  -- A key that site has never had.
  begin
    perform public.record_page_view(v.a, '/other', v.visitor, v.session, 'tablet', 'p_zzzzzzzz');
    insert into an_res (step, expected, actual, pass)
    values ('an invented page key is refused', 'refused', 'accepted', false);
  exception when others then
    insert into an_res (step, expected, actual, pass)
    values ('an invented page key is refused', 'refused', 'refused', true);
  end;

  select count(*) into n from page_views where page_key = 'p_a1b2c3d4';
  insert into an_res (step, expected, actual, pass)
  values ('and only the good one was written', '1', n::text, n = 1);
end $$;

-- ── 1d. a gallery, by album_id, exactly as before S4 ────────────────────────
do $$
declare v record; new_id uuid;
begin
  select * into v from t;
  new_id := public.record_page_view(v.a, '/trips/public-gallery', v.visitor, v.session,
                                'desktop', null, v.album_a);

  insert into an_res (step, expected, actual, pass)
  select 'a gallery records album_id', 'album, no page_key',
         format('album=%s page_key=%s path=%s', p.album_id = v.album_a,
                coalesce(p.page_key, 'null'), p.path),
         p.album_id = v.album_a and p.page_key is null and p.post_id is null
           and p.path = '/trips/public-gallery'
    from page_views p where p.id = new_id;
end $$;

-- ── 1e. a story, by post_id ─────────────────────────────────────────────────
do $$
declare v record; new_id uuid;
begin
  select * into v from t;
  new_id := public.record_page_view(v.a, '/journal/first-light', v.visitor, v.session,
                                'phone', null, null, v.post_a);

  insert into an_res (step, expected, actual, pass)
  select 'a story records post_id', 'post, no page_key',
         format('post=%s page_key=%s path=%s', p.post_id = v.post_a,
                coalesce(p.page_key, 'null'), p.path),
         p.post_id = v.post_a and p.page_key is null and p.album_id is null
           and p.path = '/journal/first-light'
    from page_views p where p.id = new_id;
end $$;

-- ── 1f. one call, one row ───────────────────────────────────────────────────
do $$
declare v record; n_before int; n_after int;
begin
  select * into v from t;
  select count(*) into n_before from page_views;
  perform public.record_page_view(v.a, '/contact', v.visitor, v.session, 'desktop', 'contact');
  select count(*) into n_after from page_views;

  insert into an_res (step, expected, actual, pass)
  values ('one call writes exactly one row', '1', (n_after - n_before)::text,
          n_after - n_before = 1);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. WHAT IT REFUSES — THE RESOURCE BOUNDARY
-- ════════════════════════════════════════════════════════════════════════════
--
-- This is the block S4 exists for. Before it, `page_views` carried
-- `for insert with check (true)`: a visitor to any site could POST a row
-- naming any gallery on the platform.

do $$
declare
  v record;
  n int;
  cases text[] := array[
    'a gallery belonging to another site',
    'a story belonging to another site',
    'a custom page belonging to another site',
    'a site that does not exist',
    'a gallery and a page at once',
    'nothing at all',
    'a gallery at another page''s address',
    'a made-up gallery id'
  ];
  i int := 0;
begin
  select * into v from t;

  -- Another site's custom page, to prove a key is checked against the OWNER
  -- and not merely against the shape of a key.
  update site_settings
     set custom_pages = '[{"key":"p_b9b9b9b9","slug":"elsewhere","title":"Elsewhere"}]'::jsonb
   where tenant_id = v.b;

  for i in 1..array_length(cases, 1) loop
    begin
      case i
        when 1 then perform public.record_page_view(v.a, '/trips/other-site', v.visitor, v.session, 'desktop', null, v.album_b);
        when 2 then perform public.record_page_view(v.b, '/journal/first-light', v.visitor, v.session, 'desktop', null, null, v.post_a);
        when 3 then perform public.record_page_view(v.a, '/elsewhere', v.visitor, v.session, 'desktop', 'p_b9b9b9b9');
        when 4 then perform public.record_page_view('00000000-0000-0000-0000-000000000000'::uuid, '/', v.visitor, v.session, 'desktop', 'home');
        when 5 then perform public.record_page_view(v.a, '/', v.visitor, v.session, 'desktop', 'home', v.album_a);
        when 6 then perform public.record_page_view(v.a, '/', v.visitor, v.session, 'desktop');
        when 7 then perform public.record_page_view(v.a, '/about', v.visitor, v.session, 'desktop', null, v.album_a);
        when 8 then perform public.record_page_view(v.a, '/trips/ghost', v.visitor, v.session, 'desktop', null, '00000000-0000-0000-0000-0000000000ff'::uuid);
      end case;
      insert into an_res (step, expected, actual, pass)
      values (format('refused: %s', cases[i]), 'refused', 'ACCEPTED', false);
    exception when others then
      insert into an_res (step, expected, actual, pass)
      values (format('refused: %s', cases[i]), 'refused', 'refused', true);
    end;
  end loop;

  -- And none of the eight left a trace.
  select count(*) into n from page_views
   where tenant_id = v.b or album_id = v.album_b or page_key = 'p_b9b9b9b9';
  insert into an_res (step, expected, actual, pass)
  values ('and not one of them wrote a row', '0', n::text, n = 0);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. WHAT IT REFUSES — THE PRIVACY RULES, AS RULES RATHER THAN AS INTENTIONS
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v record;
  cases text[] := array[
    'a query string in the path',
    'a fragment in the path',
    'an absolute URL as the path',
    'a full referrer URL',
    'a referrer with a search query',
    'a single-label referrer',
    'a user-agent as the device',
    'a made-up device bucket',
    'an IPv4 address as the visitor hash',
    'an IPv6 address as the visitor hash',
    'an email address as the visitor hash',
    'a user-agent as the visitor hash',
    'a session id that is not 16 random bytes',
    'an account id as the session id',
    'a session id in upper-case hex',
    'a session id of 31 characters'
  ];
  i int;
begin
  select * into v from t;

  for i in 1..array_length(cases, 1) loop
    begin
      case i
        when 1  then perform public.record_page_view(v.a, '/?email=someone@example.com', v.visitor, v.session, 'desktop', 'home');
        when 2  then perform public.record_page_view(v.a, '/#token', v.visitor, v.session, 'desktop', 'home');
        when 3  then perform public.record_page_view(v.a, 'https://one.example/', v.visitor, v.session, 'desktop', 'home');
        when 4  then perform public.record_page_view(v.a, '/', v.visitor, v.session, 'desktop', 'home', null, null, 'https://google.com/search');
        when 5  then perform public.record_page_view(v.a, '/', v.visitor, v.session, 'desktop', 'home', null, null, 'google.com/search?q=wildlife+prints');
        when 6  then perform public.record_page_view(v.a, '/', v.visitor, v.session, 'desktop', 'home', null, null, 'localhost');
        when 7  then perform public.record_page_view(v.a, '/', v.visitor, v.session, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'home');
        when 8  then perform public.record_page_view(v.a, '/', v.visitor, v.session, 'watch', 'home');
        when 9  then perform public.record_page_view(v.a, '/', '203.0.113.47', v.session, 'desktop', 'home');
        when 10 then perform public.record_page_view(v.a, '/', '2001:db8::8a2e:370:7334', v.session, 'desktop', 'home');
        when 11 then perform public.record_page_view(v.a, '/', 'visitor@example.com', v.session, 'desktop', 'home');
        when 12 then perform public.record_page_view(v.a, '/', 'Mozilla/5.0 Safari', v.session, 'desktop', 'home');
        when 13 then perform public.record_page_view(v.a, '/', v.visitor, 'not-random', 'desktop', 'home');
        when 14 then perform public.record_page_view(v.a, '/', v.visitor, '11111111-1111-1111-1111-111111111111', 'desktop', 'home');
        when 15 then perform public.record_page_view(v.a, '/', v.visitor, upper(repeat('a', 32)), 'desktop', 'home');
        when 16 then perform public.record_page_view(v.a, '/', v.visitor, repeat('a', 31), 'desktop', 'home');
      end case;
      insert into an_res (step, expected, actual, pass)
      values (format('refused: %s', cases[i]), 'refused', 'ACCEPTED', false);
    exception when others then
      insert into an_res (step, expected, actual, pass)
      values (format('refused: %s', cases[i]), 'refused', 'refused', true);
    end;
  end loop;
end $$;

-- ── 3b. and a good referrer IS kept, as a host and nothing more ─────────────
do $$
declare v record; new_id uuid;
begin
  select * into v from t;
  new_id := public.record_page_view(v.a, '/', v.visitor, v.session, 'desktop', 'home',
                                null, null, 'instagram.com');

  insert into an_res (step, expected, actual, pass)
  select 'a bare referrer host is kept', 'instagram.com', p.referrer_host,
         p.referrer_host = 'instagram.com'
    from page_views p where p.id = new_id;
end $$;

-- ── 3b2. A MISSING SESSION IS NOT A MISSING VIEW ───────────────────────────
--
-- The correction of 2026-09-29. `sessionStorage` throws in a Safari private
-- window and wherever site data is blocked, and the first version treated that
-- as a reason to record nothing at all — which made a browser that respects its
-- user an uncounted visitor and undercounted exactly the people most likely to
-- have blocked storage. `session_hash` exists for within-visit funnels; it is
-- not a precondition for counting a page view.
--
-- So null is an ordinary value here, and the three things that must all be true
-- together are: the row IS written, the column IS null, and a session id that
-- is supplied is STILL held to its exact shape (the refusals above, which now
-- include upper-case hex and a 31-character id).
do $$
declare v record; new_id uuid; n int;
begin
  select * into v from t;

  new_id := public.record_page_view(v.a, '/about', v.visitor, null, 'desktop', 'about');

  insert into an_res (step, expected, actual, pass)
  select 'a view with no session is still recorded', 'recorded, session null',
         case when p.id is null then 'NO ROW'
              else format('recorded, session %s', coalesce(p.session_hash, 'null')) end,
         p.id is not null and p.session_hash is null
           and p.page_key = 'about' and p.path = '/about' and p.tenant_id = v.a
    from page_views p where p.id = new_id;

  -- And it is a whole view, not a degraded one: everything else on the row is
  -- there. A visitor with storage blocked still counts towards "how many
  -- people", because `visitor_hash` does not come from the browser at all.
  insert into an_res (step, expected, actual, pass)
  select 'and the rest of the row is complete', 'visitor + device + path',
         format('%s %s %s', p.visitor_hash = v.visitor, p.device, p.path),
         p.visitor_hash = v.visitor and p.device = 'desktop' and p.path = '/about'
    from page_views p where p.id = new_id;

  -- The same for a gallery, so this is not a property of built-in pages only.
  new_id := public.record_page_view(v.a, '/trips/public-gallery', v.visitor, null,
                                    'phone', null, v.album_a);
  insert into an_res (step, expected, actual, pass)
  select 'a gallery view with no session is recorded too', 'album, session null',
         format('%s %s', p.album_id = v.album_a, coalesce(p.session_hash, 'null')),
         p.album_id = v.album_a and p.session_hash is null
    from page_views p where p.id = new_id;

  -- Both spellings of "no session" behave the same way. `p_session` has no
  -- default, so a caller omitting it is not possible — but a caller passing
  -- SQL NULL and a caller passing the string 'null' are two different things,
  -- and only the first is a missing session.
  begin
    perform public.record_page_view(v.a, '/', v.visitor, 'null', 'desktop', 'home');
    insert into an_res (step, expected, actual, pass)
    values ('the WORD null is not a missing session', 'refused', 'ACCEPTED', false);
  exception when others then
    insert into an_res (step, expected, actual, pass)
    values ('the WORD null is not a missing session', 'refused', 'refused', true);
  end;

  -- Nothing about this loosens the column. A direct insert of a malformed id is
  -- still refused by the CHECK, and a direct insert of null is still fine.
  begin
    insert into page_views (tenant_id, page_key, path, visitor_hash, session_hash)
    values (v.a, 'home', '/', v.visitor, 'NOTHEXATALL');
    insert into an_res (step, expected, actual, pass)
    values ('the column still refuses a malformed id', 'refused', 'ACCEPTED', false);
  exception when check_violation then
    insert into an_res (step, expected, actual, pass)
    values ('the column still refuses a malformed id', 'refused', 'refused', true);
  end;

  -- Exactly the two above: a page and a gallery. The refused attempts left
  -- nothing, which is the other half of what this block is asserting.
  select count(*) into n from page_views where session_hash is null and path is not null;
  insert into an_res (step, expected, actual, pass)
  values ('two sessionless views written, and no more', '2', n::text, n = 2);
end $$;


-- ── 3c. the table itself refuses them too, not only the function ────────────
--
-- Two copies of the rules on purpose: the function is the door, the constraints
-- are what the table IS. A future migration, a backfill or somebody at a psql
-- prompt goes round the door; nothing goes round a CHECK. Written as the OWNER,
-- who bypasses RLS and holds every privilege — so the only thing that can stop
-- these is the constraint.
do $$
declare
  v record;
  cases text[] := array[
    'direct insert: a query string in the path',
    'direct insert: a user-agent in device',
    'direct insert: a full referrer URL',
    'direct insert: an IP in visitor_hash',
    'direct insert: a session id of the wrong shape',
    'direct insert: no identity at all',
    'direct insert: two identities'
  ];
  i int;
begin
  select * into v from t;
  for i in 1..array_length(cases, 1) loop
    begin
      case i
        when 1 then insert into page_views (tenant_id, page_key, path, visitor_hash) values (v.a, 'home', '/?e=1', v.visitor);
        when 2 then insert into page_views (tenant_id, page_key, path, visitor_hash, device) values (v.a, 'home', '/', v.visitor, 'Mozilla/5.0');
        when 3 then insert into page_views (tenant_id, page_key, path, visitor_hash, referrer_host) values (v.a, 'home', '/', v.visitor, 'https://google.com/search');
        when 4 then insert into page_views (tenant_id, page_key, path, visitor_hash) values (v.a, 'home', '/', '198.51.100.9');
        when 5 then insert into page_views (tenant_id, page_key, path, visitor_hash, session_hash) values (v.a, 'home', '/', v.visitor, 'abc');
        when 6 then insert into page_views (tenant_id, path, visitor_hash) values (v.a, '/', v.visitor);
        when 7 then insert into page_views (tenant_id, page_key, album_id, path, visitor_hash) values (v.a, 'home', v.album_a, '/', v.visitor);
      end case;
      insert into an_res (step, expected, actual, pass)
      values (cases[i], 'refused', 'ACCEPTED', false);
    exception when check_violation or not_null_violation then
      insert into an_res (step, expected, actual, pass)
      values (cases[i], 'refused', 'refused by a constraint', true);
    when others then
      insert into an_res (step, expected, actual, pass)
      values (cases[i], 'refused', 'refused, but not by a constraint: ' || sqlerrm, false);
    end;
  end loop;
end $$;

-- ── 3d. there is nowhere for an address to live ─────────────────────────────
do $$
declare bad text;
begin
  select string_agg(a.attname, ', ') into bad
    from pg_attribute a
   where a.attrelid = 'public.page_views'::regclass
     and a.attnum > 0 and not a.attisdropped
     and (a.attname ~* '(^|_)(ip|addr|address|agent|ua|email|user_agent|referrer_url|url|query)($|_)');

  insert into an_res (step, expected, actual, pass)
  values ('page_views has no column an address could go in', 'none',
          coalesce(bad, 'none'), bad is null);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 4. WHO MAY WRITE — AS THE REAL ROLES
-- ════════════════════════════════════════════════════════════════════════════

-- ── 4a. anon: nothing at all ────────────────────────────────────────────────
do $$
declare v record; outcome text;
begin
  select * into v from t;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);

  begin
    insert into page_views (tenant_id, page_key, path, visitor_hash) values (v.a, 'home', '/', v.visitor);
    outcome := 'ALLOWED';
  exception when insufficient_privilege then outcome := 'permission denied';
  when others then outcome := 'blocked: ' || sqlerrm;
  end;
  insert into an_res (step, expected, actual, pass)
  values ('anon cannot insert a view directly', 'permission denied', outcome,
          outcome = 'permission denied');

  begin
    perform public.record_page_view(v.a, '/', v.visitor, v.session, 'desktop', 'home');
    outcome := 'ALLOWED';
  exception when insufficient_privilege then outcome := 'permission denied';
  when others then outcome := 'blocked: ' || sqlerrm;
  end;
  insert into an_res (step, expected, actual, pass)
  values ('anon cannot call record_page_view', 'permission denied', outcome,
          outcome = 'permission denied');

  begin
    perform count(*) from page_views;
    outcome := 'ALLOWED';
  exception when insufficient_privilege then outcome := 'permission denied';
  when others then outcome := 'blocked: ' || sqlerrm;
  end;
  insert into an_res (step, expected, actual, pass)
  values ('anon cannot read the table', 'permission denied', outcome,
          outcome = 'permission denied');

  perform set_config('role', 'none', true);
end $$;

-- ── 4b. a signed-in photographer: reads their own site, writes nothing ──────
do $$
declare v record; outcome text; n_mine int; n_theirs int;
begin
  select * into v from t;

  perform set_config('request.jwt.claims', json_build_object('sub', v.owner_a)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_mine from page_views where tenant_id = v.a;
  select count(*) into n_theirs from page_views where tenant_id = v.b;

  insert into an_res (step, expected, actual, pass)
  values ('a photographer reads their own views', '>0', n_mine::text, n_mine > 0);
  insert into an_res (step, expected, actual, pass)
  values ('and none of anybody else''s', '0', n_theirs::text, n_theirs = 0);

  begin
    insert into page_views (tenant_id, page_key, path, visitor_hash) values (v.a, 'home', '/', v.visitor);
    outcome := 'ALLOWED';
  exception when insufficient_privilege then outcome := 'permission denied';
  when others then outcome := 'blocked: ' || sqlerrm;
  end;
  insert into an_res (step, expected, actual, pass)
  values ('a photographer cannot insert a view, even on their own site',
          'permission denied', outcome, outcome = 'permission denied');

  begin
    perform public.record_page_view(v.a, '/', v.visitor, v.session, 'desktop', 'home');
    outcome := 'ALLOWED';
  exception when insufficient_privilege then outcome := 'permission denied';
  when others then outcome := 'blocked: ' || sqlerrm;
  end;
  insert into an_res (step, expected, actual, pass)
  values ('a photographer cannot call record_page_view', 'permission denied',
          outcome, outcome = 'permission denied');

  begin
    delete from page_views where tenant_id = v.a;
    outcome := 'ALLOWED';
  exception when insufficient_privilege then outcome := 'permission denied';
  when others then outcome := 'blocked: ' || sqlerrm;
  end;
  insert into an_res (step, expected, actual, pass)
  values ('a photographer cannot delete their own views', 'permission denied',
          outcome, outcome = 'permission denied');

  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);
end $$;

-- ── 4c. service_role: the function, and not the table ───────────────────────
--
-- The whole privilege design in two assertions. The route can record a view;
-- the route cannot write a row of its own choosing. That is the difference
-- between a door and a hole.
do $$
declare v record; outcome text; new_id uuid;
begin
  select * into v from t;

  perform set_config('role', 'service_role', true);

  begin
    new_id := public.record_page_view(v.a, '/journal', v.visitor, v.session, 'desktop', 'journal');
    outcome := case when new_id is null then 'null' else 'recorded' end;
  exception when others then outcome := 'blocked: ' || sqlerrm;
  end;
  insert into an_res (step, expected, actual, pass)
  values ('service_role can record a view', 'recorded', outcome, outcome = 'recorded');

  begin
    insert into page_views (tenant_id, page_key, path, visitor_hash) values (v.a, 'home', '/', v.visitor);
    outcome := 'ALLOWED';
  exception when insufficient_privilege then outcome := 'permission denied';
  when others then outcome := 'blocked: ' || sqlerrm;
  end;
  insert into an_res (step, expected, actual, pass)
  values ('service_role cannot insert a view directly', 'permission denied',
          outcome, outcome = 'permission denied');

  begin
    perform count(*) from page_views;
    outcome := 'granted';
  exception when insufficient_privilege then outcome := 'PERMISSION DENIED';
  when others then outcome := 'blocked: ' || sqlerrm;
  end;
  insert into an_res (step, expected, actual, pass)
  values ('service_role may read, which its filtered delete needs', 'granted',
          outcome, outcome = 'granted');

  -- And it CAN delete, because deleteSite() does.
  --
  -- THIS IS THE ASSERTION THAT FOUND THE GRANT BUG. The first version of the
  -- migration granted DELETE and not SELECT, on the reasoning that the route
  -- writes through the function and nothing else needs to look. But
  -- `delete from page_views where tenant_id = $1` READS that column to decide
  -- which rows to remove, so DELETE without SELECT fails with "permission
  -- denied for table page_views" — and `deleteSite()` swallows any error
  -- matching /does not exist/, which that one does not, so a site deletion
  -- would have reported "rows may remain in page_views" for ever.
  --
  -- Found only because this block runs as the real role. As the table's owner
  -- it passes either way, which is the whole argument for `set role`.
  --
  -- Row counts are deliberately not asserted: db/test-fixture.sql creates a
  -- plain `service_role` where production's carries BYPASSRLS
  -- (db/schema-verified.md), so locally the policy narrows this to nothing.
  -- The grant is the part that differs between the two databases.
  begin
    delete from page_views where tenant_id = v.a and false;
    outcome := 'granted';
  exception when insufficient_privilege then outcome := 'PERMISSION DENIED';
  when others then outcome := 'blocked: ' || sqlerrm;
  end;
  insert into an_res (step, expected, actual, pass)
  values ('service_role may delete, which deleteSite() needs', 'granted',
          outcome, outcome = 'granted');

  perform set_config('role', 'none', true);
end $$;

-- ── 4d. and the function really is the thing holding the line ───────────────
do $$
declare def record; outcome text;
begin
  select p.prosecdef as definer,
         p.proconfig as config
    into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_page_view';

  insert into an_res (step, expected, actual, pass)
  values ('record_page_view is SECURITY DEFINER', 'true',
          coalesce(def.definer::text, 'missing'), def.definer);

  insert into an_res (step, expected, actual, pass)
  -- Stored as `search_path=""`, not `search_path=`: `set search_path = ''`
  -- keeps the quotes in pg_proc.proconfig. Asserting the wrong spelling is a
  -- test that fails on a correct function, which is worse than no test.
  values ('with an empty search_path', 'search_path=""',
          coalesce(array_to_string(def.config, ','), 'unset'),
          def.config @> array['search_path=""']);

  -- Its EXECUTE list, stated rather than assumed.
  select coalesce(string_agg(g, ', ' order by g), 'none') into outcome
    from (
      select case
               when has_function_privilege(r.rolname, p.oid, 'execute') then r.rolname
             end as g
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
       where n.nspname = 'public' and p.proname = 'record_page_view'
    ) z where g is not null;

  insert into an_res (step, expected, actual, pass)
  values ('and only service_role may execute it', 'service_role', outcome,
          outcome = 'service_role');
end $$;

-- ── 4e. the table's grants, stated ──────────────────────────────────────────
do $$
declare listed text;
begin
  select coalesce(string_agg(format('%s:%s', grantee, privilege_type), ' ' order by grantee, privilege_type), 'none')
    into listed
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'page_views'
     and grantee in ('anon', 'authenticated', 'service_role');

  insert into an_res (step, expected, actual, pass)
  values ('page_views grants nothing but reading and one delete',
          'authenticated:SELECT service_role:DELETE service_role:SELECT', listed,
          listed = 'authenticated:SELECT service_role:DELETE service_role:SELECT');
end $$;

-- ── 4f. and the open door is gone ───────────────────────────────────────────
do $$
declare policies text;
begin
  select coalesce(string_agg(policyname || '/' || cmd, ', ' order by policyname), 'none')
    into policies
    from pg_policies where schemaname = 'public' and tablename = 'page_views';

  insert into an_res (step, expected, actual, pass)
  values ('"Anyone can record a view" no longer exists',
          'Tenant members manage/ALL', policies,
          policies = 'Tenant members manage/ALL');
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. NOTHING THAT WORKED BEFORE HAS STOPPED
-- ════════════════════════════════════════════════════════════════════════════

-- ── 5a. the four preserved columns, untouched, row for row ──────────────────
do $$
declare drifted int;
begin
  select count(*) into drifted
    from before_s4 b
    left join page_views p on p.id = b.id
   where p.id is null
      or p.album_id     is distinct from b.album_id
      or p.post_id      is distinct from b.post_id
      or p.visitor_hash is distinct from b.visitor_hash
      or p.viewed_at    is distinct from b.viewed_at;

  insert into an_res (step, expected, actual, pass)
  values ('album_id, post_id, visitor_hash and viewed_at are unchanged',
          '0 rows differ', drifted::text || ' rows differ', drifted = 0);
end $$;

-- ── 5b. and each of them was given the site its parent belongs to ───────────
do $$
declare wrong int;
begin
  select count(*) into wrong
    from page_views p
    left join albums     a on a.id = p.album_id
    left join blog_posts g on g.id = p.post_id
   where (p.album_id is not null and p.tenant_id is distinct from a.tenant_id)
      or (p.post_id  is not null and p.tenant_id is distinct from g.tenant_id);

  insert into an_res (step, expected, actual, pass)
  values ('every view''s site agrees with its gallery or story', '0 wrong',
          wrong::text || ' wrong', wrong = 0);
end $$;

-- ── 5c. the two existing readers' queries still return what they did ────────
--
-- The literal shape of both, from lib/admin/overview.ts and
-- app/admin/trips/[id]/stats/page.tsx, including the `tenant_id` filter this
-- commit adds to them. The pre-S4 rows must still be found by it, which is the
-- thing the backfill was for.
do $$
declare v record; n_album int; n_post int; n_stats int;
begin
  select * into v from t;

  select count(*) into n_album from page_views
   where tenant_id = v.a and viewed_at >= now() - interval '30 days'
     and album_id in (select id from albums where tenant_id = v.a);

  select count(*) into n_post from page_views
   where tenant_id = v.a and viewed_at >= now() - interval '30 days'
     and post_id in (select id from blog_posts where tenant_id = v.a);

  select count(*) into n_stats from page_views
   where tenant_id = v.a and album_id = v.album_a
     and viewed_at >= now() - interval '29 days';

  insert into an_res (step, expected, actual, pass)
  values ('the overview still finds gallery views', '>=2', n_album::text, n_album >= 2);
  insert into an_res (step, expected, actual, pass)
  values ('the overview still finds story views', '>=2', n_post::text, n_post >= 2);
  insert into an_res (step, expected, actual, pass)
  values ('the album stats screen still finds its own', '>=2', n_stats::text, n_stats >= 2);
end $$;

-- ── 5d. deleting a site takes its views with it ─────────────────────────────
--
-- Two mechanisms, and both matter. `app/actions/sites.ts` deletes by
-- `tenant_id`, which is the call that has never worked (the column did not
-- exist, and the error was swallowed by the "table does not exist on this
-- deployment" guard). The foreign key cascade is the backstop for a path
-- nobody thought of.
do $$
declare v record; left_over int;
begin
  select * into v from t;

  perform public.record_page_view(v.b, '/', repeat('f', 32), repeat('1', 32), 'desktop', 'home');

  delete from page_views where tenant_id = v.b;
  select count(*) into left_over from page_views where tenant_id = v.b;

  insert into an_res (step, expected, actual, pass)
  values ('deleting by tenant_id removes a site''s views', '0',
          left_over::text, left_over = 0);
end $$;

do $$
declare ghost uuid := gen_random_uuid(); before int; after_n int;
begin
  -- A THROWAWAY site, not one of the fixture's two. `albums.tenant_id` has no
  -- ON DELETE clause — deliberately, so that `deleteSite()` has to name every
  -- table it destroys — so a tenant with a gallery in it cannot be deleted at
  -- all, and testing the cascade on Site Two tests the albums foreign key
  -- instead. Same trick as db/verify-tenant-isolation.sql.
  insert into tenants (id, name, domain) values (ghost, 'cascade check', 'cascade-check.invalid');

  perform public.record_page_view(ghost, '/', repeat('f', 32), repeat('1', 32), 'desktop', 'home');
  select count(*) into before from page_views where tenant_id = ghost;

  delete from tenants where id = ghost;
  select count(*) into after_n from page_views where tenant_id = ghost;

  insert into an_res (step, expected, actual, pass)
  values ('and the tenant cascade is there as a backstop',
          format('%s then 0', before), format('%s then %s', before, after_n),
          before > 0 and after_n = 0);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 6. THE INDEXES EARN THEIR PLACE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Not "an index exists" — a plan that USES it, for the query it was added for.
--
-- ── Why enable_seqscan is turned off, and what that costs the assertion ─────
--
-- At fixture scale the planner is right to ignore both indexes: eight hundred
-- rows fit in a handful of pages and reading all of them beats an index lookup.
-- So an assertion that the planner CHOOSES the index would either fail here and
-- pass in production, or need tens of thousands of invented rows to become
-- true — a slow suite asserting something about row counts rather than about
-- the index. Measured: with sequential scans allowed, both of these plans are
-- `Seq Scan`, correctly.
--
-- With sequential scans disabled the question becomes the one actually worth
-- asking: **can this index serve this query shape at all?** That is what a
-- wrong column order, or a partial clause that excludes the rows being looked
-- for, gets wrong — and it is what would otherwise make these indexes dead
-- weight on every insert for ever without anything noticing.
--
-- What it does NOT prove is that production's planner will choose them, which
-- is a question about volume. That is answered by Supabase's "unused index"
-- advisory after the first real traffic — the same follow-up already recorded
-- for the queue's three indexes in `claude/open-items.md`.

do $$
declare
  v record;
  plan text;
  i int;
  found_tenant boolean := false;
  found_post   boolean := false;
begin
  select * into v from t;

  -- Enough rows, and enough DIFFERENT rows, so that a plan is about narrowing.
  --
  -- The second loop needs a word. An earlier version put all 400 story views on
  -- the fixture's single story, which made `post_id = <that story>` match half
  -- the table — not selective at all — so the planner's choice between
  -- `page_views_post_idx` and `page_views_tenant_time` was a near-tie decided by
  -- rounding. It was: adding two unrelated rows in block 3b2 flipped it, and the
  -- assertion started reporting a `Bitmap Index Scan on page_views_tenant_time`
  -- as a failure. The test was wrong, not the index.
  --
  -- A real site has many stories, so the views are spread over ten of them here
  -- and one story is a few per cent of the table. That is the shape
  -- `lib/admin/overview.ts` actually queries, and the plan for it is not a tie.
  for i in 1..9 loop
    insert into blog_posts (tenant_id, title, slug, status)
    values (v.a, 'plan check ' || i, 'plan-check-' || i, 'published');
  end loop;

  for i in 1..400 loop
    insert into page_views (tenant_id, page_key, path, visitor_hash, session_hash, device, viewed_at)
    values (v.a, 'home', '/', repeat('c', 32), repeat('2', 32), 'desktop',
            now() - (i || ' hours')::interval);
  end loop;

  for i in 1..400 loop
    insert into page_views (tenant_id, post_id, path, visitor_hash, session_hash, device, viewed_at)
    select v.a,
           case when i % 10 = 0 then v.post_a
                else (select id from blog_posts
                       where tenant_id = v.a and slug = 'plan-check-' || (i % 10)) end,
           '/journal/x', repeat('d', 32), repeat('3', 32), 'phone',
           now() - (i || ' hours')::interval;
  end loop;

  analyze page_views;
  set local enable_seqscan = off;

  -- The shape of every aggregate the analytics screen will ask for: this site,
  -- this window.
  for plan in
    execute 'explain (costs off) select count(*) from page_views where tenant_id = '
            || quote_literal(v.a)
            || ' and viewed_at >= now() - interval ''7 days'''
  loop
    if plan like '%page_views_tenant_time%' then found_tenant := true; end if;
  end loop;

  insert into an_res (step, expected, actual, pass)
  values ('this site, this window can use page_views_tenant_time',
          'index', case when found_tenant then 'index' else 'sequential scan' end,
          found_tenant);

  -- And the story index, which is the one that was missing all along:
  -- `lib/admin/overview.ts` has run this query since it was written, with an
  -- index on album_id and nothing at all for post_id.
  for plan in
    execute 'explain (costs off) select count(*) from page_views where post_id = '
            || quote_literal(v.post_a)
            || ' and viewed_at >= now() - interval ''30 days'''
  loop
    if plan like '%page_views_post_idx%' then found_post := true; end if;
  end loop;

  insert into an_res (step, expected, actual, pass)
  values ('views of one story can use page_views_post_idx',
          'index', case when found_post then 'index' else 'sequential scan' end,
          found_post);

  -- And it is the partial one. The clause is `where post_id is not null`, which
  -- has to still cover a lookup for a particular story — if it did not, the
  -- index would be unusable for the only query it exists for.
  insert into an_res (step, expected, actual, pass)
  select 'and it is partial, so the nulls cost nothing', 'partial',
         case when indexdef like '%post_id IS NOT NULL%' then 'partial' else indexdef end,
         indexdef like '%post_id IS NOT NULL%'
    from pg_indexes where schemaname = 'public' and indexname = 'page_views_post_idx';

  reset enable_seqscan;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- Report, and undo everything
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  report text;
  failed int;
begin
  select string_agg(
           format('%s  %-52s expected %-28s got %s',
                  -- COALESCE, because a comparison against a null is neither
                  -- true nor false, and an UNKNOWN printed as FAIL but counted
                  -- as neither is how four failures were once summarised as
                  -- two. Same fix as db/verify-jobs.sql.
                  case when coalesce(pass, false) then '  ok  ' else ' FAIL ' end,
                  step, expected, actual),
           E'\n' order by ord)
    into report
    from an_res;

  select count(*) into failed from an_res where not coalesce(pass, false);

  raise exception E'\n\n%\n\n%\n\nNothing was kept — this transaction always rolls back.\n',
    report,
    case
      when failed = 0 then format('All %s checks passed.', (select count(*) from an_res))
      else format('%s of %s check(s) failed. Analytics is NOT safe to deploy.',
                  failed, (select count(*) from an_res))
    end;
end $$;

rollback;
