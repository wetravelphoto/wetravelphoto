# The canvas — the visual editor

Phase 3 of the builder plan, built 2026-09-17 on top of the draft layer
(`claude/draft-layer.md`). Live at **`/edit/<page>`** for every page, built-in
(home, about, contact, journal, galleries, shop, notfound) or the
photographer's own (`/edit/p_xxxxxxxx`), with a Style mode at `?mode=style`.

## Pages (2026-09-21)

`lib/sections/pages.ts` is the list of editable pages (home, about, contact), used
by the canvas's page switcher (the title in the top bar), the preview route, the
public routes and every canvas action (`requirePage` refuses unknown slugs).
There is one draft for the whole site, so Publish sends every page's changes
together. Adding a page takes three things: an entry in `PAGES`, a mapping in
`legacyPageSections`, and a public route that renders `PageBody`.

- **About** is a new `about` section type (`AboutSection`, which imports
  `about.css` itself). Before its first publish it is built from the `about_*`
  columns and mirrored back to them.
- **Contact** uses the one `contact` section type, in its `layout: 'centered'`
  form (the form centred on its own, with no photograph). The homepage uses
  `layout: 'split'`. A short-lived separate `contact-form` type was folded into
  it the same day. Rows stored under the old name are read as the new type (see
  `RETIRED` and `normalizeRow` in `lib/sections/load.ts`, which also apply to the
  draft), so no migration was needed. Mirroring back to the old columns is
  limited to the sections those columns described (`MIRRORED` in `legacy.ts`),
  so the Contact page's section never writes the homepage's `contact_*` columns.
- **Journal** (`/edit/journal`) and **Galleries** (`/edit/galleries`, public
  `/trips`) use the existing section types with a new `layout: 'grid'`: every
  story with the newest drawn large, and every public gallery as a tile. Their
  old forms redirect to the canvas and `updateJournalPage` / `updateGalleriesPage`
  are deleted. Mirroring is page-aware (`legacyColumns(page, …)`): the journal
  section on the Journal page writes the `journal_page_*` columns, not the
  homepage row's. The grid layouts deliberately apply no section typography,
  because their type lives in `gallery.css` / `journal-cards.css`. The journal
  grid's title-size slider is live (`--journal-title-scale`).
- **Shop** (`/edit/shop`) is a new `shop` section type called "Print wall": the
  title lines, categories, the grid of prints (the "Prints across" slider is
  live via `--cols-wide`) and the caption toggles. It needs `catalog` data,
  loaded in `buildContext`, which reads `?c=` through PageBody's `query` prop.
  The wall texture, heading typeface and closing quote are shared with each
  print's product page, so they stay store-wide in **Shop settings**
  (`/admin/shop/settings`, `updateShopSettings`, under Selling). They are
  applied around the page by `lib/sections/frame.tsx` (`pageFrame`). PageBody
  now takes `page`, and derives both `fill` and the frame from it, so the live
  page and the preview can't dress a page differently. The wall section mirrors
  back to the `shop_*` columns on Publish. For the product page, which still
  reads those columns, this mirror is the live contract, not just a way back.
- **Not found (404)** — see its own section below.
- `fill: true` pages render `PageBody` as a full-height column. Section types
  marked `grows` pass the spare height through the preview wrapper, so the
  preview matches the live page.
- `PageBody` imports every section stylesheet, so a section added to any page
  brings its styles with it.
- The menu labels for all five links, and the "Show the About page" setting, moved
  to **Settings → Menu** (`updateMenu`). The old About/Contact forms now redirect
  to the canvas, `updateAboutPage`, `updateContactPage` and
  `lib/sections/sync.ts` are deleted, and the menu-label inputs were removed from
  the Journal/Galleries/Shop forms.

## The 404 page (2026-09-22)

"Page not found" is a **built-in editor page like any other**, keyed
`notfound`, so a photographer can say what a visitor who lands on a dead
address sees, in their own words and their own style. Before this it was fixed
in code and said "Back to all trips".

- **In the list:** `PAGES.notfound = { label: 'Not found (404)', path: '/404',
  fill: true }`. It appears in the page switcher, Pages & menu, the preview
  route and page settings like the rest.
- **It is never a menu entry.** A 404 has no address a visitor can be sent to,
  so `isLinkablePage(key)` (in `lib/sections/pages.ts`) returns false for it,
  and both `pageIsLive()` in `lib/menu.ts` and the "add to menu" list in
  `PagesMenu` go through it. Even a hand-edited menu row pointing at it is
  dropped when the menu is resolved.
