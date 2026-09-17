-- Proof that the draft layer holds. Run AFTER
-- db/migrations/2026-09-16_site_draft.sql.
--
-- Same shape as db/verify-tenant-isolation.sql, and for the same reason:
-- everything happens inside one transaction that ALWAYS ends by raising an
-- exception, which aborts it. The report is the exception message. There is no
-- path through this file that commits, so the draft rows and the throwaway
-- tenant it creates are rolled back whether it passes, fails, or falls over
-- halfway.
--
-- What it is actually checking, in plain terms:
--
--   1. A draft belongs to one site and nobody else can read it. This is the
--      one that matters — a draft is an unannounced rebrand, next season's
--      prices, a gallery a client has not seen. page_sections is deliberately
--      world-readable; this deliberately is not.
--   2. There can only ever be one draft per site.
--   3. Publishing can be written to the undo list. The action check
--      constraint had only three values before today, so a publish would have
--      been refused and — because the code stops when it cannot save an undo
--      point — nothing would have been published at all.
--   4. updated_at looks after itself.

begin;

create temp table draft_res (
  ord      int generated always as identity,
  step     text,
  expected text,
  actual   text,
  pass     boolean
);

-- Phase 4 runs as `authenticated` to ask the question from the other side, and
-- would otherwise be unable to write its own results down.
grant select, insert on draft_res to public;
grant usage on all sequences in schema pg_temp to public;

do $$
declare
  v_me       uuid;
  v_tenant_a uuid;
  v_tenant_b uuid;
begin
  select id, tenant_id into v_me, v_tenant_a
    from profiles order by created_at asc, id asc limit 1;

  if v_me is null then
    raise exception 'No profiles exist, so there is nothing to test as.';
  end if;

  insert into tenants (name, domain)
  values ('Draft test — rolled back', 'draft-test.invalid')
  returning id into v_tenant_b;

  -- A platform admin sees everything by design, so the isolation check would
  -- pass against any policy at all. Off for the duration.
  update profiles set is_platform_admin = false where id = v_me;

  perform set_config('dr.me', v_me::text, true);
  perform set_config('dr.tenant_a', v_tenant_a::text, true);
  perform set_config('dr.tenant_b', v_tenant_b::text, true);
end $$;


-- ── 1. A draft can be written, and only one exists ──────────────────────────

do $$
declare
  n int;
  v_tenant_a uuid := current_setting('dr.tenant_a')::uuid;
begin
  insert into site_draft (tenant_id, pages)
  values (v_tenant_a, '{"home": [{"type": "hero", "visible": true}]}'::jsonb);

  select count(*) into n from site_draft where tenant_id = v_tenant_a;
  insert into draft_res (step, expected, actual, pass)
  values ('draft written', '1', n::text, n = 1);

  -- A second draft for the same site must be impossible, not merely unusual:
  -- two would mean deciding which one Publish means.
  begin
    insert into site_draft (tenant_id, pages) values (v_tenant_a, '{}'::jsonb);
    insert into draft_res (step, expected, actual, pass)
    values ('second draft refused', 'rejected', 'accepted', false);
  exception when unique_violation then
    insert into draft_res (step, expected, actual, pass)
    values ('second draft refused', 'rejected', 'rejected', true);
  end;
end $$;


-- ── 2. updated_at maintains itself ──────────────────────────────────────────

do $$
declare
  t0 timestamptz;
  t1 timestamptz;
  v_tenant_a uuid := current_setting('dr.tenant_a')::uuid;
begin
  select updated_at into t0 from site_draft where tenant_id = v_tenant_a;
  perform pg_sleep(0.01);
  update site_draft set pages = '{"home": []}'::jsonb where tenant_id = v_tenant_a;
  select updated_at into t1 from site_draft where tenant_id = v_tenant_a;

  insert into draft_res (step, expected, actual, pass)
  values ('updated_at moves on write', 'later', case when t1 > t0 then 'later' else 'unchanged' end, t1 > t0);
end $$;


-- ── 3. A publish can be recorded in the undo list ───────────────────────────

do $$
declare
  n int;
  v_tenant_a uuid := current_setting('dr.tenant_a')::uuid;
begin
  insert into site_template_history (tenant_id, action, sections_before, styles_before, note)
  values (v_tenant_a, 'publish', '[]'::jsonb, '{}'::jsonb, 'Draft test — rolled back');

  select count(*) into n
    from site_template_history
   where tenant_id = v_tenant_a and action = 'publish';

  insert into draft_res (step, expected, actual, pass)
  values ('publish is an undo point', '1', n::text, n = 1);

  -- The constraint should still be a constraint.
  begin
    insert into site_template_history (tenant_id, action, sections_before, styles_before)
    values (v_tenant_a, 'demolish', '[]'::jsonb, '{}'::jsonb);
    insert into draft_res (step, expected, actual, pass)
    values ('unknown action refused', 'rejected', 'accepted', false);
  exception when check_violation then
    insert into draft_res (step, expected, actual, pass)
    values ('unknown action refused', 'rejected', 'rejected', true);
  end;
end $$;


-- ── 4. THE ONE THAT MATTERS — another site cannot read the draft ────────────
--
-- Asked from the other side, as the isolation test does: your own account is
-- moved to a throwaway tenant for a moment, and your own draft must stop
-- answering to you.

do $$
declare
  n_visible int;
  n_written int;
  v_me       uuid := current_setting('dr.me')::uuid;
  v_tenant_a uuid := current_setting('dr.tenant_a')::uuid;
  v_tenant_b uuid := current_setting('dr.tenant_b')::uuid;
begin
  update profiles set tenant_id = v_tenant_b where id = v_me;

  perform set_config('request.jwt.claim.sub', v_me::text, true);
  perform set_config('role', 'authenticated', true);
  execute 'set local role authenticated';

  select count(*) into n_visible from site_draft where tenant_id = v_tenant_a;

  insert into draft_res (step, expected, actual, pass)
  values ('other site cannot read the draft', '0 rows', n_visible::text || ' rows', n_visible = 0);

  -- Nor overwrite it.
  update site_draft set pages = '{"home": "vandalised"}'::jsonb where tenant_id = v_tenant_a;
  get diagnostics n_written = row_count;

  insert into draft_res (step, expected, actual, pass)
  values ('other site cannot write the draft', '0 rows', n_written::text || ' rows', n_written = 0);

  reset role;
end $$;


-- ── Report, then abort ──────────────────────────────────────────────────────

do $$
declare
  report text := '';
  r      record;
  failed int;
begin
  for r in select * from draft_res order by ord loop
    report := report || chr(10) ||
      case when r.pass then '  PASS  ' else '  FAIL  ' end ||
      rpad(r.step, 38) || ' expected ' || rpad(r.expected, 12) || ' got ' || r.actual;
  end loop;

  select count(*) into failed from draft_res where not pass;

  -- RAISE's placeholder is %, not %s, and two of them written together would
  -- be an escaped literal percent. One argument, built here.
  raise exception e'Draft layer verification — ROLLED BACK, nothing was kept.\n%',
    report || chr(10) || chr(10) ||
    case when failed = 0
      then 'All checks passed.'
      else failed::text || ' CHECK(S) FAILED — do not ship the canvas until this is green.'
    end;
end $$;

rollback;
