# Photo assets and usages — implementation sequence

Written 2026-09-29, after `claude/photo-assets-design.md` was approved in
principle. That document is the *what*; this is the *order*, and it is the
document to work against phase by phase.

**Rules that hold across every phase:**

- **Additive only.** No column is dropped, renamed or repurposed anywhere in
  this sequence. Legacy path compatibility is preserved throughout.
- **Phase D is not in this sequence.** Dropping the redundant file columns from
  `photos` is a separately approved migration, not this quarter.
- **`srcSetFromPath` is not retired here.** It stays until a query reports zero
  path-only usages, which is after this sequence ends.
- Every new assertion is **shown to fail against the bug it was written for**
  before it is kept. That is how every existing suite in `.mk/` was built and it
  is the only thing that makes a green suite mean anything.
- Each phase is deployable on its own and leaves the application working.
- **A production migration is followed, in the same sitting, by updating
  `db/schema-2026-09.sql`, `db/test-fixture.sql` and `db/schema-verified.md`.**
  A fixture that lags production is the S1 failure; a fixture that runs ahead of
  it is the same failure pointed the other way.

---

## Where this sits

| | step | status |
|---|---|---|
| prerequisite | **S1** schema truth | **done 2026-09-29** |
| prerequisite | **S2** programmatic value validation | **done 2026-09-29** |
| prerequisite | **S3** jobs infrastructure | **DEPLOYED TO PRODUCTION 2026-09-29** — migration `20260929212635` |
| parallel | **S4** analytics instrumentation | **DEPLOYED TO PRODUCTION 2026-09-29** — migration `20260929231653`; application code pushed 2026-09-30 |
| | **P1–P6** the photo migration | this document; **P1 is now unblocked** |
| after | **S5** AI foundation + alt text | needs P5 |

S4 did not block anything here and was not made to wait behind it: every day
unrecorded is traffic data that cannot be recovered. It is done;
`claude/analytics-s4.md` is its record.

---

# S1 — Schema truth

**Purpose.** Stop rehearsing migrations against a fixture that disagrees with
production. This has already cost three incidents.

**Files.** `db/survey.sql`, `db/schema-2026-09.sql` (new),
`db/schema-verified.md` (new), `db/test-fixture.sql`,
`db/verify-tenant-isolation.sql`.

**Database changes.** None. Read-only inspection.

**DONE 2026-09-29.**

- `db/survey.sql` rewritten as twelve independently-runnable read-only parts,
  each returning one `line` column, and run against production.
- `db/schema-2026-09.sql` is the snapshot: PostgreSQL 17.6, 34 tables, 473
  columns, 3 sequences, 9 functions, RLS on all 34, one trigger
  (`site_draft_touch`), grants. *(Updated the same evening for the queue — see
  S3.)*
- `db/test-fixture.sql` regenerated from it, 411 → 1,329 lines, plus the
  Supabase stubs and a two-tenant seed. Builds cleanly against local PostgreSQL
  16.13; production is 17.6, so **the fixture is not version parity** and that
  is recorded.
- `db/schema-verified.md` records every verified fact, the three parts that are
  reconstructed rather than transcribed, and every discrepancy found and
  **deliberately left alone** — `orders.status`'s default violating its own
  CHECK, `newsletter_signups_email_key` being unique on `(email)` alone,
  `profiles_role_check` forbidding `'admin'`, the duplicate unique indexes, the
  columns nothing reads, and the thirteen tenant columns with no foreign key.
- The fixture had **nine foreign keys wrong**, declaring NO ACTION where
  production cascades. A local rehearsal of `delete from albums` therefore
  *failed* locally and succeeds in production — the fixture proved the opposite
  of the truth. Also corrected: `push_draft_step` was missing entirely, and
  `tenant_of`'s parameter names were wrong, which matters for a named-argument
  call.
- `db/verify-tenant-isolation.sql` phase 3 asserted a platform admin's
  unqualified update touched **exactly one** row, true only while the database
  had one site. It reported a false failure under a summary line reading
  *"Isolation is NOT holding — do not open beta logins"*. It now counts the
  sites first as the table owner and asserts the admin reached every one, with
  at least one beyond its own tenant. 14/14 pass; proven to fail (`0 of 2`) with
  the platform-admin flag disabled.

**Rollback.** Revert the files. Nothing runtime depends on them.

---

