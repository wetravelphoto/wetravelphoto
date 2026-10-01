# Lens Grid — project context

**What this document is.** The durable map of what Lens Grid is, why it is built
the way it is, what exists today, what is settled, and what today's decisions
must leave room for. Written 2026-09-29 so that a fresh session can be useful
without the conversation history that produced the last four phases.

**What it is not.** It is not the roadmap, not the task list, and not the schema.
Those have their own files and own their own truth — see the document map at the
end. Where this document and a canonical file disagree, **the canonical file
wins and this one should be corrected.**

**How to use it.** Read this once at the start of a phase. Then read the one or
two canonical documents that own the thing you are about to change.

---

# 1. Product identity

**Lens Grid is a premium website and business platform built specifically for
photographers.** One rendering engine, many photographers; each site lives at
its own address and belongs to one tenant.

The first tenant is **WeTravelPhoto** — Gonzalo's own wildlife and travel
photography site. It is both the product's first customer and its proving
ground: everything ships against a real site with real photographs before it is
offered to anybody else. The platform brand is **Lens Grid** (`lensgrid.co`);
beta testers get a subdomain (`ana.lensgrid.co`).

## The photograph is the central object

This is the decision every other decision bends around. A photograph is not
decoration inside a page; it is the thing the business is made of, and it will
be referenced from a gallery, a homepage hero, a story, a print listing and a
portfolio at the same time. The data model is being reshaped so that a
photograph has **one identity** and its placements are a projection of that
identity rather than the other way round (§5).

Practical consequence: when a feature could either treat an image as a string on
a page or as a reference to a photograph, choose the reference.

## Not a generic website builder

Lens Grid is deliberately **not** becoming a drag-anything page builder. That
tension was named early and resolved, in `claude/visual-editor-plan.md`:

> Showit's drag-anything freedom is exactly what lets unskilled users make ugly
> sites, and it is why Showit sites are notoriously poor on phones — it keeps
> two separate canvases and asks the user to design twice. Squarespace's
> constraint is not a limitation they failed to remove; it is the product.

The stated philosophy is **"enough freedom to feel unique, enough structure that
it is difficult to look bad"**, and it is resolved by setting the dial *per
axis* rather than globally:

| free | not free |
|---|---|
| which sections, in what order | absolute position, overlap, z-index |
| typography, colour, spacing scale | per-breakpoint hand layout |
| image treatment — crop, ratio, corner, mat | font pairings that fail |
| gallery density, captions, transitions | colour combinations that fail contrast |
| page width | arbitrary CSS |

The goal is **exceptionally beautiful, art-directed photographer websites** —
sites that look like a designer made them — and eventually the photographer's
**business** underneath them. A site that a photographer can make ugly is a
product failure, not a freedom.

## Where the money is

Also from `claude/visual-editor-plan.md`, and it should shape sequencing:

> The builder is table stakes. The photography workflow is the moat.

Squarespace has ~1,800 employees; Format and Pixpa exist anyway, because
Squarespace is mediocre at client galleries, proofing, print fulfilment and
image delivery — and those are what photographers pay for. Build the minimum
builder that gets a beautiful site up, and spend the surplus on the photography
workflow, where this project is already unusually far along.

## House rules that are cultural, not technical

These recur throughout the codebase and the docs, and they are worth adopting
rather than rediscovering:

- **Honest numbers.** `lib/admin/overview.ts`: *"A dashboard that rounds,
  extrapolates or shows a plausible-looking zero is worse than no dashboard."*
  An error is reported as an error, never as a zero.
- **A declaration with nothing behind it is the recurring bug class.** A UNIQUE
  that does not constrain, a `limit` that does not limit, a font picker that
  never fetched a stylesheet, a CSS variable nothing reads, a comment that
  contradicts the code. Most of the expensive faults in this project have this
  shape. Prefer a measurement to a confident sentence.
- **Preview against the photographer's own photographs, never placeholders.**
- **A plan may lock, it may not delete.** A downgrade hides and marks locked;
  going back up restores exactly what was there.

---

# 2. Major product areas

## What exists today

| area | state |
|---|---|
| **Premium photographer website** | Real. Ten section types, seven built-in pages, photographer-created pages, header/footer, 404. |
| **Visual editor ("the canvas")** | Real. `/edit/<page>`, live preview through the real renderer, drag reorder, undo/redo, keyboard shortcuts, version history, private review links. |
| **Draft / publish** | Real. One draft per site covering every page; publish promotes it. |
| **Looks (templates) as data** | Real, snapshot-based. One look shipped; the machinery for more exists. |
| **Global + per-section + per-element styling** | Real. Design tokens site-wide, typography per section, and per-element typography on 25 pieces of text across 8 sections. |
| **Galleries / client delivery** | Real and comparatively mature: public, unlisted, password and client-only galleries; share links; favourites; downloads (per-album switch); zip download. |
| **Stories / Journal** | Real. Story bodies are **11 typed blocks** (`lib/blocks.ts`) with drag-reorder and live preview; TipTap provides rich text inside `components/BlogEditor.tsx`. Grid and card layouts. |
| **Print shop** | Real but **checkout is on hold by decision**. Catalog, print options, wall/frame presets, room-scene mockups. |
| **Inquiries** | Real. Contact form → email via Resend, stored in Messages, honeypot + Turnstile (keys not yet installed). |
| **Newsletter** | Partly. CSV plus connectors for Mailchimp, Kit, MailerLite, Brevo, Flodesk. Local double opt-in and unsubscribe still missing. |
| **Instagram feed** | Real, synced daily by cron. |
| **Analytics** | Real as of S4 — first-party, all standard public site pages. No reading screen yet. |
| **SEO** | Partial. Per-page metadata with a draft layer, sitemap, robots. No JSON-LD, no place model, two implementations that disagree on limits. |
| **Multi-tenancy** | Real on both read and write paths. Host → tenant, RLS, platform admin. |
| **Jobs** | Real as of S3. Database-backed queue. |
| **Error monitoring** | Deployed but inert — Sentry needs its environment variables. |

## What is future

- **Centralised photo library** — the photograph as a first-class object with
  one identity, a library view, "where is this used", and unused-photo queries.
  §5 and `claude/photo-assets-design.md`.
- **More premium section types** — pricing/packages, FAQ, testimonials first,
  then photo grid, text block, image+text rows, CTA banner, video, booking form,
  schedule, logo strip, map, divider.
- **Scene architecture and photographer templates** — §4.
- **Business layer**: bookings, CRM, invoicing, payments, contracts. Nothing
  exists; print-shop checkout is the nearest neighbour and is on hold.
- **Commerce**: print checkout with a lab (Prodigi / WHCC / Printful), plus
  watermarks and fuller proofing.
- **Platform**: super-admin, sign-up and onboarding, billing, custom domains,
  the Lens Grid marketing site, backups and export.
- **Marketing**: the marketing site, then growth features.
- **AI-assisted workflows** — §6.

---

# 3. Current application architecture

Verified against the repository on 2026-09-29. **Do not restate these names from
memory in a later session — check the files.**

## Stack

Next.js **16.3.4** (App Router, React 19.2.8, TypeScript 5), Tailwind 4 via
PostCSS, Supabase (Postgres + Auth + PostgREST; `@supabase/ssr`), Cloudflare R2
for storage via the S3 SDK, `sharp` for derivatives, `exifr` for capture
metadata, Resend for email, Sentry for errors, deployed on **Vercel Hobby**.

> **Next.js 16 is not the Next.js in your training data.** `AGENTS.md` (which
> `CLAUDE.md` imports, and which `next dev` regenerates) says to read
> `node_modules/next/dist/docs/` before writing routing, caching or config code.
> Take that seriously.

## The section registry — the closed action space

`lib/sections/registry.ts` is the most load-bearing file in the product.

- `SECTIONS: Record<string, SectionDef>` — **ten** section types (`hero`,
  `hero-sequence`, `mark`, `intro`, `about`, `galleries`, `journal`, `shop`,
  `instagram`, `contact`), grouped into **five** `FAMILIES` (Opening,
  Photographs, Words, Shop, Connect). `SECTION_TYPES` is its key list.
