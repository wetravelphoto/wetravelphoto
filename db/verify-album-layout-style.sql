-- Proof that albums.layout_style admits exactly masonry, grid, single_column
-- and square. Run AFTER db/migrations/2026-11-22_album_layout_square.sql:
--
--   node scripts/p4-local-db.mjs sql db/migrations/2026-11-22_album_layout_square.sql \
--        db/migrations/2026-11-22_album_layout_square.sql db/verify-album-layout-style.sql
--
-- Against the fixture WITHOUT the migration it must fail (square refused) —
-- that is what shows it can.
--
-- Same shape as db/verify-draft.sql: one transaction that ALWAYS ends by
-- raising, so nothing is kept whether it passes, fails or falls over.
--
-- The writes that matter run as `authenticated` in the album's own site — the
-- role the editor's server actions use — and each refusal records WHICH layer
-- refused (check_violation vs. a privilege error vs. zero rows from RLS), so a
-- pass cannot come from the wrong one.

begin;

create temp table ls_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);
grant select, insert on ls_res to public;
grant usage on all sequences in schema pg_temp to public;

do $$
declare
  v_me     uuid;
  v_tenant uuid;
  v_album  uuid;
  v_other  uuid;
begin
  -- The first site's owner and one of its albums; an album on another site.
  select id, tenant_id into v_me, v_tenant from profiles order by created_at asc, id asc limit 1;
  if v_me is null then raise exception 'No profiles exist, so there is nothing to test as.'; end if;
  select id into v_album from albums where tenant_id = v_tenant order by id limit 1;
  select id into v_other from albums where tenant_id <> v_tenant order by id limit 1;
  if v_album is null or v_other is null then
    raise exception 'Setup: need an album on the account''s site and one on another site.';
  end if;

  -- A platform admin passes every tenant check; off, so the RLS control means something.
  update profiles set is_platform_admin = false where id = v_me;

  perform set_config('ls.me', v_me::text, true);
  perform set_config('ls.tenant', v_tenant::text, true);
  perform set_config('ls.album', v_album::text, true);
  perform set_config('ls.other', v_other::text, true);
end $$;


-- ── 1. The catalogue says exactly what was meant ────────────────────────────

do $$
declare
  v_def   text;
  v_valid boolean;
  v_dflt  text;
  v_nn    boolean;
  n       int;
