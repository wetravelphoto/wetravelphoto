-- ═══════════════════════════════════════════════════════════════════════════
-- A SITE'S MARKS BELONG TO THAT SITE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `components/Logo.tsx` fell back to a set of built-in SVGs whenever no logo
-- had been uploaded, and `lib/sections/legacy.ts` did the same for the accent
-- mark. The comment above it said it was so "a fresh site still looks
-- finished", which was true and harmless while there was one site.
--
-- Those files are `/logos/we-travel-photo-*.svg`. With a second site on the
-- platform the fallback stopped being a placeholder and became **another
-- photographer's brand at the top of their homepage** — not obviously wrong
-- enough to replace, because it looks finished. The first tester saw it before
-- anything else.
--
-- The code now falls back to the site's own NAME, set in its own display
-- typeface, and to no mark at all rather than a stranger's. For that to be
-- safe, the site those files actually belong to has to stop relying on the
-- default and name them, which is all this migration does.
--
-- It matches on the address rather than on "the first row", so it does the
-- right thing whatever order the tenants were created in, and it touches
-- nothing if the address is not there.
--
-- Safe to run twice. Safe on a database with no WeTravelPhoto row.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  owner_tenant uuid;
  touched      int;
begin
  select t.id into owner_tenant
    from tenants t
    where t.id in (
      select d.tenant_id from tenant_domains d
       where d.host in ('wetravelphoto.com', 'www.wetravelphoto.com')
    )
    limit 1;

  -- Before tenant_domains is populated, fall back to the tenants.domain
  -- column the addresses were backfilled from.
  if owner_tenant is null then
    select t.id into owner_tenant
      from tenants t
     where t.domain in ('wetravelphoto.com', 'www.wetravelphoto.com')
     limit 1;
  end if;

  if owner_tenant is null then
    raise notice 'no wetravelphoto tenant on this database — nothing to name';
    return;
  end if;

  update site_settings
     set logo_header_path = coalesce(logo_header_path, '/logos/we-travel-photo-word.svg'),
         logo_footer_path = coalesce(logo_footer_path, '/logos/we-travel-photo-full.svg'),
         logo_bird_path   = coalesce(logo_bird_path,   '/logos/we-travel-photo-bird.svg')
   where tenant_id = owner_tenant;

  get diagnostics touched = row_count;
  raise notice 'named the built-in marks on % settings row(s)', touched;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- AFTERWARDS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Who has marks of their own, and who will show their name as type instead
-- (which is the correct answer for a site nobody has uploaded a logo to):
--
--   select t.name, s.logo_header_path, s.logo_footer_path, s.logo_bird_path
--     from site_settings s join tenants t on t.id = s.tenant_id
--    order by t.created_at;
--
-- Any site other than WeTravelPhoto pointing at a /logos/we-travel-photo file
-- is a leak and should be cleared (expect no rows):
--
--   select t.name, s.logo_header_path, s.logo_footer_path, s.logo_bird_path
--     from site_settings s join tenants t on t.id = s.tenant_id
--    where (s.logo_header_path like '/logos/we-travel-photo%'
--        or s.logo_footer_path like '/logos/we-travel-photo%'
--        or s.logo_bird_path   like '/logos/we-travel-photo%')
--      and t.domain not like '%wetravelphoto%';
-- ═══════════════════════════════════════════════════════════════════════════
