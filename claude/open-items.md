# Everything still open — updated 2026-09-30

Two demo sites are with real testers. Ordered by what hurts while somebody else
is using it, not by what is most interesting to build.

Where this disagrees with `claude/roadmap.md` on priority, this one is newer.
`roadmap.md` is the master list of *what exists to do*; this is *what is in the
way*, plus everything found in testing.

---

## 1. Yours to do — nothing here needs code

- [x] **The S4 application code is committed and pushed** (2026-09-29, commit
      `2af178b`), after
      the migration was deployed and the repository reconciled to it. Database
      first, code second, as intended.
- [ ] **Confirm `CRON_SECRET` is set in Vercel.** The jobs drain is deployed and
      fails closed without it — 401 rather than an open endpoint — so an unset
      secret is a queue that never drains on its own, not a risk. Same variable
      the Instagram cron already uses, so if that one runs this is done.
- [ ] **Sentry environment variables in Vercel.** The code has been deployed
      since 2026-09-24 and does nothing without them, so every fault still
      arrives as a tester saying "it broke". `NEXT_PUBLIC_SENTRY_DSN`,
      `SENTRY_ORG`, `SENTRY_PROJECT` (none secret) and `SENTRY_AUTH_TOKEN`
      (secret; without it stack traces name the minified bundle).
      **This is the most valuable unticked box on the page.**
- [ ] **Confirm Supabase backups / point-in-time recovery.** Someone else's
      photographs are in that database. Check the tier even offers PITR.
- [ ] **Turnstile keys into Vercel** — spam protection is built and switched
      off until they exist.
- [ ] **`MAIL_FROM_ADDRESS` to a verified lensgrid.co address.**
- [ ] Delete the stray `wetravel\app` and `wetravel\db` folders.
- [ ] Delete the stale `.project-docs/` folder in the repository — four
      documents frozen at 2026-09-23/24, superseded by `claude/`.
- [ ] wetravelphoto.com cutover.
- [ ] Verify a share link lists galleries, now that `allow_downloads` exists.

## 2. From the Supabase advisors

Recorded rather than acted on, and three of them should be left alone
permanently.

- [x] **`enqueue_jobs` is flagged as an authenticated-executable SECURITY
      DEFINER function.** **This is the design and must not be "fixed".** It is
      deliberately the one narrow door a signed-in photographer has to the
      queue, and it holds the checks the table cannot: the site (restated,
      because a definer function is not subject to RLS), an allow-listed job
      kind, the payload's shape, **the photograph's ownership**, a 200-item
      batch cap, and a dedupe key it derives itself rather than accepting.
      Revoking `authenticated` EXECUTE would not close a hole; it would remove
      the only validated path and leave nothing in its place.
- [x] **`jobs_ready`, `jobs_stale` and `jobs_tenant_status` show as unused.**
      Expected: `jobs` has 0 rows. Worth re-checking after the first real
      backfill, when "unused" would mean something.
- [x] **After the S4 deployment: no S4-specific security finding at all**, and
      `record_page_view` was not flagged — its EXECUTE grant is `service_role`
      only, so unlike `enqueue_jobs` it is not reachable by a browser role.
      `page_views_tenant_time` and `page_views_post_idx` report as unused, which
      is expected immediately after creation and means something only once real
      views arrive.
- [x] **After the P1 deployment (2026-09-30): no P1-specific security finding.**
- [ ] **P1 performance findings — a measured index review once P2/P3 have
      written rows.** All informational, and **deliberately not acted on**: do
      not add an index merely to silence the advisor. Reported:
      - the new indexes as **unused** — expected with 0 rows in both tables;
      - several of `photo_usages`' **composite foreign keys lacking a covering
        index**;
      - `photo_assets.created_by`'s foreign key **lacking a covering index**.

      Some existing leading-column and partial indexes may already serve the
      real query and delete shapes — e.g. `photo_usages_slot_gallery (photo_id)`
      leads with the photo column that a cascade from `photos` searches, and
      `photo_usages_asset (asset_id)` leads with the asset column; whether a
      partial index or a leading column is enough for a given cascade or join is
      a question for `explain` against realistic rows, not for the advisor or
      for reasoning. Decide each one with the plan in hand, after P2/P3.
- [ ] **The advisors also flagged pre-existing items elsewhere in the schema.**
      Deliberately out of scope for S3 and S4 and not touched. **Worth its own
      read-only pass** — one sitting, list each finding, decide each on its
      merits, change nothing in the same breath. Some will be by design like the
      ones above; the point is to have said so once, in writing, rather than
      re-deciding every time the advisor runs.