- Every setting is a declared `Field`, a discriminated union on `kind`:
  `select` (with `options`), `number` (`min`/`max`/`step`), `toggle`, `color`,
  `text`, `textarea`, `image`, `custom`.
- **`Field.content: boolean` is the content/design line**, and
  `splitSettings(def, settings)` enforces it. A look's manifest *physically
  cannot carry* the photographer's words or photographs.
- `resolveSettings` merges stored values over defaults. `visibleFields` applies
  `when`. `deviceView` / `liveFor` / `LIVE_ATTRS` drive per-device values and
  the instant-feedback channel.
- **`Object.keys(def.defaults)` is a larger set than the declared fields.**
  `derivedDefaults()` synthesises `text`, `text_<device>`, `shown` and `_mobile`
  twins that no field declares, deliberately, so a look change cannot eat them.
  Anything that enumerates settings must read the module at runtime, never the
  source literal.
- **The section contract:** never remove or repurpose a key; adding one is free.
  `updateDraftSectionValues` refuses a key not in `def.defaults`, and Next
  redacts server-action errors in production — so a key the panel writes that
  the defaults lack reaches the photographer as *"Minified React error #441"*.

Authority: `claude/sections-engine.md`.

## Pages and section storage

`lib/sections/pages.ts`:

- `PAGES` — seven built-ins: `home`, `about`, `contact`, `journal`, `galleries`
  (public address `/trips`), `shop`, `notfound`. `notfound` has no visitable
  address.
- The photographer's own pages are `{ key, slug, title }` entries in
  `site_settings.custom_pages`, keyed `p_xxxxxxxx` (`CUSTOM_KEY`), max 40,
  served by `app/[slug]/page.tsx`. **A page is identified by its key, not its
  address** — renaming the address moves nothing.
- `RESERVED` is the slug blocklist.

Live section rows live in `page_sections`; there is exactly **one** writer,
`replaceSections()` in `lib/sections/store.ts`, and it is delete-then-insert.
Section ids are regenerated at publish and positions rewritten to `0..n`.

## The visual editor and the draft layer

- `/edit/<page>`, with Style mode at `?mode=style`. Preview at
  `/preview/<page>`. Both the preview and the live page render through **one**
  component, `components/PageBody.tsx` — *"the preview is then honest by
  construction rather than by diligence."*
- `site_draft` — one row per tenant, covering every page. `lib/drafts/store.ts`
  (`writeDraftPage`, `publishDraft`, `discard`, `restoreDraftFrom`),
  `steps.ts` (undo/redo plus `diffDrafts` / `describeChange` in plain English),
  `versions.ts` (`KEEP = 60` restore points), `review.ts` (`/review/<token>`,
  no account needed).
- `patchSiteSettings()` in `lib/site-patch.ts` is the one writer for settings.
  **There is one way for section rows to change and one way for settings to
  change, whatever asked for it.**

Authority: `claude/the-canvas.md`, `claude/draft-layer.md`.

## Value validation — two writers, one rule set

`lib/sections/values.ts` holds the field rules once. Two callers, **two
different failure policies**, deliberately:

- from a **FormData** form (`lib/sections/form.ts` `readField`): an invalid
  value falls back to the current one, because the panel is on screen and the
  control snapping back is the message;
- **programmatically** (`updateDraftSectionValues`): it throws.

This is what makes the registry safe as an AI action space (§6).

## Styling: three layers

1. **Global tokens** — `lib/styles/tokens.ts`: `StyleTokens`, `TOKENS_VERSION`,
   six `PALETTES`, six `PAIRINGS`, `resolveTokens`, `cssVariables`. Emitted as
   inline custom properties on `<html>` from the root layout, so panel values
   beat any stylesheet `:root` rule whatever the load order.
2. **Per-section typography** — three roles (heading, body, over-line),
   `--sec-*` variables.
3. **Per-element typography** — the `text` bag, `--txt-*` variables,
   `lib/type-styles.ts` and `lib/sections/text-style.ts`. Twenty-five pieces of
   text across eight sections carry their own type. Size is stored as a
   **multiplier shown as a percentage**, never an absolute `font-size`, and
   emitted as a custom property the stylesheet multiplies into its own
   `clamp()` — an inline `font-size` would beat the media query and a title
   sized on a desktop would keep that size on a phone.

The `text` bag deliberately has **no field declaration**, which is what makes
`splitSettings` treat it as content so a look change cannot take it away.

Authority: `claude/per-device-and-buttons.md` and the per-element notes in
`claude/open-items.md`.

## Looks (templates) as data

`templates`, `template_versions`, `site_template`, `site_template_history`.

- **Snapshot, not live.** Publishing a new version of a look changes nothing
  anywhere until somebody chooses it. This was the decision that could not be
  deferred, and it is what makes staging, rollback and pricing a *product*
  decision later rather than an architecture decision made by accident.
- A manifest is `{ schema, pages: { home: [...] }, styles }` — order,
  visibility, design settings, typography. Nothing else.
- `applyManifest` in `lib/templates/manifest.ts` is **pure: it decides, it does
  not write.** `describeApply()` returns plain-English lines, and the design
  screen computes the offer before anybody presses anything.
- **A section the new look has no slot for is parked and hidden, never deleted.**
- History is written before the change, or the change is refused.

Authority: `claude/looks-and-tiers.md`.

## Tenancy

Three enforcement layers, and all three are load-bearing:

1. **The database** — `apply_tenant_policy(table)` and
   `apply_tenant_policy_via(table, col, parent)` generate the policies;
   `current_tenant_id()`, `is_platform_admin()` and `tenant_of(regclass, id)`
   are the helpers.
2. **The application** — `requireEditor()` (`lib/auth.ts`) for writes;
   `currentSite()` / `currentSiteTenantId()` (`lib/tenant.ts`) resolves the
   site from the `Host` header against `tenant_domains` for reads. **The host
   decides, not the session:** a signed-in photographer visiting somebody
   else's address sees that person's site.
3. **`scripts/check-tenant-scoping.mjs`**, wired into `npm run build`. It walks
   every `.from('<scoped table>')` and fails if the statement around it never
   mentions `tenant_id`. Its exemption rule is the discipline to copy:

   > *An exemption may only say how a query is NARROWED. "The caller is
   > trusted" is never that. If a reason does not name a filter, it is not a
   > reason.*

   That rule exists because a blanket exemption once hid a bug that showed
   every site's galleries to a photographer who owned none of them, and another
   that would have deleted every photographer's draft on the platform.

Storage is scoped too: everything lives under `t/<tenant id>/…`
(`lib/storage-keys.ts`), and `ownsKey()` checks a browser-supplied key against
that prefix.

`lib/entitlements.ts` is the metering seam: `can(tenantId, capability)` returns
`true` for everything today, and `Capability` is a closed string union. Adding
plans is a change to one function rather than an audit.

Authority: `claude/tenant-scoping.md`.

## Media and photographs today

This is the part being replaced, and it is worth understanding as it is.

*Since P1 (2026-09-30) the replacement's tables exist in production —
`photo_assets`, `photo_usages`, and a nullable `asset_id` on `photos` and
`site_images`. P2 writes `photo_assets` on every upload; P3's database half
(2026-10-01) can project `photo_usages`, and its application half does once it
is pushed. **Nothing READS either table yet** (that is P5). Everything below
still describes how the application actually handles images.*

- `photos` — the gallery membership row, with derivative paths, dimensions and
  EXIF. `photos.album_id` is `NOT NULL` and **ON DELETE CASCADE** (verified
  against production); there are no triggers on `albums` or `photos`.
- `site_images` — photographs uploaded from inside the editor ("Uploads"),
  deprecated on arrival once assets land.
- Everywhere else, **an image is a bare storage path in a settings key** and the
  photograph's identity is thrown away. That is the hole §5 closes.
- `lib/images.ts` (`photoUrl`, `imageSrc`), `lib/srcset.ts` (`srcSetFor`,
  `srcSetFromPath`, `displayUrl`), `lib/derivatives.ts`.