# S2 — Programmatic value validation

**Purpose.** `updateDraftSectionValues` checks that a key exists and does not
check its value. It is the writer a model would use. Close it before anything
non-human calls it.

**Files.** `lib/sections/values.ts` (new — the shared rules),
`lib/sections/form.ts` (`readField` now calls them), `app/actions/canvas.ts`,
`.mk/section-values.ts` (new).

**Database changes.** None.

**DONE 2026-09-29.**

One set of rules in `lib/sections/values.ts`, **two failure policies**: from a
form, a value that does not pass leaves the setting exactly as it was, because
the panel is on screen and the control snapping back is the message; from code,
it throws. A second schema was never an option — a second copy is how the two
come to disagree, and the one that disagrees quietly is the one nobody watches.

- `toggle` requires a boolean; `number` requires a finite number and is
  **clamped** into its declared range, exactly as the form path has always
  clamped it; `color` requires `#rrggbb` and is lower-cased; `select` requires
  one of the field's own options, compared case-sensitively; text, textarea and
  image take a string, trimmed, with empty meaning null.
- **`null` stays valid on every per-size twin.** It is FOLLOWING, not "none" —
  "Follow desktop" and the placement picker's Follow both write it, and
  `overrideValue` produces it every time a phone value comes back equal to the
  desktop's. Refusing it would have broken the commonest gesture in the panel.
- **`custom` is never validated** — a focal point, a story chooser and a mark
  image each have a purpose-built editor with its own shape, and `readField`
  already leaves them alone.
- **The keys no field declares pass through untouched** — `text`, `text_mobile`,
  `shown`, `type` and each placement's phone value. The four existing sanitizers
  are preserved and run after the validator, on the whole bag.

**Tests.** `.mk/section-values.ts`, **1,557 assertions**, of which **43 were
shown to fail** against the writer this replaced (the suite models the old
writer inline, so every case is on record as a hole that was really open). The
half that matters more than the refusals: every default, every option of every
`select`, and every value the FormData path writes for every section on both
sizes, all still accepted unchanged.

**Closed afterwards.** `galleries.columns` and `journal.grid_columns` were
`select` fields whose options are the strings `'2'`, `'3'`, `'4'` and whose
defaults were the **number** `3`. The registry was corrected rather than the
validator broadened — one canonical type per field, agreeing with its own
options — and proved by rendering both sections with the number and with the
string and diffing the markup byte for byte. The suite's known-exception list is
gone rather than shortened, replaced by an assertion that every field's default
matches its own declared kind.

**Rollback.** Revert; the old writer accepted more, so nothing that worked
stops working.

**Must remain unchanged.** Every value the editor's own panel can produce is
still accepted. The FormData path (`updateDraftSection`) behaves identically —
it already validated.

---

# S3 — Jobs infrastructure

## DEPLOYED TO PRODUCTION 2026-09-29

**Supabase migration version `20260929212635`,
`jobs_infrastructure_2026_09_29`.** The committed file's SHA256 was checked
before it was applied:

```
9048133d6ff9431150ab07e1e48188718edf33b83eb6cfb139bb937e0ea7797f
```

Verified against the live database afterwards — table, 15 columns, RLS, the five
indexes, the six constraints, the policy, the grants and all three functions.
The full verified list is in `db/schema-verified.md`; the headline is the grant
shape, because it is the design:

| | |
|---|---|
| `jobs` table | `authenticated`: SELECT only. `anon`: none. **`service_role`: none.** |
| `enqueue_jobs` | DEFINER, `search_path = ''`, EXECUTE to `authenticated` |
| `claim_jobs`, `finish_job` | DEFINER, `search_path = ''`, EXECUTE to `service_role` |

**Purpose.** The backfill cannot run in a request. Three existing operations
also wanted this: `backfillDerivatives` (a client-side `do…while` loop),
newsletter `syncPending` (up to 300 serial HTTP calls) and the Instagram
refresh.

**Files.** `db/migrations/2026-09-29_jobs.sql`, `app/api/jobs/drain/route.ts`,
`lib/jobs/{types,queue,handlers,derive,run}.ts`, `vercel.json`,
`app/actions/backfill.ts`, `components/admin/BackfillPanel.tsx`,
`app/admin/settings/page.tsx`, `app/admin/sites/page.tsx`,
`scripts/check-tenant-scoping.mjs`, `package.json` (+ `pg` for the test
harness), `db/verify-jobs.sql`, `scripts/jobs-concurrency.sh`,
`scripts/fixture-matches-migration.sh`, `.mk/jobs.ts`.

