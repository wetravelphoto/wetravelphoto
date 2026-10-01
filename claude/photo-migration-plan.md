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
| parallel | **S4** analytics instrumentation | **DEPLOYED TO PRODUCTION 2026-09-29** — migration `20260929231653`; application code committed 2026-09-29 (commit `2af178b`) |
| | **P1** tables and constraints | **DEPLOYED TO PRODUCTION 2026-09-30** — migration `20260930123113`; reconciled |
| | **P2** unified ingestion | **DEPLOYED TO PRODUCTION 2026-09-30** — migration `20260930191116`; reconciled |
| | **P3–P6** the rest of the photo migration | this document; **P3 is next, not started** |
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

## DEPLOYED TO PRODUCTION 2026-09-30

**Supabase migration version `20260930123113`, `photo_assets_p1_2026_09_29`**,
from `db/migrations/2026-09-29_photo_assets.sql`. Reviewed independently and
applied by ChatGPT, which verified the SHA256 before applying:

```
fedb6e7f457f9a7e7568efefcb2116ca7ca1b38db113dd3b1d1bf47bdc887eef
```

Verified in production afterwards: **37 tables, 549 columns, 13 functions, 56
policies**; both tables present with 38 and 15 columns, 0 rows, RLS on,
`tenant_id` NOT NULL with no default, the tenant policy as the only policy,
`authenticated` SELECT only, `anon` and `service_role` nothing; the four parent
targets, every constraint, all seven slot indexes; `asset_id` nullable with no
foreign key on both parents. Three live smoke tests passed and were cleaned up:
a cross-tenant asset refused (`23503`), a site deleted with its asset and usages
(0 / 0 / 0), and RLS (own 1, foreign 0; platform admin 2). The full record is in
`db/schema-verified.md`.

**Reconciled the same sitting**, in the order below: the snapshot, the fixture,
`db/schema-verified.md`, the drift guard (now 435 P1 facts across the two tables
and the five parents they touched), and then `db/verify-tenant-isolation.sql`
(now 25 checks).

**Advisors:** no P1 security finding. The performance advisor's notes — new
indexes unused, several composite foreign keys and `photo_assets.created_by`
without a covering index — are **recorded, not acted on**: see
`claude/open-items.md`, for a review measured with real query plans once P2/P3
have written rows.

What follows is the plan as it was carried out.

**Purpose.** Create the schema. Nothing reads it. This phase is pure DDL so it
can be deployed, observed and reverted with zero application risk.

**Files — before production (what Claude writes and rehearses).**
- `db/migrations/<date>_photo_assets.sql` (new) — the migration, safe to run
  twice.
- `db/verify-photo-assets.sql` (new) — the dedicated P1 suite, named after the
  existing `db/verify-<subject>.sql` files and built the same way (one
  transaction that always ends by raising; privilege blocks `set role` to the
  real role). It covers the constraints and CHECKs, per-kind partial
  uniqueness, the tenant-aware foreign keys, grants and RLS, and tenant
  deletion.
- `.mk/photo-assets.ts` (new) — the TypeScript half, in the manner of
  `.mk/analytics.ts` asserting its SQL page map against `PAGES`: proves the
  `page_key` CHECK and `isPageKey()` agree (a **permanent invariant**), and
  that `lib/photos/usage-kinds.ts` agrees with the SQL kind set.
- `scripts/check-tenant-scoping.mjs` — the two table names added to `SCOPED`.
- `lib/photos/usage-kinds.ts` (new, declaration only; nothing imports it).

**All P1 isolation assertions live in `db/verify-photo-assets.sql` before
deployment.** `db/verify-tenant-isolation.sql` is **not** touched before
production: it runs against the production-truth fixture, which deliberately
has no photo tables yet, so extending it now would make the global suite fail.

Rehearsal order, as for S3: `db/test-fixture.sql` (production as it is) → the
migration → the migration again → the suites. The fixture itself does not
contain the new tables until after deployment.

**Files — only AFTER ChatGPT has applied and verified the migration in
production**, in this order: `db/schema-2026-09.sql`, `db/test-fixture.sql`,
`db/schema-verified.md`, `scripts/fixture-matches-migration.sh` (the drift
guard extended to both tables), and **then** `db/verify-tenant-isolation.sql`
(extended for the two tables). Doing any of these earlier puts the fixture
ahead of production, which is the S1 failure pointed the other way.

**Database changes.**
- `photo_assets` and `photo_usages` exactly as `claude/photo-assets-design.md`
  §1 and §2 (revision 6), including the seven partial unique indexes and the
  `photo_usages_page_key_shape` CHECK.
