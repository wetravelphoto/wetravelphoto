# Lens Grid Intelligence — inspection, decisions and the build order

Written 2026-09-29 from a read of the presentation layer, the photo/asset
layer, analytics, SEO, the async story and the whole authorization stack.
**Parts 1–4 are the inspection: verified facts about the code as it stands, with
file paths.** Parts 5–8 are the plan, and carry Gonzalo's decisions of
2026-09-29.

Extends `claude/roadmap.md` item 35 and the AI notes in
`claude/lens-grid-platform.md`, which said the same thing in smaller form:
*"the AI never writes code or touches the database. It returns structured values
for the section fields that already exist (the registry) … into the draft."*
That instinct was right. The architecture turns out to be further along than
that note assumed.

The photo migration has its own document — **`claude/photo-assets-design.md`** —
because it is the one step that needs reviewing before it is written.

---

## The verdict in one paragraph

The hard part of the brief is already built. "AI chooses among valid
possibilities rather than generating CSS" needs a closed, enumerable set of
valid possibilities — `lib/sections/registry.ts` is exactly that, down to the
allowed values of every field. "Propose → preview → approve" needs a place to
put an unapplied change and a way to show it — the draft layer, `/preview`, undo
steps, version history and review links are exactly that. "Content survives
design changes" needs an enforced line — `Field.content` plus `splitSettings()`
is exactly that. What is **not** built is everything underneath: there is no
asset model (a photograph used on the homepage is a bare string with its id
thrown away), no background jobs at all, no analytics worth reasoning over, no
committed schema, and the one programmatic write path an AI would use validates
key names but not values. The work is not "add AI". It is: **make the data model
answerable, make the writer honest, and put a thin, metered, provider-agnostic
layer on top.**

---

# Part 1 — What already supports this direction

## 1.1 The section registry is the action space, already closed

`lib/sections/registry.ts`. Ten section types (`SECTION_TYPES`), five families,
every field declared as a discriminated union on `kind`:

| kind | what it declares | maps to |
|---|---|---|
| `select` | `options: {value,label}[]` | a JSON Schema **enum** |
| `number` | `min`, `max`, `step` | **minimum / maximum / multipleOf** |
| `toggle` | — | **boolean** |
| `color` | — | `pattern: ^#[0-9a-f]{6}$` |
| `text` / `textarea` | `placeholder` | string (no length cap today) |
| `image` | — | a storage key |
| `custom` | `editor`, `note` | excluded — no declared shape |

**This is the single most valuable thing in the codebase for this project.** The
schema an AI must satisfy does not need writing; it needs *generating* from
`SECTIONS`. One function — `schemaFor(def)` — and the contract can never drift
from the panel, because both read the same declaration. Hand-written AI schemas
would drift the first week.

Also closed and enumerable in code: `FAMILIES` (5), `PAGES` (7 built-in),
`PALETTES` (6), `PAIRINGS` (6), `FONT_NAMES` (20), `SPOTS` (15), `DEVICES` (2),
`BACKDROP_KINDS` (3), `SECTION_STYLE_KEYS` (9), `TEXT_VARS` (18), `SEC_VARS`
(14), `CHROME_FIELDS` (20 with limits), `COVER_PRESETS` (16), `Capability` (7).

Caveat worth knowing: `Object.keys(def.defaults)` is a **larger** set than
`def.fields.map(f => f.key)`. The loop at `registry.ts:1316` and
`derivedDefaults()` synthesize `text`, `text_<device>`, `shown` and `_mobile`
twins that no field declares — deliberately, so a look change cannot eat them.
Any schema generator must read the module at runtime, never the source literal.

## 1.2 The draft layer is already propose → preview → approve

| the brief asks for | what exists |
|---|---|
| a place to put an unapplied change | `site_draft`, one row per tenant, `lib/drafts/store.ts` |
| a preview of it | `/preview/[page]` and `/` render through **one** component, `components/PageBody.tsx` — *"The preview is then honest by construction rather than by diligence."* |
| approve | `publishDraft()` |
| reject | `discard()`, `undoDraft()` per step |
| a diff in plain English | `diffDrafts()` + `describeChange()` in `lib/drafts/steps.ts` |
| restore points | `lib/drafts/versions.ts`, `KEEP = 60` |
| show a third party without an account | `/review/<token>`, `lib/drafts/review.ts` |

