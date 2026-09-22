-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-22 — The photographer's own pages, and an editable menu
--
--   site_settings.custom_pages  pages created in the editor, served at /<slug>:
--                               [{ "key": "p_4k9x2m7q", "slug": "weddings",
--                                  "title": "Weddings" }, …]
--                               Their sections live in page_sections under the
--                               KEY (page = 'p_4k9x2m7q'), so renaming the
--                               address moves nothing.
--
--   site_settings.menu          the header menu: pages, links and one level of
--                               folders (see lib/menu.ts). NULL means never
--                               set: the menu is built as it always was.
--
--   site_draft.custom_pages     the same two, while unpublished. NULL means the
--   site_draft.menu             draft has not touched them.
--
-- No policy changes: both tables already carry theirs, and page_sections
-- already takes any page name. Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table site_settings add column if not exists custom_pages jsonb not null default '[]'::jsonb;
alter table site_settings add column if not exists menu         jsonb;

alter table site_draft    add column if not exists custom_pages jsonb;
alter table site_draft    add column if not exists menu         jsonb;

comment on column site_settings.custom_pages is
  'Pages created in the editor: [{ key, slug, title }]. Sections are filed in page_sections under key.';
comment on column site_settings.menu is
  'Header menu (lib/menu.ts). Null: never set, so the built-in menu is used.';

commit;

notify pgrst, 'reload schema';

-- ── Check ───────────────────────────────────────────────────────────────────
--   select custom_pages, menu from site_settings;   -- expect [] and null until a publish