## 3. Per-element text editing — what is left

All three slices have shipped (see *What shipped*): **25 pieces of text across
8 sections** carry their own typography. What remains is polish, not reach:

- [ ] **Reconcile with section-level typography.** There are now two controls
      over the same numbers: the Typography *group* (whole section, three
      roles) and the per-element button. The cascade resolves them correctly,
      but nothing on screen says which is which — probably: move the section
      group below the fields it no longer governs, and have it say what it
      still does.
- [ ] **Say when an element has stopped following.** The button shows a count;
      the *page* shows nothing. Some mark in the preview on a hovered element
      that has its own styling would stop the "why is this one different"
      question before it is asked.
- [ ] **Album covers and gallery text** are the one place this has not
      reached — they are composed by `CoverRenderer` from the album's own
      settings, not from a section, so they need their own pass.

## 4. Platform gaps

- [ ] **The jobs drain runs once a day, because the account is on Hobby.**
      Vercel rejects any cron expression that would run more than once a day on
      a Hobby account — the deployment itself fails, so this is not something
      to discover later. The photographer-facing path does not depend on it
      (pressing "Process photographs" drains their own site on the spot); the
      cron is the safety net. On Pro it becomes `*/5 * * * *`, one string in
      `vercel.json`, and the safety net becomes the scheduler.
- [ ] **Nothing writes `allow_downloads` except the new switch** — check it
      actually saves on a real gallery.
- [ ] **Newsletter double opt-in and unsubscribe** for sites with no connected
      service (roadmap 3, unfinished half).
- [ ] **Instagram how-to page** (roadmap 28). Testers are told to leave the
      section off, which is a workaround.
- [ ] **Public Suffix List submission for lensgrid.co** before a wildcard
      domain, and check whether Supabase auth cookies carry a `Domain`
      attribute — if they do, one tester's cookie is readable on another's
      subdomain.
- [ ] **No keyboard equivalent for the hero drag.** The panel picker is fully
      keyboard-operable so nothing is unreachable, but the drag is
      pointer-only.

## 5. Found in the repository

- [ ] **`visitor_hash` has no secret in it.** It is
      `sha256(ip | user-agent | today's date)`, so it is a function of PUBLIC
      inputs: anybody holding the table and a candidate address can confirm a
      match by recomputing it. The daily rotation is what limits this to one
      day's window, and it is why the hash is not a durable identifier. S4 was
      explicitly required to preserve the current privacy model, so it is
      unchanged — but **a server-side pepper would close it without changing
      the rotation or any count a dashboard shows**: one env var
      (`ANALYTICS_SALT`), mixed in beside the day, in one line of
      `app/api/view/route.ts`. Worth doing on its own, deliberately, and worth
      deciding whether an unset variable should fail closed.
- [ ] **A single print's page (`/shop/<photo id>`) is not tracked.** S4 records
      every standard public site page; an individual print-detail page is the
      one exception, because a print's identity is a photograph id: there is no
      column to hold one, and putting an unvalidated id inside `path` is exactly
      the boundary S4 exists to close. Two honest ways forward — a fourth
      identity column on `page_views`, or a `catalog_listing` page kind that the
      enqueue function can check against `photos` — and neither belonged in that
      phase.
- [ ] **`page_views_visitor_is_a_hash` is looser than what the route writes.**
      The route writes 32 hex characters; the constraint allows 8–64 of anything
      that is not an address, an email or a user-agent. That was deliberate:
      `db/test-fixture.sql` seeded `hash-one` and `hash-two`, and a migration
      that cannot be rehearsed against the fixture is one that gets applied
      untested. Tightening it now costs a production migration and two seed
      values. Not urgent — the negative clauses are what actually keep an
      address out — and worth folding into whatever the next `page_views`
      migration turns out to be.
- [ ] **`db/verify-draft.sql` has been broken since the fixture was
      regenerated**, and was simply never in the test loop. Block 1 inserts a
      `site_draft` row for tenant A **unguarded** (line 72) and the regenerated
      fixture already seeds one; `site_draft`'s primary key is `tenant_id`, so
      that first insert raises outside any handler and aborts the whole
      transaction:
      `ERROR: duplicate key value violates unique constraint "site_draft_pkey"`.
      Nothing to do with the queue or with analytics, and deliberately untouched
      by both reconciliations. The fix is one line — delete or upsert rather
      than insert blind, or use a throwaway tenant the way
      `db/verify-tenant-isolation.sql` does — and it should be **added to the
      standard run afterwards**, since a suite nobody runs is a suite that rots.