- **`tenant_id` on both new tables is `uuid NOT NULL` with NO DEFAULT** (design
  §3.6). Not `tenant_for_insert()`: under the service-role client that falls
  back to the oldest tenant. The existing parents' `tenant_for_insert()`
  defaults are **not** changed in P1.
- **Privileges stated whole** (design §3.7): revoke all from `public`, `anon`,
  `authenticated` and `service_role` on both tables, then grant SELECT to
  `authenticated`. No INSERT, UPDATE or DELETE for any application role; no
  SECURITY DEFINER write function. Later phases add the narrowest writer they
  need.
- `unique (id, tenant_id)` on `photos`, `albums`, `blog_posts`,
  `catalog_items`.
- `photos.asset_id` and `site_images.asset_id`, both nullable, no FK yet —
  the FK is added in P4 once the backfill has populated them, so an empty column
  cannot fail a constraint.
- `apply_tenant_policy` on both new tables.
- The **two** new table names (`photo_assets`, `photo_usages`) added to
  `SCOPED` **in this change**, before a single query exists, so the first
  unscoped read fails the build. *(Earlier text said "four"; P1 creates two.)*

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
  fixture cannot drift from the migration — **after deployment**, with the
  fixture reconciliation, since before it the fixture has no such tables.

**Tests.**
- The migration runs twice against `db/test-fixture.sql` without error
  (every migration in this repo is written to be safe to run twice).
- **Uniqueness, per kind:** inserting a duplicate logical slot is rejected for
  each of the seven shapes. Each must be shown to *succeed* against a
  single compound `UNIQUE` first — that is the defect this design corrects, and
  a test that never saw it fail proves nothing.
- **Referential integrity, as the TABLE OWNER** — two categories of test that
  must not be conflated. This category proves PostgreSQL's constraints
  independently of RLS and grants: the owner bypasses RLS and holds every
  privilege, so if a write is refused, the foreign key or CHECK did it. A usage
  with tenant A is rejected against an asset, photo, album, blog post and
  catalog item owned by B (all five foreign keys); changing a usage's
  `tenant_id` so it disagrees with a referenced parent is rejected; moving a
  referenced parent to another tenant is rejected. Each asserts **which
  constraint** refused. *(Earlier wording said "under the service-role
  client"; in P1 `service_role` holds nothing on these tables, so its write
  would be refused by the grant layer and prove nothing about a key.)*
- **CHECK coverage:** a `gallery` usage with a `page_key`, a `page_section`
  usage with an `album_id`, a `draft`-scoped `story_block`, an unknown `kind`,
  a `NULL` tenant (no default to hide it), and a malformed `page_key` are each
  rejected.
- **The page-key contract:** `.mk/photo-assets.ts` shows that the SQL
  `photo_usages_page_key_shape` and `isPageKey()` in `lib/sections/pages.ts`
  agree — every key of `PAGES` (including `notfound`), a valid custom key, and
  near-misses (upper case, wrong length, missing `p_`, non-ASCII, trailing
  newline, empty string, `constructor`). It must also fail if a built-in is
  added to `PAGES` without the CHECK following.
- **Grants and RLS, as the real roles** (`anon`, `authenticated`,
  `service_role`, and a platform admin through the same JWT-claim setup the
  existing suites use), not as the table owner — the owner
  holds every privilege and bypasses RLS, and a suite that only runs as the
  owner cannot see a grant problem. That is how S3's `service_role` defect hid
  behind a green suite. A photographer reads their own rows and 0 foreign rows;
  `anon` and `service_role` are refused by privilege (asserted as a privilege
  error, not as zero rows); no application role can INSERT, UPDATE or DELETE; a
  platform admin reaches across tenants.
- **Tenant deletion:** a throwaway tenant, one asset, one valid usage of it;
  delete the tenant; assert the tenant, the asset and the usage are all gone.
  This measures `photo_assets.tenant_id` cascade + `photo_usages.tenant_id`
  cascade against `photo_usages.asset_id` **restrict**. **If the delete fails,
  STOP** and report the exact PostgreSQL behaviour: do not change `restrict`,
  and do not pull P6 deletion code forward. If it succeeds, record the proof;
  `deleteSite` / `TENANT_TABLES` stay at P6.
- Before deployment these isolation assertions are in
  `db/verify-photo-assets.sql`; `db/verify-tenant-isolation.sql` gains them in
  the post-deployment reconciliation, after the fixture has the tables.
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