- **Its first version** is `legacyNotFoundSections()`: one Introduction, over-line
  "Error 404", heading "Off the map", and a line saying the page doesn't exist
  or the album is private. So the page is never empty the first time it is
  opened, and the wording it starts from is the wording the site already had.
- **Drawn by** `app/not-found.tsx`, which now loads the sections and renders
  `PageBody … page="notfound"`. It is the same renderer as every other page, so
  the header, footer, menu and styles come along without a second code path.
- **Search settings** work on it too (`MAIN.notfound` in `lib/seo.ts`, falling
  back to "Page not found"). Next.js already serves 404s with a 404 status.
- The path shown in the editor is `/404`; Next.js itself has no such route —
  the page is reached by asking for anything that doesn't exist.

## The site icon (favicon) (2026-09-22)

**Settings → Site icon** (`components/admin/FaviconPanel.tsx`). The picture
browsers show on the tab, in bookmarks and on a phone's home screen. Before
this the site had none at all.

- **Not part of the draft, on purpose.** It never appears on the page, so there
  is nothing to preview and nothing to publish: the upload writes
  `site_settings.favicon_path` and is live at once. This is the same bargain
  the logos used to have before they moved into the canvas — and the reason
  they moved (you want to *see* a logo change) does not apply here.
- **Stored** in the site's own folder in R2, under a fresh random name every
  upload (`branding/icon-<uuid>.<ext>`), with a year-long immutable cache. A
  new icon is a new address, so a browser holding the old one picks the new one
  up rather than being told to re-check a file that rarely changes.
- **Accepts** PNG, SVG, WebP and ICO, up to 500 KB. ICO is allowed because it
  is what favicon generators hand back.
- **Actions:** `uploadFavicon` / `removeFavicon` in `app/actions/branding.ts`,
  both behind `requireEditor()`. Removing forgets the pointer and leaves the
  file in the bucket.
- **Emitted** by the root layout's `generateMetadata` as `icons`
  (`icon`, `shortcut`, `apple`), left out entirely when none is set.
- The panel previews the icon twice, at 16px and 48px. A mark that reads at
  180px and turns to mud at 16 is the usual mistake, and the two sizes side by
  side is the quickest way to notice it.
- Migration: `db/migrations/2026-09-22_favicon.sql`. `getSiteSettings()` is a
  `select('*')`, so the column is picked up with no other change, and the code
  reads `favicon_path ?? null` so it works before the migration has run.

## One typeface for the admin (2026-09-22)

The whole admin and the editor are set in **Inter**, so an admin screen and the
canvas no longer look like two products.

- One variable, `--admin-font` on `:root` in `app/admin/admin.css`
  (`'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif`), applied on
  `.admin-shell` and to its inputs, textareas, selects and buttons — form
  controls do not inherit a font family on their own.
- `UI_FONT_HREF` in `lib/fonts.ts` is the one stylesheet link, loaded by
  `app/admin/layout.tsx` (including on the login page, which has no shell) and
  by `app/edit/[page]/page.tsx`.
- The admin's chrome stylesheets that used to say `var(--font-display)` /
  `var(--font-body)` now say `var(--admin-font)`: admin.css, admin-extra.css,
  settings-extra.css, save-bar.css, uploader.css, gallery.css, home-editor.css.
- **Stylesheets that preview the site keep the site's fonts** —
  home-preview.css, home-preview-ig.css, hero-picker.css, branding.css,
  chrome-device.css. A preview that showed the admin's typeface would be lying
  about the site.
- Four inline `fontFamily` styles were changed the same way (BlockEditor,
  JournalTable, PostActions, the login page).

## Keyboard shortcuts (2026-09-22)

| Key | What it does |
| --- | --- |
| Ctrl/⌘ Z, Ctrl/⌘ Shift Z (or Ctrl Y) | Undo / redo |
| Ctrl/⌘ D | Duplicate the selected section |
| Delete or ⌫ | Remove the selected section, after a confirm |
| Esc | Deselect (back to Page settings) |
| ↑ / ↓ | Move the selection between sections |

**One list, two documents.** The editor is the page and the preview is an
iframe inside it, so a key pressed over the page is heard only by the preview
and a key pressed in the rail only by the editor. `lib/canvas-keys.ts`
(`readShortcut`) is the single place that says which key means what; both sides
read the event with it, and the preview forwards what it finds
(`{ type: 'shortcut', name }`) to the editor. The preview never decides what a
shortcut means — it only names the key.

**What each one does is decided in the editor** (`runShortcut` in Canvas.tsx),
because only the editor knows what is selected and whether a window is open.
Three rules:

- **A text field keeps its own keys.** Anything aimed at an input, textarea,
  select or contenteditable is not a shortcut at all — Backspace in the heading
  field deletes a letter, and that includes the contact form inside the preview.
- **A shortcut that does not apply is not swallowed.** `runShortcut` returns
  whether it acted, and only then is the key prevented, so the arrows go on
  scrolling the preview when nothing is selected and Esc goes on closing
  whatever window is open. With a window open (the picker, Pages & menu,
  History, Share) or in Style mode, only undo/redo are live.
- **Nothing destructive is silent.** Delete asks the same question the × in the
  rail asks. A permanent section says it can't be removed and a singleton says
  it can't be duplicated, rather than doing nothing. The header and footer are
  selectable but are not sections, so neither applies to them.

↑/↓ move the *selection*, not the section — reordering is the rail's ↑/↓
buttons and dragging, and a key that silently rearranges the page is not what
you want next to a key that deletes. With nothing selected, ↓ starts at the top
of the page and ↑ at the bottom. `shortcutHint()` writes the keys into the
tooltips on Undo, Redo, Duplicate and Remove, and names both modifiers rather
than asking the browser which machine this is — the editor is server-rendered
first, and a tooltip that says ⌘ on one pass and Ctrl on the next is a
hydration mismatch for the sake of a character.

## Thumbnails in "Add a section" (2026-09-22)

Each card in the picker carries a small drawing of the arrangement
(`components/canvas/SectionThumb.tsx`). A name and a sentence say what a
section *is*; the picture says what it will look like on the page, which is the
thing actually being chosen between — "Introduction" and "About" read almost
the same in words and not at all the same on a page.

- **Abstract and drawn in code, not screenshots.** A screenshot of one
  photographer's homepage is wrong for the next one and has to be retaken every
  time a section changes. These are a few rectangles on a 160 × 96 grid, so
  they stay honest about the arrangement — a photo on the left, three across, a
  form on the right — which is all a 200px card can usefully say. They inherit
  the editor's own `--cv-*` colours, so they follow the chrome rather than the
  site.
- **One visual grammar** across every card, as CSS classes on the shapes:
  `p` a photograph, `t` a line of text, `a` whatever carries the eye first
  (a heading, a button), `f` a field in a form, `pi` the hills-and-sun glyph
  inside a photograph. The glyph is what stops a grey rectangle reading as an
  empty text block; it is only drawn when the rectangle is big enough to hold
  it (28 × 26 on that grid).
- **Adding a section type without adding a drawing is fine** — it gets the
  plain one. The registry stays the only place a type must be declared, which
  is the rule the picker has always followed.
- Verified in Chromium against the real `canvas.css`, which is how the
  distinction between a photo block and a text block was found to be missing.

This settles the rail's old note about thumbnails: they are in the **picker**,
where you are choosing between types you cannot see. The rail stays names,
because there you are looking at the page itself.

## A photograph behind a section, and how wide it sits (2026-09-22)

Two settings in the same folded **Section** group every type already has
(`SPACING_FIELDS` in the registry, drawn by `app/sections-common.css`). Both
follow the rule that group was built on: **Default changes nothing**.

### Background: a photograph

**Background** gained "A photograph", and with it *Photograph* (the picker),
*Keep in view* (top / middle / bottom), *Words* (light or dark) and *Darken it*
(0–80%).

- **The section never learns about it.** Every section root already reads
  `--sec-bg` for its colour, so `[data-bg='image']` sets that one property to
  `transparent` and the photograph behind shows through. No section type was
  touched.
- **Two layers in one declaration** — a flat `linear-gradient` of
  `rgb(0 0 0 / var(--sec-bg-dim))` over `var(--sec-bg-image)` — rather than a
  pseudo-element. The wrapper's two pseudo-elements are already spoken for in
  the editor (the click target and the outline), and a third stacking context
  around every section is a lot to pay for a dark wash.
- **The one case where the live wrapper becomes a box.** `.sec-wrap` is
  `display: contents`, which has nothing to paint on, so
  `.sec-wrap[data-bg='image']` is a flex column — and on a full-height page
  PageBody gives that wrapper the same `GROW` style the preview uses, so a
  section that grows still can.
- **Words switch with it** (`data-ink`). A photograph does not change the text
  colour on its own and the site's ink is nearly always too dark to read on
  one, so light is the default. `color` is re-stated on the wrapper as well as
  the tokens: text inherits a *computed* colour from the body, so redefining
  `--ink` further down would change everything that reads the token by name and
  nothing that merely inherited.
- **The url is built from a storage key**, so the key is matched against
  `[A-Za-z0-9/_.-]+` before it goes anywhere near a stylesheet. A section set
  to "a photograph" with none chosen yet renders as `default` rather than
  turning its own background off and showing nothing.