- [ ] **Four test suites the documentation described do not exist.**
      `CLAUDE.md` and `PROJECT-CONTEXT.md` listed `.mk/blockable.ts` (749),
      `.mk/textvars.ts` (94), `.mk/perdevice.ts` (75) and
      `.mk/preview-chrome.ts` (31) in the standard run, plus `.mk/*.cjs`
      bundles. **None of these paths appears in any commit on any branch** (the
      only commit containing the word `blockable` is the docs commit
      `0761626`), and none is git-ignored — they were never in this
      repository. The standard lists were corrected 2026-09-29 to name only the
      suites that exist. **The coverage they describe is therefore missing**:
      a scan of class names (`blockable`), the per-element text-variable
      cascade (`textvars`), per-device values (`perdevice`), and source
      assertions on the preview's CSS (`preview-chrome`). Still referenced as if
      they existed in: `.mk/section-values.ts:615` and
      `app/preview/preview.css:145` (comments — runtime/test code, deliberately
      not edited in a documentation pass), and `claude/analytics-s4.md`'s test
      table, which records them with counts as part of S4's verification. They
      may exist outside this repository (e.g. the claude.ai project or another
      machine); ask before recreating them.
- [ ] **The `.mk` suites that exist hard-code the old Linux sandbox root.**
      `.mk/analytics.ts`, `.mk/jobs.ts`, `.mk/section-values.ts` and
      `.mk/settings.ts` read repository files from `/home/claude/build/…`, so
      on any other machine they cannot find them. P1 ran them unmodified
      through a scratchpad `--require` shim that maps the path; the fix is to
      resolve the root from the file (`.mk/photo-assets.ts` does
      `resolve(__dirname, '..')`). Test-code cleanup, deliberately not done in
      P1.
- [ ] **The rehearsal tools assume a Linux sandbox.** Found running P1 on
      Windows against portable PostgreSQL 17.6: `psql` can take the console's
      WIN1252 as its client encoding, and the migrations carry UTF-8 in their
      comments — `═` is refused outright, `—` is silently mis-transcoded (set
      `PGCLIENTENCODING=UTF8`); `scripts/fixture-matches-migration.sh` passes
      SQL with a `·` through `psql -c`, which Windows converts to the ANSI code
      page (worked around with a stdin shim, script unmodified);
      `scripts/sandbox-build.sh` needs `python3` for its font stub (absent; the
      real build ran with network fonts and passed); and `tsx` is not a
      devDependency, so `npx` fetches it.
- [ ] **Line endings and migration hashes.** `core.autocrlf=true` and no
      `.gitattributes`: a migration hashed in a Windows working copy can differ
      from the committed blob. P1's recorded SHA is of the LF file, as git
      stores it. A `.gitattributes` pinning `*.sql` to LF would make the hash
      the same everywhere — a repository-wide decision, not made here.
- [ ] **A misplaced line in the schema files.** In `db/schema-2026-09.sql` and
      `db/test-fixture.sql`, `jobs_tenant_id_fkey` sits inside the *unique
      constraints* section, between `newsletter_signups`' explanatory NOTE and
      the line it explains. Harmless to what the files build; confusing to
      read. Left as found.

## 6. Found in testing — still open

- [ ] **Letterspacing mostly does nothing** *at the section level*. Confirmed
      by tracing. Fifteen rules read `var(--sec-track, <literal>)` and only one
      chains through to the site-wide `var(--heading-track, …)`, so with no
      section typography set the element falls back to a hard-coded value
      rather than to the slider. **Not a sweep**: the literals differ per
      element (0.005em to 0.08em) and are deliberate, so chaining all fifteen
      would flatten real design decisions. Needs deciding element by element.
      *Largely overtaken*: the per-element panel sets `--txt-track` and that
      now reaches all 25 pieces of text, so this is only about the
      section-wide slider.
- [ ] **Publish gives no feedback.** Briefly change the button to "Published".
- [ ] **Colour pickers need an undo** — a small revert arrow beside each, back
      to the value the look shipped with. (The new text panel has this: the
      readout beside each slider hands the value back, and "Back to the look"
      clears the element. The *style page* pickers still do not.)
- [ ] **Rename the "Section" group to "Visibility".**
- [ ] **Hero typography caps at 2x.** The per-element control goes to 400% on
      every piece of text now. The **section-level** slider still stops at 2x
      and should match.