## The four things that make the queue safe

1. **One worker per job.** `claim_jobs` selects `for update skip locked`, so two
   drains on two Vercel instances take different rows. The lock is a row lock in
   Postgres, not a flag in a process — there is no shared memory between two
   Vercel invocations, so anything in-process would be no lock at all.
2. **Attempts are counted at CLAIM time, not on failure.** A worker killed
   mid-job never gets to write "that failed", so a count kept in the failure path
   would retry a job that kills its worker for ever.
3. **A lease, not a lock.** A job past `lease_until` is claimable again, so
   recovery is the ordinary claim query rather than a second mechanism that has
   to be scheduled and can itself fail.
4. **Finishing requires still holding the lease.** `finish_job` matches on
   `locked_by`, so a worker that stalled, lost its job to a reclaim and then woke
   up cannot write over the new holder's result.

## Nobody writes to the table directly

The queue's own columns are its integrity, and a caller who can choose `status`,
`attempts`, `max_attempts`, `run_after`, `locked_by`, `lease_until` or
`finished_at` can turn all four of those properties off. Row-level security does
not help: it decides *which rows* a caller may touch, not *what they may put in
them*.

So the table grants no INSERT, UPDATE or DELETE to anybody, and three SECURITY
DEFINER functions are the whole interface. `enqueue_jobs` validates the site, the
job kind **and the resource the payload names** — for `photo.derivatives` it
checks the id is a real photograph of that site's, then **builds** the payload
and derives the dedupe key from what it validated rather than copying what it was
sent, so a caller cannot choose the dedupe identity at all. Batches are capped at
200 items in SQL because the function is reachable from a browser;
`lib/jobs/queue.ts` splits longer lists.

## Two bugs this phase found and fixed before deployment

**A `grant` is additive, and `service_role` had nothing.** The first draft left
the worker functions SECURITY INVOKER and granted `service_role` no table
privileges, assuming Supabase's defaults would cover it. Checked instead:
`authenticated: INSERT, SELECT. postgres: ALL. service_role: NOTHING.` The drain
would have failed in production with *permission denied for table jobs*. Fixed by
stating the whole privilege set — the migration **revokes from every role first**,
then grants — and by making all three functions DEFINER, so the worker's entire
reach is EXECUTE on two functions.

**`claim_jobs` could claim more than `p_limit`.** The form
`update … where j.id in (select … limit p_limit for update skip locked)` reads as
"take at most p_limit" and is not what it does: the planner puts that subquery on
the **inner** side of a Nested Loop Semi Join, re-executing it per candidate row,
and `skip locked` returns a different row each time.

```
5 queued rows, one call, p_limit => 1  →  5 claimed, 5 attempts burned
```

The drain runs only the first and abandons the rest `running` under a ten-minute
lease; five such rounds and each is failed as *"the worker did not report back"*
having never run. **Plan-dependent, hence intermittent** — empty statistics gave
5, statistics saying 500 rows gave 1 — which is why it surfaced as a flaky test.
A CTE containing `FOR UPDATE` is never inlined and is materialised once. The
production body carries the CTE; the subquery form is not deployed.

## First consumer

`backfillDerivatives`, one job per photograph, replacing a `do…while` loop **in
the browser** where closing the tab stopped it, a failure was swallowed by a bare
`catch {}`, and a photograph that failed every time was permanently in the "still
to go" count with nothing saying why. The panel lost its second button — "Process
10" and "Process all" were two speeds of a loop that no longer exists — and
gained a line saying how many photographs gave up.

**Not touched, as required:** the upload flow, the Instagram schedule, and
newsletter behaviour. `syncPending` only gained a `maxDuration` on the page that
invokes it.

## The cron, and the plan it is on

`vercel.json` schedules `/api/jobs/drain` **daily** (`0 5 * * *`), because a
Hobby account rejects anything more frequent **at deploy time** — a cron
expression that would run more than once a day fails the deployment outright. The
work photographers wait for is started by them in the admin, which drains their
own site on the spot; the cron is the safety net. On Pro this becomes
`*/5 * * * *`, one string.

## Tests