An AI change that lands in the draft inherits all of it for free. Most products
have to build this *because* of AI. It is already here, and it is better than
what most products build.

## 1.3 `applyManifest` is already a pure proposal function

`lib/templates/manifest.ts:139` — *"Pure: it decides, it does not write."*
`describeApply(result)` returns plain-English lines. `app/admin/design/page.tsx`
computes an `UpdateOffer` **before anyone presses anything**: *"Computed here
rather than promised in the abstract, and read-only: nothing is written until
the button is pressed."*

That is the propose/preview shape, already written, for the largest change the
system makes. The AI design feature should reuse it, not reinvent it.

## 1.4 Content and presentation are separated by a flag, not by discipline

`Field.content: boolean` → `splitSettings(def, settings)` → a template manifest
**physically cannot carry** the photographer's words or photographs. Rules
stated in `manifest.ts:8-25`. A section the new look has no slot for is *parked
and hidden, never deleted*.

So an AI design change can be guaranteed not to eat content by construction.
That guarantee is worth more here than anywhere else in the product.

## 1.5 There is exactly one way for section rows to change, and one for settings

`replaceSections()` and `patchSiteSettings()`. Publish and the look system both
go through them: *"There is one way for section rows to change and one way for
settings to change, whatever asked for it."* An AI cannot invent a new write
path because there is not one to invent.

## 1.6 `ShareAccess` is the capability-handle pattern the context service needs

`lib/gallery-access.ts` states its own two rules: *"1. Never take an album or
photo id from the caller and trust it. 2. Never export something that returns
rows without a `ShareAccess`."* And: *"It runs with the service-role key, which
ignores row level security — so the scoping in this file IS the security."*

That is precisely the shape an AI context retriever must take. It is not a new
pattern to invent; it is an existing one to copy, with a different handle type.

## 1.7 Tenant scoping is enforced in three layers, and the checker will catch the new code

RLS (`apply_tenant_policy`), an application filter on every table with a public
SELECT policy, and `scripts/check-tenant-scoping.mjs` wired into `npm run build`.
Its rule for exemptions is exactly the right discipline for a context service:

> *"an exemption may only say how a query is NARROWED. 'The caller is trusted' is
> never that. If a reason does not name a filter, it is not a reason."*

A new `lib/ai/` directory full of `.from()` calls is caught on day one. Good.

## 1.8 `lib/entitlements.ts` is a ready-made metering seam

`can(tenantId, capability)` returns `true` for everything. `Capability` is a
string union. *"This file exists so that the day plans do exist, adding them is a
change to ONE function rather than an audit of the whole codebase."* AI credits,
per-feature quotas and tier gating land here without touching anything else.

## 1.9 Honest numbers are already a house rule

`lib/admin/overview.ts`: *"A dashboard that rounds, extrapolates or shows a
plausible-looking zero is worse than no dashboard."* The `subscribersAllTime`
fallback exists because *"reporting an error as '0 subscribers' is the exact lie
this file exists to avoid."*

That rule transfers directly to AI recommendations, and it is already the
culture of the codebase rather than something to introduce.

## 1.10 The image pipeline already decodes every photograph

`sharp` runs four resizes per upload; `exifr` already parses keywords, capture
date and GPS. Ingestion-time analysis is a hook onto an existing decode, not a
new pass over the library.

---

# Part 2 — What needs adaptation

## 2.1 The programmatic writer validates key names, not values

`updateDraftSectionValues(page, id, values)` — `app/actions/canvas.ts:297`. The
entire key check:

```ts
for (const key of Object.keys(values)) {
  if (!(key in def.defaults)) {
    throw new Error(`${def.label} has no setting called "${key}".`)
  }
}
```

Then four by-name sanitizers (`type`, `text`, `text_mobile`, `shown`) and a
blind merge. So today this is **accepted and stored**: a `select` value outside
its options, a number outside `min`/`max`, a colour that is not hex, a string
where a boolean belongs, an arbitrarily long string, and every custom-editor
payload (`focal`, `featured_post_ids`, `titles`, `story_focal`).

