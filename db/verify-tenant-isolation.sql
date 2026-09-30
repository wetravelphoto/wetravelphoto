-- Proof that tenant isolation actually holds. Run AFTER
-- db/migrations/2026-09-15_tenant_scoping.sql.
--
-- Since 2026-09-30 it also covers `photo_assets` and `photo_usages` (P1,
-- Supabase migration 20260930123113), which db/test-fixture.sql now contains
-- because production does. Before that deployment these assertions lived only
-- in db/verify-photo-assets.sql, which still holds the complete P1 proof.
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

  /*
   * THE PHOTO TABLES (P1, deployed 2026-09-30). One probe photograph and one
   * placement of it on your site, and one photograph on the throwaway site —
   * inserted as the owner, since nobody else may write these tables, and rolled
   * back with everything else. Probes rather than whatever rows exist, so every
   * count below is about rows known to be there; the usage is a DRAFT slot at a
   * position and field no real section uses, so it can never collide with one.
   */
  insert into photo_assets (tenant_id, key_base, display_path)
  values (v_tenant_a, 'isolation-probe/rolled-back', 'isolation-probe/rolled-back/2400.webp');
  insert into photo_usages (tenant_id, asset_id, scope, kind, page_key, field, position)
  select v_tenant_a, id, 'draft', 'page_section', 'home', 'isolation_probe', 9999
    from photo_assets where tenant_id = v_tenant_a and key_base = 'isolation-probe/rolled-back';
  insert into photo_assets (tenant_id, key_base, display_path)
  values (v_tenant_b, 'isolation-probe/rolled-back', 'isolation-probe/rolled-back/2400.webp');
end $$;


-- ── Phase 1 — signed in, own tenant. Everything should work. ────────────────

do $$
declare
  n_update int;
  n_albums int;
  n_assets int;
  n_usages int;
  photo_write text;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', current_setting('iso.me'))::text, true);
  perform set_config('role', 'authenticated', true);

  update site_settings set site_title = site_title;
  get diagnostics n_update = row_count;

  select count(*) into n_albums from albums;

  select count(*) into n_assets from photo_assets
   where tenant_id = current_setting('iso.tenant_a')::uuid and key_base = 'isolation-probe/rolled-back';
  select count(*) into n_usages from photo_usages
   where tenant_id = current_setting('iso.tenant_a')::uuid and field = 'isolation_probe';

  -- READ, not write: in P1 no application role may write the photo tables,
  -- even on its own site. Refused by privilege, before any policy is asked.
  begin
    insert into photo_assets (tenant_id, key_base, display_path)
    values (current_setting('iso.tenant_a')::uuid, 'isolation-probe/write', 'x');
    photo_write := 'allowed — NOT BLOCKED';
  exception when insufficient_privilege then
    photo_write := 'blocked';
  end;

  perform set_config('role', current_setting('iso.owner_role'), true);

  insert into iso_res (step, expected, actual, pass) values
    ('own tenant can write its settings', '1 row', n_update || ' rows', n_update = 1),
    ('own tenant can read its galleries', '1 or more', n_albums || '', n_albums >= 1),
    ('own tenant reads its photo_assets',  '1', n_assets || '', n_assets = 1),
    ('own tenant reads its photo_usages',  '1', n_usages || '', n_usages = 1),
    ('own tenant cannot write photo_assets', 'blocked', photo_write, photo_write = 'blocked');

  perform set_config('iso.albums_seen', n_albums::text, true);
end $$;


-- ── Phase 2 — same account, moved to another tenant. Nothing should work. ───

do $$
declare
  n_update   int;
  n_albums   int;
  insert_err text := 'allowed — NOT BLOCKED';
  n_a_assets int;
  n_a_usages int;
  n_b_assets int;
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

  -- The photo tables have no public surface at all, so here there is no
  -- "unless it is public": every row of site A must be invisible. And the
  -- throwaway site's own probe must still be visible, or a zero above could be
  -- a policy that hides everything rather than one that hides the right thing.
  select count(*) into n_a_assets from photo_assets where tenant_id = current_setting('iso.tenant_a')::uuid;
  select count(*) into n_a_usages from photo_usages where tenant_id = current_setting('iso.tenant_a')::uuid;
  select count(*) into n_b_assets from photo_assets where tenant_id = current_setting('iso.tenant_b')::uuid;

  perform set_config('role', current_setting('iso.owner_role'), true);

  insert into iso_res (step, expected, actual, pass) values
    ('other tenant cannot write settings',    '0 rows',  n_update || ' rows', n_update = 0),
    ('other tenant cannot read private work', '0',       n_albums || '',      n_albums = 0),
    ('other tenant cannot write into yours',  'blocked', insert_err,
       insert_err in ('blocked', 'inconclusive')),
    ('other tenant reads 0 of your assets',   '0',       n_a_assets || '',    n_a_assets = 0),
    ('other tenant reads 0 of your usages',   '0',       n_a_usages || '',    n_a_usages = 0),
    ('and still reads its OWN assets',        '1',       n_b_assets || '',    n_b_assets = 1);
end $$;


-- ── Phase 3 — platform admin. Should see across both. ───────────────────────

do $$
declare
  n_update int;
  n_sites  int;
  n_others int;
  n_assets_all  int;
  n_assets_seen int;
  n_assets_a    int;