- `photos.alt_text` is never written; `photos.tags` (Lightroom keywords) and
  `photos.latitude` / `longitude` are written and read by nothing.

### A naming hazard, recorded deliberately

**`lib/scenes.ts` already exists and means something else.** It is *room
scenes* for the print shop — a photograph of a room plus the four corners of the
wall space where art hangs, backed by the `room_scenes` table. The future
**Scene architecture** of §4 is unrelated. Do not put Scene-architecture code
in `lib/scenes.ts` or `lib/scenes/`, and pick the namespace deliberately when
that work starts.

## Jobs (S3, deployed)

One queue, in the database rather than a service.

- `jobs` (15 columns) with `enqueue_jobs`, `claim_jobs`, `finish_job` — all
  three SECURITY DEFINER with `search_path = ''`.
- `lib/jobs/{types,queue,handlers,derive,run}.ts`. `drain()` takes a Supabase
  client and claims **one job at a time**, so a claimed-but-never-started job is
  impossible.
- `/api/jobs/drain` behind `CRON_SECRET`, `maxDuration = 300`, and a Vercel cron
  at `0 5 * * *`.
- **Nobody writes to the table directly.** It grants no INSERT, UPDATE or
  DELETE to anybody; the three functions are the whole interface.
- The four properties that make it safe: `for update skip locked` so two drains
  never take the same row; **attempts counted at claim time**, so a job that
  kills its worker still terminates; a **lease** rather than a lock, so
  recovery is the ordinary claim query rather than a second scheduled
  mechanism; and finishing requires still holding that lease.
- **Handlers must be idempotent.** A retry is ordinary.
- First consumer: `backfillDerivatives`, moved off a `do…while` loop that ran
  in the browser.

> The cron runs **once a day because the account is on Hobby** — Vercel rejects
> a more frequent expression *at deploy time*, so the deployment itself fails.
> On Pro it becomes `*/5 * * * *`, one string in `vercel.json`. The
> photographer-facing path does not depend on the cron; pressing "Process
> photographs" drains their own site on the spot.

## Analytics (S4, deployed)

`page_views` with eleven columns: the original five (`id`, `album_id`,
`post_id`, `visitor_hash`, `viewed_at`) plus `tenant_id NOT NULL`, `path`,
`page_key`, `referrer_host`, `session_hash`, `device`.

- `components/ViewTracker.tsx` is mounted **once**, in the root layout, and
  sends **a pathname and nothing that identifies anything**.
- The server resolves the site from the `Host` header and the page by looking
  the pathname up in *that site's own* pages, galleries and stories — so
  another photographer's gallery is not at any address here and the spoof
  **cannot be expressed** rather than being caught.
- `record_page_view` (SECURITY DEFINER, `search_path = ''`, EXECUTE to
  `service_role` only) is the whole write path. No role holds INSERT.
- `lib/analytics/{visit,session,pages,record}.ts`, `app/api/view/route.ts`.
- Coverage is **all standard public site pages**; an individual print-detail
  page (`/shop/<photo id>`) is the one exception and remains an open item,
  because its identity is a photograph id and there is no column to hold or
  validate one. The shop's front page **is** tracked. Admin, editor and preview
  addresses are never tracked.

Authority: `claude/analytics-s4.md`. Privacy stance: §8.

## Database and storage patterns worth knowing

- **PostgREST refuses a select naming a column that does not exist** — the whole
  request errors rather than returning the row without that field. This has
  caused silent, total feature failure more than once (`albums.allow_downloads`
  read in three places before it existed). Adding a column the code already
  reads is therefore urgent, not cosmetic.
- **PostgREST answers an embed it cannot resolve with an error for the whole
  request**, not with the parent and no children. Prefer two flat selects.
- Migrations live in `db/migrations/<date>_<name>.sql` and every one is written
  to be **safe to run twice**.
- Production is PostgreSQL **17.6**; the local fixture runs on **16.13**, so the
  rehearsal is *not* version parity and that is recorded.
- The service-role client (`lib/supabase/admin.ts`) bypasses RLS and exists for
  writes an anonymous visitor must be able to *cause* but must not be able to
  *forge*. `createAdminClientOrNull()` is for surfaces that can degrade;
  `createAdminClient()` throws, for surfaces that must not.

---

# 4. Scene architecture — the approved direction

**Status: approved in principle. There is no dedicated repository document yet,
so this section is currently the authority.** When the work starts it should get
its own `claude/scene-architecture.md`, and this section should shrink to a
pointer.

## The problem it solves

Today a section type has essentially one arrangement. "Three to five layouts per
section type, plus about five templates" is roadmap item 37, and the wrong way
to build it is the obvious way: a template that owns its own components. That
way, N templates is N codebases, switching template destroys the site, and every
new section has to be built N times — Squarespace 7.0, which they spent years
escaping.

## What a Scene is

**A Scene is a presentation recipe for a section type.** It names an
arrangement — how the slots are composed, at each size — and nothing else.

The principles, all of which extend patterns that already exist:

1. **Content stays separate.** A Scene is design. `Field.content` and
   `splitSettings()` already draw that line and already guarantee a design
   change cannot eat the photographer's words or photographs. A Scene changes
   presentation; it never touches content.
2. **React components stay controlled and reusable.** A Scene selects and
   composes existing components with declared props. It is not a second
   rendering engine and it is not a place to paste markup.
3. **A Scene Registry, in the shape of `SECTIONS`.** Closed, enumerable,
   declared in TypeScript, read at runtime. Every Scene declares which section
   type it serves, which slots it has, and which controls it exposes. Its slots
   declare their own `accessibilityRole` — which is why
   `photo-assets-design.md` §4.1 says today's `hero.image_path` role is *not* a
   permanent semantic rule.
4. **Constrained controls, not page-builder freedom.** The free/not-free table
   in §1 is the contract. A Scene may expose a choice; it may not expose
   absolute position, z-index or arbitrary CSS.
5. **Responsive compositions.** A Scene describes the arrangement at every size
   itself. The photographer does not design twice — that is precisely the
   Showit failure mode named in `visual-editor-plan.md`.
6. **Layout belongs to a section INSTANCE, not to a template.** This is the
   load-bearing one. A section on a page carries which Scene it is using, the
   way it already carries `layout` and `type`. Mix-and-match then falls out for
   free.
7. **A template is a preset over approved Scenes.** Already the settled
   definition of a look — *"Template = section list (order + settings) + global
   style values + demo content"* — extended to include the Scene choice per
   section. Switching template keeps the photographs and the words and changes
   the design.
8. **Future AI design operates through approved Scenes and settings.** It picks
   among valid possibilities; **it does not generate CSS** (§6).

## Sequencing

**The generic Scene architecture comes BEFORE any specific design system built
on top of it** (the "Atelier" design-system work discussed separately). Build
the abstraction, prove it with two or three Scenes on one section type, and only
then build a named design system as presets over it. Doing it the other way
round produces a design system welded to one arrangement, which is the fork
`visual-editor-plan.md` warns about.

Corollary for today: **layouts before templates.** Build three to five Scenes
per section type first and the five photographer templates (Wildlife, Landscape,
Wedding, Sessions, Sports) become presets over them. Build the templates first
and each is a fork to maintain separately.

---

# 5. Photography architecture — the approved direction

**Authority: `claude/photo-assets-design.md` (schema, approved in principle,
revision 5, not to be redesigned without a concrete contradiction in the real
codebase) and `claude/photo-migration-plan.md` (implementation order).** What
follows is the shape, not the columns.

## Two tables, and the distinction between them is the whole design

**`photo_assets` — the canonical photograph.** One row per uploaded file
(identified by `key_base`, which identifies one upload and all its
derivatives; `content_sha256` is what identifies identical bytes uploaded
twice). It owns storage paths, derivatives, dimensions, capture metadata, the
canonical `alt_text` with its `alt_source`, ingestion state and lifecycle
(`archived_at`, `deleted_at`, `original_purged_at`).

**`photo_usages` — a read-only projection of placement.**

> `photo_usages` is a derived index. It is written by `syncUsages()` and by
> nothing else. Drop the table, re-run `syncUsages` over every document, and it
> comes back identical.

