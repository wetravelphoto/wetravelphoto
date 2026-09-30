@AGENTS.md

# Lens Grid — operating instructions

A premium website and business platform built specifically for photographers.
One rendering engine, many photographers, each site on its own address and
belonging to one tenant. First tenant and proving ground: **WeTravelPhoto**.
Platform brand: **Lens Grid** (`lensgrid.co`).

Next.js 16.3.4 · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres, Auth,
PostgREST) · Cloudflare R2 · Vercel (Hobby) · Sentry.

`claude/PROJECT-CONTEXT.md` is imported with this file, so it is already in
context: product, architecture, current state, settled decisions. **Read it
before your first change of a session.** This file is only *how you are allowed
to work*.

---

## The essential invariants

Break one of these and something quiet and expensive happens.

- **Tenant isolation is mandatory, in the database AND the application.** Every
  read of a site-owned table names `tenant_id`; every write goes through
  `requireEditor()`; the site for a public request comes from the `Host` header
  via `lib/tenant.ts`, never from the session or the request body.
  `node scripts/check-tenant-scoping.mjs` is what notices, and it runs inside
  `npm run build`. **An exemption may only say how a query is NARROWED — "the
  caller is trusted" is never that.**
- **A platform admin passes every tenant check.** An unqualified query that is
  safe for an ordinary tenant is not safe at all. This has caused two real
  incidents.
- **The section registry (`lib/sections/registry.ts`) is a contract.** Never
  remove or repurpose a key; adding one is free. A key the panel writes that
  `def.defaults` lacks reaches the photographer as *"Minified React error
  #441"*, because Next redacts server-action errors in production.
- **`Field.content` is the content/design line**, enforced by `splitSettings`.
  A design change must be unable to eat the photographer's words or photographs.
- **One writer each.** `replaceSections()` for section rows, `patchSiteSettings()`
  for settings, `syncUsages()` (from P3) for photo usages. Do not add a second.
- **`jobs` and `page_views` are written only through their SECURITY DEFINER
  functions.** Neither grants INSERT to anybody, deliberately.
- **Job handlers must be idempotent.** A retry is ordinary.
- **Production schema truth is authoritative** and lives in
  `db/schema-verified.md` and `db/schema-2026-09.sql`. `db/test-fixture.sql` is
  the rehearsal room and must match production — a fixture that runs *ahead* of
  production is the same failure as one that lags.

## How we work

- **Inspect before modifying.** Read the code and the relevant canonical
  document first. Most of the expensive faults in this project were a confident
  sentence where a measurement belonged.
- **Preserve the existing architecture** unless the phase explicitly changes it.
  The registry, the draft layer, the look system, the sanitizers, tenant scoping
  and `PageBody`'s one-tree rule all stay.
- **One deployable phase at a time**, and each leaves the application working.
- **Do not broaden scope.** Do not silently fix unrelated issues. If you find
  one, **report it and leave it** — `claude/open-items.md` is where it belongs.
- **Additive and reversible migrations are strongly preferred.** No column is
  dropped, renamed or repurposed without its own approved phase. Every migration
  must be **safe to run twice**.
- **Do not weaken an existing test to make a phase pass.** If a test fails, the
  code is wrong until proven otherwise — and if the test is wrong, say so and
  fix the test on its own terms.
- **A new test must be shown capable of failing** where practical: break the
  thing it guards, watch it fail, revert. A green suite on its first run is not
  evidence. Prefer asserting *which layer* refused something over asserting only
  that it was refused.
- **Test as the real roles where permissions matter.** A suite connecting as the
  table owner holds every privilege and bypasses RLS, so it cannot see a grant
  problem — and a grant problem is most of what there is to see.
- **Never let an AI-generated feature write arbitrary SQL, CSS, HTML or storage
  paths.** A model chooses among declared values in the registry; the result is
  validated by the same sanitizers as a manual edit and lands in the draft.

## Deployment rules — never violated

1. **Claude does not apply production migrations.** Ever.
2. Claude writes the migration, **rehearses it locally** against
   `db/test-fixture.sql` (including running it twice), runs the suites, reports
   the **SHA256** of the migration file, and **stops**.
3. **ChatGPT reviews independently, then applies and verifies** the Supabase
   production migration, and reports the migration version and the verified
   facts.
