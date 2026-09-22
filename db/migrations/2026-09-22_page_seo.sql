-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-22 — Search and sharing, per page
--
-- Each editor page (home, about, contact, journal, galleries, shop) can set
-- the title and description search results show, the image a shared link
-- shows, and whether search engines should list it. See lib/seo.ts.
--
--   site_settings.page_seo  what is live:
--                           { "about": { "title": "…", "description": "…",
--                                        "image": "<storage key>",
--                                        "noindex": true }, … }
--   site_draft.page_seo     the same, while unpublished. Null means the draft
--                           has not touched it (not "empty").
--
-- Every field is optional. A page that sets nothing gets exactly what it had
-- before: its heading for a title, the site's tagline for a description, and
-- now also its first photograph (or the homepage's share image) for links.
--
-- No policy changes: both tables already carry theirs. Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table site_settings add column if not exists page_seo jsonb not null default '{}'::jsonb;
alter table site_draft    add column if not exists page_seo jsonb;

comment on column site_settings.page_seo is
  'Per-page search and sharing overrides: title, description, image (storage key), noindex.';

commit;

notify pgrst, 'reload schema';

-- ── Check ───────────────────────────────────────────────────────────────────
--   select page_seo from site_settings;   -- expect {} until something is published