**Must remain unchanged.** Everything a person can see. No application code is
touched in this phase beyond the scoping list and the declaration-only
`lib/photos/usage-kinds.ts`; no rendered page, admin screen or editor behaves or
looks any different.

*What "byte-identical" does and does not mean here.* Adding a nullable
`asset_id` means a `select('*')` on `photos` — e.g.
`app/admin/trips/[id]/page.tsx`, whose rows go to the client component
`PhotoGrid` — now carries an extra `asset_id: null` in its server-component
payload. That internal shape change is expected and accepted. Application
queries are **not** changed in P1 merely to hide it.

---

# P2 — Unified ingestion

**Status: DEPLOYED TO PRODUCTION 2026-09-30 and reconciled — COMPLETE.**
Supabase migration `20260930191116` (`photo_ingest_2026_09_30`), sha256
`6b83b8176f2f669e61e828eea59f84244d3954c47e123b48965031b7af880b9d`, from
`db/migrations/2026-09-30_photo_ingest.sql`; deployed after, and separately
from, the S3 tenant-guard hotfix (`20260930184309`). Verified live: 37 / 549 /
18 / 56; the five functions with exactly the designed security and grants; all
four routes, the canonical-retry proofs and the boundary refusals smoke-tested
and cleaned up (`db/schema-verified.md`). The Supabase advisor's warnings about
authenticated-executable definer functions are the intended design. The
reconciled fixture alone now passes `db/verify-photo-ingest.sql`, and the drift
guard rebuilds all five functions from the migration file.

The decisions below are Gonzalo's
(P2 design pass, then four final rulings: the server's byte count everywhere,
`photos.original_bytes` included; `width`/`height` must be > 0 or ingestion
fails; `check:tenants` is not broadened to `.rpc(` — the suites prove the
tenant rule instead; a minimal cover-UI fix only if the stuck spinner is
confirmed). The design's §9 (`claude/photo-assets-design.md`, revision 7) is
the schema-side authority.

**Hardening pass (2026-09-30), before review:** content type now route-specific
(gallery/site/journal must be a recognised image type; only a custom cover may
be NULL); the live cover editor (`AlbumSettingsEditor`) no longer sticks on
"Uploading…" after a failure. **Deploy order:** the separate S3 hotfix
`2026-09-30_enqueue_jobs_tenant_guard.sql` is independent of P2 and can go
first; P2 does not depend on it. Rehearsed as fixture → hotfix → P2 → P2.

**Integrity pass (2026-09-30), after ChatGPT's exact-file review:** a
relationship row (the `photos` membership, the `site_images` row) and the
album's cover path are built from the **canonical asset**, never from a
retry's arguments — proved on the accepted "asset exists, relationship gone"
state; latitude/longitude both-or-neither enforced in SQL; the signed routes
accept **exactly** the five upload types (HEIF refused; a cover may still be
HEIF or unrecognised); an unreadable source now goes through the same checked
cleanup as every other failure. The S3 hotfix was approved as written and is
unchanged.

**Purpose.** Every photograph upload produces an asset. Do this *before* the
backfill, so the moment the backfill finishes there is no new stream of
un-asseted files.

## The four routes in scope — as they exist today (verified 2026-09-30)

| | route | entry | bytes come from | objects that exist after success | row written today |
|---|---|---|---|---|---|
| **A** | gallery photograph | `PhotoUploader` → `/api/upload-url {albumId}` → `registerPhoto(albumId, key, base, originalBytes): Promise<void>` | the browser PUTs the original to R2; the action reads it back | `<base>/original.<ext>` + the WebP ladder | `photos` |
| **B** | site / editor photograph | `PhotoPicker` → `/api/upload-url {folder:'site'}` → `registerSiteImage(key, base, filename?)` → `{ok:true, path, id:string\|null} \| {ok:false, message}` | same | same | `site_images` (a failed insert still returns `ok:true`, `id:null` — hardened below) |
| **C** | journal / story photograph | `ImagePickerModal` (story blocks, featured image) → `/api/upload-url {folder:'journal'}` → `registerJournalImage(key, base): Promise<string\|null>` | same | same | **nothing** |
| **D** | custom gallery cover | `CoverEditor` / `AlbumSettingsEditor` → `uploadCustomCover(albumId, formData): Promise<void>` | the file arrives **in the server-action body** (`next.config` `bodySizeLimit: '25mb'`) | **the WebP ladder only** — no original is ever written | `albums.cover_custom_path` (+ `cover_photo_id = null`) |

