-- ============================================================
-- THE SITE ICON (FAVICON)
-- ============================================================
-- The little picture browsers show on the tab, in bookmarks and on a phone's
-- home screen. One file per site, stored in the site's own folder in R2 like
-- the logos, and pointed at from site_settings.
--
-- It is NOT part of the draft: a favicon is not something you see on the page
-- while editing, and there is nothing to preview. Uploading it changes the
-- live site straight away, the same way the logos did before they moved into
-- the canvas.
-- ============================================================

alter table site_settings
  add column if not exists favicon_path text;

comment on column site_settings.favicon_path is
  'Storage key of the site icon (favicon) in R2, or NULL for none.';