- [ ] **Button shape and padding** as a look-level choice. Typeface, size,
      weight, case, tracking and colour are per-button now; the geometry is
      not.
- [ ] **Button link should offer the site's own pages** in a picker, with
      "custom link" for anything external, rather than a bare URL box.
- [ ] **Move Search and sharing to the bottom** of the page settings panel.
- [ ] **New sites should ship with a sample accent mark**, the way they ship
      with sample photographs.
- [ ] **The typography message on the style page is confusing.** It says four
      sections override the site setting and offers to reset them. Gonzalo's
      position: everything should start following the site, and a section only
      diverges once deliberately changed. That is a behaviour change, not
      wording.
- [ ] **Picker popover cells are 22px** on the *placement* grid — fine with a
      mouse, tight on a touchscreen. The typography panel is built at 24px and
      up; the placement grid should follow under `pointer: coarse`.

### Closed this session

- [x] **The policy count did not add up, by one — and the prose was the thing
      that was wrong.** `db/survey.sql` Part 4 had been transcribed as **53
      policies** in production before the queue, while `db/test-fixture.sql` and
      `db/schema-2026-09.sql` both yield **55** after it. Nothing local could
      say which was right, so **production was counted directly**: **55 public
      RLS policies, of which `jobs` has exactly one** — so 54 before S3 and 55
      after. The two schema files were right all along; **there is no schema
      discrepancy**, and no SQL, fixture, migration or test needed changing. The
      corrected figures are recorded in `db/schema-verified.md`, with the note
      kept rather than deleted: the fixture and the snapshot were doubted on the
      strength of a number somebody had typed, and they turned out to be the
      reliable ones. *(Both schema headers still said 54 after the queue; that
      stale figure was corrected during the S4 reconciliation. The sequence is
      54 → 55 → 54: the queue added one policy and analytics removed one.)*
- [x] **Two `select` fields had a NUMBER for a default.** Found by S2's
      validator and closed the same day. `galleries.columns` and
      `journal.grid_columns` are declared `kind: 'select'` with the options
      `'2'`, `'3'`, `'4'`, and defaulted to the number `3` — so a section
      nobody had opened carried a number and a section saved once carried a
      string. Nothing was visibly wrong, because all three renderers read it
      through `num(settings, …)` rather than comparing it, and nothing would
      have been until the first renderer compared it. **The registry was
      corrected rather than the validator broadened.** Proved by rendering
      `GalleriesSection` and `JournalSection` with the number and with the
      string and diffing the markup — byte-identical, and the diff shown to
      catch a one-character change before it was trusted. The known-exception
      list in `.mk/section-values.ts` is **gone rather than shortened**,
      replaced by an assertion that every field's default matches its own
      declared kind.
- [x] **A label over the position button** reading **Position**.
- [x] **A Typography button beside it**, per text element.
- [x] **Both in the order Position · Typography**, and only where they apply.
- [x] **Button hover went to black.** All three buttons inverted to a
      hard-coded pair, so one given its own colour lost it under the pointer.
      They now invert against whatever the button actually is.
- [x] **Typeface and Weight drop-downs were white on white.** A translucent
      background on a `select` composites against the LIST's white default,
      not against the dark panel behind the control.
- [x] **Section typefaces were never fetched** on any section but the hero — a
      font picker that changed nothing, because the stylesheet was never asked
      for. Every section loads its own now.

## 7. Asked for by the beta testers

- [ ] **12a — Gallery carousel: arrows and autoplay** (**S**). Drag-only today
      with nothing on screen saying it moves.
- [ ] **12b — A hero built from galleries** (**M**) — and Gonzalo's extension:
      for the hero, offer **galleries instead of stories**, a **carousel of
      three images**, or a **video**. Same sequence machinery, different
      sources.

## 8. Next on the roadmap proper

- [ ] **12 — Contrast warning + custom font upload** (**M**). Last of Tier 2.
- [ ] **13 — New section types** (**L**, one at a time): pricing/packages,
      FAQ, testimonials first. Look at two or three real references, decide
      which arrangements are worth supporting, *then* write the registry
      declaration. Do not paste 21st.dev blocks — they hard-code colour, type
      and spacing and would ignore Style mode. **Each new type now costs one
      extra word per text field** (`textStyle: true`) and one line in its
      stylesheet to get the whole typography panel — **and, since S4, one line in
      `record_page_view`'s built-in page map if it is a new built-in page.**
      `.mk/analytics.ts` asserts the SQL map matches `PAGES`.