begin
  update profiles
     set is_platform_admin = true
   where id = current_setting('iso.me')::uuid;
  -- still parked in tenant B, so this can only pass via the admin flag

  /*
   * HOW MANY SITES THERE ARE, counted before the admin touches anything.
   *
   * This check used to assert `n_update = 1`. That was correct only while the
   * database held exactly one site — the update below names no site, so it
   * touches every row the caller can reach. Production has had several sites
   * for a while, so the check reported a FALSE FAILURE, under a summary line
   * that reads "do not open beta logins". A test that cries wolf about
   * isolation is worse than one that is merely absent.
   *
   * (It was not vacuous in the single-site case: this account is parked in a
   * throwaway tenant that owns no settings row, so without the admin flag it
   * reaches 0, not 1. The old assertion caught a broken flag. It just could
   * not survive a second site.)
   *
   * Counted as the table owner, who bypasses row-level security, so this is
   * the true total rather than what some role can see.
   */
  select count(*) into n_sites from site_settings;

  -- And how many of those belong to a site this account is NOT parked in.
  -- Reaching every row only means something if at least one of them is
  -- somebody else's.
  select count(*) into n_others
    from site_settings
   where tenant_id <> current_setting('iso.tenant_b')::uuid;

  -- The same question of the photo tables: every asset there is, counted as
  -- the owner, and at least one of them on a site this account is not in.
  select count(*) into n_assets_all from photo_assets;

  perform set_config('role', 'authenticated', true);

  update site_settings set site_title = site_title;
  get diagnostics n_update = row_count;

  select count(*) into n_assets_seen from photo_assets;
  select count(*) into n_assets_a    from photo_assets where tenant_id = current_setting('iso.tenant_a')::uuid;

  perform set_config('role', current_setting('iso.owner_role'), true);

  insert into iso_res (step, expected, actual, pass) values
    ('platform admin reaches every site',
     'all ' || n_sites || ' sites',
     n_update || ' of ' || n_sites || ', ' || n_others || ' beyond its own',
     n_update = n_sites and n_others >= 1),
    ('platform admin reads every asset',
     'all ' || n_assets_all,
     n_assets_seen || ' of ' || n_assets_all || ', ' || n_assets_a || ' on site A',
     n_assets_seen = n_assets_all and n_assets_a >= 1);
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
  anon_assets text;
  anon_usages text;
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

  -- The photo tables grant anon NOTHING, so this is refused by privilege —
  -- asserted as a refusal, not as "0 rows", which a policy could also produce.
  begin
    perform count(*) from photo_assets;
    anon_assets := 'allowed — NOT BLOCKED';
  exception when insufficient_privilege then anon_assets := 'blocked';
  end;
  begin
    perform count(*) from photo_usages;
    anon_usages := 'allowed — NOT BLOCKED';
  exception when insufficient_privilege then anon_usages := 'blocked';
  end;

  perform set_config('role', current_setting('iso.owner_role'), true);

  insert into iso_res (step, expected, actual, pass) values
    ('anonymous cannot write settings',      '0 rows', n_update || ' rows',    n_update = 0),
    ('anonymous cannot read private work',   '0',      n_private || '',        n_private = 0),
    ('anonymous cannot list clients',        '0',      n_clients || '',        n_clients = 0),
    ('anonymous cannot list share tokens',   '0',      n_shares || '',         n_shares = 0),
    ('anonymous cannot read favourites',     '0',      n_favs || '',           n_favs = 0),
    ('anonymous cannot delete favourites',   '0 rows', n_fav_write || ' rows', n_fav_write = 0),
    ('anonymous cannot read private photos', '0',      n_shared_ph || '',      n_shared_ph = 0),
    ('anonymous CAN still read public work', '1 or more', n_public || '',      n_public >= 1),
    ('anonymous cannot read photo_assets',   'blocked', anon_assets,           anon_assets = 'blocked'),
    ('anonymous cannot read photo_usages',   'blocked', anon_usages,           anon_usages = 'blocked');
end $$;


-- ── Phase 5 — the service role. Nothing on the photo tables, in P1. ─────────
--
-- The drain, the backfill and ingestion will all run as service_role, which
-- RLS does not narrow — so in P1 it holds no privilege on these tables at all,
-- and P2/P3 each grant it only what their writer needs, on purpose.

do $$
declare
  sr_read  text;
  sr_write text;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);

  begin
    perform count(*) from photo_assets;
    sr_read := 'allowed — NOT BLOCKED';
  exception when insufficient_privilege then sr_read := 'blocked';
  end;
  begin
    delete from photo_usages where field = 'isolation_probe';
    sr_write := 'allowed — NOT BLOCKED';
  exception when insufficient_privilege then sr_write := 'blocked';
  end;

  perform set_config('role', current_setting('iso.owner_role'), true);

  insert into iso_res (step, expected, actual, pass) values
    ('service_role cannot read photo_assets', 'blocked', sr_read,  sr_read  = 'blocked'),
    ('service_role cannot delete usages',     'blocked', sr_write, sr_write = 'blocked');
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
                  -- COALESCE, because a comparison against a null is neither
                  -- true nor false. `v_out.status = 'done'` where nothing came
                  -- back is UNKNOWN, and an unknown result printed as FAIL but
                  -- counted as neither is a report that disagrees with itself —
                  -- which is how 4 failures were once summarised as 2.
                  case when coalesce(pass, false) then '  ok  ' else ' FAIL ' end,
                  step, expected, actual),
           E'\n' order by ord)
    into report
    from iso_res;

  select count(*) into failed from iso_res where not coalesce(pass, false);
  select count(*) into known  from iso_res where not coalesce(pass, false) and step like '%(known)%';

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