Renderers re-validate on read, so a bad value degrades rather than breaks — but
it is durably stored and shows in the Inspector as the current value.

**The fix is not new validation.** The FormData path already enforces the
declared schema (`lib/sections/form.ts:27-65`: `readField` clamps numbers,
checks `select` against `options`, tests colour against the hex regex). The work
is routing the programmatic path through the schema that already exists.

## 2.2 Section ids die at publish

`publishDraft` → `replaceSections` is delete-then-insert and passes only
`{type, visible, version, settings}` — Postgres mints new ids. An id is stable
*within a draft session* and not after. A stored proposal that names section ids
is only valid until the next publish.

## 2.3 The one whole-design operation bypasses the draft

`applyLook(slug)` → `install()` → `liveSections()` + `replaceSections()` +
`patchSiteSettings()` — **live, not draft**, and hardcoded to `page = 'home'`
(as are `revertTo` and `captureLook`). Its safety net is `site_template_history`,
a different mechanism from draft undo.

"Make my homepage feel more cinematic" is precisely this operation. If it is to
be a proposal the photographer previews and approves, it has to land in the
draft like everything else.

## 2.4 A photograph is not an asset, and a usage is not a row

- `photos.album_id` is a **single-parent FK**, written once at insert, **never
  updated by any code**. RLS derives a photo's visibility from that one album.
- Every non-gallery usage stores a **bare path string** and throws the id away
  at selection time (`PhotoPicker.tsx:285` — `onPick(image.path)`).
- **12 scalar columns and 5 JSON blobs** hold paths today. Full inventory in
  `claude/photo-assets-design.md`.
- Exactly **7 columns in the whole schema** are photo-id foreign keys, 6 of them
  shop/client-gallery.
- Reference counting is `JSON.stringify(post.blocks).includes(path)`
  (`app/actions/galleries.ts:60`). `deletePhoto` does no such check at all — it
  deletes every R2 object unconditionally.
- **Two disjoint asset tables** (`photos`, `site_images`) with no relation, and a
  **third class of file with no row at all**: `registerJournalImage` returns a
  path and records nothing.
- Per-usage data is scattered in three incompatible shapes:
  `albums.cover_focal_x/y`, `settings.focal` as `{x,y,mx,my}`, and
  `settings.story_focal` keyed by **post id**. `alt_text` is a column **no code
  ever writes**.

## 2.5 Analytics cannot answer the questions the brief asks of it

`app/api/view/route.ts` inserts **three columns**: `album_id`, `post_id`,
`visitor_hash` (`sha256(ip|ua|YYYY-MM-DD)` — so "unique visitor" means unique
*per day*). No path, no referrer, no session, no device.

Instrumented: **two routes** — `/trips/[slug]` and `/journal/[slug]`. Not the
homepage, `/about`, `/contact`, the journal index, the galleries index, the shop,
any product page, **any custom page**, share-link galleries or the 404.

So no funnel, landing page, source or per-page breakdown is derivable from the
stored data. The codebase is honest about it (`overview.ts:34`) — but it is a
**time-sensitive** gap: every day unrecorded is data that cannot be recovered.

## 2.6 There is no asynchronous machinery of any kind

- **One cron**, the entire `vercel.json`: `/api/instagram/refresh`, daily.
- No job table, queue, worker, retry, idempotency key, dead-letter, `after()` or
  `waitUntil()` anywhere.
- **One `maxDuration` in the whole repo** (`/api/download-all`, 300s).
  `deleteSite`, `backfillDerivatives` and `syncPending` all run unbounded at the
  platform default.
- The existing "async" backfill is a **client-side `do…while` loop**.

## 2.7 SEO has no structured data and no place

- **Zero** hits for `application/ld+json`, `schema.org`, `@context`.
- OpenGraph in three places inconsistently; gallery and product pages have none.
  Canonical only from `pageMetadata`.
- **Two independent SEO implementations** with different limits: `lib/seo.ts`
  (60/160, `site_settings.page_seo`, has a draft layer) and `blog_posts.seo_*` +
  `SeoFields.tsx` (60/155, live columns only). The sitemap honours only the
  first one's `noindex`.