- [ ] **15 — Legal pages** (**S–M**).
- [ ] **16 — Caching public pages**, **17 — Instagram into R2**,
      **18 — image delivery check**, **19 — structured data**,
      **20 — accessibility pass**, **21 — visitor stats** — which is now
      *reading* what S4 records rather than instrumenting anything.

## 9. Before going operational — the order Gonzalo wants

Decided 2026-09-24. **Vercel Pro is the last step, not the first** — it is the
bill that starts when there is something to sell.

1. **Super-admin at lensgrid.co** (roadmap 29, **L**). The tenant work of
   2026-09-24 is the mechanism "log in as the photographer" needs.
2. **The Lens Grid marketing site** (roadmap 31, **M–L**).
3. **More looks, more section types, and templates.**

Then: Vercel Pro (Hobby forbids commercial use and caps 50 domains per
project), Supabase tier check, billing (26), custom domains (27), sign-up and
onboarding (25), and deliverability as an ongoing job.

### The template set — later, and worth writing down now

Wildlife · Landscape · Wedding · Sessions · Sports. Each with its **own section
designs**, not merely its own colours, and then **mix and match**.

That last part is the architectural requirement: mix-and-match means a
*layout* is a property of a section, chosen per instance, not of the template
it came from — which is roadmap 37's "3–5 layouts per section type" **before**
it is roadmap 37's templates. Build the layouts first and the five templates
become presets over them; build the templates first and each is a fork to
maintain separately.

---

## Where to pick up

**Gonzalo:** commit P1 (the migration, its suites and this reconciliation) —
production already has it, so the repository is what lags. Then the four
Sentry variables in Vercel, and confirm `CRON_SECRET` is set so the nightly
drain actually runs.

**Next build:** **P2 — unified ingestion**, in `claude/photo-migration-plan.md`.
**Not started.** P1 is deployed and reconciled, so nothing is in front of it —
but P1 granted no application role any write on the photo tables, so P2 must
begin by deciding, and putting through its own reviewed migration, the
narrowest write capability asset ingestion needs.

**The alternative**, if testers get restless: 12a, the carousel arrows. Small,
asked for, and visible. Or **21 — visitor stats**, which after S4 is a screen
over data rather than a build.

---

## What shipped, most recent first

### 2026-09-30 — P1, the photo-asset tables, DEPLOYED

Migration `20260930123113`, `photo_assets_p1_2026_09_29`, sha256 `fedb6e7f…`,
reviewed and applied by ChatGPT. Full record: `db/schema-verified.md`.

`photo_assets` (the photograph, one row per upload) and `photo_usages` (where
it is placed — a projection that only `syncUsages()` will ever write) now exist
in production, **empty, and read or written by nothing** — no photographer can
see any difference. Production is 37 tables, 549 columns, 13 functions, 56
policies.

What it settled, each proved against a real database before it went near
production and again in it:

- **A forgotten site is an error, not a guess.** Neither table has a tenant
  default, so a service-role writer that forgets the site fails instead of
  filing a photograph under the oldest site on the platform.
- **A placement cannot point across sites** — five tenant-aware composite
  foreign keys, shown to refuse what a plain foreign key admits. Live smoke
  test: refused with `23503`.
- **One slot, one photograph, for every kind** — seven partial unique indexes,
  shown to refuse a duplicate of every kind that the obvious single wide UNIQUE
  admits.
- **Deleting a site still works** with a used photograph on it: the tenant
  cascade and the asset's RESTRICT compose. Asked to be measured rather than
  reasoned about; measured locally and in production (0 / 0 / 0).
- **Nobody writes these tables yet.** `authenticated` reads its own site's rows;
  `anon` and `service_role` hold nothing. Live: own 1, foreign 0, admin 2.
- **Page keys have one definition in two languages**, `isPageKey()` and a
  CHECK, held to parity by `.mk/photo-assets.ts` — a new built-in page now
  fails that suite until the CHECK has it.

137 SQL assertions, 55 TypeScript, 25 isolation checks; eight broken copies of
the migration each caught; the drift guard extended to 435 P1 facts and shown to
catch six kinds of fixture drift.

### 2026-09-29 (late) — S4 analytics instrumentation, DEPLOYED

Migration `20260929231653`, `analytics_instrumentation_2026_09_29`, sha256
`c1acb1ae…`. Full write-up: **`claude/analytics-s4.md`**. The short version.