begin
  select pg_get_constraintdef(c.oid), c.convalidated into v_def, v_valid
    from pg_constraint c
   where c.conrelid = 'public.albums'::regclass and c.conname = 'albums_layout_style_check';
  insert into ls_res (step, expected, actual, pass) values
    ('constraint definition', 'four values', coalesce(v_def, '(missing)'),
     v_def = 'CHECK ((layout_style = ANY (ARRAY[''masonry''::text, ''grid''::text, ''single_column''::text, ''square''::text])))'),
    ('constraint validated', 'true', coalesce(v_valid::text, '(missing)'), v_valid is true);

  -- Exactly one check on albums mentions layout_style: no second rule narrows it.
  select count(*) into n from pg_constraint c
   where c.conrelid = 'public.albums'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%layout_style%';
  insert into ls_res (step, expected, actual, pass)
  values ('one layout_style check', '1', n::text, n = 1);

  select pg_get_expr(d.adbin, d.adrelid), a.attnotnull into v_dflt, v_nn
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.albums'::regclass and a.attname = 'layout_style';
  insert into ls_res (step, expected, actual, pass) values
    ('default unchanged', '''masonry''::text', coalesce(v_dflt, '(none)'), v_dflt = '''masonry''::text'),
    ('still NOT NULL', 'true', coalesce(v_nn::text, '(missing)'), v_nn is true);
end $$;


-- ── 2. As the photographer: every allowed value saves ───────────────────────

do $$
declare
  v_me    uuid := current_setting('ls.me')::uuid;
  v_album uuid := current_setting('ls.album')::uuid;
  v       text;
  n       int;
  got     text;
  outcome text;
begin
  foreach v in array array['masonry', 'grid', 'single_column', 'square', 'masonry'] loop
    perform set_config('request.jwt.claim.sub', v_me::text, true);
    execute 'set local role authenticated';
    begin
      update albums set layout_style = v where id = v_album;
      get diagnostics n = row_count;
      select layout_style into got from albums where id = v_album;
      outcome := n::text || ' row, now ' || coalesce(got, '(null)');
    exception
      when check_violation then outcome := 'check_violation';
      when insufficient_privilege then outcome := 'permission denied';
    end;
    reset role;
    insert into ls_res (step, expected, actual, pass)
    values ('authenticated saves ' || v, '1 row, now ' || v, outcome, outcome = '1 row, now ' || v);
  end loop;
end $$;

-- A new album created as the photographer, square from the start; and one that
-- names no layout still gets the default.
do $$
declare
  v_me     uuid := current_setting('ls.me')::uuid;
  v_tenant uuid := current_setting('ls.tenant')::uuid;
  got      text;
  dflt     text;
  outcome  text;
begin
  perform set_config('request.jwt.claim.sub', v_me::text, true);
  execute 'set local role authenticated';
  begin
    insert into albums (tenant_id, title, slug, layout_style)
    values (v_tenant, 'Layout test — rolled back', 'layout-test-square', 'square')
    returning layout_style into got;
    insert into albums (tenant_id, title, slug)
    values (v_tenant, 'Layout test — rolled back', 'layout-test-default')
    returning layout_style into dflt;
    outcome := 'ok';
  exception
    when check_violation then outcome := 'check_violation';
    when insufficient_privilege then outcome := 'permission denied';
  end;
  reset role;
  insert into ls_res (step, expected, actual, pass) values
    ('authenticated inserts square', 'square', coalesce(got, outcome), got = 'square'),
    ('insert without layout -> default', 'masonry', coalesce(dflt, outcome), dflt = 'masonry');
end $$;


-- ── 3. Unknown values are refused — by the CHECK, not by another layer ──────

do $$
declare
  v_me    uuid := current_setting('ls.me')::uuid;
  v_album uuid := current_setting('ls.album')::uuid;
  v       text;
  n       int;
  outcome text;
  before  text;
  after   text;
begin
  select layout_style into before from albums where id = v_album;
  foreach v in array array['editorial', 'Square', 'square ', '', 'squares', 'single-column'] loop
    perform set_config('request.jwt.claim.sub', v_me::text, true);
    execute 'set local role authenticated';
    begin
      update albums set layout_style = v where id = v_album;
      get diagnostics n = row_count;
      outcome := 'accepted (' || n::text || ' row)';
    exception
      when check_violation then outcome := 'check_violation';
      when insufficient_privilege then outcome := 'permission denied';
    end;
    reset role;
    insert into ls_res (step, expected, actual, pass)
    values ('authenticated refused ' || quote_literal(v), 'check_violation', outcome, outcome = 'check_violation');
  end loop;

  -- NULL is the column's NOT NULL to refuse.
  perform set_config('request.jwt.claim.sub', v_me::text, true);
  execute 'set local role authenticated';
  begin
    update albums set layout_style = null where id = v_album;
    outcome := 'accepted';
  exception
    when not_null_violation then outcome := 'not_null_violation';
    when check_violation then outcome := 'check_violation';
    when insufficient_privilege then outcome := 'permission denied';
  end;
  reset role;
  insert into ls_res (step, expected, actual, pass)
  values ('authenticated refused NULL', 'not_null_violation', outcome, outcome = 'not_null_violation');

  select layout_style into after from albums where id = v_album;
  insert into ls_res (step, expected, actual, pass)
  values ('refusals left the row alone', coalesce(before, '(null)'), coalesce(after, '(null)'), after is not distinct from before);

  -- And as the table owner, who bypasses RLS: still refused, so the refusal
  -- above is the constraint's.
  begin
    update albums set layout_style = 'editorial' where id = v_album;
    outcome := 'accepted';
  exception when check_violation then outcome := 'check_violation';
  end;
  insert into ls_res (step, expected, actual, pass)
  values ('owner refused editorial', 'check_violation', outcome, outcome = 'check_violation');
end $$;


-- ── 4. Control: the role is really tenant-scoped ────────────────────────────
-- Square on ANOTHER site's album changes nothing (0 rows from RLS), so the
-- successes in block 2 were made as a scoped photographer, not a superuser.

do $$
declare
  v_me    uuid := current_setting('ls.me')::uuid;
  v_other uuid := current_setting('ls.other')::uuid;
  n       int;
  outcome text;
begin
  perform set_config('request.jwt.claim.sub', v_me::text, true);
  execute 'set local role authenticated';
  begin
    update albums set layout_style = 'square' where id = v_other;
    get diagnostics n = row_count;
    outcome := n::text || ' rows';
  exception
    when check_violation then outcome := 'check_violation';
    when insufficient_privilege then outcome := 'permission denied';
  end;
  reset role;
  insert into ls_res (step, expected, actual, pass)
  values ('other site''s album untouched', '0 rows', outcome, outcome = '0 rows');
end $$;


-- ── Report, then abort ──────────────────────────────────────────────────────

do $$
declare
  report text := '';
  r      record;
  failed int;
begin
  for r in select * from ls_res order by ord loop
    report := report || chr(10) ||
      case when coalesce(r.pass, false) then '  PASS  ' else '  FAIL  ' end ||
      rpad(r.step, 38) || ' expected ' || rpad(r.expected, 18) || ' got ' || coalesce(r.actual, '(null)');
  end loop;
  select count(*) into failed from ls_res where not coalesce(pass, false);
  raise exception e'albums.layout_style verification — ROLLED BACK, nothing was kept.\n%',
    report || chr(10) || chr(10) ||
    case when failed = 0
      then 'All checks passed.'
      else failed::text || ' CHECK(S) FAILED.'
    end;
end $$;

rollback;
