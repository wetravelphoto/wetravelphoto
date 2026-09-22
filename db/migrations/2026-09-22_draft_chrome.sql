-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-22 — The header and footer, edited in the canvas
--
-- Their values stay in the site_settings columns they always used (logo,
-- heights, layout, typefaces, sizes, copyright line, newsletter block). What
-- is new is that the editor changes them in the DRAFT first, so they are seen
-- on the page before they go live, publish with Publish and undo with Undo.
--
--   site_draft.chrome   only the values changed in the draft, e.g.
--                       { "header_align": "center", "logo_header_height": 40 }.
--                       NULL means the draft has not touched them.
--
-- See lib/chrome.ts for the list and each value's limits. Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table site_draft add column if not exists chrome jsonb;

commit;

notify pgrst, 'reload schema';