That sentence is both the rule and the test. It exists because
`replaceSections` is delete-then-insert and five other writers rewrite whole
documents — so a table that tried to be authoritative about placement would be
wrong within a day.

Seven usage kinds (`gallery`, `gallery_cover`, `page_section`, `page_legacy`,
`story_cover`, `story_block`, `shop_listing`), each with a typed parent and its
own **partial unique index** — because a single wide UNIQUE over four nullable
parent columns is `NULLS DISTINCT` and would look like protection while
providing none.

**Galleries stay relationships.** A `gallery` usage is created beside the
`photos` row on upload and destroyed with it by cascade; it is the one kind that
never participates in `syncUsages`. Deleting an album removes the album, its
`photos` rows (production cascade) and their `gallery` usages (ours), with no
application deletion logic in the path.

## Two rules worth carrying into any similar design

- **A value may be mirrored into a projection only if its authoritative source
  lives inside the document whose rewrite triggers the rebuild.** Anything that
  can change independently must be resolved at read time. That is why
  `alt_override` is mirrored and effective alt text is not.
- **Tenant-aware composite foreign keys.** `photo_usages` references
  `(parent_id, tenant_id)`, so a row claiming tenant A cannot point at a parent
  owned by B — enforced by the planner on every write, *including service-role
  writes that bypass RLS*. A trigger was rejected because a trigger is
  invisible at the point of the write.

## Phasing

P1 tables and constraints → P2 unified ingestion → P3 the extractor and
`syncUsages` → P4 backfill → P5 asset-aware pickers, the resolver and alt
semantics → P6 deletion and the sweeper. Detail in §12.

---

# 6. AI architecture — the settled principles

**Authority: `claude/intelligence-architecture.md`.** Its verdict is worth
quoting, because it changes what "add AI" means here:

> The hard part of the brief is already built. "AI chooses among valid
> possibilities rather than generating CSS" needs a closed, enumerable set of
> valid possibilities — `lib/sections/registry.ts` is exactly that. "Propose →
> preview → approve" needs a place to put an unapplied change and a way to show
> it — the draft layer, `/preview`, undo steps, version history and review links
> are exactly that. … The work is not "add AI". It is: **make the data model
> answerable, make the writer honest, and put a thin, metered,
> provider-agnostic layer on top.**

S1–S4 were that groundwork.

## Principles

- **Provider agnostic.** One interface —
  `complete({ task, messages, schema, images?, signal })` — with adapters
  behind it. **OpenAI is the first adapter.** Nothing else in the codebase
  imports a vendor SDK, the same rule already applied to the service-role key.
- **A task registry, not scattered prompts.** A task is a *named string*, and
  `TASKS` is a closed record in the same spirit as `SECTIONS`:
  `{ tier, schema, maxTokens, cacheable, capability }`. `route(task)` resolves
  `{ provider, model }` from config.
- **Models are selected by task and tier**, in one place. Never a model name in
  business logic.
- **Schemas are generated from the registry, not hand-written.** `schemaFor(def)`
  derives the JSON Schema from `SECTIONS`, so the contract cannot drift from the
  panel. Hand-written AI schemas would drift the first week.
- **Scoped context.** A retriever takes a capability handle, the way
  `lib/gallery-access.ts` does: *"Never take an album or photo id from the
  caller and trust it. Never export something that returns rows without a
  `ShareAccess`."*
- **Usage and cost metered from the first call.** An `ai_usage` table costs
  nothing now and cannot be reconstructed later.
- **Jobs for asynchronous work.** S3 exists for this.
- **The proposal model: propose → preview → approve.** An AI change lands in the
  draft and inherits preview, diff-in-plain-English, undo, version history and
  review links for free. `applyManifest` is already a pure proposal function to
  copy rather than reinvent.
- **Deterministic software wherever it can answer.** Analytics aggregate before
  a model sees anything; photo metadata is computed at ingestion; semantic
  search retrieves a candidate set before any vision reasoning; layout comes
  from approved sections and (later) approved Scenes.
- **Agents are thin orchestrators over shared capabilities.** Not five
  independent systems each fetching and parsing Lens Grid. Build the shared
  services; an "agent" is then a retriever set plus a task set.
- **Contextual affordances before any chatbot.** "Generate alt text", "Find SEO
  opportunities", "Create story from gallery", "Curate portfolio", "Review this
  page". A conversational assistant comes last, orchestrating capabilities that
  already work alone.
- **No model writes CSS, HTML, SQL or a storage path.** A storage path from a
  model is an unowned-key problem. Structured output is validated by the same
  sanitizers as a manual edit.
- **Incremental, never greenfield.** The registry, the draft layer, the look
  system, the sanitizers, tenant scoping and `PageBody`'s one-tree rule all stay.

## Intended sequence

1. **Alt text** — the proving feature, end to end: context → router → model →
   schema → usage row → proposal → approval → draft. Needs P5.
2. **SEO metadata** as proposals into the draft; also unifies the two SEO
   implementations and their disagreeing limits.
3. **Story generation from a gallery.**
4. **Embeddings and semantic search** — `photo_embeddings` + pgvector in the
   Supabase instance that already exists (**no separate vector database**),
   candidate retrieval first and vision reasoning only over the shortlist.
   Dimensions deferred to a benchmark.
5. **Portfolio and site intelligence** — curation, site review.
6. **Design proposals** — only after `applyLook` goes through the draft and
   section identity survives publish. Scene architecture (§4) is what makes this
   safe.
7. **A conversational orchestrator** — much later, and not the centre.

---

# 7. Security and multi-tenancy invariants

These are the hard rules. S1–S4 each cost something to learn them.

## The rules

- **Tenant enforcement lives in the database AND the application.** Neither
  alone is sufficient: RLS cannot narrow a table with a public SELECT policy by
  site (a signed-out visitor has no tenant to compare against), and an
  application filter can be forgotten by the next query anybody writes.
  `check:tenants` is what notices.
- **Never trust a client-supplied tenant or resource identity.** Derive the
  tenant from the `Host` header or the session. Validate that a referenced
  album, story or page **belongs to the site being acted on** — and prefer a
  design where the wrong resource *cannot be named* over one where it is named
  and refused.
- **SECURITY DEFINER functions are not subject to RLS**, so a definer function
  must restate its table's tenant rule itself.
- **Every SECURITY DEFINER function gets `set search_path = ''`** and fully
  qualifies every application object. `pg_catalog` is always searched first, so
  its functions resolve — but `session_user`, `current_user` and `coalesce` are
  **parser constructs, not catalog functions**, and qualifying them fails.
  Measure rather than apply the rule mechanically.
- **A `grant` is additive.** Stating a privilege set requires revoking from
  `public`, `anon`, `authenticated` and `service_role` first. Never assume
  Supabase's default privileges.
- **RLS decides WHICH ROWS, not WHAT VALUES.** A policy of
  `tenant_id = current_tenant_id()` is fully satisfied by a malformed row on
  your own site. Column integrity needs CHECK constraints and a narrow write
  function.
- **Test as the real roles.** A suite that connects as the table owner holds
  every privilege and bypasses RLS, so it cannot see a grant problem — and a
  grant problem is most of what there is to see.
- **Production schema truth is authoritative**, and it lives in
  `db/schema-verified.md` and `db/schema-2026-09.sql`. The fixture is the
  rehearsal room and must match production; a fixture that runs *ahead* of
  production is the same failure as one that lags.

## The lessons, one line each

