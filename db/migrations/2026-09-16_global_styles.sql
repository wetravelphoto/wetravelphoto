-- 2026-09-16 — global styles
--
-- One place for the colours, typefaces and measures the whole site uses,
-- instead of a scattering of per-section typography fields and seven hex codes
-- hard-coded in app/globals.css.
--
-- Stored as a single JSONB blob for the same reason page_sections.settings is:
-- these are read as a set, by one resolver, and adding the next one should cost
-- a line in lib/styles/tokens.ts rather than a migration, a TypeScript field, a
-- form input and a save action. site_settings is already at 130-odd columns
-- because that lesson arrived late.
--
-- Empty on purpose. lib/styles/tokens.ts holds defaults lifted from
-- globals.css, so a site that never opens the panel renders exactly as it did
-- before the panel existed — and this migration changes nothing on its own.

begin;

alter table site_settings
  add column if not exists global_styles jsonb not null default '{}'::jsonb;

-- The registry version these values were written against, so a future change
-- in meaning can migrate them at read time. Same idea as page_sections.version.
alter table site_settings
  add column if not exists global_styles_version int not null default 1;

commit;


-- ── Verify ───────────────────────────────────────────────────────────────────
--
--   select global_styles, global_styles_version from site_settings where id = 1;
--
-- Expect {} and 1. The site should look identical until you change something
-- in Design → Style.
--
-- Then reload PostgREST or the new columns read as missing:
--
--   notify pgrst, 'reload schema';