- **No redirects table.** Renaming a custom page's slug leaves nothing behind.
- **No location, venue, city, region or service-area concept.**
  `photos.latitude`/`longitude` are parsed, stored, and read by nothing.

## 2.8 Three fields are already populated and read by nothing

`photos.alt_text` (never written), `photos.tags` (Lightroom keywords, written on
every upload, read nowhere), `photos.latitude` / `longitude`.

---

# Part 3 — Technical debt that would block this architecture, ranked

By **how much more expensive it gets the longer it waits**, not by size.

**1. The photo/usage model.** Every week adds another bare path. Foundation of
four of the eight V1 priorities.

**2. No committed schema.** `photos` has **no DDL anywhere** — the fixture
declares six columns, the app reads sixteen. `page_views.visitor_hash` and
`viewed_at` exist in **no migration and no fixture**. Cheapest item here;
unblocks careful work on everything else.

**3. Analytics that records nothing addressable.** Small refactor cost,
permanent data cost.

**4. `updateDraftSectionValues` accepting any value.** Harmless while only a
human panel calls it.

**5. No job system, and no `maxDuration` on anything expensive.** Already a live
reliability risk.

**6. `applyLook` writing live and only to `home`.** Blocks AI design entirely.

**7. Section ids regenerated at publish.** Blocks stored proposals.

**8. Two SEO implementations, no JSON-LD, no place concept.**

---

# Part 4 — The smallest AI foundation worth building

Six modules and two tables. None of them is an AI feature.

### `lib/ai/provider.ts` — one interface, adapters behind it
```
complete({ task, messages, schema, images?, signal }) → { value, usage, model }
```
**Nothing else in the codebase imports a vendor SDK** — the same rule
`lib/supabase/admin.ts` already applies to the service-role key.

### `lib/ai/tasks.ts` — the router as a closed registry
A task is a **named string, not a prompt**. `TASKS` is a `Record<TaskName, …>`
in the same spirit as `SECTIONS`: `{ tier, schema, maxTokens, cacheable,
capability }`. `route(task)` → `{ provider, model }`, resolved from config.

### `lib/ai/schemas.ts` — generated from the registry, not hand-written
`schemaFor(def)` walks `def.fields` and emits the JSON Schema: `select` →
`enum`, `number` → `minimum`/`maximum`/`multipleOf`, `color` → the hex pattern,
`toggle` → boolean, `custom` → excluded. Because both the panel and the model
read the same declaration, the contract cannot drift.

### `lib/ai/context.ts` — the capability handle, modelled on `ShareAccess`
`contextFor(feature)` calls `requireEditor()`, checks `can(tenantId, capability)`
and returns an `AiContext { tenantId, feature, allow }`. Every retriever takes
the handle as its first argument. **Nothing in `lib/ai/` may query Supabase
without one**, and retrievers return compact structured summaries — never raw
rows, never a whole table.

### `lib/ai/usage.ts` — one table, written inside the provider wrapper
So it cannot be forgotten. Columns in Part 5.

### `lib/ai/propose.ts` — the proposal envelope
`apply(proposal)` routes **only** through the existing deterministic writers.
Everything lands in the **draft**, so preview, undo, version history and review
links come free.

---

# Part 5 — Decisions taken (2026-09-29)

## 5.1 Build order — settled

1. Commit and reconcile the real database schema
2. Fix programmatic section value validation
3. Jobs infrastructure, and move the existing expensive async work onto it
4. Analytics instrumentation — **early, because the data cannot be reconstructed**
5. Photo asset / photo usage architecture
6. AI foundation + alt text as the proving feature

Then: SEO titles and descriptions → story draft from a gallery → broader
Intelligence features.

**The photo split lands before any visible AI feature.**

## 5.2 Analytics — first-party, and privacy-conscious

Extend `page_views` rather than adopting a vendor. Keep `album_id` and `post_id`
so everything that reads them today keeps working.

Added columns:

| column | what it is | why it is safe |
|---|---|---|
| `path` | the request path, no query string | query strings are where PII leaks |
| `page_key` | the editor's page key (`home`, `p_a1b2c3d4`), null for galleries/stories | survives a slug rename — the same reason `page_seo` is keyed this way |
| `referrer_host` | **host only**, never the full URL | strips paths and search terms |
| `session_hash` | a random id minted in the browser and held in `sessionStorage` | first-party, dies with the tab, derived from nothing about the person |
| `device` | `phone \| tablet \| desktop`, bucketed server-side | the UA itself is never stored |
| `viewed_at` | already read, never declared — gets a real column | |