- `bg_image` is deliberately **not** `live`: a path has to be wrapped in
  `url()` to be a background, which is a transformation rather than the
  identity. It arrives with the refresh. Position, darkening, words and width
  are all live.
- It is `content: true` — the photographer's own picture, carried across when
  the look changes.

### Width

**Width**: the site's width, Narrow (a reading column), Wide, or Edge to edge.

- Each section's inner element reads `--sec-measure` with **its own old
  max-width as the fallback** — the same bargain as the spacing. So Default is
  not "the site's measure imposed on everything": the galleries grid keeps its
  1400px and the homepage's blocks keep `var(--container)`. Forcing them to
  agree would have moved the live site the day this shipped.
- Edge to edge also drops the side gutter, which each section ROOT reads as
  `--sec-pad-x`, again with its own old value as the fallback.
- The hero and About are full-bleed by construction and have no measure to
  set, which the field's help line says.
- Verified in Chromium against the real stylesheets, at all four widths and in
  both text colours.

## Photographs in the editor (2026-09-22)

A photograph can now be added without leaving the page being built
(`components/canvas/PhotoPicker.tsx`, actions in `app/actions/images.ts`,
migration `2026-09-22_site_images.sql`).

Two things were wrong before. A picture had to be uploaded into a **gallery**
in Admin first — which meant leaving the editor, and which put pictures that
were never meant to be seen as work (an About portrait, a texture) into a
public gallery. And the picker the editor opened was the **admin's**, whose
stylesheet `/edit` does not load: in here it had no backdrop and no styled
controls at all.

- **Two sources, in this order.** *Uploads* — `site_images`, everything added
  from the editor, for the site itself, newest first — then each gallery, so
  the public work can be reused rather than duplicated. A gallery id is never
  trusted on its own; row-level security decides what comes back.
- **Uploads are findable again.** That is the whole point of the table: a
  photograph used on the About page is still there next week for the footer.
  "Take out of Uploads" removes the row and leaves the files, because a
  published page may still point at them.
- **Files go straight to R2** with a short-lived signed URL
  (`/api/upload-url`, folder `site` → `t/<tenant>/site-images/…`), so a
  full-resolution photograph is not capped by the request size limit.
  `registerSiteImage` then builds the same display sizes every other
  photograph gets — and that is where the key is checked against this site's
  own prefix, because the key came from the browser.
- **Uploading is not publishing.** Registering returns a path; the panel
  writes it into the draft like any other setting. Publish puts it live,
  Discard leaves an unused file and nothing else. (The same exception the
  accent mark already had.)
- **Drag and drop** anywhere in the window, or the Upload button. One file is
  taken as "I want this one" and chosen straight away; several are added to
  Uploads to pick from. Uploads run one at a time rather than pushing five
  originals at once.