| lesson | where it came from |
|---|---|
| A `grant` is additive; `service_role` had **nothing** on `jobs`, not "the usual defaults". | S3. The drain would have failed with *permission denied*. |
| **An authorisation guard must be NULL-safe.** `if not (x = current_tenant_id() or …)` does not raise when `current_tenant_id()` is NULL (a caller with no profile). Write `(…) is not true`. | P2's suite caught it in its own draft — and then found the same shape live in S3's `enqueue_jobs`. Hotfixed 2026-09-30. `record_page_view` has it too, unexposed (service_role only). |
| RLS protects rows, not values — a photographer could have written a job on their own site with `max_attempts` at a million. | S3. The fix was a narrow DEFINER function, not a broader policy. |
| **A platform admin passes every tenant check**, so an unqualified query that is safe for an ordinary tenant is not safe at all. | The dashboard counted every site's views as one photographer's; `deleteDraft()` would have deleted every draft on the platform. |
| `update … where id in (select … limit N for update skip locked)` does **not** claim at most N. The planner puts the subquery on the inner side of a semi-join and re-executes it per row. **Use a materialised CTE** — a CTE containing `FOR UPDATE` is never inlined. | S3. `p_limit => 1` claimed five. Plan-dependent, so it surfaced as a flaky test. |
| **A filtered DELETE reads the column it filters on**, so DELETE without SELECT is *permission denied*. | S4. Found only because the suite ran as the real role. |
| A green test must be **capable of detecting the defect it claims to protect against**. | S4. An assertion passed 215/215 with the tenant filter removed, because the database caught what the resolver missed and `ok === false` looked like success. It now asserts *which layer* refused. |
| An `ON CONFLICT` with a targeted column list **fails** against a partial unique index. | S3, measured against the real index. |
| A comment saying "row-level security handles it" over a query that names no filter is not a reason. An exemption must name a filter. | 2026-09-23 and 2026-09-25. |
| Chasing an intermittent test failure instead of dismissing it is the only reason the worst S3 bug was found. | S3. |
| A confident code comment was doing the work a test should have been doing. | The hero re-parenting crash. |

---

# 8. Data and privacy philosophy

Settled by S4, and the direction for anything that records behaviour.
**Authority: `claude/analytics-s4.md`.**

- **First-party only.** One table in our own database. No third-party analytics,
  no pixels.
- **Not stored, each with an assertion behind it:** raw IP addresses, full
  user-agent strings, full referrer URLs, query strings, analytics cookies,
  `localStorage` identifiers, any fingerprint (canvas, fonts, hardware), email
  or account identifiers, any cross-site identifier. No country or location.
- **`visitor_hash`** is `sha256(ip | user-agent | today's date)`, computed and
  discarded in the same request. It rotates at midnight, so nobody can be
  followed across two days. *Known weakness, recorded and not yet fixed:* the
  day is a bucket, not a secret, so the hash is a function of public inputs; a
  server-side pepper would close it without changing any count.
- **`session_hash`** is 16 random bytes minted in the tab and kept in
  **`sessionStorage`** — derived from nothing, gone when the tab closes. A
  cookie would need a consent banner and outlive the visit; `localStorage`
  would quietly become a durable identifier for one person across months.
- **The session may be NULL, and that is ordinary.** `sessionStorage` throws in
  a private window and wherever site data is blocked; the page view is recorded
  anyway with no session. Treating a privacy-respecting browser as an uncounted
  visitor is systematic undercounting of exactly the people most likely to have
  blocked storage. There is **no fallback that outlives the tab**.
- **Reduce at every boundary.** The browser sends a pathname rather than a URL
  and a hostname rather than a referrer, so the discarded part never crosses the
  wire; the server reduces again, because what arrives over a network is never
  what was sent; and the table **refuses the discarded shapes outright** with
  CHECK constraints, so no future writer can put them back.
- **A share-link token is a credential.** It must never be written into a path,
  a log or an export. Sentry scrubs them; analytics refuses those addresses.

---

# 9. Development and deployment workflow

This separation is **deliberate**: the agent that writes a migration is not the
agent that reviews it, and neither applies it without a human in between.

1. **Claude Code inspects, then implements locally.** Read the code before
   changing it.
2. **Claude creates the migration and rehearses it locally** against
   `db/test-fixture.sql` — including running it twice.
3. **Claude runs the test suites and reports the migration's SHA256.**
4. **Claude stops.** It does not apply anything to production, and it does not
   commit or push.
5. **Gonzalo takes the result to ChatGPT.**
6. **ChatGPT reviews independently.**
7. **ChatGPT applies and verifies the Supabase production migration** once
   approved, and reports the Supabase migration version, the verified facts and
   the advisor results.
8. **Claude reconciles** `db/schema-2026-09.sql`, `db/test-fixture.sql`,
   `db/schema-verified.md` and the drift guard to the new production truth —
   *after* deployment, never before.
9. **The suites run again** against the reconciled fixture.
10. **Gonzalo commits and pushes** after a final review.
11. **The next phase begins.**

**The database goes first and the application code follows.** Production having
columns nothing writes to is safe; an application live against a schema without
them is not.

## The verify loop

Run from the repository root. There is no `npm test`; the suites are files.

```bash
npx tsc --noEmit -p .                      # must be clean
npx eslint <the paths you touched>         # repo-wide has pre-existing noise
node scripts/check-tenant-scoping.mjs      # also runs inside `npm run build`
bash scripts/sandbox-build.sh              # expect: BUILD EXIT: 0
```

Database suites need a local Postgres carrying the fixture:

```bash
createdb wtp
psql -d wtp -f db/test-fixture.sql         # jobs (hardened), page_views, the P1 tables, the P2 functions, P3

psql -d wtp -f db/verify-analytics.sql        # 76 assertions
psql -d wtp -f db/verify-jobs.sql             # 114 (incl. the no-profile tenant gate)
psql -d wtp -f db/verify-tenant-isolation.sql # 25 (14 + 11 for the photo tables)
psql -d wtp -f db/verify-photo-assets.sql     # 146
psql -d wtp -f db/verify-photo-ingest.sql     # 246
psql -d wtp -f db/verify-photo-usages.sql     # 159
psql -d wtp -f db/verify-album-cover-fk.sql   # 17
bash scripts/fixture-matches-migration.sh     # 409 jobs + 175 page_views + 1616 P1/P2/P3 facts
bash scripts/jobs-concurrency.sh              # 17, needs two connections
bash scripts/album-cover-fk.sh                # 15, its own scratch database
# db/verify-draft.sql is BROKEN and deliberately not in the loop — see open-items
```

TypeScript suites live in `.mk/` and are run directly:

```bash
npx tsx .mk/analytics.ts       # 295   (needs the database)
npx tsx .mk/jobs.ts            # 64    (needs the database)
npx tsx .mk/photo-assets.ts    # 58    (needs the database)
npx tsx .mk/ingest.ts          # 175   (needs the database; two-connection concurrency)
npx tsx .mk/usages.ts          # 176   (needs the database; two-connection concurrency)
npx tsx .mk/section-values.ts  # 1557
npx tsx .mk/settings.ts        # 408
```

*On a Windows machine* (P1 was rehearsed on one, against portable PostgreSQL
17.6): set `PGCLIENTENCODING=UTF8`, because `psql` can otherwise take the
console's WIN1252 and the migrations carry UTF-8 in their comments; and note
that `.mk/analytics.ts`, `jobs.ts`, `section-values.ts` and `settings.ts`
hard-code the old Linux sandbox root `/home/claude/build`. Both are recorded in
`claude/open-items.md` §5.

That is every suite in `.mk/`. Earlier versions of this list also named
`textvars.ts`, `perdevice.ts`, `blockable.ts`, `preview-chrome.ts` and `.cjs`
bundles; **none has ever been committed to this repository** (whole git
history checked, 2026-09-29). The missing coverage is recorded in
`claude/open-items.md` §5.

Conventions inside these suites, worth matching rather than reinventing: a
`pass` counter plus a `fail: string[]`; an `ok(name, good, detail)` helper; a
SQL suite runs inside one transaction that **always ends by raising**, so the
report is the exception message and nothing is kept; privilege blocks `set role`
to the real role and reset it immediately.

---

# 10. Completed foundation

| | | |
|---|---|---|
| **S1** | Schema truth | **COMPLETE** (no migration — read-only survey) |
| **S2** | Programmatic section value validation | **COMPLETE** (no migration) |
| **S3** | Jobs infrastructure | **DEPLOYED TO PRODUCTION 2026-09-29** |
| **S4** | Analytics instrumentation | **DEPLOYED TO PRODUCTION 2026-09-29** |
| **P1** | `photo_assets` / `photo_usages` tables and constraints | **DEPLOYED TO PRODUCTION 2026-09-30, reconciled** |
| **S3 hotfix** | `enqueue_jobs` tenant guard made NULL-safe | **DEPLOYED TO PRODUCTION 2026-09-30, reconciled** |
| **P2** | Unified photo ingestion | **DEPLOYED TO PRODUCTION 2026-09-30, reconciled — COMPLETE** |
| **P3** | The photo-usage projection (`syncUsages`) | **DEPLOYED TO PRODUCTION 2026-10-01, reconciled, activated — COMPLETE / CLOSED** |