Of the nine public addresses a site has, **two recorded anything**: a gallery
and a story, because `<ViewTracker>` was dropped into those two page files by
hand. The homepage, About, Contact, the Journal and Galleries index pages, the
shop and every page a photographer made themselves were never counted at all.
Now the tracker is mounted **once**, in the root layout, and sends a pathname —
nothing that identifies anything. The server works out what is at that address
**on this site**, so another photographer's gallery is not at any address here
and the spoof cannot be expressed rather than being caught. Every standard
public page is covered; an individual print-detail page (`/shop/<photo id>`) is
the one known exception and is recorded in §5.

Six columns added to `page_views`: `path`, `page_key`, `referrer_host`,
`session_hash`, `device`, and `tenant_id` — which was not asked for and without
which none of the others work, because RLS reached the site through the album or
story and a homepage view has neither, so **a photographer could not have read
their own homepage views at all.** All 77 pre-existing rows were backfilled from
their parent and verified: 0 ownership mismatches, 0 identity failures, and the
five metadata columns still NULL on every one of them.

**The same hole S3 closed on the queue was open here.** `page_views` had
`for insert with check (true)` and `anon` held INSERT, so anybody could POST a
row naming any gallery on the platform with any hash and any timestamp. Measured
rather than assumed, by restoring the old grant inside a transaction:
`PRE-S4 ACCEPTED, 1 row` → `POST-S4 permission denied`. Now no role holds INSERT
at all, including `service_role`; one SECURITY DEFINER function is the whole
interface and only `service_role` may call it. **The policy count went DOWN by
one**, which is the change rather than an error in it.

**Privacy as rules rather than intentions.** No IP, no user-agent string, no
full referrer, no query string, no cookie, no `localStorage`, no fingerprint, no
third party — each with an assertion behind it, and seven CHECK constraints so
that a future writer cannot put them back. `visitor_hash` is unchanged (daily
rotation, so nobody is followed across two days); `session_hash` is 16 random
bytes in `sessionStorage`, derived from nothing, gone with the tab.

**And it is optional, which was a correction.** The first version recorded
nothing at all when `sessionStorage` threw — a Safari private window, or site
data blocked — which made a browser that respects its user an uncounted visitor.
Now the view is recorded with `session_hash` null, with no fallback that outlives
the tab. Production's own smoke test used a null session, which is why that is
the test worth having run.

**A grant bug found by running as the real role.** The first version gave
`service_role` DELETE and not SELECT. A filtered DELETE reads the column it
filters on, so `deleteSite()` would have failed with *permission denied for
table page_views* — and it swallows only `/does not exist/`, so it would have
said *"rows may remain in page_views"* for ever. As the table's owner the test
passes either way. Same shape as S3's defect, found the same way.

**And a hole in the new suite, found by mutating it.** Assertions passing on the
first run is not evidence. Fourteen mutations were applied and reverted; thirteen
were caught. The one that was not — dropping the tenant filter from the album
lookup — **passed 215/215**, because the resolver handed the database a
cross-tenant album, the database refused it, and `ok === false` looked like
success. The assertion was satisfied for the wrong reason. It now asserts *which
layer refused*, and the mutation fails. The defence in depth was real and
working, and it was hiding a test that could not tell which layer did the work.

**76 SQL assertions, 295 application assertions**, and the drift guard extended
to `page_views`: 403 facts compared for `jobs`, 175 for `page_views`, shown to
bite twice. Three clean rounds of every suite against the reconciled fixture,
`BUILD EXIT: 0`.

One thing the extended guard found was its own fault and worth remembering:
comparing raw `attnum` reported the rebuilt columns as drift, because dropping and
re-adding six columns leaves gaps — and production's numbering (added) never
matched the fixture's (declared inline) anyway. Position is now compared as a
rank among live columns, which still catches a reordering. Dropping the position
from the comparison would have been the easy fix and the wrong one.

### 2026-09-29 — S1 schema truth, S2 value validation, S3 jobs (deployed)

Three prerequisites off `claude/photo-migration-plan.md`. Only the last reached
production, and the only thing a photographer can see is one button where there
used to be two.

**S1.** `db/survey.sql` rewritten as twelve independently-runnable read-only
parts, run against production, and its output committed as
`db/schema-2026-09.sql` — the first schema snapshot this repo has ever had.
`db/test-fixture.sql` was regenerated from it (411 → 1,329 lines) and
`db/schema-verified.md` records every verified fact, every reconstruction, and
every discrepancy found and deliberately left alone. The fixture had **nine
foreign keys wrong**, declaring NO ACTION where production cascades, which meant
a local rehearsal proved the opposite of the truth. Also fixed: a false failure
in `db/verify-tenant-isolation.sql` that asserted a platform admin's unqualified
update touched exactly one row — true only while the database had one site.