| | |
|---|---|
| `db/verify-jobs.sql` | **107** |
| `.mk/jobs.ts` (the real worker, as `service_role`, against a real database) | **64** |
| `scripts/jobs-concurrency.sh` (two-plus connections) | **17** |
| `scripts/fixture-matches-migration.sh` | 402 facts compared (403 after S4 extended the guard) |
| `db/verify-tenant-isolation.sql` | 14 |

Determinism, after two harness defects were found and fixed: 15 solo runs of
each suite, **40 rounds concurrency → .mk → verify-jobs**, **40 rounds in the
reverse order** (which previously failed 9 of 40), and 3 fresh
fixture-and-migration rebuilds in both orders — all clean. Deliberate pollution
(1, 2, 3 and 60 foreign queued rows; a row left `running` under a live lease) is
absorbed.

The two harness defects, both real: the suites cleaned only their own job kinds
while claiming any kind for their tenant, so one leftover row broke them — each
now clears every job for its test tenants and **asserts the queue is empty**
before proceeding. And block 6 asserted two drains finish everything *in one
pass*, which this design does not guarantee; it now drains to empty over bounded
passes and asserts what is true — **every job runs exactly once, never twice**.

**Environment variables.** None new. `CRON_SECRET` and
`SUPABASE_SERVICE_ROLE_KEY`, both already required. The drain fails closed on an
unset secret, so an unset one is a queue that never self-drains rather than an
open endpoint.

**Rollback.** `drop table jobs cascade;` (which takes the three functions with
it — they return `public.jobs`), remove the cron, revert
`backfillDerivatives` to its loop. Nothing else reads jobs yet.

**Unchanged, as required.** The photo upload path, the Instagram refresh
schedule, and the newsletter sync's observable behaviour. Only *where* the work
runs changed.

---

# P1 — Tables and constraints

**Purpose.** Create the schema. Nothing reads it. This phase is pure DDL so it
can be deployed, observed and reverted with zero application risk.

**Files.** `db/migrations/<date>_photo_assets.sql` (new),
`db/test-fixture.sql`, `db/schema-2026-09.sql`, `db/schema-verified.md`,
`db/verify-tenant-isolation.sql`, `scripts/check-tenant-scoping.mjs`,
`lib/photos/usage-kinds.ts` (new, declaration only).

**Database changes.**
- `photo_assets` and `photo_usages` exactly as `claude/photo-assets-design.md`
  §1 and §2, including the seven partial unique indexes.
- `unique (id, tenant_id)` on `photos`, `albums`, `blog_posts`,
  `catalog_items`.
- `photos.asset_id` and `site_images.asset_id`, both nullable, no FK yet —
  the FK is added in P4 once the backfill has populated them, so an empty column
  cannot fail a constraint.
- `apply_tenant_policy` on both new tables.
- The four new table names added to `SCOPED` **in this commit**, before a single
  query exists, so the first unscoped read fails the build.

**Lessons from S3 that apply directly here.**
- State the whole privilege set: **revoke from `public`, `anon`,
  `authenticated` and `service_role` first**, then grant. A `grant` is additive
  and Supabase's default privileges may already have handed out ALL.
- Any `SECURITY DEFINER` function gets `search_path = ''` and fully qualified
  names, and restates the tenant rule its table's policy states — a definer
  function is not subject to RLS.
- Never `update … where id in (select … limit N for update skip locked)`. Use a
  materialised CTE.
- Extend `scripts/fixture-matches-migration.sh` to cover the new tables, so the
  fixture cannot drift from the migration.

**Tests.**
- The migration runs twice against `db/test-fixture.sql` without error
  (every migration in this repo is written to be safe to run twice).
- **Uniqueness, per kind:** inserting a duplicate logical slot is rejected for
  each of the seven shapes. Each must be shown to *succeed* against a
  single compound `UNIQUE` first — that is the defect this design corrects, and
  a test that never saw it fail proves nothing.
- **Cross-tenant, under the service-role client** so a pass proves the database
  and not RLS: a usage with tenant A and a parent owned by B is rejected for
  each of the five foreign keys; a tenant mismatch against its own asset is
  rejected; updating a usage's `tenant_id` is rejected; moving a parent row to
  another tenant while a usage points at it is rejected.
- **CHECK coverage:** a `gallery` usage with a `page_key`, a `page_section`
  usage with an `album_id`, a `draft`-scoped `story_block`, and an unknown
  `kind` are each rejected.