- **Refusals are in words, before the upload starts:** a type the sizes cannot
  be built from (a phone's HEIC has to be exported first) and anything over
  60 MB. If the row cannot be filed, the photograph is still usable — it just
  will not be in the list.
- **In the panel** an `image` field is `components/canvas/ImageField.tsx`:
  a hidden input carries the value so the Inspector's ordinary form save picks
  it up, and choosing also saves at once, because a photograph is the one
  setting you want on the page immediately. `SectionFields` gained a
  `renderImage` hook alongside `renderCustom`, so the canvas supplies its own
  picker and anything else keeps the admin's.
- The migration was run twice against Postgres 16 to check it is repeatable,
  and the tenant default and policy verified on a real row.

## Version history and review links (2026-09-22)

Two buttons at the top right of the editor, **History** and **Share**.

**Version history** (`lib/drafts/versions.ts`, `HistoryModal`):

- **What is kept:** after every Publish, the whole live site is stored in
  `site_versions`, the newest 60. That covers every page's sections, the
  style, search settings, own pages, the menu, and the header and footer. The
  first publish also keeps a "baseline" of the site before it.
- **Same shape as the draft** (`DraftSnapshot`), so **restoring a version
  makes it the draft** (`restoreDraftFrom`): one Undo step, nothing live until
  Publish. There is no second path that writes live tables.
- The newest version is marked "Live now" and cannot be restored.
- **Best effort:** if a version can't be kept, Publish still happens. The
  older `recordHistory` undo point still blocks a publish when it fails.

**Review links** (`lib/drafts/review.ts`, `ShareModal`,
`app/review/[token]`):

- **What it does:** shows the draft to someone without an account, read-only.
- **The token:** 32 random bytes (base64url) in `draft_shares`, with an expiry
  of 3, 7, 14 or 30 days, a "who it's for" note, and a switch to turn it off.
  Only the site's editors can list or create them.
- **How it is checked:** `openShare()` uses the service-role client to read
  only the share row (by token), then that share's site's draft. The tenant
  comes from the share row, never from the request. The route is read-only,
  noindex, and sends `referrer: no-referrer`.
- **Drawn with** `composeDraftPage(draft, page)`, the same function
  `loadDraftPage` now uses, through PageBody.
- **Staying in the preview:** a bottom bar switches pages and captures clicks
  on the site's own links, so the reviewer stays inside the preview instead of
  landing on the live site.
- With no draft, the page says there is nothing to preview right now. An
  expired or revoked link says so.
- `review` is a reserved page address.

## Header and footer in the canvas (2026-09-22)

The header and footer ("chrome") are selected by clicking them in the preview,
or their fixed rows at the top/bottom of the section rail (ids `__header` /
`__footer`). The right panel is `components/canvas/ChromePanel.tsx`:

- **Header:** logo (upload/replace/built-in), logo height, layout, menu
  typeface, menu size, and a link to Pages & menu.
- **Footer:** logo, logo height, layout, typeface, text size, the copyright
  line, and the newsletter block (show, heading, text).
- **Sizes per device:** a Desktop/Phone switch picks which value the sliders
  hold and puts the preview in that width.

How it is stored and drawn:

- **Same columns as before** (`logo_header_*`, `header_*`, `logo_footer_*`,
  `footer_*`, `footer_copy`, `show_newsletter`, `newsletter_*`). The list and
  limits are `CHROME_FIELDS` in `lib/chrome.ts`.
- While unpublished they are in `site_draft.chrome`: only the changed keys,
  laid over the live settings by `loadDraftPage`. Publish patches them. Undo
  labels are "Header" / "Footer".
- **Live repaint:** `CHROME_LIVE` maps sizes and layout to the custom
  property or attribute the header/footer are drawn with. The bridge's
  `chrome-live` message sets them on `[data-chrome="header|footer"]`, kept as
  pending under `__header`/`__footer` until `settle`. Typeface changes send
  `navFontVars` / `footerFontVars`, the functions SiteHeader/SiteFooter use.
- The header and footer now load their own typeface stylesheet. Before this,
  a menu font that was not one of the site's own fonts never loaded on the
  live site.
- Logo uploads use `uploadChromeLogo`, which stores the file and returns the
  key. The live logo does not change until Publish.
- **Settings page:** the Header/Footer editor (ChromeEditor, LogoUploader),
  the copyright field and the Newsletter form were removed, and the page now
  points to the editor. `updateBranding` now writes only the fields it is
  sent (site name, owner name). `uploadLogo`, `clearLogo` and
  `updateNewsletter` were deleted.

## Your own pages and the menu (2026-09-22)

**Pages & menu** (a button in the top bar) opens one window with two lists
(`components/canvas/PagesMenu.tsx`, actions in `app/actions/pages.ts`):

- **Pages.** Every page, built-in and the photographer's own. Own pages can
  be created (name plus an address, suggested from the name), renamed
  (name/address) or deleted. A new page gets an Introduction headed with its
  name, is added to the end of the menu, and opens in the editor.
- **Menu.** Ordered entries of three kinds:
  - page: its label follows the page unless one is typed;
  - link: https, mailto, tel or /path, optionally in a new tab;
  - folder: one level; it becomes a dropdown on desktop and an indented group
    on phones.

  Entries are arranged with ↑/↓, and →/← move an entry into or out of the
  folder above. Changes save debounced. Pages that are not linkable (the 404)
  are never offered.

How it is stored:

- `site_settings.custom_pages` holds `[{ key, slug, title }]`.
- `site_settings.menu` holds the menu. Null means never set, so the old menu
  is built by `legacyMenu()`, with labels from Settings → Menu.
- Both are also in the draft (null = untouched), so they publish with Publish
  and undo as "Pages & menu".
- **Pages are filed by key**, not address: `p_xxxxxxxx` is used in
  page_sections, page_seo and the draft. Renaming an address moves nothing.
  Built-in keys stay their names ('about').

Where it shows up:

- Public own pages are served by `app/[slug]/page.tsx`. Fixed routes win over
  it, and `RESERVED` in `lib/sections/pages.ts` refuses their addresses.
- `lib/menu.ts` `resolveMenu()` feeds both the header (`HeaderNav`) and the
  footer's Explore list. It drops pages that are switched off (About, a closed
  shop), deleted pages, pages with no address of their own, and empty folders.