4. **Schema snapshot and fixture bookkeeping happens AFTER production
   deployment**, never before: `db/schema-2026-09.sql`, `db/test-fixture.sql`,
   `db/schema-verified.md` and `scripts/fixture-matches-migration.sh`.
5. **The database goes first; the application code is pushed after.** Production
   having columns nothing writes to is safe; an application live against a
   schema without them is not.
6. **Do not commit and do not push unless Gonzalo explicitly asks.** He runs
   git himself. When he asks, give the command rather than running it.
7. Claude does not change the live database, run deployments, or edit anything
   in the Supabase dashboard.

## Standard commands

```bash
npx tsc --noEmit -p .                   # must be clean
npx eslint <paths you touched>          # repo-wide has pre-existing noise
node scripts/check-tenant-scoping.mjs   # a.k.a. npm run check:tenants
bash scripts/sandbox-build.sh           # expect: BUILD EXIT: 0
```

Database suites — need a local Postgres carrying the fixture, which already
contains `jobs`, `page_views` and the P1 photo tables in their deployed shape:

```bash
createdb wtp && psql -d wtp -f db/test-fixture.sql

psql -d wtp -f db/verify-analytics.sql         # 76 assertions
psql -d wtp -f db/verify-jobs.sql              # 107
psql -d wtp -f db/verify-tenant-isolation.sql  # 25
psql -d wtp -f db/verify-photo-assets.sql      # 137
bash scripts/fixture-matches-migration.sh      # 403 jobs + 175 page_views + 435 P1 facts
bash scripts/jobs-concurrency.sh               # 17, needs two connections
```

TypeScript suites live in `.mk/` and are run directly:

```bash
npx tsx .mk/analytics.ts       # 295  (needs the database)
npx tsx .mk/jobs.ts            #  64  (needs the database)
npx tsx .mk/photo-assets.ts    #  55  (needs the database)
npx tsx .mk/section-values.ts  # 1557
npx tsx .mk/settings.ts        #  408
```

On Windows, set `PGCLIENTENCODING=UTF8` first. Four of the `.mk` suites
hard-code the old sandbox root `/home/claude/build`; see `open-items.md` §5.

That is every suite in `.mk/`. Earlier versions of this list also named
`blockable.ts`, `textvars.ts`, `perdevice.ts` and `preview-chrome.ts`, and
`.cjs` bundles; **none of them has ever been committed to this repository**
(checked against the whole git history, 2026-09-29). The coverage they
describe is recorded as missing in `claude/open-items.md` §5.

A SQL suite runs inside one transaction that **always ends by raising**, so the
report is the exception message and nothing is kept. `db/verify-draft.sql` is
**broken and deliberately out of the loop** — see `open-items.md`.

## Where things are

| | |
|---|---|
| `lib/sections/` | the registry, page list, load/store, per-device and per-element styling, shared value rules |
| `lib/drafts/` | draft store, undo steps, versions, review links |
| `lib/styles/` | global design tokens, palettes, pairings |
| `lib/templates/` | looks as data; `applyManifest` is pure |
| `lib/jobs/` | the queue's client side |
| `lib/analytics/` | first-party analytics; the reductions and the writer |
| `lib/tenant.ts`, `lib/auth.ts`, `lib/entitlements.ts` | which site, who may act, what a plan allows |
| `lib/storage-keys.ts` | `t/<tenant id>/…` and `ownsKey()` |
| `components/PageBody.tsx` | the one renderer for both the live page and the preview |
| `db/migrations/` | every migration, each safe to run twice |
| `.mk/`, `scripts/`, `db/verify-*.sql` | the suites |

**Naming hazard:** `lib/scenes.ts` already exists and means *room scenes* for the
print shop (the `room_scenes` table). The future **Scene architecture** is
unrelated — do not put Scene code there.

## Current state

**S1** schema truth · **S2** programmatic value validation — complete.
**S3** jobs infrastructure — **deployed**, migration `20260929212635`.
**S4** analytics instrumentation — **deployed**, migration `20260929231653`.
**P1** `photo_assets` / `photo_usages` tables and constraints — **deployed**
2026-09-30, migration `20260930123113`, and reconciled. Nothing reads or writes
the new tables yet.

Production: 37 tables · 549 columns · 13 functions · 56 policies · RLS on all 37
· PostgreSQL 17.6.