**Not doing:** raw IP addresses, full user-agent strings, canvas/font/hardware
fingerprinting, cross-site identifiers, or any cookie. `visitor_hash` keeps its
daily salt, so it stays un-joinable across days by construction; `session_hash`
supplies within-visit funnels without creating a durable identity. Country from
`x-vercel-ip-country` is available and coarse — **left out until you ask for it.**

`ViewTracker` moves into the shared public layout so all standard public site
pages fire, including the homepage, contact and every custom page; individual
print-detail pages (`/shop/<photo id>`) remain an open item.

What this then supports: page funnels, homepage → portfolio engagement,
portfolio → inquiry conversion, landing pages, referrer summaries, device
differences, per-page engagement — and the aggregates that feed Intelligence,
computed in SQL before any model sees them.

## 5.3 Provider — OpenAI first, provider-agnostic permanently

- OpenAI is the **first adapter**, not a dependency of feature code. Nothing
  outside `lib/ai/providers/` imports a vendor SDK.
- **No model name anywhere but the task registry.** Tier 1 → an inexpensive
  multimodal model; Tier 2 → a stronger general-purpose model; Tier 3 → the most
  capable, user-triggered only.
- **No pricing in business logic.** Rates live in
  `lib/ai/pricing.config.ts` (or the database) keyed by provider + model, so a
  price change is a config edit. Cost is *estimated at call time and stored*, so
  history stays correct when the rate changes later.

`ai_usage` records: `tenant_id`, `feature`, `task`, `provider`, `model`,
`input_tokens`, `output_tokens`, `estimated_cost_micros`, `latency_ms`,
`success`, `error_code`, `created_at` — plus `job_id` and `proposal_id` where
there is one, so a whole Site Review's cost can be summed rather than inferred.

That answers, per customer and per period: Portfolio Curator cost, SEO
Intelligence cost, Story generation cost, and the cost of one full Site Review.

## 5.4 Alt text — the proving feature, and the rules it must obey

It exercises the full loop: authorized context → task router → inexpensive
multimodal model → structured output → usage and cost metering → proposal →
review/approval → deterministic write.

**It must never silently overwrite photographer-written alt text.** The asset
carries `alt_text` and `alt_source` (`'photographer' | 'ai' | null`). A
generated value is only written where `alt_text is null`, or where
`alt_source = 'ai'` and the photographer explicitly asked to regenerate. Anything
a person typed is `'photographer'` and is never touched without an explicit
replace.

First cut is small and single-image. Batch generation comes after the loop is
proven, and runs through the jobs table.

## 5.5 The standing rules

- **A closed, validated action space.** No model writes CSS, HTML, SQL, a
  storage path, or a database mutation. Schemas are generated from the section
  registry, never hand-copied. Programmatic writes are validated against the
  same constraints the human editor uses.
- **Propose → preview → approve.** Meaningful changes land in the existing
  draft; there is no separate AI mutation system.
- **Agents stay thin.** Shared services first; Site/Portfolio/SEO/Business/
  Marketing agents are later orchestrators over them.
- **Deterministic software wherever it can answer.** Analytics aggregate before
  a model sees anything; photo metadata is computed once at ingestion; semantic
  search retrieves a candidate set before any vision reasoning; layout comes
  from approved sections.
- **Contextual affordances, not a chatbot.** "Suggest a stronger layout",
  "Curate portfolio", "Find SEO opportunities", "Create story from gallery",
  "Generate alt text", "Review this page". A conversational assistant comes last,
  orchestrating capabilities that already work alone.
- **Incremental, never greenfield.** The section registry, draft/publish model,
  content/presentation separation, tenant scoping and deterministic writers all
  stay.

---

# Part 6 — The build order, in detail

Each step ships on its own and leaves the application working. Nothing deletes a
working feature.

