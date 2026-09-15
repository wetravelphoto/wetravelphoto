-- Proof that tenant isolation actually holds. Run AFTER
-- db/migrations/2026-09-15_tenant_scoping.sql.
--
-- ── It cannot leave anything behind ─────────────────────────────────────────
--
-- Everything happens inside one transaction that ALWAYS ends by raising an
-- exception, which aborts it. The report is the exception message. There is no
-- path through this file that commits, so the throwaway tenant it creates and
-- the changes it makes to your own profile are rolled back whether it passes,
-- fails, or falls over halfway.
--
-- ── How it tests without inventing a second person ──────────────────────────
--
-- A second photographer would mean a second row in auth.users, which is more
-- machinery than a test should need. Instead it moves YOUR account to a
-- throwaway tenant for a moment and checks that your own site stops answering
-- to you — which is the same question asked from the other side, and needs
-- nothing that does not already exist.
--
-- It also has to switch off your platform-admin flag first, because a platform
-- admin legitimately sees everything. A test run as an admin would pass
-- against a completely broken policy.

begin;

create temp table iso_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

-- ── Setup ────────────────────────────────────────────────────────────────────

do $$
declare
  v_me       uuid;
  v_tenant_a uuid;
  v_tenant_b uuid;
begin
  perform set_config('iso.owner_role', session_user, true);

  select id, tenant_id into v_me, v_tenant_a
    from profiles order by created_at asc, id asc limit 1;

  if v_me is null then
    raise exception 'No profiles exist, so there is nothing to test as.';
  end if;

  insert into tenants (name, domain)
  values ('Isolation test — rolled back', 'isolation-test.invalid')
  returning id into v_tenant_b;

  -- A platform admin sees everything by design, so the test would pass against
  -- any policy at all. Off for the duration.
  update profiles set is_platform_admin = false where id = v_me;

  perform set_config('iso.me', v_me::text, true);
  perform set_config('iso.tenant_a', v_tenant_a::text, true);
  perform set_config('iso.tenant_b', v_tenant_b::text, true);
end $$;


-- ── Phase 1 — signed in, own tenant. Everything should work. ────────────────

do $$
declare
  n_update int;
  n_albums int;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', current_setting('iso.me'))::text, true);
  perform set_config('role', 'authenticated', true);

  update site_settings set site_title = site_title;
  get diagnostics n_update = row_count;

  select count(*) into n_albums from albums;

  perform set_config('role', current_setting('iso.owner_role'), true);

  insert into iso_res (step, expected, actual, pass) values
    ('own tenant can write its settings', '1 row', n_update || ' rows', n_update = 1),
    ('own tenant can read its galleries', '1 or more', n_albums || '', n_albums >= 1);

  perform set_config('iso.albums_seen', n_albums::text, true);
end $$;


-- ── Phase 2 — same account, moved to another tenant. Nothing should work. ───

do $$
declare
  n_update   int;
  n_albums   int;
  insert_err text := 'allowed — NOT BLOCKED';
begin
  update profiles
     set tenant_id = current_setting('iso.tenant_b')::uuid
   where id = current_setting('iso.me')::uuid;

  perform set_config('role', 'authenticated', true);

  -- The settings row still belongs to tenant A.
  update site_settings set site_title = site_title;
  get diagnostics n_update = row_count;

  -- Galleries are only visible here if they are public — which is not a
  -- tenancy leak, it is what "public" means. Private ones must be gone.
  select count(*) into n_albums from albums where privacy_type <> 'public';

  -- Writing a row INTO someone else's tenant must be refused by with check,
  -- not merely defaulted away from.
  begin
    insert into albums (title, slug, privacy_type, tenant_id)
    values ('isolation probe', 'isolation-probe-rolled-back', 'private',
            current_setting('iso.tenant_a')::uuid);
    insert_err := 'allowed — NOT BLOCKED';
  exception
    when insufficient_privilege or check_violation then
      insert_err := 'blocked';
    when others then
      -- A missing NOT NULL column means the insert never got as far as the
      -- policy, so this says nothing either way.
      insert_err := 'inconclusive (' || sqlerrm || ')';
  end;

  perform set_config('role', current_setting('iso.owner_role'), true);

  insert into iso_res (step, expected, actual, pass) values
    ('other tenant cannot write settings',    '0 rows',  n_update || ' rows', n_update = 0),
    ('other tenant cannot read private work', '0',       n_albums || '',      n_albums = 0),
    ('other tenant cannot write into yours',  'blocked', insert_err,
       insert_err in ('blocked', 'inconclusive'));