**Custom covers, exactly.** `uploadCustomCover` reads the form file into a
buffer, mints `keyBase = t/<tenant>/covers/<album>/<uuid>`, and calls
`processExistingOriginal(buffer, keyBase, keyBase)`. That function **never reads
storage** — despite its name it only resizes the bytes it is handed and PUTs
`<keyBase>/400.webp` (always) and `800`/`1600`/`2400.webp` (each only when the
long edge reaches it). Its returned `originalPath` is the string it was given —
`keyBase` itself, **not an object** — and `uploadCustomCover` discards it,
writing only `displayPath`. **P2 preserves this: no original is retained for a
cover; the asset records `original_path = NULL`.** (In A–C it is the *caller*
that reads the browser-uploaded original back from R2 before calling
`processExistingOriginal`.)

**Out of scope, deliberately:** the cover video, logos, favicon, **the accent
mark** (branding furniture, may be SVG — excluded from P2, P3 and
`photo_assets`), shop wall texture and frames, room scenes, Instagram URLs, and
the built-in sample photographs.

## Database changes

No photo **schema-shape** change. One reviewed migration adds the narrow write
boundary — P1 granted no application role any write on `photo_assets` or
`photo_usages`, and that stays true: **no direct table grant is added for
`authenticated` or `service_role`, and no upload route moves to the service-role
client.** Routes A–D keep running as the signed-in photographer.

Four route-specific SECURITY DEFINER wrappers, EXECUTE to `authenticated` only,
over one internal helper nobody can call. Exact proposed shapes, naming checks
and rules: design §9. In outline —

| wrapper | does, in ONE transaction | returns |
|---|---|---|
| `register_gallery_photo(…)` | asset upsert/reuse → reuse or insert the album's `photos` row (columns as today) with `asset_id` → the `gallery` usage | `(photo_id, asset_id)` |
| `register_site_image(…)` | asset upsert/reuse → reuse or insert `site_images` with `asset_id` | `(site_image_id, asset_id)` |
| `register_journal_image(…)` | asset upsert/reuse; **no usage** — the post owns placement, P3 projects it | `asset_id` |
| `register_album_cover(…)` | asset upsert/reuse → `albums.cover_custom_path` / `cover_photo_id = null`, as today | `asset_id` |

## What the application does (per route)

1. `requireEditor()` → the host tenant. `ownsKey` + the route's key shape,
   unchanged.
2. Bytes: A–C read the original back from storage (as today); D takes the form
   bytes (as today).