- **As the real roles**, not as the table owner — the owner holds every
  privilege and bypasses RLS, and a suite that only runs as the owner cannot see
  a grant problem. That is how S3's `service_role` defect hid behind a green
  suite.
- `db/verify-tenant-isolation.sql` extended: a foreign tenant reads 0 assets and
  0 usages; `anon` reads 0 of both; a platform admin still reaches across.
- `check:tenants` passes.

**Rollback.**
```sql
drop table photo_usages;
drop table photo_assets;
alter table photos        drop column asset_id;
alter table site_images   drop column asset_id;
alter table photos        drop constraint photos_id_tenant;
alter table albums        drop constraint albums_id_tenant;
alter table blog_posts    drop constraint blog_posts_id_tenant;
alter table catalog_items drop constraint catalog_items_id_tenant;
```
Safe at any moment: nothing reads any of it.

**Must remain unchanged.** Everything. No application code is touched in this
phase; the site and the admin are byte-identical before and after.

---

# P2 — Unified ingestion

**Purpose.** Every upload produces an asset. Do this *before* the backfill, so
the moment the backfill finishes there is no new stream of un-asseted files.

**Files.** `lib/photos/key-base.ts` (new), `lib/photos/ingest.ts` (new),
`app/actions/photos.ts` (`registerPhoto`), `app/actions/images.ts`
(`registerSiteImage`), `app/actions/blog.ts` (`registerJournalImage`),
`.mk/ingest.ts` (new).

**Database changes.** None. Writes rows into tables created in P1, and sets
`photos.asset_id` / `site_images.asset_id` on new uploads.

**What `ingest()` does.** Fetch from R2 → `sharp` for dimensions and the
derivative ladder → `exifr` for capture metadata → `upsert photo_assets on
(tenant_id, key_base)` → return `{ assetId, displayPath }`. The caller then
creates its relationship row in one transaction. `registerPhoto` additionally
inserts the `gallery` usage beside the `photos` row.

Three consequences worth stating:
- **EXIF becomes universal.** Today only gallery uploads are parsed; journal and
  editor uploads will carry capture date and keywords too.
- **Journal images finally exist as records.** `registerJournalImage` returns a
  path and writes nothing today.
- **The failure mode improves.** A crash between the asset and the relationship
  leaves an asset with no usage — findable with one query and re-runnable.
  Today it leaves a file in R2 that no table mentions.

**Tests.**
- `ingest()` is idempotent: running it twice on the same key produces one asset
  and identical columns.
- All three ingestion paths produce an asset; the `photos` row and its asset
  agree on `display_path`, `width`, `height`, `derivatives`.
- A `.mk` scan finds **no** `processExistingOriginal(` call site that does not
  also call `ingest(` — the same shape as `.mk/blockable.ts`, which scans class
  names. Shown to fail by reinstating a bare call.
- `ownsKey()` is enforced on every mint, including inside `ingest`.
- An upload of a photograph whose long edge is under 1600 produces the correct
  short derivative ladder in both the asset and the `photos` row.

**Rollback.** Revert the code. Assets created in the meantime are harmless
orphans; the backfill would recreate them idempotently.

**Must remain unchanged.**
- `registerPhoto` returns nothing and revalidates the same paths; the uploader
  UI is untouched.
- `registerSiteImage` returns the same `{ id, path }` shape the picker expects.
- `registerJournalImage` **still returns the display path** — its signature
  gains an object return only in P5, not here.
- The `photos` row's own columns are written exactly as today.
- Galleries, the journal and the editor picker render identically.

---

# P3 — The extractor and `syncUsages`

**Purpose.** From this point every document edit projects its usages correctly.
Deliberately **before** the backfill, so there is never a window in which a live
edit goes unprojected.

**Files.** `lib/photos/extract.ts` (new — one function per document shape),
`lib/photos/usages.ts` (new — `syncUsages`), `lib/sections/store.ts`
(`replaceSections`), `lib/drafts/store.ts` (`writeDraftPage`, `publishDraft`,
`restoreDraftFrom`, `discard`), `lib/site-patch.ts` (`patchSiteSettings`),
`app/actions/templates.ts` (`install`, `revertTo`), `app/actions/albums.ts`,
`app/actions/blog.ts`, `app/actions/catalog.ts`, `.mk/usages.ts` (new).