**S2.** `updateDraftSectionValues` checked that a setting existed and stored
whatever value came with it. The form path, one file away, had always checked
the value against its field. The rules now live once in `lib/sections/values.ts`
and both writers share them, with two different failure policies: from a form,
fall back to the current value, because the panel is on screen and the control
snapping back is the message; from code, throw. 1,557 assertions in
`.mk/section-values.ts`, 43 of which were shown to fail against the writer this
replaced.

**S3 — deployed as Supabase migration `20260929212635`.** One queue, in the
database rather than a service: `jobs`, with `enqueue_jobs`, `claim_jobs` and
`finish_job`. `for update skip locked` so two drains never take the same row;
attempts counted at **claim** time so a job that kills its worker still
terminates; a lease rather than a lock so recovery is the ordinary claim query;
and finishing requires still holding that lease. **Nobody writes to the table
directly** — it grants no INSERT, UPDATE or DELETE to anybody, and the three
SECURITY DEFINER functions are the whole interface.

`backfillDerivatives` is the first thing through it, and the one that most needed
it: that was a `do…while` loop **in the browser**, where closing the tab stopped
it, a photograph that failed was skipped by a bare `catch {}`, and one that failed
every time was invisible — permanently in the "still to go" count with nothing
saying why. Now one job per photograph, retried with backoff, five attempts and
then a row a query can find.

**Three bugs this phase found in its own work, each before production:**

- **A `grant` is additive.** The first draft granted `authenticated` SELECT and
  INSERT and gave `service_role` nothing, assuming Supabase's defaults. Checked
  instead: `service_role: NOTHING` — the drain would have failed with *permission
  denied for table jobs*. The migration now states the whole privilege set,
  revoking from every role first.
- **RLS protects rows, not values.** A photographer could have posted straight to
  PostgREST and written a job on their own site with `max_attempts` at a million.
  The enqueue path became a narrow function that names four columns and leaves the
  machinery to its defaults — and that validates the *photograph* the payload
  names, not just the site.
- **`claim_jobs` could claim more than `p_limit`.** `update … where id in (select
  … limit N for update skip locked)` reads as "at most N" and is not: the planner
  puts that subquery on the inner side of a semi-join and re-executes it per row,
  so one call with `p_limit => 1` claimed **five** and burned an attempt on each.
  The drain runs the first and abandons the rest under a ten-minute lease; five
  rounds and each is failed as *"the worker did not report back"* having never
  run. Plan-dependent, so it surfaced as a flaky test rather than a failure — and
  chasing that flake instead of dismissing it is the only reason it was caught.
  Fixed with a materialised CTE.

### 2026-09-27 (evening) — the same panel on every piece of text

Twenty-five text fields across eight sections: the hero's three in BOTH modes,
the intro's over-line, heading and body, About's four, the galleries' heading
in both layouts, the Journal's heading, over-line and link, the print wall's
four header lines, the Instagram heading, and Contact's five.

Three things came out of doing it eight times rather than once.

**One helper instead of eight copies.** `styledText(ctx, settings, key)`
returns the `data-field` marker and the element's typography together, because
they have to land on the same element and neither works alone — the live
channel writes to `[data-field="…"]`, so a style on a wrapper would disagree
with the editor for as long as it took the server to render.

**The failure here is silent, so it is measured rather than looked at.** A
control whose CSS rule does not read `--txt-*` is stored and ignored; a
fall-through written carelessly changes text nobody touched. There is now an
assertion over **28 elements × 11 properties, in both directions**: every
property must reach every element when set, and nothing may move when nothing
is set. It caught two real faults that reading the diff did not:

- The Journal's over-line lost its own type entirely. `inherit` is only a
  neutral fallback when nothing else was setting the property; `.eyebrow` in
  globals.css was, at the same specificity and earlier in the cascade, so
  `inherit` quietly won and the line came out as plain body text.
- The hero's button ignored its alignment, because it never declared
  `text-align` and the place's own centring reached it by inheritance.

**Two fixes fell out of the survey.** Every button inverted to a hard-coded
pair on hover, which is the "hover goes to black" a tester reported — they now
invert against whatever the button actually is. And `allFonts()` replaced a
per-section omission: outside the hero, a section's chosen typeface was never
fetched, so that picker had never done anything on any other section.