S1 and S2 are complete; S3, S4, P1, the S3 hotfix, P2 and P3 are deployed,
verified and reconciled into the schema-truth files. Application code through
P2 is committed (P1's as `284876c`, P2's and the hotfix's as `1177869`); P3's
as `cd018bd`, deployed by Vercel with `SUPABASE_SERVICE_ROLE_KEY` confirmed in
Production, and activated by the one-time rebuild (2026-10-01: 38 parents, 0
failed, 102 unresolved pre-P2 references for P4). **P4 is next and has not been
started.**

## Production migration identifiers

| phase | Supabase version | name | file sha256 |
|---|---|---|---|
| S3 | `20260929212635` | `jobs_infrastructure_2026_09_29` | `9048133d6ff9431150ab07e1e48188718edf33b83eb6cfb139bb937e0ea7797f` |
| S4 | `20260929231653` | `analytics_instrumentation_2026_09_29` | `c1acb1ae3a68c21094622820c768343e1e5fba63de6ee2f769ba5d4ddd4bfbdf` |
| P1 | `20260930123113` | `photo_assets_p1_2026_09_29` | `fedb6e7f457f9a7e7568efefcb2116ca7ca1b38db113dd3b1d1bf47bdc887eef` |
| S3 hotfix | `20260930184309` | `enqueue_jobs_tenant_guard_2026_09_30` | `fb5e1689de95048f39c76f19a42ca2a7d18e2eecb3c0b8e69d0cbf8c7c4b1bc3` |
| P2 | `20260930191116` | `photo_ingest_2026_09_30` | `6b83b8176f2f669e61e828eea59f84244d3954c47e123b48965031b7af880b9d` |
| P3 A | `20261001005946` | `album_cover_tenant_fk_2026_09_30` | `fad895dc3b16c4ac2bf5859a77bfb6b8d361be2a240351402ff1aad5a93f93ed` |
| P3 B | `20261001010021` | `photo_usages_sync_2026_09_30` | `cad8cabf96345c288964f81fcebab953e1947a744e5aff4b7806b76dd82e642d` |

(The 2026-09-30 hashes are of the files with LF line endings, as git stores
them. A Windows checkout with `core.autocrlf=true` is CRLF and hashes
differently.)

## Production shape, as reconciled

**37 tables · 549 columns · 25 functions · 56 policies · RLS on all 37 ·
PostgreSQL 17.6.**

The policy sequence is 54 → 55 (the queue added one) → 54 (analytics removed
`"Anyone can record a view"`, which was `for insert with check (true)`) → 56
(P1 added one tenant policy on each photo table). P1 added 2 tables and 55
columns (38 + 15 + two `asset_id`) and no function. P2 added five functions
(13 → 18) and changed nothing else; the hotfix changed one line of
`enqueue_jobs`. P3 added seven functions (18 → 25), one CHECK and one index on
`photo_usages`, restated three of its CHECKs, made `albums_cover_photo_fk`
tenant-aware, and re-created two P2 wrappers with the album lock; no table,
column or policy.

The Supabase security advisor warns that `authenticated` may execute five
SECURITY DEFINER functions — `enqueue_jobs` and P2's four `register_*`. **That
is the approved design, not a finding to fix**: each is a narrow, fully
validated door (tenant, resource, key shape, values, privileges — tested as the
real roles), and the alternative would be direct table grants RLS cannot
police. Recorded in `db/schema-verified.md`.

## What each phase actually changed

- **S1** produced the first schema snapshot this repository has ever had, and
  regenerated the fixture from it. The old fixture had **nine foreign keys
  wrong**, declaring NO ACTION where production cascades — a local rehearsal
  proved the opposite of the truth.
- **S2** gave the programmatic writer the same field rules the form writer
  always had, in one shared module with two failure policies.
- **S3** built the queue described in §3, and found three bugs in its own work
  before production.
- **S4** instrumented all standard public site pages; individual print-detail
  pages (`/shop/<photo id>`) remain an open item. Before it, **two of the nine
  public addresses recorded anything**; the homepage, About, Contact, the index
  pages, the shop's front page and every photographer-created page were never
  counted. It also
  closed the open insert policy and gave `page_views` a `tenant_id` — without
  which a photographer could not have read their own homepage views at all,
  because RLS reached the site through the album or story.
- **P1** created `photo_assets` and `photo_usages` and **nothing reads or
  writes them yet** — no user-visible change. What it settled, each proved
  locally and again in production:
  - **No tenant default** on either table: a forgotten tenant under the
    service-role client is a NOT NULL error, not a row filed under the oldest
    site. The parents' existing `tenant_for_insert()` defaults were left alone.
  - **Privileges stated whole:** `authenticated` SELECT only; `anon`,
    `service_role` and PUBLIC nothing; no write function. P2 and P3 each add
    the narrowest writer they need, deliberately.
  - **Tenant-aware composite foreign keys** on all five parents, shown to
    refuse a cross-tenant row that a plain foreign key admits.
  - **Seven per-kind partial unique indexes**, shown to refuse a duplicate slot
    of every kind that one wide UNIQUE admits.
  - **Deleting a site that holds a used asset succeeds** — the tenant CASCADE
    and the asset RESTRICT compose; measured locally and in production.
  - A **`page_key` CHECK** that is the SQL twin of `isPageKey()`, `notfound`
    included, held to it by `.mk/photo-assets.ts` as a permanent invariant.
  - `photos.asset_id` / `site_images.asset_id` exist, nullable, **with no
    foreign key until P4**.
- **The S3 hotfix** made `enqueue_jobs`' tenant guard NULL-safe. It read
  `if not (p_tenant = current_tenant_id() or is_platform_admin())`; for a
  signed-in account with no profile that is `not NULL`, which does not raise,
  so such an account could queue work on any site. Now `(…) is not true`.
  Found by P2's own suite, which tests the same guard shape.
- **P2** made every real photograph upload — gallery, site/editor, journal,
  custom cover — one canonical `photo_assets` row, written in the same
  transaction as the route's own row, through four narrow definer functions.
  Details below; live smoke results in `db/schema-verified.md`.

---

# 11. The current next phase

## P4 — the backfill

**Not started. Do not start it without being asked.** Authority:
`claude/photo-migration-plan.md`, P4. After its passes,
`scripts/rebuild-photo-usages.ts --all` re-projects every site.

## P3 — the photo-usage projection — DEPLOYED 2026-10-01

Supabase `20261001005946` (A, the tenant-aware cover key) and
`20261001010021` (B). `photo_usages` has one writer, `syncUsages`
(`lib/photos/usages.ts`), which reads each parent's SAVED source, extracts the
document references (`lib/photos/extract.ts`), and calls
`sync_photo_usages` — service_role only, refusing a stale snapshot, binding
every reference to the source, resolving only same-site assets, and reading
gallery rows, covers, catalogue entries, legacy columns and share images
itself. Unresolved references are skipped and counted; built-in samples are
ignored. `rebuildUsages` / `scripts/rebuild-photo-usages.ts` is the repair
path. Proved by `db/verify-photo-usages.sql` (159), `.mk/usages.ts` (176),
`db/verify-album-cover-fk.sql` (17) and `scripts/album-cover-fk.sh` (15), and
smoke-tested live (`db/schema-verified.md`). Application commit `cd018bd`,
deployed by Vercel; activated by the one-time `rebuild-photo-usages --all`,
which converged on two identical passes. **COMPLETE / CLOSED.**

## P2 — unified ingestion — DEPLOYED 2026-09-30

Every new photograph upload produces an asset **before** the backfill runs.
Deployed as Supabase `20260930191116` together with, and separately from, the
S3 tenant-guard hotfix (`20260930184309`). Proved by
`db/verify-photo-ingest.sql` (246) and `.mk/ingest.ts` (175), and smoke-tested
live on all four routes. The shape:

- **Four routes, not three**: gallery (`registerPhoto`), site/editor
  (`registerSiteImage`), journal (`registerJournalImage`) and **custom gallery
  covers** (`uploadCustomCover`, which keeps no original — the asset records
  `original_path = NULL`). The accent mark is branding furniture and is **out**.
- **The write boundary is four route-specific SECURITY DEFINER wrappers**
  (`register_gallery_photo`, `register_site_image`, `register_journal_image`,
  `register_album_cover`), EXECUTE to `authenticated` only, over one internal
  upsert nobody can call. No direct table grant for anybody; uploads keep
  running as the photographer. Each wrapper validates the tenant (the
  platform-admin rule), the album, and the exact storage-key shape its route
  mints, and has **no parameter** for anything the database should decide
  (`state`, `alt_*`, lifecycle, `created_by`).
- **Atomic and idempotent**: asset + relationship in one transaction,
  serialised on a row lock of the asset; a retry reuses rather than duplicates.
- **Failure is hardened**: a failed registration fails the upload, after a
  cleanup that first checks no committed asset owns the files.
- **EXIF is normalised everywhere; geolocation is not** — kept only for gallery
  uploads, which store it today. The `exif` column is a 1 KB allowlist.

Authority: `claude/photo-assets-design.md` §9 (revision 7) and
`claude/photo-migration-plan.md`, P2. The P1 record is in §10 and in
`db/schema-verified.md`.

---

# 12. The planned photo sequence

`claude/photo-migration-plan.md` is the exact authority. In outline:

| phase | what | user-visible change |
|---|---|---|
| **P1** | Tables, constraints, indexes, policies. Pure DDL. **DEPLOYED 2026-09-30** (`20260930123113`) and reconciled. | none |
| **P2** | **Unified ingestion.** One `ingest()`, four routes (gallery, site, journal, custom cover), idempotent on `key_base`. Done *before* the backfill so there is no new stream of un-asseted files. EXIF normalisation becomes universal (geolocation does not); journal images finally exist as records. **DEPLOYED 2026-09-30** (`20260930191116`) and reconciled. | none on success; failed uploads now fail cleanly |
| **P3** | **The extractor and `syncUsages`.** Every document edit projects its usages. Deliberately before the backfill, so no live edit goes unprojected. The invariant test: drop every usage row, re-run over every document, and the table comes back identical. **DEPLOYED 2026-10-01** (`20261001005946`, `20261001010021`), reconciled, application `cd018bd` live, rebuilt — **COMPLETE**. | none |
| **P4** | **Backfill**, in idempotent passes through the queue, then the two deferred foreign keys — which applying without violation is itself the proof the passes were complete. | none |
| **P5** | **Asset-aware pickers, the resolver and alt semantics.** P5a: identity travels through `onPick`. P5b: `resolveImage` prefers the asset's real derivatives and falls back to the stored path. | correct srcsets for small photographs; alt semantics |
| **P6** | **Deletion and the sweeper.** Referential integrity replaces reference-scanning; storage deletion becomes deferred with a 30-day grace and a final live-and-draft re-check. | **the one deliberate behaviour change: storage deletion deferred 30 days** |
| **S5** | **AI foundation + alt text**, after P5. | the first AI affordance |

Two standing exclusions: **`srcSetFromPath` is not retired** in this sequence
(only when a query reports zero path-only usages), and **Phase D** — dropping
the redundant file columns from `photos` — is **not this quarter** and needs its
own approval.

---

# 13. The broader roadmap

`claude/roadmap.md` is the broad feature inventory. It does not override a
domain's own canonical document (photo, AI, analytics, schema truth), and
`open-items.md` beats it on priority — see §16. What matters here is what
today's decisions must not block.

- **More premium section types** (roadmap 13), one at a time:
  pricing/packages, FAQ, testimonials; then photo grid, text block, image+text
  rows; then CTA banner, video; then booking form, schedule, logo strip, map,
  divider. Each follows the registry pattern and wants a drawing in
  `SectionThumb.tsx`.
  - **The method:** look at two or three real references first, decide which
    arrangements are worth supporting, *then* write the registry declaration.
  - **What cannot be pasted in:** a 21st.dev block is Tailwind utilities with
    hard-coded colour, type and spacing. Our sections read `--ink` /
    `--surface` / `--ember`, their own typography, `--sec-*`, and tag their text
    so the canvas can select it. A pasted block would ignore Style mode and be
    uneditable. What *is* worth lifting is interaction mechanics — an
    accordion's keyboard handling, a carousel's physics — re-skinned to tokens.
  - **Each new type now costs one extra word per text field** (`textStyle: true`)
    and one line in its stylesheet to get the whole typography panel.
  - **A new BUILT-IN page costs two lines of SQL, each in a migration, each
    with a suite that fails until it is there:**
    - since S4, one line in `record_page_view`'s built-in page map — unless the
      page is not visitable, as `notfound` is not. `.mk/analytics.ts` asserts
      the SQL map matches `PAGES`.
    - since P1, one key in the `photo_usages_page_key_shape` CHECK, which is the
      SQL twin of `isPageKey()` and **does** include non-visitable pages like
      `notfound` — a placement is not a visit. `.mk/photo-assets.ts` holds the
      two to exact parity as a **permanent invariant**: it fails the moment
      `PAGES` gains a key the CHECK lacks, in both the migration text and the
      live constraint.
    Photographers' own pages (`p_xxxxxxxx`) cost nothing: both contracts
    accept `CUSTOM_KEY` already.
- **3–5 Scenes per section type, then five templates** (roadmap 37) — Wildlife,
  Landscape, Wedding, Sessions, Sports, each with its own section *designs* and
  then mix-and-match. §4 is why the layouts come first.
- **Platform, in the order Gonzalo wants** (decided 2026-09-24, Vercel Pro
  **last** because it is the bill that starts when there is something to sell):
  super-admin at lensgrid.co → the Lens Grid marketing site → more looks,
  section types and templates. Then Vercel Pro, the Supabase tier check,
  billing, custom domains, sign-up and onboarding, and deliverability as an
  ongoing job.
- **Speed and quality:** caching public pages (best done with tenant
  resolution), Instagram photos into R2, an image-delivery check (AVIF/WebP and
  correct `sizes` — galleries are the product), structured data, an
  accessibility pass.
- **Richer visitor statistics** (roadmap 21) — after S4 this is a *screen over
  data* rather than a build.
- **Gallery improvements:** carousel arrows and autoplay, a hero built from
  galleries, fuller proofing with comments, download limits, expiry and a final
  selection email; watermarks.
- **Client and business features:** inquiry/booking forms with custom fields,
  print checkout (on hold by decision), then bookings, CRM, invoicing and
  payments.
- **AI layers** as sequenced in §6.

Two hard platform facts that constrain plans: **Vercel Hobby forbids commercial
use and caps 50 domains per project**, and **Supabase's custom-SMTP default is
30 messages an hour**.

---

# 14. Known open operational work

`claude/open-items.md` is the live list and the authority. The highest-impact
items at the time of writing, none of which need code:

1. **The four Sentry environment variables in Vercel.** The code has been
   deployed since 2026-09-24 and does nothing without them, so every fault still
   arrives as a tester saying "it broke". *The most valuable unticked box.*
2. **Confirm `CRON_SECRET` is set** so the nightly drain runs. It fails closed,
   so an unset secret is a queue that never self-drains rather than an open
   endpoint.
3. **Confirm Supabase backups / point-in-time recovery** — somebody else's
   photographs are in that database.
4. **Turnstile keys** (spam protection is built and switched off) and
   **`MAIL_FROM_ADDRESS`** on a verified lensgrid.co address.

Engineering items worth knowing before touching the relevant area:

- **`db/verify-draft.sql` has been broken since the S1 fixture regeneration** and
  is deliberately out of the test loop. One unguarded insert of a `site_draft`
  row the fixture already seeds. The fix is one line, and the suite should be
  added to the standard run afterwards.
- **A one-off read-only pass over the pre-existing Supabase advisor findings** —
  one sitting, each decided on its merits, nothing changed in the same breath.
- **`visitor_hash` has no secret in it** (§8) and **`/shop/<photo id>` is not
  tracked** by S4 — both recorded with their reasons.
- The section-level letterspacing sliders mostly do nothing, and the
  section-level typography controls now overlap the per-element ones without
  the screen saying which is which.

---

# 15. Decision log — settled, do not reopen without new evidence

Each verified against the canonical documents on 2026-09-29.

| decision | where it is settled |
|---|---|
| **The photograph is the central object**, and its identity is separate from its placements. | `photo-assets-design.md`; `intelligence-architecture.md` Part 3 |
| **Scene architecture, not an unconstrained page builder.** Freedom is set per axis. | §4; `visual-editor-plan.md` |
| **A template is a preset, never its own layout code.** Templates become presets over reusable Scenes; layouts come first. | `visual-editor-plan.md`; roadmap 37 |
| **A look is a SNAPSHOT, not a live subscription**, with full history, and every apply is undoable. | `looks-and-tiers.md` |
| **Content and design are separated by `Field.content`, enforced by `splitSettings`** — not by discipline. | `registry.ts`; `looks-and-tiers.md` |
| **The `photo_assets` / `photo_usages` split is approved**, revision 6, usages being a disposable read-only projection — and its tables are deployed (P1, 2026-09-30). | `photo-assets-design.md` §8 |
| **New tenant-owned tables get NO tenant default**; every writer names the site. | `photo-assets-design.md` §3.6; P1 |
| **AI proposes through deterministic systems** — into the draft, validated by the same sanitizers, choosing among declared values. **No model writes CSS, HTML, SQL or a storage path.** | `intelligence-architecture.md` Parts 5 and 8 |
| **Provider-agnostic AI**, one interface, OpenAI as the first adapter, no vendor SDK anywhere else. | `intelligence-architecture.md` Part 4 |
| **Contextual AI affordances before any chatbot**, and no conversational centre. | `intelligence-architecture.md` Parts 5 and 8 |
| **Not building five agents**; build shared services and let an agent be a retriever set plus a task set. | `intelligence-architecture.md` Part 8 |
| **pgvector in the existing Supabase instance. No separate vector database.** | `intelligence-architecture.md` Part 8 |
| **First-party, privacy-conscious analytics**, with a nullable session and no durable identifier. | `analytics-s4.md` |
| **A database-backed job queue, not another queue service** at this scale. Revisit only if the database design proves inadequate. | S3; `photo-migration-plan.md` |
| **Nobody writes to `jobs` or `page_views` directly.** SECURITY DEFINER functions are the whole interface. | S3, S4 |
| **No Phase D this quarter** — the redundant `photos` file columns stay. | `photo-migration-plan.md` |
| **`srcSetFromPath` stays** until a query reports zero path-only usages. | `photo-assets-design.md` §6; `photo-migration-plan.md` |
| **`site_images` is retained but deprecated** — no retirement until picker parity is proven in production. | `photo-assets-design.md` §8 |
| **Videos stay outside `photo_assets` in V1**, and existing video handling is untouched. | `photo-assets-design.md` §4 |
| **`photo_analysis` and `photo_embeddings` are documented, not created.** | `photo-assets-design.md` §5 |
| **Beta testers get a subdomain**, created by a platform admin who emails an invite. No public sign-up this round. | `beta-readiness.md` |
| **Print-shop checkout is on hold by decision.** | roadmap 34 |
| **Vercel Pro is the last step before going operational**, not the first. | `open-items.md` §9 |
| **A plan may lock, it may not delete.** | `looks-and-tiers.md` |

---

# 16. Document map

**`imported` means `CLAUDE.md` pulls it into every session with `@` — only two
documents are: this one and `db/schema-verified.md`. `in repo` means it is on
disk and is NOT in context until a session opens it; the primary canonical
documents below are `in repo`, and the one that owns an area must be read before
changing it. `project` means it exists only in the claude.ai project
"WetravelPhoto"** — ask for it rather than reconstructing it. The thirteen
architecture and planning documents were copied from the project into `claude/`
on 2026-09-29 (commit `0761626`) as the real files, not retyped: a hand-copied
canonical document is a second copy that drifts.

**Precedence, where two documents disagree** (the same rules as `CLAUDE.md`):
`db/schema-verified.md` beats everything on what the production database IS; a
phase- or domain-specific canonical document beats `roadmap.md` in its own
domain — `photo-assets-design.md` / `photo-migration-plan.md` for photo work,
`intelligence-architecture.md` for AI, `analytics-s4.md` for analytics;
`open-items.md` beats `roadmap.md` on current priority; `roadmap.md` is a broad
feature inventory that beats only older, general documents; and any canonical
document beats this file, which should then be corrected.

| document | where | owns |
|---|---|---|
| `CLAUDE.md` | in repo | **Operating instructions.** How a session is allowed to work, and the standard commands. Auto-loaded. |
| `claude/PROJECT-CONTEXT.md` | imported | **This file.** Product, architecture, current state, settled decisions. |
| `db/schema-verified.md` | imported | **Verified production database facts** — what was checked, what was reconstructed, what was found and deliberately left alone. |
| `claude/roadmap.md` | in repo | **The broad feature inventory**, with sizes. Does not override the domain documents below. |
| `claude/open-items.md` | in repo | **Current blockers, issues and priorities**, plus the "what shipped" log. Beats roadmap.md on priority. |
| `claude/photo-assets-design.md` | in repo | **The approved photo data model.** Schema authority for `photo_assets` / `photo_usages`. |
| `claude/photo-migration-plan.md` | in repo | **P1–P6 implementation order**, with each phase's tests, rollback and must-not-change list. |
| `claude/analytics-s4.md` | in repo | **Analytics design and deployment record**, including the privacy stance. |
| `claude/intelligence-architecture.md` | in repo | **The AI architecture** — inspection, decisions and build order. |
| `db/schema-2026-09.sql` | in repo | **The production schema snapshot.** Documentation; never run against production. |
| `db/test-fixture.sql` | in repo | The local rehearsal room. Must match production. |
| `claude/sections-engine.md` | in repo | The section registry and renderer contract. |
| `claude/the-canvas.md` | in repo | The visual editor. |
| `claude/draft-layer.md` | in repo | Draft, publish, undo, versions, review links. |
| `claude/looks-and-tiers.md` | in repo | Looks as data, content/design line, entitlements. |
| `claude/tenant-scoping.md` | in repo | Multi-tenancy enforcement. |
| `claude/visual-editor-plan.md` | in repo | The builder's product brief and the "template is a preset" decision. |
| `claude/lens-grid-platform.md` | in repo | The platform's product direction and future-feature notes. |
| `claude/beta-readiness.md` | project | What had to be true before a tester touched it. |
| `claude/cloudflare-move.md` | project | DNS, domains and the R2 decision. |
| `claude/email-and-newsletter.md` | project | Email foundation and newsletter connectors. |
| `claude/share-links.md` | project | Share-link and review-link design. |
| `claude/settings-screen.md`, `claude/admin-workspace.md`, `claude/per-device-and-buttons.md`, `claude/admin-ad-blocker.md` | project | Admin and editor surfaces. |
| `claude/audit-2026-09-21.md`, `claude/phase-3-remaining.md`, `claude/handoff-session-1.md` | project | Historical. Superseded where they disagree with the above. |
| `AGENTS.md` | in repo | Next.js 16's own agent rules. **Regenerated by `next dev`** — do not delete. |

**Scene architecture has no document of its own yet.** §4 of this file is the
authority until it gets one.

**`.project-docs/` in the repository root is STALE** — four documents frozen at
2026-09-23/24 (`roadmap`, `beta-readiness`, `cloudflare-move`, `the-canvas`).
It predates S1–S4 and everything since. Do not read it as current; `claude/`
holds the live copies of `roadmap.md` and `the-canvas.md`, and the claude.ai
project holds the other two. Deleting `.project-docs/` is an open item.