**Database changes.** None.

**The shape.** `syncUsages(scope, kind, ref, found)` deletes every usage for
that narrow scope and re-inserts the extracted set — delete-and-reinsert for one
(tenant, scope, kind, parent), mirroring `replaceSections`' own strategy, which
is why it composes with it cleanly. A path with no asset **mints one** in
`state = 'pending'` and queues a derive job **through `enqueue_jobs`**, exactly
as the backfill will; the two share one code path so they cannot disagree.

`gallery` never participates: it is created beside the `photos` row in P2 and
destroyed by the production cascade (`db/schema-verified.md`).

**Tests.**
- **The invariant:** drop every row from `photo_usages`, re-run `syncUsages`
  over every document, and the table comes back identical. This is the test that
  justifies the whole projection design.
- **publish → undo → redo → discard** leaves `photo_usages` exactly matching the
  documents at every step. Shown to fail against a picker-written usage row —
  the design defect this phase exists to avoid.
- `applyLook` followed by `revertTo` leaves no stale usages.
- Deleting an album cascades its cover usage to zero; deleting a story cascades
  its block usages; deleting one gallery photograph cascades its membership
  usage. Each verified by count, not by inspection.
- A section moved from position 2 to position 0 re-projects under the new
  ordinal with no duplicate.
- Two `intro` sections on one page, both with an `image_path`, produce two
  distinct usages — the case the slot key exists for.
- `check:tenants` passes with the new queries.

**Rollback.** Revert the code. `photo_usages` becomes stale, which matters to
nothing, because nothing reads it until P5.

**Must remain unchanged.** This is the phase with the most call sites and the
strictest requirement:

- Every document writer's **output is identical** — `page_sections`,
  `site_draft`, `site_settings`, `blog_posts.blocks` and `albums` rows are
  written exactly as before.
- Publish, undo, redo, discard, restore-version, apply-look and revert all
  behave identically from the editor's point of view.
- **No user-visible change at all.** Verified by rendering every built-in page
  through the existing markup harness and diffing against the pre-phase output.

---

# P4 — Backfill

**Purpose.** Bring existing data up to the state P2 and P3 now maintain.

**Files.** `lib/photos/backfill.ts` (new), `lib/jobs/handlers.ts` (kinds
registered), `db/migrations/<date>_photo_assets_fk.sql` (new),
`.mk/backfill.ts` (new).

**Now unblocked:** the queue S3 deployed is what this runs on. A new job kind
costs an entry in `JOB_KINDS`, a handler, **and a line in `enqueue_jobs`'
allow-list** — which means a migration somebody reads, on purpose.

**Database changes.** Rows only, until the final step: once every `photos` and
`site_images` row has an `asset_id`, add the foreign keys that were deliberately
left off in P1.

```sql
alter table photos      add constraint photos_asset_fk
  foreign key (asset_id, tenant_id) references photo_assets (id, tenant_id);
alter table site_images add constraint site_images_asset_fk
  foreign key (asset_id, tenant_id) references photo_assets (id, tenant_id);
```

**The passes**, each idempotent, each batched through the jobs table:

0. `keyBaseFor()` — the resolver. Duplicate detection *is* the unique index on
   `(tenant_id, key_base)`; there is no comparison logic.
1. Assets from `photos`. Sets `photos.asset_id`, `state = 'derived'`.
2. Assets from `site_images`. Same key, so a file in both tables collapses to
   one asset automatically.
3. Usages from real relationships: `photos.album_id` → `gallery`;
   `albums.cover_photo_id` / `cover_custom_path` → `gallery_cover`;
   `catalog_items` → `shop_listing`.
4. Usages from documents, using **the P3 extractor** — `page_sections` (live),
   `site_draft.pages` (draft), `blog_posts.blocks`,
   `blog_posts.featured_custom_path`, and the four legacy `site_settings` image
   columns.

**Excluded, deliberately:** logos, favicon, `shop_wall_texture`, `shop_frames`,
`room_scenes.image_path` (site furniture); `site_versions` / `site_template`
snapshots (frozen history); `cover_video_path` and `video_path` (videos are out
of V1); sample photographs (`isSamplePhoto()`).

**Tests.**
- Every `photos` row has an `asset_id`; every `site_images` row has one.
- Every path in the 14 scalar columns and 4 live blobs resolves to **exactly
  one** asset; every excluded furniture and video path resolves to **none**.