### 2026-09-27 — typography for one piece of text

Two slices, one idea: **the controls for a piece of text belong beside that
piece of text.** Typography used to be chosen per *section*, in three roles —
heading, body, over-line — which meant a section with two headings had one
control for both, three groups down the panel from the words it governed.

Now every text element declared `textStyle` in the registry gets a
**Typography** button under its own box, beside its **Position** button. The
popover carries alignment, typeface, size, weight, capitals, italic,
underline, line height, letter spacing, word spacing and colour.

Three decisions worth keeping:

**Size is a multiplier, shown as a percentage.** Elementor shows `48`, which is
honest, literal, and meaningless after a change of look or on a phone. 140%
means "half again as big as this text is meant to be", which survives both.
Emitted as a custom property the stylesheet multiplies into its own `clamp()`,
never as an inline `font-size` — an inline one would beat the media query and a
title sized on a desktop would keep that exact size on a phone.

**Only what is chosen is stored.** Every control has a "following" state and
starts there; clicking a chosen segment again hands it back, and a slider's
readout is the button that clears it. That silence is what lets an unset value
fall through to the section, then the look, then the site.

**A look does not take these away.** Everywhere else in the codebase typography
is design and a look owns it. Here it is the photographer's work: the `text`
bag deliberately has no field declaration, which is what makes `splitSettings`
treat it as content and carry it across.

Verified: 24 sanitiser assertions against hostile input (a key that tries to
carry a CSS selector is refused, since it ends up inside `[data-field="…"]`),
29 browser assertions on the cascade and the element-scoped live channel, and
31 browser assertions driving the real panel — including the one that matters
most, that styling a second element before the first has saved does not drop
the first. That bug was real and was closed by holding the last-written bag in
the panel rather than re-reading a settings prop the debounce leaves behind.

### 2026-09-26 — the hero's fifteen places

The title, subtitle and button were one block welded to the bottom of the
picture, centred, with a "Title position" control that moved the *wordmark* and
left them alone. Each now names its own place out of fifteen — five bands down,
three across — set from a button under its own text box or by dragging it on
the photograph. Two that pick the same place stack in reading order.

The wordmark is gone entirely: render, toggle, settings column and CSS.

**The crash this caused, and the lesson.** The first version moved the element
into its new container with `appendChild`, and a code comment argued this was
"the identity" because the next render puts it there anyway. Visually true,
mechanically false: React holds its own tree of where each node lives, and
re-parenting one behind its back means the next reconciliation tries to remove
a child from a parent that no longer has it. It throws, and the preview shows
the error page. Nothing is re-parented now — a dragged element is carried by a
`transform`, which is paint and not structure, and parks over the computed
destination until the server's render arrives. Measured shift on release: 1px,
from about 200.

That in turn exposed a layout flaw worth remembering: the grid rows were
content-sized, so a place was only as tall as what was in it and moving the
tallest element out of one shrank the whole band. The drop targets were moving
under the pointer. A place is now a fixed rectangle whatever is in it.

The lesson: a confident comment was doing the work a test should have been
doing. There is now an assertion whose only job is to fail if anything
re-parents.

### 2026-09-25 — samples, and the editor outage

`imageSrc()` replaced thirty-one hand-built image URLs. Samples live on this
origin, not in the bucket, so every picker was drawing a broken image; the tell
was the hero's crop box failing beside a large preview of the same photograph
that worked, because one went through `photoUrl()` and the other did not.

`site_draft.tenant_id` defaulted to `default_tenant_id()` and the upsert never
set it — it named `tenant_id` as its conflict target and left the value to the
database. Removing that default made every save in the editor insert NULL into
a NOT NULL primary key. Found alongside it: `deleteDraft()` ran `.delete()`
with no tenant, commented as safe because row-level security narrows it — but a
platform admin passes every tenant check, so publishing would have deleted
**every photographer's draft on the platform**. All of it was hidden by one
blanket exemption reading "the draft layer carries its own tenant handling",
which named no filter and was not true.

### 2026-09-24 — tenancy, downloads, monitoring

A platform admin on somebody else's address now edits *that* site rather than
their own, with a red pill naming the address. A switch for
`albums.allow_downloads`, which governed two doors and which nothing had ever
set. Sentry, inert without a DSN, tagging every event with the site and
scrubbing share-link and auth tokens before anything leaves. The checklist
stopped asking to fill a homepage that was already full.