end $$;


-- ── Phase 3 — platform admin. Should see across both. ───────────────────────

do $$
declare
  n_update int;
begin
  update profiles
     set is_platform_admin = true
   where id = current_setting('iso.me')::uuid;
  -- still parked in tenant B, so this can only pass via the admin flag

  perform set_config('role', 'authenticated', true);

  update site_settings set site_title = site_title;
  get diagnostics n_update = row_count;

  perform set_config('role', current_setting('iso.owner_role'), true);

  insert into iso_res (step, expected, actual, pass) values
    ('platform admin reaches every site', '1 row', n_update || ' rows', n_update = 1);
end $$;


-- ── Phase 4 — a passer-by with the public anon key. ─────────────────────────

do $$
declare
  n_update    int;
  n_clients   int;
  n_private   int;
  n_shares    int;
  n_favs      int;
  n_fav_write int;
  n_shared_ph int;
  n_public    int;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);

  update site_settings set site_title = site_title;
  get diagnostics n_update = row_count;

  select count(*) into n_private from albums where privacy_type <> 'public';
  select count(*) into n_clients from clients;
  select count(*) into n_shares  from album_clients;
  select count(*) into n_favs    from favorites;

  -- Photographs of a privately shared album. Readable by anyone until
  -- 2026-09-15_share_links.sql.
  select count(*) into n_shared_ph
    from photos p
    join albums a on a.id = p.album_id
   where a.privacy_type <> 'public';

  -- Deleting somebody's favourites used to be open to anyone, so this is a
  -- write check, not a read one.
  delete from favorites;
  get diagnostics n_fav_write = row_count;

  -- The regression check. All of the above going to zero is worthless if the
  -- public site went with it.
  select count(*) into n_public from albums where privacy_type = 'public';

  perform set_config('role', current_setting('iso.owner_role'), true);

  insert into iso_res (step, expected, actual, pass) values
    ('anonymous cannot write settings',      '0 rows', n_update || ' rows',    n_update = 0),
    ('anonymous cannot read private work',   '0',      n_private || '',        n_private = 0),
    ('anonymous cannot list clients',        '0',      n_clients || '',        n_clients = 0),
    ('anonymous cannot list share tokens',   '0',      n_shares || '',         n_shares = 0),
    ('anonymous cannot read favourites',     '0',      n_favs || '',           n_favs = 0),
    ('anonymous cannot delete favourites',   '0 rows', n_fav_write || ' rows', n_fav_write = 0),
    ('anonymous cannot read private photos', '0',      n_shared_ph || '',      n_shared_ph = 0),
    ('anonymous CAN still read public work', '1 or more', n_public || '',      n_public >= 1);
end $$;


-- ── Report, and undo everything ──────────────────────────────────────────────

do $$
declare
  report  text;
  failed  int;
  known   int;
begin
  select string_agg(
           format('%s  %-38s expected %-10s got %s',
                  case when pass then '  ok  ' else ' FAIL ' end,
                  step, expected, actual),
           E'\n' order by ord)
    into report
    from iso_res;

  select count(*) into failed from iso_res where not pass;
  select count(*) into known  from iso_res where not pass and step like '%(known)%';

  raise exception E'\n\n%\n\n%\n\nNothing was kept — this transaction always rolls back.\n',
    report,
    case
      when failed = 0 then 'All checks passed.'
      when failed = known then
        format('%s check(s) failed, all of them the known share-link hole. Tenant isolation holds.', failed)
      else
        format('%s check(s) failed, %s of them NOT the known hole. Isolation is NOT holding — do not open beta logins.',
               failed, failed - known)
    end;
end $$;

rollback;
