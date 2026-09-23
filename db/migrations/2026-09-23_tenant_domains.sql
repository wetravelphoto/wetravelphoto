-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-23 — The addresses a site answers to
--
-- Until now "which site is this?" had no answer on the public side: every
-- visitor got site_settings row 1 whoever they were and wherever they came
-- from. This is the lookup table that makes the Host header mean something.
--
-- WHY A TABLE AND NOT THE tenants.domain COLUMN IT ALREADY HAS
-- ────────────────────────────────────────────────────────────
-- A site has more than one address more often than not, and always at the
-- worst moment. A beta tester starts on ana.lensgrid.co; three weeks later she
-- buys anaphoto.com and wants both to work while she tells people. A column
-- holds one, so the day she connects her own domain the old links break — and
-- that is the day she is telling everybody about her new site.
--
-- So: one row per address, one of them marked primary. The primary is what
-- canonical URLs, Open Graph tags and the sitemap use; the rest answer and
-- keep working. tenants.domain stays where it is and is kept in step as the
-- primary, so nothing that reads it has to change today.
--
-- Hosts are stored lower-cased, with no scheme, no port, no trailing dot and
-- no path — exactly what `Host` gives after the port is stripped.
--
-- Readable by anyone, on purpose: this lookup has to happen before there is a
-- session to read, and a list of hostnames is public by definition — it is
-- DNS. Writes are platform-admin only.
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- `tenants` itself predates db/migrations/ and has never had a file. Recorded
-- here so the shape is written down somewhere that is not a survey dump.
-- (id uuid pk, name text, domain text, created_at timestamptz.)
create table if not exists tenant_domains (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  -- Lower-case hostname. 'ana.lensgrid.co', 'wetravelphoto.com'.
  host       text not null,
  -- The one this site calls home. Canonical URLs and share links use it.
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint tenant_domains_host_shape check (
    host = lower(host)
    and host !~ '[:/[:space:]]'
    and host not like '%.'
    and length(host) between 3 and 253
  )
);

-- An address belongs to exactly one site. This is the whole safety property:
-- without it, two rows could claim the same host and which site a visitor got
-- would depend on row order.
create unique index if not exists tenant_domains_host_key on tenant_domains (lower(host));

-- At most one primary per site.
create unique index if not exists tenant_domains_primary_key
  on tenant_domains (tenant_id) where is_primary;

create index if not exists tenant_domains_tenant on tenant_domains (tenant_id);

-- Backfill from the column that has been carrying this alone.
insert into tenant_domains (tenant_id, host, is_primary)
select t.id, lower(trim(t.domain)), true
  from tenants t
 where t.domain is not null
   and trim(t.domain) <> ''
   and lower(trim(t.domain)) !~ '[:/[:space:]]'
on conflict do nothing;

alter table tenant_domains enable row level security;

drop policy if exists "Anyone resolves a site by its address" on tenant_domains;
create policy "Anyone resolves a site by its address"
  on tenant_domains for select
  using (true);

drop policy if exists "Platform admins manage addresses" on tenant_domains;
create policy "Platform admins manage addresses"
  on tenant_domains for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

revoke all on tenant_domains from anon;
grant select on tenant_domains to anon;
grant select, insert, update, delete on tenant_domains to authenticated;

commit;

notify pgrst, 'reload schema';

-- ── Check ───────────────────────────────────────────────────────────────────
--   select t.name, d.host, d.is_primary
--     from tenant_domains d join tenants t on t.id = d.tenant_id
--    order by t.name, d.is_primary desc;
--
-- ── Adding a beta tester's address by hand, until the screen exists ──────────
--   insert into tenant_domains (tenant_id, host, is_primary)
--   values ('<tenant uuid>', 'ana.lensgrid.co', true);