3. **Server-computed facts:** `content_sha256` of those bytes, `original_bytes`
   = their length (not the browser's `file.size`), `content_type` from the
   format `sharp` detects (not the browser's claim), `filename` normalised where
   the route has one (B: `f.name` as today; D: the form `File.name`; A and C
   have none → NULL — no client contract changes).
4. **Normalised EXIF** (one module, all four routes) — design §9.5. Latitude
   and longitude are kept **only for route A**, which stores them today; B, C
   and D pass none.
5. The WebP ladder through the existing `processExistingOriginal`, via a
   narrow injectable storage seam (real R2 by default); the keys this attempt
   wrote are tracked.
6. The route's RPC, through the photographer's own client.
7. **Success → the existing successful return, unchanged.**
8. **Failure → the action fails and returns no usable path**, after
   best-effort cleanup (below).

## Failure policy — an intentional hardening of failure behaviour only

A successful upload now *includes* a successful asset registration. If the
RPC fails:

- **Check before deleting.** Read `photo_assets` for `(tenant, key_base)`
  through the photographer's own client (`authenticated` holds SELECT). If a
  committed asset exists — the RPC committed but its reply was lost, or a
  concurrent retry won — **delete nothing**: those objects belong to a real
  asset.
- Otherwise delete, best-effort, **only the objects this attempt created**: the
  derivatives it wrote and, for A–C, the original the browser uploaded for this
  attempt's key (D created no original).
- A cleanup failure is logged with `console.error`, naming the tenant, the
  route and every key left behind — never swallowed.
- Then fail in the route's existing failure shape: A and D **throw** (as they
  do today on a database error); B returns `{ ok: false, message }` (today it
  returned `ok: true` with `id: null` — this is the hardening); C **throws**
  (today it throws on a bad key and returns `null` on an empty object; it must
  no longer return a path whose asset does not exist).

No sweeper is built in P2 — orphan files from a failed cleanup are P6's.

## Idempotency and concurrency

- One asset per `(tenant_id, key_base)` — the P1 unique index.
- Inside each wrapper: `insert … on conflict (tenant_id, key_base) do nothing`,
  then **`select … for update` on the asset row**. Two concurrent registrations
  of one upload serialise on that lock; the second then finds the first's
  relationship row (a new statement under READ COMMITTED sees the commit) and
  **reuses** it: one `photos` row per (album, asset), one `site_images` row per
  asset, the same cover state, the same journal asset.
- A retry whose bytes hash differently from the asset already at that key is
  **refused** (the key is one upload; different bytes are not a retry).
- **No new uniqueness constraint** on `photos` or `site_images`: the asset lock
  serialises, and new rows are found by `asset_id`.

## Accepted transitional states (recorded, not fixed in P2)

- **Deleting a gallery photograph** (`deletePhoto`, unchanged) removes its R2
  files and its `photos` row; the `gallery` usage cascades away; **the
  `photo_assets` row survives, unused, pointing at deleted files.** Accepted:
  nothing reads `photo_assets` yet. Archive, soft-delete, delayed deletion and
  the sweeper are **P6**.
- **`derivePhoto()`** (`lib/jobs/derive.ts`, the pre-ladder backfill job) calls
  `processPhoto` and writes `photos.derivatives` **without** an asset. A named,
  temporary exemption — it must not become an ingestion route. **P4** owns
  bringing it under assets (or retiring it) and removing the exemption from the
  call-site scan.
- No P2 job kind: ingestion stays synchronous, as registration is today.

## Files (pre-deployment) — as implemented

New: `lib/photos/storage.ts` (the seam, plus a `recording` wrapper that
remembers every key written — the cleanup list does not depend on processing
finishing), `lib/photos/exif.ts` (normalisation), `lib/photos/key-base.ts`
(new-upload key shapes; legacy shapes are P4's), `lib/photos/ingest.ts`
(facts, ladder, the route's RPC, checked cleanup; `fromSupabase` adapts the
photographer's client to the two calls ingestion makes),
`db/migrations/2026-09-30_photo_ingest.sql`, `db/verify-photo-ingest.sql`,
`.mk/ingest.ts` (also the two-connection concurrency proof — the SQL suite runs
in one transaction and cannot race itself).
Changed: `app/actions/photos.ts` (`registerPhoto`), `app/actions/images.ts`
(`registerSiteImage`), `app/actions/blog.ts` (`registerJournalImage`),
`app/actions/albums.ts` (`uploadCustomCover`), `lib/derivatives.ts` (both
ladder functions accept the storage seam, defaulting to R2 — `derive.ts`'s call
is unchanged).
Not changed: the upload components (see the cover-UI note in
`claude/open-items.md` §10), `app/api/upload-url`, `lib/jobs/*`, branding,
`deletePhoto`, `seedSamples`, `scripts/check-tenant-scoping.mjs`.
After deployment, as for P1: the schema snapshot, fixture, `schema-verified.md`,
the drift guard (extended to the five new functions), and the isolation suite.

## Tests

- **Idempotency:** the same registration twice → one asset, one `photos` row
  (A), one `site_images` row (B), the same cover (D), the same asset (C) — and
  **concurrently**, from two connections, in the `scripts/jobs-concurrency.sh`
  manner.
- **Every route produces its asset**, and the row and asset agree on display
  path, derivatives, width and height; `asset_id` is set; route A's `gallery`
  usage exists; D's asset has `original_path = NULL`.
- **The boundary, as the real roles:** `authenticated` may call the four
  wrappers and still cannot write either table directly; `anon` and
  `service_role` can call none; nobody can call the internal helper. Wrong
  tenant, another site's album, a key outside the route's prefix, a derivative
  path outside the key base, a malformed hash, an out-of-allowlist EXIF key or
  an oversized EXIF object are each refused **by the database, with the
  SQLSTATE/constraint named**. A platform admin acting on the host tenant
  succeeds and is recorded as `created_by`; a retry never rewrites
  `created_by`. The function `search_path` decoy test, as for S3.
- **Nothing the routes may not set is settable:** the wrappers have no
  parameter for `state`, `alt_*`, lifecycle or `created_by` — asserted from the
  catalogue, not by reading the SQL.
- **Privacy:** B, C and D can never store a latitude/longitude (no parameter);
  A stores what it stores today.
- **The call-site scan:** no `processExistingOriginal(` or `processPhoto(` call
  without `ingest`, except the one named exemption (`lib/jobs/derive.ts`, P4).
  Shown to fail by reinstating a bare call.
- **Through the storage seam, with no real R2:** reads, writes, the hash of the
  exact bytes, the short ladder for a small photograph (long edge < 1600) in
  both the asset and the `photos` row, and **cleanup** — a failed RPC deletes
  exactly this attempt's objects; a "failed" RPC whose asset in fact committed
  deletes nothing; a cleanup that itself fails is logged with its keys.
- **Samples** never reach `ingest()`; a `/samples/…` path is refused by
  `ownsKey` before any byte is read.
- **Unchanged success:** return values of all four routes; `photos` columns as
  today (see the one open question in `claude/open-items.md` on
  `photos.original_bytes`); rendered output byte-identical.
- **Mutations**, each shown to fail the suites: a direct table grant, a dropped
  prefix check, a dropped platform-admin clause, a caller-settable `state`, a
  missing asset lock (duplicate rows under concurrency), cleanup that ignores
  a committed asset.

**Rollback.** Revert the code, then drop the four wrappers and the helper.
Assets created meanwhile are harmless and the P4 backfill is idempotent over
them.

**Must remain unchanged on success.** Every successful return; the uploader,
picker and cover UIs; the `photos` row's columns; what galleries, the journal
and the editor render; storage layout (A–C keep their original, D still keeps
none). **Only failure behaviour changes**, as stated above.

---

# P3 — The extractor and `syncUsages`

**Purpose.** From this point every document edit projects its usages correctly.
Deliberately **before** the backfill, so there is never a window in which a live
edit goes unprojected.

**Status: DEPLOYED 2026-10-01 and reconciled — COMPLETE (database).** Migration
A Supabase `20261001005946` (`album_cover_tenant_fk_2026_09_30`, sha256
`fad895dc3b16c4ac2bf5859a77bfb6b8d361be2a240351402ff1aad5a93f93ed`); Migration B
`20261001010021` (`photo_usages_sync_2026_09_30`, sha256
`cad8cabf96345c288964f81fcebab953e1947a744e5aff4b7806b76dd82e642d`). Live
verification and smoke tests: `db/schema-verified.md`.
**Activated 2026-10-01 — P3 COMPLETE / CLOSED.** Application commit
`cd018bd` deployed by Vercel, `SUPABASE_SERVICE_ROLE_KEY` confirmed in
Production, and the one-time `scripts/rebuild-photo-usages.ts --all` run twice:
both passes 38 parents, 0 failed, 0 written, 102 unresolved (all
`photo_has_no_asset` / `no_asset` — pre-P2 references), 0 malformed, the second
identical to the first (`open-items.md` §11). P4's backfill owns those 102;
re-run the rebuild after it. **P4 is next, not started.**
Two migrations, applied in this order — database first, application after:

- **A — `db/migrations/2026-09-30_album_cover_tenant_fk.sql`**, the prerequisite:
  `albums (cover_photo_id, tenant_id) → photos (id, tenant_id) ON DELETE SET
  NULL (cover_photo_id)`, with a preflight that refuses (and changes nothing)
  while any album names a cover on another site. The database boundary is the
  SITE; "one of this album's own photographs" is `updateAlbumSettings`' rule.
- **B — `db/migrations/2026-09-30_photo_usages_sync.sql`**: the eighth kind,
  `page_share`; `sync_photo_usages`, `read_photo_usage_source` and
  `list_photo_usage_parents` (SECURITY DEFINER, `search_path = ''`, EXECUTE
  to `service_role` ONLY, and a run-time role check on top); four internal
  helpers nobody may call; and `register_gallery_photo` /
  `register_album_cover` replaced ONLY to take the album's projection lock.
  No table grant changes.

**Files.** `lib/photos/extract.ts` (pure: which settings and blocks hold a
photograph, from the registry at runtime), `lib/photos/usages.ts`
(`syncUsages` — the one writer — the per-parent helpers and
`rebuildUsages`), `lib/photos/usage-kinds.ts` (+ `page_share`),
`lib/sections/registry.ts` (`Field.accessibilityRole`, metadata only), and the
hooks: `lib/sections/store.ts`, `lib/site-patch.ts`, `lib/drafts/store.ts`,
`lib/products.ts`, `app/actions/{albums,photos,blog,catalog,sites}.ts`.
Suites: `db/verify-photo-usages.sql`, `db/verify-album-cover-fk.sql`,
`scripts/album-cover-fk.sh`, `.mk/usages.ts`.

**The shape.** A PARENT is replaced at once: `live_page` (one page's
page_section, page_legacy and page_share), `draft` (the whole site's draft —
one document), `album` (gallery rows of its photographs, both cover slots),
`post` (story_cover, story_blocks), `catalog_item` (keyed by its photograph's
id). `syncUsages`:

1. reads the SAVED source (`read_photo_usage_source`) — never the caller's
   object — as the canonical text of one jsonb value;
2. extracts the document-shaped references from it (section image settings,
   story blocks); everything relational (gallery membership, covers, featured
   image, catalogue photograph, legacy columns, explicit share images) is read
   by the database itself, under the lock, and never accepted from a caller;
3. calls `sync_photo_usages`, which takes the parent's advisory lock, rebuilds
   the source and compares: **different → it writes nothing and answers
   `stale`**, and syncUsages re-reads (at most 3 attempts, no sleep). An older
   snapshot never overwrites a newer document. Otherwise it deletes the
   parent's rows and inserts the current set — each document reference BOUND
   to the saved source (the slot holds exactly that path) and resolved only to
   an asset of the SAME site.

**Unresolved references are SKIPPED** — counted and logged with site, scope,
parent and field — and produce no row. P3 mints no asset, writes no
placeholder, queues no job and adds no job kind. P4 mints; a rebuild projects.

**Resolution.** A photograph id resolves only through a same-site
`photos.asset_id`; a path only to a same-site asset whose `key_base` is the
path's directory and whose original, display file or one of its sizes IS the
path. Nothing fuzzy.

**Slots.** page_section: the section's ordinal, the settings key (`_mobile`
twins included; the hero video excluded by key; the accent mark is a custom
field and never a slot). story_block: `block:<zero-based index>` — never the
browser's block id — at position 0 (image), 0/1 (pair), or the array index
(gallery, masonry). page_share: `page_seo.image` at 0, the EXPLICIT stored
image only; lib/seo.ts' automatic fallback is never a usage. page_legacy: a
live page's legacy column ONLY while it has zero section rows — once rows
exist the columns are mirrors, and both are never projected.

**Stored means referenced.** Hidden sections, a hero photograph kept while it
shows a video, a background kept while it shows a colour — all projected.
Versions, history, templates and undo steps are frozen and excluded. Every
saved story is `live` whatever its status: for story kinds `live` means the
canonical saved story, not visitor visibility.

**Failure.** Source write → saved state read back → sync. A failed or
non-converging sync never rolls the save back and never reports it failed; it
is logged. `rebuildUsages(tenant)` is the repair path — replace per parent, all
eight kinds, gallery rows from `photos.asset_id`, safe on a live site.

**The album lock.** `register_gallery_photo` and `register_album_cover` take
the same advisory lock as an album sync, so neither interleaves with it. P2's
immediate gallery row stays; an album sync writes the identical row. After
`register_album_cover` commits, `uploadCustomCover` syncs the album (the
wrapper changes the cover but writes no cover usage). `registerPhoto` needs no
application sync: its wrapper wrote the only row that changed, under the lock.

**Tests.** (Rehearsed 2026-09-30 against the fixture + A + B, B again.)
- `db/verify-photo-usages.sql` — 159: privileges from the catalogue (EXECUTE,
  PUBLIC, search_path, security) for all seven new functions; WHICH LAYER refuses
  (the grant for authenticated/anon; the role check for an owner with no role and
  for a MISTAKEN grant); no direct write for anybody; page_share's slot,
  parent and scope rules; the resolver (own files only, never another site);
  binding (a path the slot does not hold, a slot that does not exist, another
  page, an extra key, page_share / page_legacy / gallery from the caller — each
  refused, nothing changed); the two ceilings; an OLD snapshot after a newer save
  is stale and writes nothing; the legacy rule both ways and never both;
  explicit share image only; the draft; album, story and catalogue projections.
- `db/verify-album-cover-fk.sql` — 17, and `scripts/album-cover-fk.sh` — 15 (14 before reconciliation):
  the preflight refuses and changes nothing, A twice, the exact rollback, and
  the suite FAILING (6 of 17) against the original key.
- `.mk/usages.ts` — 176 (with the rebuild command's tests): the pinned slot map and exclusions; stored means
  referenced; blocks by index; every writer of a photographic source hooked
  (or listed with its reason, the list itself checked for staleness); nothing
  else writes photo_usages; the real syncUsages end to end; the stale retry and
  a source that will not settle; failures logged, never thrown; two intro
  sections are two usages and a move re-projects; P2's gallery row reproduced;
  **THE INVARIANT** — all eight kinds, deleted and rebuilt identical, the other
  site untouched; the P2 wrappers are P2's bodies plus the lock; and the album
  lock with two connections — upload vs sync and cover vs sync, both orders.
- Nineteen mutation proofs, each caught (P3 reports), including the built-in
  sample rule (every P3 source: `isSamplePhoto()` declared to the database,
  proved against the saved slot or the canonical `photos` row) and the rebuild
  command's argument rules.
- After deployment the fixture alone passes all of these, and the drift guard
  rebuilds the photo tables P1 → P2 → A → B (1616 facts).
- **Not covered by an automated end-to-end test:** publish → undo → redo →
  discard and applyLook → revertTo *through the server actions* (they need a
  request context). Each is covered by construction — every one of those paths
  writes through `replaceSections`, `patchSiteSettings`, `upsertDraft` or
  `deleteDraft`, whose hooks are asserted — and by the rebuild invariant. The
  markup-diff render check was not run; no rendering code changed.

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

**Database changes.** Rows only, until the final step: once every **non-sample**
`photos` row and every `site_images` row has an `asset_id`, add the foreign keys
that were deliberately left off in P1. (Built-in sample photographs keep
`asset_id = NULL` for good; a composite foreign key with a NULL in it is not
checked under MATCH SIMPLE, so they do not stand in the keys' way.)

**`derivePhoto` is P4's.** The pre-ladder derivative job (`lib/jobs/derive.ts`)
is the one ingestion-shaped code path P2 deliberately leaves without an asset —
a named exemption in P2's call-site scan. P4 brings it under assets (or retires
it, once pass 1 has given every legacy photograph its asset) **and removes the
exemption from the scan.**

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

**Excluded, deliberately:** logos, favicon, **the accent mark
(`mark.image_path`)**, `shop_wall_texture`, `shop_frames`,
`room_scenes.image_path` (site furniture); `site_versions` / `site_template`
snapshots (frozen history); `cover_video_path` and `video_path` (videos are out
of V1 — the hero's `video_path` by key, since its registry kind says `image`);
sample photographs (`isSamplePhoto()`).

**Tests.**
- Every **non-sample** `photos` row has an `asset_id`; every `site_images` row
  has one. *(Corrected 2026-09-30: this used to read "every `photos` row",
  which contradicted the exclusion of samples below.)* Built-in sample
  photographs — recognised by `isSamplePhoto()` — **never** produce a
  `photo_assets` row, keep `asset_id = NULL`, and stay outside tenant-owned
  storage ingestion; asserted by count, both ways.
- Every path in the 14 scalar columns and 4 live blobs resolves to **exactly
  one** asset; every excluded furniture and video path resolves to **none**.
- Asset and photo agree on `display_path`, `width`, `height`.
- **Re-running passes 1–4 changes zero rows.** The definition of idempotent —
  and the queue expects it, because a retry is ordinary.
- `keyBaseFor` is idempotent for every shape, including the two legacy
  exceptions (`backfill.ts`'s extensionless base, and pre-derivative files).
- No asset has zero usages except ones uploaded through the editor picker or
  the journal picker and never placed, and assets left unused by a
  `deletePhoto` since P2 (an accepted transitional state that P6 resolves).
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
- `lib/photos/public.ts` never selects `*` — asserted by reading the source.
  GPS, camera serials, filenames and original paths must not reach a visitor.
  *(Earlier text cited `.mk/preview-chrome.ts` as the model; that file has never
  existed in this repository — see `claude/open-items.md` §5.)*
- Alt resolution follows the stated order: `decorative` → `""`; override; asset
  canonical; otherwise empty with an editor warning.
- A `bg_image` renders `alt=""` and a hero photograph does not.
- `check:tenants` passes. *(Earlier text also required "`blockable` still
  passes for any new class names"; there is no such suite in the repository —
  see `claude/open-items.md` §5. Whether P5 needs one is decided then.)*

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
| **P1** tables | yes — **DEPLOYED** `20260930123113` | none | yes — drop |
| **P2** ingestion | yes — **DEPLOYED** `20260930191116` | none on success; failures now fail cleanly | yes |
| **P3** projection | yes | none | yes |
| **P4** backfill | yes | none | yes — idempotent |
| **P5a** picker identity | yes | none | yes |
| **P5b** resolver | yes | correct srcsets for small photographs; alt semantics | yes — path fallback |
| **P6** deletion | yes | **storage deletion deferred 30 days** | yes |

Six of the nine change nothing a photographer can see. The one deliberate
behaviour change is in P6 and is an improvement in safety at the cost of
delayed space reclamation.