- PageBody passes its settings to SiteHeader and SiteFooter, so the preview
  shows the draft's menu.
- The editor's page switcher, preview route, `requirePage` and SEO all accept
  own pages, as the draft has them.
- Publishing a draft that deleted a page clears that page's live sections and
  search settings.
- The sitemap lists own pages.

## Page settings: search and sharing (2026-09-22)

With **no section selected** (click empty space, press Esc, or "Page settings"
at the top of the rail), the right panel shows the page's own settings
(`components/canvas/PageSettings.tsx`). Today these are search and sharing
(`lib/seo.ts`):

- **Title, description, share image, "Hide from search engines".** All are
  optional. An empty field shows its automatic value as a greyed placeholder:
  - title: the main section's heading, as before;
  - description: the tagline (for the shop, the wall's subheading);
  - image: the first image on the page, then the homepage's share image,
    which doubles as the site default.
- Character counters (60 / 160) turn amber past the length search engines cut
  off. A search-result preview and a shared-link preview follow the typing.
- **Stored** in `site_settings.page_seo` (live) and `site_draft.page_seo`
  (null = untouched). The draft holds every page's values, copied from live on
  the first change, so publishing one page never wipes another's. It is saved
  debounced, publishes with Publish, undoes with Undo ("Search & sharing ·
  About"), and uses the same flush/remount rules as the Inspector.
- **Used by** `pageMetadata()` in every editor page's `generateMetadata`:
  - an `absolute` title, description and canonical URL;
  - Open Graph and Twitter tags with the image;
  - `robots: noindex`.

  The root layout sets `metadataBase` from `NEXT_PUBLIC_SITE_URL`, and the
  site icon. The sitemap now lists Galleries and Shop, and leaves out pages
  that are switched off or hidden from search.
- The draft read is `select('*')`, and the upsert drops `page_seo` /
  `edit_label` if the column is missing, so the code works even before its
  migration has run.

## Undo and redo (2026-09-22)

↶ / ↷ in the top bar, plus the keys above. The preview forwards them when it
has focus. Tooltips name the step, e.g. "Undo: Introduction · Homepage".

- **Whole snapshots, not inverse operations.** Before every edit,
  `upsertDraft` keeps the draft as it was in `site_draft_steps`
  (`lib/drafts/steps.ts`, migration `2026-09-22_draft_steps.sql`), so any new
  kind of edit is undoable with no extra code. The newest 50 steps are kept.
- **A burst is one step.** `describeChange` names the thing edited (a section,
  the order, the style) and never the value. `push_draft_step` (SQL, one clock)
  skips a new step when the name matches the last save
  (`site_draft.edit_label`) and that save was under 1.5s ago. Undo/Redo set
  `edit_label` to null, so the next edit always starts a fresh step. An action
  that writes several times can pass one `label` so it undoes as one step
  (`clearDraftSectionTypes`).
- Seeding a page into the draft keeps no step. A save that changes nothing
  (compared with sorted keys) keeps none either. A new edit clears Redo.
  **Publish and Discard clear the steps**, because the site history is the way
  back from a publish.
- **Order in the editor:** flush the panels (Inspector's `flushRef` also waits
  for saves already in flight, e.g. the one a blur sent), settle every live
  value in the preview, take the step, then rebuild the Inspector/Style panels
  (`revision` key) once the refreshed sections arrive, so their inputs show
  the restored values. If the step was on another page, the editor opens that
  page.
- Best effort: if the table is missing, edits still save and Undo just has
  nothing to offer (`edit_label` is dropped from the upsert if the column is
  missing).

## Every section: spacing, background, visibility, duplicate (2026-09-22)

Every section type (the hero excepted, which is full-bleed) gets a folded
**Section** group appended by the registry (`SPACING_FIELDS`, `COMMON_DEFAULTS`):

- **Space above / below**: Default, None, S, M, L, XL. One scale for the whole
  site, multiplied by the Style-mode rhythm.
- **Background**: Default, Page, Alternate, Tint (10% of the accent), Custom
  (a new `color` field kind, validated `#rrggbb` on save), or a photograph —
  see its own section above.
- **Show on** (`hide_on`, the hero included): everywhere, not on phones, phones
  only. The line is 760px, the same one the hero switches crops on. The rail's
  summary line says "Not on phones" / "Phones only".

How it is drawn: PageBody wraps each section (`frameAttrs`) with
`data-space-top`, `data-space-bottom`, `data-bg`, `data-hide` and
`--sec-bg-custom`. On the live site the wrapper is `.sec-wrap`
(`display: contents`, no box); in the editor it is the `.pv-section` itself.
`app/sections-common.css` turns those attributes into `--sec-pad-top`,
`--sec-pad-bottom`, `--sec-bg`, `--sec-measure` and `--sec-pad-x` only. Each section's own root reads them with
its old value as the fallback (`padding-top: var(--sec-pad-top, <old>)`), so
**Default changes nothing**. All five fields are `live` attributes/vars, and the
bridge also paints the `.pv-section` box itself, so they change instantly.

**Duplicate** (⧉ in the rail or Ctrl/⌘ D, not for singletons) is
`duplicateDraftSection`: a deep copy of the settings, inserted right after the
original, then selected.

**Adding in place**: a "+" appears on the thin line between two rail rows, the
bottom button reads "+ Add a section at the end", and the selected section in
the preview shows "+ Add a section below" (bridge message `add-after`). All
three open the same picker with the position (`picking.after`).

## Typography is per section (2026-09-21)

Each section stores its own typography in `settings.type`, covering heading,
body and **over-line**. It is edited in the section's own folded "Typography"
group (a `custom` field with `editor: 'typography'`) and saved like any other
value. The old shared groups in `type_styles` (hero, intro, journal, contact)
are now only a fallback: a section inherits one only if it has never had its
own type **and** its layout applied that group before (`legacyTypeGroup`; grid
layouts inherit nothing). An empty `{}` means "follow the site", which is
different from `null` ("never set", so the section inherits). Every text role
reads `--sec-*` / `--sec-body-*` / `--sec-eyebrow-*`, with fallbacks equal to
what each element had before, so nothing moved visually. That includes grid
headings, over-lines, the contact body text, the shop wall title/intro and
journal excerpts. Live repaint is per section (`data-type-root`, bridge message
`type-vars` with the section id). "Make every section follow the site" clears
both the group overrides and every section's own type, on every page.

Also this pass:
- The preview lays the page out at a real device width (desktop 1440, tablet
  820, phone 390) and scales it to fit. The old "desktop" preview was really
  tablet-width, which hid every wide-screen setting.
- Shop "Prints across" and the new "Galleries across" are `data-cols`
  attributes. frame.css used to force 3 columns below 1200px whatever was
  chosen; it now only caps 4–5.
- Journal grid arrangements: `grid_style` feature / single / columns (2|3).
- `when` can be a list (all must match). A field can start its group `folded`.
- Select values are validated against their options on save.
- Panel headers are Lightroom-style bars.

## The shape

```
┌──────────────────────────────────────────────────────────────────┐
│ ← Homepage [unpublished]   Content|Style  ▫▫▫   preview discard PUBLISH │
├──────────┬───────────────────────────────────┬───────────────────┤
│  Page    │                                   │  Introduction     │
│  Hero    │       the real site, in an        │  ──────────       │
│ ▸Intro   │       iframe, click to select     │  Heading […]      │
│  Gallery │                                   │  Body    […]      │
│ + Add    │                                   │                   │
└──────────┴───────────────────────────────────┴───────────────────┘
```

Dark, full-bleed, and **outside `/admin`** so it does not inherit the sidebar.
An editor with an admin nav down one side is an admin screen with a picture in
it, which is the thing it replaces.

The chrome deliberately does **not** use the site's design tokens, even though
the root layout puts them in scope. Using them would mean the editor changed
colour every time the photographer changed their palette — and turned white the
moment someone picked a pale one. It has its own closed set of `--cv-*`
variables.

## Two modes

**Content** — sections on the left, the selected section's settings on the
right.

**Style** — palettes and type pairings on the left, individual colours,
typefaces and measures on the right. Style is a *mode* rather than a panel
because changing a typeface affects every page, so you want to be looking at a
page while you do it.

## The rules it follows

**Opening the editor writes nothing.** The first *edit* starts the draft.

**Every action writes to the draft and nothing else.** Only `publish()` touches
`page_sections` / `site_settings`, by handing over to `lib/drafts/store.ts`.
(Exception by design: uploading a file, e.g. an accent mark, stores the file in
the bucket; only the pointer to it goes in the draft. The site icon is a
deliberate second exception — it is not something the page shows, so it is not
in the draft at all.)

**Server actions check the session themselves.** An action is a public endpoint.
Style values are validated per-key in `lib/styles/sanitize.ts`; a bad value is
dropped rather than defaulted.

**Saving is automatic, and there is no Save button.** The draft is not the site.

**Edits are not revalidated onto `/`.** Only `/edit/*` and `/preview/*`.
`publish()` is the one place that revalidates `'/'`, with `'layout'`.

## Instant feedback, and the one rule that keeps it honest

**Standing decision (Gonzalo, 2026-09-21): anything adjusted with a slider or
menu should change on the page immediately.** Default to building it that way.

Patching the preview from the editor is normally the thing to avoid, because it
means a second, hand-written renderer that drifts from the real one. So every
instant patch has to be the *identity*: the preview sets exactly what the server
is about to render. Four channels exist:

- **Text.** A plain text setting is written into the element that draws it,
  but only when that element has *no element children*, so the server's output
  is provably that same string. See `lib/sections/editable.ts`.
- **Style tokens.** These *are* the CSS custom properties the page is drawn
  from, set on `.pv-root`. A chosen typeface's stylesheet is injected alongside
  (Google Fonts URLs only).
- **Live section fields** (`live` on a field in the registry, type `LiveSpec`).
  A field declares the ONE property its value changes: a CSS variable
  (`{ var: '--mark-size', unit: 'px' }`) or a data attribute
  (`{ attr: 'data-align' }`). Its renderer writes that property itself on an
  element tagged `{...live(ctx, ['size', 'align'])}`, and the preview sets the
  same property on `[data-live~="size"]`. Wired today for: the mark's size and
  position, the hero's title position and story alignment, and image side on
  intro and contact.
  **A field whose effect is more than one property must not declare `live`.**
- **Per-section typography.** Canvas computes `styleVars()` (the renderer's own
  function) and sends every `--sec-*` variable, with removed ones as null, to
  elements tagged `data-type-group`. Saves are coalesced at 250ms, and the panel
  shows a local copy until the server's copy changes.

**Pending and settle.** A save made halfway through a drag can re-render after
the thumb has moved on, which would snap the page back. The bridge keeps each live
value as *pending* and puts it back whenever the page re-renders, watching
`style` and every live attribute. It clears them when the editor sends `settle`,
which happens once the write holding the final value has landed. This was tested
in a Chromium harness: a stale re-render is overridden; after settle the server
wins; unsafe attributes and non-Google-Fonts stylesheets are refused.

Everything else waits for `router.refresh()`, which re-runs the real server
components.

## Things worth remembering

**The rail is names; the picker has the pictures.** In the rail you are looking
at the page itself, so a name is enough; in the picker you are choosing between
types you cannot see, which is where a drawing earns its place.

**Drag is optimistic, but only the ORDER is.** Settings are always read from the
server; only a list of ids is held locally.

**The inspector snapshots FormData at the keystroke, not at the save**, so
switching sections mid-debounce cannot write one section's text onto another.

**Gesture saves are coalesced** (focal drags, story reorders, typography): the
last value is the only one that matters.

**There is no blanket click overlay.** Links are neutralised in the click
handler (capture phase, `preventDefault`) so fields inside a section can be
hovered.

**Tagging a field is one line per element**, `{...editable(ctx, 'heading')}`.
Components that take props (heroes, contact, Instagram) take an `editable`
boolean. Only things with a field in the panel are tagged.

## Rendered before shipping, and it keeps paying

There are no Supabase keys in the build sandbox, so the chrome is rendered
against the real `canvas.css` in Chromium, and the preview bridge is exercised in
a harness. Past catches: an unstyled Toggle checkbox; a fourth child wrapping a
three-column top bar; FocalPicker's geometry living in a stylesheet the canvas
did not load; the admin's CSS files existing only as stubs in the build copy,
which a blind edit would have wiped; section thumbnails in which a photograph
and a text block were the same grey rectangle; the photo picker inheriting the
admin's stylesheet, which the editor does not load. **A stylesheet is not verified by
a green build.**

## Still open

- Every public index page is now a canvas page. Still outside the canvas: each
  print's product page, each gallery and each story, which are driven by
  their own data.
- The "unpublished changes" flag does not say which pages have changes.
- More fields can gain `live` as their renderers are checked (e.g. counts are
  deliberately excluded: they add or remove elements).

## Last on the roadmap (Gonzalo, 2026-09-21)

**3–5 layout options for every section type**, like the contact section's
split/centred choice, so pages can be put together in hundreds of combinations.
On top of that, **about 5 pre-made templates** (whole-site looks built from those
options; see `claude/looks-and-tiers.md`). This is deliberately scheduled at the
very end, after the platform work. When it comes, follow the contact pattern:
a `layout` key in the type's defaults, fields gated with `when`, and one
renderer that branches, rather than new near-duplicate section types.

## Retired

`/admin/design/style` → redirect into the canvas (2026-09-17).
`/admin/pages/home` and `/details` → redirects to `/edit/home`; old homepage
editor code deleted (2026-09-21). See `claude/phase-3-remaining.md`.