- Asset and photo agree on `display_path`, `width`, `height`.
- **Re-running passes 1–4 changes zero rows.** The definition of idempotent —
  and the queue expects it, because a retry is ordinary.
- `keyBaseFor` is idempotent for every shape, including the two legacy
  exceptions (`backfill.ts`'s extensionless base, and pre-derivative files).
- No asset has zero usages except ones uploaded through the editor picker and
  never placed.
- Sample photographs produced no assets.
- The two foreign keys apply without violation — which is itself the proof that
  passes 1 and 2 were complete.

**Rollback.** `delete from photo_usages; delete from photo_assets; update photos
set asset_id = null; update site_images set asset_id = null;` and drop the two
new foreign keys. The passes are idempotent, so re-running after a revert
reproduces the result exactly.

**Must remain unchanged.** Nothing in the application reads any of this yet. The
site, the admin and the editor are byte-identical throughout.

---

# P5 — Asset-aware pickers, alt keys, and the resolver

**Purpose.** Start *using* the asset — first for identity, then for rendering.
This is the first phase with any user-visible surface, and even here the visible
change is additive.

**Files.** `components/canvas/PhotoPicker.tsx`,
`components/admin/ImagePickerModal.tsx`,
`components/admin/FeaturedImagePicker.tsx`,
`components/admin/PageImagePicker.tsx`, `app/actions/images.ts`
(`listPickerImages`), `app/actions/blog.ts` (`registerJournalImage` return
shape), `lib/sections/registry.ts` (`Field.accessibilityRole` and one
`<field>_alt` sibling key per image field), `lib/photos/image.ts` (new —
`resolveImage`), `lib/photos/public.ts` (new — server-only public reads),
`lib/album-covers.ts`, the section renderers in `components/sections/`,
`.mk/resolve.ts` (new).

**Database changes.** None.

**Two sub-steps, deployable separately.**

**P5a — identity travels.** `onPick(path)` becomes
`onPick({ assetId, path, width, height, alt, caption })`. Every caller keeps
writing the same path into the same field. `listPickerImages` reads
`photo_assets` instead of unioning two tables — "Uploads" versus "Galleries"
becomes a filter, not a different query. **Renderers untouched.**

**P5b — the resolver.** Each `kind: 'image'` field gains a sibling
`<field>_asset` key (free under the registry's *"adding a key is free; never
remove or repurpose a key"*). New writes set both. `resolveImage(settings, key)`
prefers the asset's real `derivatives` and falls back to the stored path.
`Field.accessibilityRole` lands with the values in the design §4.1 — `hero`
`content`, `bg_image` `decorative`.

**A new key needs a default.** `lib/sections/values.ts` refuses any key not in
`def.defaults`, and S2's lesson stands: a key the panel writes that the defaults
do not contain reaches the photographer as a redacted React error.

**Tests.**
- `resolveImage` returns the **path-only** result when no asset key is present,
  for every image field in the registry. Shown to fail by removing the fallback.
- A photograph whose long edge is under 1600 produces a correct srcset from the
  asset where `srcSetFromPath` produced a wrong one — the concrete win.
- Every built-in page renders byte-identically when no asset key is stored.
- `lib/photos/public.ts` never selects `*` — asserted by reading the source, the
  way `.mk/preview-chrome.ts` asserts on CSS. GPS, camera serials, filenames and
  original paths must not reach a visitor.
- Alt resolution follows the stated order: `decorative` → `""`; override; asset
  canonical; otherwise empty with an editor warning.
- A `bg_image` renders `alt=""` and a hero photograph does not.
- `check:tenants` passes; `blockable` still passes for any new class names.

**Rollback.** P5b first: revert the resolver and every renderer falls back to
the path, which was never removed; stray `<field>_asset` keys are inert because
`resolveSettings` merges over defaults and ignores unread keys. Then P5a: revert
the pickers; nothing downstream required the id.

**Must remain unchanged.**
- Every existing page renders byte-identically when no asset key is present.
- The path key is never removed from any setting.
- `srcSetFromPath` stays. It is not retired in this sequence.
- The editor's picker keeps its current behaviour, sources and upload flow.

---

# P6 — Deletion rules and the sweeper

**Purpose.** Replace reference-scanning with referential integrity, and stop
deleting files inside a request. **This is the only phase with a deliberate
behaviour change**, and it is called out in full below.

**Files.** `app/actions/photos.ts` (`deletePhoto`), `app/actions/galleries.ts`
(`deleteAlbum`), `app/actions/images.ts` (`forgetSiteImage`),
`app/actions/sites.ts` (`TENANT_TABLES`), `lib/photos/sweep.ts` (new),
`lib/jobs/handlers.ts` (a `photo.sweep` kind), `.mk/deletion.ts` (new).

**Database changes.** None — `on delete restrict` on `photo_usages.asset_id`
already exists from P1.

**The verbs**, as the design §6 defines them: remove from gallery, remove one
usage, archive, delete asset (refused by the database while usages remain),
delete original, derivative cleanup.

**The sweeper** removes R2 objects only where `deleted_at < now() - 30 days`
**and** a re-check immediately before deletion finds zero **live and draft**
usages. Soft deletion is reversible for the whole 30 days.

**Note on `jobs` and `deleteSite`.** `jobs.tenant_id` cascades from `tenants`, so
deleting a site takes its queue with it and `jobs` is deliberately **not** in
`TENANT_TABLES` — `service_role` has no DELETE on it. If the sweeper's kind needs
its own cleanup, that is a decision to state, not to assume.

**Tests.**
- Deleting an asset with a usage is **refused by the database**, not by code —
  proven by attempting it with the service-role client.
- Removing a photograph from a gallery leaves the file intact when another usage
  exists, and names the remaining placements.
- `deleteAlbum` finds a photograph used in a **section background** — the case
  its `JSON.stringify().includes()` scan never looked at. Shown to fail against
  today's scan.
- Deleting an album removes the album, its `photos` rows (production cascade)
  and their `gallery` usages (ours) in one statement, with no application
  deletion logic.
- The sweeper does not delete an object whose last usage was re-created during
  the grace period.
- The sweep handler is **idempotent** — the queue will run it twice.
- `deleteSite` still removes everything: the two new tables are in
  `TENANT_TABLES`, ordered leaves-first like the rest.

**Rollback.** Revert the code; the old scan-and-delete path returns. Assets soft
deleted in the meantime are still soft deleted — nothing has been destroyed,
which is the point.

**Must remain unchanged.**
- `deleteAlbum` keeps its signature and its `{ kept }` return; `kept` still
  means *"files not removed because something else uses them"*, now computed
  from an indexed count rather than a substring scan.
- Galleries, photographs and site images all remain deletable from the same
  places in the admin.
- `deleteSite` removes everything it removes today.

**The deliberate change, stated plainly.** Storage deletion becomes
**deferred**: files are removed by the sweeper after 30 days, not inside the
request. Space is reclaimed later than it is today, and the admin copy should
say so. In exchange, an accidental delete is recoverable for a month where today
it is gone in milliseconds — and `deletePhoto`, which performs **no in-use check
at all** today, stops being able to break a homepage.

---

# After this sequence

| | needs |
|---|---|
| **S5** AI foundation + alt text | P5 (the asset and the alt keys) |
| `site_images` retirement | a separate migration, after picker parity is proven in production |
| `srcSetFromPath` retirement | a query reporting zero path-only usages |
| `photo_analysis` | the first analyzer |
| `photo_embeddings` | Step 8, with the dimension benchmark |
| **Phase D** — drop redundant `photos` columns | 30 consecutive days of zero parity disagreements, asset-based rendering proven stable, separately approved. **Not this quarter.** |

---

# Summary

| phase | deployable alone | user-visible change | reversible |
|---|---|---|---|
| S1 schema truth | yes — **done** | none | yes |
| S2 value validation | yes — **done** | none | yes |
| S3 jobs | yes — **DEPLOYED** `20260929212635` | none | yes — drop cascade |
| **P1** tables | yes | none | yes — drop |
| **P2** ingestion | yes | none | yes |
| **P3** projection | yes | none | yes |
| **P4** backfill | yes | none | yes — idempotent |
| **P5a** picker identity | yes | none | yes |
| **P5b** resolver | yes | correct srcsets for small photographs; alt semantics | yes — path fallback |
| **P6** deletion | yes | **storage deletion deferred 30 days** | yes |

Six of the nine change nothing a photographer can see. The one deliberate
behaviour change is in P6 and is an improvement in safety at the cost of
delayed space reclamation.