### Step 1 — See the schema (hours)
Run `db/survey.sql`, commit the output as `db/schema-2026-09.sql`, reconcile
`db/test-fixture.sql` against it. Fixes the `photos`, `page_views` and
`site_settings` drift in one pass.
*Done when:* the fixture and production agree, and the file says so.

### Step 2 — Make the writer honest (a day)
Route `updateDraftSectionValues` through the same field-schema check
`readField` already performs. A suite proves an out-of-range number, an unknown
`select` value, a non-hex colour and a wrong JS type are each rejected — and is
shown to fail before the fix.
*Also:* decide the custom-editor payloads (`focal`, `featured_post_ids`,
`titles`, `story_focal`), which have no declared shape at all today.

### Step 3 — Jobs (two days)
`jobs (id, tenant_id, kind, payload, status, attempts, max_attempts, run_after,
locked_at, locked_by, last_error, created_at, finished_at)`, a `/api/jobs/drain`
route behind `CRON_SECRET` (the pattern `/api/instagram/refresh` already uses),
a second Vercel cron, and `maxDuration` on `deleteSite`, `backfill` and
`syncPending`. First customer: move `backfillDerivatives` off its client-side
`do…while` loop.
*Done when:* a failed job retries with backoff, a permanently failed job is
visible, and nothing expensive runs unbounded.

### Step 4 — Analytics (two days) — **start recording before anything else**
The columns in 5.2, `ViewTracker` in the shared layout, and the aggregates
computed in SQL (`daily_page_stats` rollup or a view — decided when the volume
is known). Existing readers untouched.
*Done when:* the homepage, contact and a custom page all record views with a
path, a session and a referrer host, and nothing stores an IP or a UA.

### Step 5 — The photo library (1–2 weeks) — **design first**
See `claude/photo-assets-design.md`. Additive, non-destructive, reversible.
**Not written until you have reviewed that document.**

### Step 6 — The AI foundation + alt text (a week)
The six modules in Part 4, `ai_usage`, the proposal table, one OpenAI adapter,
and alt text end to end under the rules in 5.4. Metered from the first call.
*Done when:* one generated alt text has gone context → router → model → schema →
usage row → proposal → approval → draft, and a second run on a photograph with
photographer-written alt text proposes nothing.

### Step 7 — SEO metadata, then story from gallery
Both as proposals into the draft. The SEO step also unifies the two
implementations and their disagreeing character limits.

### Step 8 — Embeddings and semantic search
`photo_embeddings` + pgvector, an embed job per asset, candidate retrieval
first and vision reasoning only over the shortlist.

### Step 9 — Design proposals
Only after `applyLook` goes through the draft and section identity survives
publish.

---

# Part 7 — V1 / soon / long-term

**Required for V1:** committed schema · honest programmatic validation · jobs ·
first-party analytics · photo asset/usage split · provider abstraction · task
registry · generated structured schemas · scoped AI context · usage and cost
tracking · proposal system · alt text · SEO metadata suggestions · story draft
from gallery.

**Useful soon:** image embeddings · semantic photo search · ingestion-time
metadata and quality analysis · portfolio curation · site review · JSON-LD ·
venue/place model · unified SEO implementation.

**Long term:** Site Agent · Portfolio Agent · SEO Agent · Business Agent ·
Marketing Agent · AI-driven design proposals · conversational assistant.

---

# Part 8 — What we are deliberately not doing

- **Not building five agents.** Build the shared services; an "agent" is then a
  retriever set plus a task set, and is thin. Five independent systems each
  fetching and parsing Lens Grid is the failure mode the brief names, and
  naming the agents first is how you walk into it.
- **Not building a chat interface**, now or as the centre later.
- **Not adding a vector database.** pgvector in the Supabase instance that
  already exists.
- **Not replacing** the section registry, the draft layer, the look system, the
  sanitizers, the tenant scoping or `PageBody`'s one-tree rule.
- **Not rewriting `photos`.** Add alongside and backfill.
- **Not letting a model write** CSS, HTML, SQL or a storage path. A storage path
  from a model is an unowned-key problem; `ownsKey()` exists and is enforced in
  only three places today.
- **Not metering later.** The usage table costs nothing now and cannot be
  reconstructed.
- **Not storing an IP address or a user-agent string** to make analytics better.
