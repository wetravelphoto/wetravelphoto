-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-23 — A slug belongs to a site, not to the world
--
-- `albums.slug` and `blog_posts.slug` have never had a unique index. Not per
-- site — not at all. With one photographer that is untidy: two galleries could
-- both be called "iceland" and /trips/iceland would show whichever row came
-- back first, which in Postgres means whichever one it felt like.
--
-- With three photographers it stops being untidy. Two of them writing about
-- Iceland is not a collision, it is Tuesday — and the address has to keep
-- meaning one story on one site.
--
-- So: unique on (tenant_id, slug). The application now scopes every lookup by
-- tenant as well (lib/sections/context.ts, app/journal/[slug], album-access);
-- this is the half that cannot be forgotten in a future query.
--
-- ── If this migration fails ─────────────────────────────────────────────────
-- It means duplicates already exist. That is a real thing to look at rather
-- than something to force past, so the index is created without ON CONFLICT
-- and the query to find them is at the bottom of this file. Rename one of each
-- pair in the admin, then run this again.
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- Fail early and legibly, rather than with a bare "could not create unique
-- index" naming a row nobody can find.
do $$
declare
  dupes text;
begin
  select string_agg(format('albums: %L appears %s times', slug, n), '; ')
    into dupes
    from (select slug, count(*) as n from albums group by tenant_id, slug having count(*) > 1) d;

  if dupes is not null then
    raise exception E'Two galleries share a web address, so the index cannot be created.\n%\nRename one of each pair under Admin → Galleries, then run this again.', dupes;
  end if;

  select string_agg(format('stories: %L appears %s times', slug, n), '; ')
    into dupes
    from (select slug, count(*) as n from blog_posts group by tenant_id, slug having count(*) > 1) d;

  if dupes is not null then
    raise exception E'Two stories share a web address, so the index cannot be created.\n%\nRename one of each pair under Admin → Journal, then run this again.', dupes;
  end if;
end $$;

create unique index if not exists albums_site_slug_key     on albums     (tenant_id, slug);
create unique index if not exists blog_posts_site_slug_key on blog_posts (tenant_id, slug);

commit;

notify pgrst, 'reload schema';

-- ── Check ───────────────────────────────────────────────────────────────────
--   select indexname from pg_indexes
--    where indexname in ('albums_site_slug_key', 'blog_posts_site_slug_key');
--
-- ── Finding duplicates, if it refused to run ────────────────────────────────
--   select tenant_id, slug, count(*), array_agg(id)
--     from albums group by tenant_id, slug having count(*) > 1;
--   select tenant_id, slug, count(*), array_agg(id)
--     from blog_posts group by tenant_id, slug having count(*) > 1;