**The next phase is P2 — unified ingestion** (`photo-migration-plan.md`). It
must introduce the narrowest write capability asset ingestion needs, because P1
granted no application role any write on the photo tables. **Not started.**

## Not without explicit approval

- **Starting P2**, or any other phase, or more than one phase at a time.
- **Applying anything to the production database.**
- **Committing or pushing.**
- Dropping, renaming or repurposing a column — including **Phase D** (the
  redundant `photos` file columns), which is **not this quarter**.
- Retiring `srcSetFromPath` or `site_images`.
- Introducing an external queue service, a vector database, or any vendor SDK
  outside the single AI provider adapter.
- Changing the section registry's existing keys, the content/design line, or the
  snapshot semantics of looks.
- Adding a second writer for sections, settings or usages.
- Building templates before the Scene layer they are supposed to be presets over.

## Canonical documents

### Imported — already in context

Exactly two documents are pulled into every session by the `@` lines below:
product, architecture, current state and settled decisions; then the verified
production database facts.

@claude/PROJECT-CONTEXT.md

@db/schema-verified.md

| imported document | owns |
|---|---|
| `claude/PROJECT-CONTEXT.md` | product identity, architecture, invariants, current state, decision log |
| `db/schema-verified.md` | the verified production database — the authority on what the database IS |

### Primary canonical documents — on disk, NOT imported

These are **not** in context until opened. Read the one that owns the area
before changing anything in it; before any photo phase, read both photo
documents.

| document | owns |
|---|---|
| `claude/roadmap.md` | the broad feature inventory, with sizes |
| `claude/open-items.md` | current blockers, issues, priorities, and the "what shipped" log |
| `claude/photo-assets-design.md` | the approved photo data model — schema authority for P1 |
| `claude/photo-migration-plan.md` | P1–P6 implementation order, tests, rollbacks |
| `claude/analytics-s4.md` | analytics design, privacy stance, deployment record |
| `claude/intelligence-architecture.md` | the AI architecture: inspection, decisions, build order |

### Other documents — on disk, read as needed

Importing everything would spend most of a session's context before the first
question. These are real files in this repository; open the one the task needs.

| document | owns |
|---|---|
| `db/schema-2026-09.sql` | the production schema snapshot |
| `db/test-fixture.sql` | the rehearsal room, matching production |
| `claude/sections-engine.md` | the section registry and the contract it carries |
| `claude/the-canvas.md` | the visual editor: pages, panels, live repaint, shortcuts |
| `claude/draft-layer.md` | draft, publish, undo steps, versions, review links |
| `claude/looks-and-tiers.md` | looks as snapshots, the content/design line, entitlements |
| `claude/tenant-scoping.md` | how tenant isolation was built, and what is still `using (true)` |
| `claude/visual-editor-plan.md` | the original builder plan and the template-as-data decision |
| `claude/lens-grid-platform.md` | the platform/tenant split, sign-up and platform to-dos |

### Still only in the claude.ai project "WetravelPhoto"

Operational and historical, not copied here: `beta-readiness.md` ·
`cloudflare-move.md` · `email-and-newsletter.md` · `share-links.md` ·
`settings-screen.md` · `admin-workspace.md` · `per-device-and-buttons.md` ·
`admin-ad-blocker.md` · `audit-2026-09-21.md` · `phase-3-remaining.md` ·
`handoff-session-1.md`. If a task depends on one of these, say so and ask for
it rather than reconstructing it.

There is also a stale `.project-docs/` folder in the repository from an earlier
export. **It is not canonical — do not read it or copy from it.** Removing it is
an open item.

Where two documents disagree:

1. **`db/schema-verified.md` beats everything on what the production database
   IS.**
2. **A phase- or domain-specific canonical document beats `roadmap.md` in its
   own domain:** `photo-assets-design.md` and `photo-migration-plan.md` for
   photo work; `intelligence-architecture.md` for AI; `analytics-s4.md` for
   analytics.
3. **`open-items.md` beats `roadmap.md` on current priority.**
4. **`roadmap.md` is a broad feature inventory.** It beats *older, general*
   documents on what exists to build, and never overrides a document in rule 2.
5. **Any canonical document beats `PROJECT-CONTEXT.md`**, which should then be
   corrected.
