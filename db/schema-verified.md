# Facts verified against the production database

`db/test-fixture.sql` used to be written by hand from what production was
*believed* to look like, and it was wrong three times — the `single_row`
constraint on `site_settings`, `albums.allow_downloads`, and
`photos.album_id`'s cascade. Each was found in production, not in review.

This file is the ledger of things that have actually been **checked**, with the
query that checked them and the date. A claim here is a claim somebody ran.

The full picture is in **`db/schema-2026-09.sql`**, transcribed from
`db/survey.sql` run against production on 2026-09-29.

---

## 2026-09-29 — the full survey

**Server.** PostgreSQL **17.6**. Installed extensions: `plpgsql`,
`pg_stat_statements`, `uuid-ossp`, `pgcrypto`, `supabase_vault`. Available but
**not installed**: `vector` 0.8.2, `pg_cron` 1.6.4, `pg_trgm` 1.6.

**Shape.** 34 tables in `public`, 473 columns, RLS enabled on all 34, **54
policies**, **9 functions**, one trigger (`site_draft_touch` on `site_draft`),
and no trigger anywhere else.

*The policy figure was first written here as 53, which was a counting error in
the transcription rather than anything about the database. Corrected 2026-09-29
against a direct count of production: 55 policies now, of which `jobs` has
exactly one, so 54 before the queue. See the note at the end of this file.*

**Size.** Small: `photos` ~83 rows, `page_views` ~63, `page_sections` ~28,
`site_settings` 4, everything else at or near zero. This is a good moment to do
the structural work.

---

## 2026-09-29 — `photos.album_id` cascades

| | |
|---|---|
| `photos.album_id` | `uuid NOT NULL` |
| constraint | `photos_album_id_fkey` |
| definition | `FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE` |
| `confdeltype` | `c` |
| orphaned `photos` rows | **0** |
| triggers on `albums` or `photos` | **none** |

The application comment in `app/actions/galleries.ts` — *"The database rows
cascade"* — was right, and the old fixture was wrong. `deleteAlbum` deletes the
album row and nothing else; every `photos` row under it goes by cascade, with no
application code and no trigger in the path.

**What depends on it.** The photo-usage projection
(`claude/photo-assets-design.md`) parents a `gallery` usage on `photos.id` with
its own `on delete cascade`. Combined with the above, deleting an album removes
the membership rows *and* their projected usages with no application logic. A
change to `photos_album_id_fkey` is a change to that design.

---

## 2026-09-29 — every foreign key into `albums` and `photos`

All fifteen, as production has them. The old fixture had **nine** of these
wrong — it declared NO ACTION where production cascades, which meant a local
rehearsal proved the opposite of the truth: deleting an album *failed* locally
and succeeds in production.

| child | parent | on delete |
|---|---|---|
| `album_clients.album_id` | albums | CASCADE |
| `blog_posts.album_id` | albums | SET NULL |
| `favorites.album_id` | albums | CASCADE |
| `page_views.album_id` | albums | CASCADE |
| `photos.album_id` | albums | **CASCADE** |
| `site_settings.hero_album_id` | albums | SET NULL |
| `albums.cover_photo_id` | photos | SET NULL |
| `blog_posts.cover_photo_id` | photos | **NO ACTION** |
| `blog_posts.featured_photo_id` | photos | SET NULL |
| `catalog_items.photo_id` | photos | CASCADE |
| `downloads.photo_id` | photos | CASCADE |
| `favorites.photo_id` | photos | CASCADE |
| `order_items.photo_id` | photos | SET NULL |
| `photo_shop_categories.photo_id` | photos | CASCADE |
| `products.photo_id` | photos | CASCADE |

`blog_posts.cover_photo_id` is the one photo child that neither cascades nor
nulls, so a photograph used as a story's cover photo could not be deleted. In
practice no row has it set — no application code reads or writes that column
(see "Columns nothing uses" below) — so the constraint has never been hit.

---

## Verified, and recorded as production truth without being changed

Production is the source of truth. These all look like mistakes; none was
touched.

### `orders.status` — the default violates its own CHECK

`DEFAULT 'pending_payment'` against
`CHECK status IN ('pending','paid','fulfilled','cancelled')`. Any insert into
`orders` that does not name a status **fails**. Latent rather than live: no code
inserts into `orders` — checkout is on hold (`claude/roadmap.md` item 34) — so
it has never been exercised. It will be the first thing checkout hits.

### `newsletter_signups_email_key` is UNIQUE on `(email)` alone

Not `(tenant_id, email)`. One address can exist **once across the whole
platform**. `app/actions/newsletter.ts` treats error `23505` as
"already subscribed" and returns success, so a visitor subscribing on site B
whose address is already on site A is told they are subscribed and **no row is
written for site B**. Silent, and it gets worse with every site added.

### `profiles_role_check` forbids `'admin'`

`CHECK role IN ('owner','editor')`. `lib/auth.ts` has
`EDIT_ROLES = ['owner', 'admin', 'editor']`. The `'admin'` branch can never
match a real row. Harmless today; a dead branch that reads as live.

### Duplicate unique indexes

`albums` carries both `albums_site_slug_key` and `albums_tenant_id_slug_key`,
identical on `(tenant_id, slug)`. `blog_posts` has the same pair. Each costs a
write on every insert and update. Reproduced as-is in the fixture; candidate for
a later, separate cleanup.

### Columns nothing uses

`photos.watermark_enabled`, `blog_posts.cover_photo_id`,
`blog_posts.featured_photo_id` (written only as `null`, `app/actions/blog.ts:79`),
`photos.tags`, `photos.latitude`, `photos.longitude`, `photos.alt_text` —
present, populated in some cases, read by nothing.

`site_settings.instagram_token` still exists beside `site_secrets.instagram_token`.
The application reads the secrets table; `site_settings` is readable with the
anon key, which is why the token moved. The old column was not dropped.

### `clients.access_token` is `uuid`, not `text`

`lib/gallery-access.ts:68` compares it to a share token taken from the URL. A
token that is not a valid uuid makes PostgREST return `22P02`, and that function
**discards the error** and checks only `data`, so the request 404s rather than
500s. Correct outcome, reached by accident: the comment above it attributes the
null path to a missing service-role key.

### Tenant columns without a foreign key

`contact_messages`, `instagram_media`, `newsletter_signups`, `page_sections`,
`print_options`, `room_scenes`, `shop_categories`, `catalog_items`, `products`,
`order_items`, `site_draft`, `site_template` and `site_template_history` all
carry `tenant_id` with **no foreign key to `tenants`**. Others (`albums`,
`photos`, `clients`, `blog_posts`, `orders`, `profiles`, `site_settings`,
`site_images`, `site_secrets`, `site_versions`, `site_draft_steps`,
`draft_shares`, `tenant_domains`) do. Inconsistent, and it means deleting a
tenant leaves some of its rows behind.

### Five tables have no `tenant_id` by design

`album_clients`, `downloads`, `favorites`, `page_views`,
`photo_shop_categories` scope through a parent via `tenant_of(...)`. Correct and
deliberate; recorded so nobody "fixes" it.

### `NO DEFAULT` on five tenant columns, also by design

`page_sections`, `site_draft`, `site_template`, `site_template_history`,
`tenant_domains` require the caller to name the tenant.
`2026-09-24_no_guessing_tenant.sql` dropped the defaults so *"a forgotten tenant
is a hard error rather than a silent write into the oldest tenant"*. The other
tenant columns still default to `tenant_for_insert()`.

---

## Reconstructed, not transcribed

Three parts of `db/schema-2026-09.sql` are not byte-for-byte production output.

1. **CHECK predicates.** The survey result was returned in an abbreviated form
   (`CHECK cover_fit IN ('cover','contain')`) rather than the literal text
   `pg_get_constraintdef` produces. The predicates in the snapshot are a
   faithful reconstruction of that meaning. `tenant_domains_host_shape` was
   abbreviated to "host shape/lowercase/length rules" and is taken verbatim from
   `db/migrations/2026-09-23_tenant_domains.sql` instead.
2. **Sequence grants.** `db/survey.sql` covers table grants only. The snapshot's
   `grant usage, select on all sequences` is Supabase's default and is required
   for an `authenticated` insert into `site_settings`; it was **not** surveyed.
3. **Function bodies.** The survey returns each function's signature, security
   mode and volatility, not its source. The bodies come from the migrations
   listed in the function table above, and the attributes corroborate them.

---

## 2026-09-29 — the function inventory

Nine functions in `public`. Every VOLATILITY and SECURITY attribute matches the
migration that created it. **No drift.**

| function | security | volatility | created by |
|---|---|---|---|
| `apply_tenant_policy(target regclass)` | INVOKER | VOLATILE | `2026-09-15_tenant_scoping.sql` |
| `apply_tenant_policy_via(target regclass, fk_column text, parent regclass, parent_key text)` | INVOKER | VOLATILE | same |
| `current_tenant_id()` | **DEFINER** | STABLE | same |
| `default_tenant_id()` | **DEFINER** | STABLE | same, redefined by `2026-09-24_no_guessing_tenant.sql` |
| `is_platform_admin()` | **DEFINER** | STABLE | `2026-09-15_tenant_scoping.sql` |
| `push_draft_step(p_tenant uuid, p_snapshot jsonb, p_label text, p_window interval, p_keep integer)` | INVOKER | VOLATILE | `2026-09-22_draft_steps.sql` |
| `tenant_for_insert()` | **DEFINER** | STABLE | `2026-09-15_tenant_scoping.sql` |
| `tenant_of(parent regclass, key_value uuid, key_column text)` | **DEFINER** | STABLE | same |
| `touch_site_draft()` | INVOKER | VOLATILE | `2026-09-22_draft_steps.sql` |

**DEFINER + STABLE on the four tenant readers is load-bearing.** Definer because
a policy on `profiles` that reads `profiles` through an invoker function recurses
forever; stable so Postgres evaluates them once per statement rather than once
per row. The migration says as much, and production agrees.

**`apply_tenant_policy` and `apply_tenant_policy_via` both exist.** The P1
migration calls them by name, so that dependency is confirmed rather than
assumed. They are INVOKER and VOLATILE — correct for a function whose whole job
is to run DDL as the caller.

The survey returns signatures and attributes, not source, so the BODIES in
`db/schema-2026-09.sql` still come from the migrations. The attributes above
corroborate them: a body that had been edited in place would be unlikely to keep
the same security and volatility markers.

### Two things this inventory corrected in our own files

1. **`push_draft_step` was missing entirely** from the first snapshot, along
   with its function-level grants (`revoke all … from public, anon`,
   `grant execute … to authenticated`). `lib/drafts/steps.ts:182` calls it by
   RPC on every draft write, so a rehearsal of anything touching undo history
   would have failed locally for a reason that does not exist in production.
   Restored from `2026-09-22_draft_steps.sql`.
2. **`tenant_of`'s parameter names were wrong** in our reconstruction —
   `(parent, key, parent_key)` instead of production's
   `(parent, key_value, key_column)`. Parameter names are part of the signature
   for a named-argument call, so this was a genuine defect in the fixture, not a
   cosmetic one. Production matches its migration; our file was the outlier.

## A test that was wrong about production — fixed 2026-09-29

`db/verify-tenant-isolation.sql`, phase 3, ran an unqualified
`update site_settings set site_title = site_title` as a platform admin and
asserted the row count was **exactly 1**. That held only while the database had
one site. Production has several, so the check reported a **false failure**
under a summary line reading *"Isolation is NOT holding — do not open beta
logins"*.

It now counts the sites first, as the table owner (who bypasses RLS, so the
count is the true total), and asserts the admin's unqualified update reached
**every one of them** — and that at least one of them belongs to a site the
account is not parked in, so "reached everything" means something.

```sql
select count(*) into n_sites  from site_settings;
select count(*) into n_others from site_settings
 where tenant_id <> current_setting('iso.tenant_b')::uuid;
...
pass := n_update = n_sites and n_others >= 1;
```

Verified both ways against the local fixture: it passes with the platform-admin
flag set (`2 of 2, 2 beyond its own`) and **fails with the flag disabled**
(`0 of 2`). 14 of 14 checks pass.

The old assertion was not vacuous in the single-site case — the account is
parked in a throwaway tenant owning no settings row, so without the flag it
reaches 0, not 1. It caught a broken flag; it just could not survive a second
site.

---

## 2026-09-29 — `jobs`, DEPLOYED TO PRODUCTION

**Supabase migration version `20260929212635`, `jobs_infrastructure_2026_09_29`.**
The file's SHA256 was checked against the committed copy before it was applied:

```
9048133d6ff9431150ab07e1e48188718edf33b83eb6cfb139bb937e0ea7797f
```

Verified against the live database afterwards, not assumed:

| | |
|---|---|
| `public.jobs` | exists, 0 rows, RLS enabled, all 15 columns |
| `tenant_id` | `uuid NOT NULL`, **no default**, FK to `tenants(id)` ON DELETE CASCADE |
| indexes | `jobs_pkey`, `jobs_ready`, `jobs_stale`, `jobs_tenant_status`, `jobs_pending_dedupe` |
| constraints | PK on id; tenant FK cascade; payload is an object; `dedupe_key` ≤ 200; status in the four; `max_attempts` 1–20 |
| policy | `Tenant members manage`, ALL, `tenant_id = current_tenant_id() or is_platform_admin()` both USING and WITH CHECK |
| table grants | `authenticated`: SELECT only. `anon`: none. `service_role`: **none**. `postgres`: owner. |
| `enqueue_jobs` | DEFINER, VOLATILE, `search_path = ''`, EXECUTE to `authenticated` only |
| `claim_jobs` | DEFINER, VOLATILE, `search_path = ''`, EXECUTE to `service_role` only |
| `finish_job` | DEFINER, VOLATILE, `search_path = ''`, EXECUTE to `service_role` only |
| `claim_jobs` body | carries the **materialised CTE**. The `where id in (…)` form that could claim more than `p_limit` is NOT in production. |

Production is now **35 tables, 488 columns, 12 functions, 55 policies**, RLS
on all 35. The policy count was checked directly against production, and `jobs`
holds exactly one of the 55.

`db/schema-2026-09.sql` and `db/test-fixture.sql` were updated in the same
sitting, which was the condition recorded below before deployment. The three
function definitions in both were **copied verbatim from the migration**, and
`scripts/fixture-matches-migration.sh` is what stops that copy drifting: it
builds the fixture, records 402 facts about `jobs`, drops the lot, lets the
migration build it instead, and diffs. Shown to catch a single changed column
default.

### The bug the deployment does not contain

`claim_jobs` shipped in review as
`update … where j.id in (select … limit p_limit for update skip locked)`, which
reads as "take at most p_limit" and is not what it does. The planner puts that
subquery on the **inner** side of a Nested Loop Semi Join, so it is re-executed
once per candidate row, and `skip locked` returns a different row each time:

```
5 queued rows, one call, p_limit => 1  →  5 rows claimed, 5 attempts burned
```

The drain runs only the first and abandons the rest `running` under a ten-minute
lease with an attempt spent; five such rounds and each is failed as "the worker
did not report back" having never run. **Plan-dependent, hence intermittent** —
`stats say the table is empty → claimed 5`, `stats say 500 rows → claimed 1` —
which is why it surfaced as a flaky test rather than a failure. A CTE containing
`FOR UPDATE` is never inlined and is materialised once, so `limit p_limit` means
what it says. `db/verify-jobs.sql` block 1b asserts it, with `analyze jobs` in
the suite's clean slate to force the vulnerable plan; without that line the
assertion passed against the bug about half the time.

---

## Superseded: the pre-deployment note

`db/migrations/2026-09-29_jobs.sql` creates the `jobs` table, two functions
(`claim_jobs`, `finish_job`), four indexes and the usual tenant policy. It has
been **rehearsed against this fixture and nothing else**.

**Kept for the record.** At the time this was written the fixture deliberately
did not contain `jobs`, because production did not: A fixture that runs ahead of production is the same defect as
one that lags it, pointed the other way: a rehearsal would then prove something
about a database that does not exist. The rehearsal order is therefore

```
db/test-fixture.sql          ← production as it is
db/migrations/2026-09-29_jobs.sql   ← the change being proposed
db/verify-jobs.sql           ← what it must do
scripts/jobs-concurrency.sh  ← and what two of them must not do
```

**When the migration is applied to production, the fixture and
`db/schema-2026-09.sql` must be updated in the same sitting**, or the next
rehearsal is against a database that is missing a table the application reads.

### Verified locally, 2026-09-29

Against PostgreSQL 16.13 carrying `db/test-fixture.sql` (production is 17.6 —
not version parity; see the note at the top of this file).

| | |
|---|---|
| the migration runs twice with no error | yes |
| `db/verify-jobs.sql` | 101 of 101 |
| `scripts/jobs-concurrency.sh` | 14 of 14 |
| `.mk/jobs.ts` (the worker, against this database) | 61 of 61 |

### The privilege model, checked rather than assumed

The first draft granted `select, insert` to `authenticated`, left the worker
functions SECURITY INVOKER, and granted `service_role` nothing — on the
assumption that Supabase's default privileges would have given the worker what
it needed. Asked instead:

```sql
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'jobs';
→ authenticated: INSERT, SELECT.   postgres: ALL.   service_role: NOTHING.
select defaclrole::regrole, defaclobjtype, defaclacl from pg_default_acl;
→ (0 rows)
```

**Two defects, both of which the whole suite passed straight through**, because
every assertion in it ran as the table's owner — who holds every privilege and
bypasses row-level security, and who is nobody in production:

1. **The drain would have failed** with `permission denied for table jobs`, or
   worked only by accident on a default this repo never stated. Reproduced by
   reverting the functions to INVOKER: `db/verify-jobs.sql` reports 4 failures
   and `.mk/jobs.ts` 31.
2. **A `grant` is additive.** On a database whose default privileges hand out
   ALL — which Supabase's bootstrap normally does, and which this fixture does
   not — `grant select, insert to authenticated` would have left `authenticated`
   holding UPDATE and DELETE as well, with nothing in the migration saying so.

Both are fixed by stating the whole privilege set rather than adding to
whatever was there: the migration **revokes from `public`, `anon`,
`authenticated` and `service_role` first**, then grants. The result is
identical on a database with Supabase's default privileges and on one with
none. The resulting set, read back from the catalogue:

| | |
|---|---|
| `jobs` table | `authenticated`: SELECT. Nobody else, by any route. |
| `enqueue_jobs` | EXECUTE to `authenticated` |
| `claim_jobs`, `finish_job` | EXECUTE to `service_role` |
| all three functions | SECURITY DEFINER, `search_path = public` |

`service_role` has **no privilege on the table at all** — claiming and
finishing are the whole of what the worker can do, and it cannot read the
queue, empty it, or finish a job it does not hold.

All three are `set search_path = ''` rather than `= public`, with every
relation and application function written out in full. An empty path removes
the question of what an unqualified name resolves to; `pg_catalog` is still
searched implicitly, ahead of anything in `search_path`, which is what lets
`now()`, `coalesce`, `jsonb_typeof` and the built-in type names still work
inside a function whose path is empty. Proved by putting a decoy schema
holding its own `jobs` and `current_tenant_id()` in front of the caller's
path: all three functions still reach `public`, and unqualifying a single name
makes the suite report five failures.

One fixture/production difference worth recording: Supabase creates
`service_role` with `BYPASSRLS`; `db/test-fixture.sql` creates a plain role.
The DEFINER design makes that irrelevant for `jobs` — the functions run with
the table owner's rights either way — which is a second reason to prefer it
over INVOKER plus a table grant.

### The enqueue boundary validates the resource, not only the site

`enqueue_jobs` checked the tenant, the kind and the queue-control columns. That
left the interesting half open: a photographer calling it by hand could queue
work on their own site pointing at photographs belonging to somebody else, or
at ids that are not photographs at all. `lib/jobs/derive.ts` would have
declined each one — it reads the photograph WITH its tenant and treats a miss
as permanent — but "the worker declines it later" is not the same thing as "it
never entered the queue", and only one of the two is a boundary.

For `photo.derivatives` the function now **builds** what it stores instead of
copying it. Each item is reduced to a photograph id, checked for shape and for
ownership against `public.photos`, and the row that lands carries
`{"photoId": "<that id>"}` with `dedupe_key` set to the same id. A caller
cannot choose the dedupe identity at all, which is what makes "the same work is
not queued twice" a promise about the work rather than about a string somebody
picked. One bad item refuses the whole batch; a partial success that reports a
number is how a caller comes to believe work is waiting when it is not. "Does
not exist" and "belongs to another site" give the same message, so the function
cannot be used to ask whether an id exists elsewhere.

A batch is capped at **200 items**, enforced in SQL because the function is
reachable from a browser and an unbounded JSON array is work the database would
do on request. `lib/jobs/queue.ts` splits longer lists into runs of that size —
the trusted caller works around the bound, a direct PostgREST call does not.
`.mk/jobs.ts` asserts the two numbers are the same one, and queues 250 real
photographs to prove the split does not drop its tail.

### A reporting bug in our own harness, found the same way

`db/verify-jobs.sql` summarised four failures as two. `pass` is a boolean
expression, and `v_out.status = 'done'` where nothing came back is **unknown**,
not false: `case when pass then 'ok' else 'FAIL' end` printed FAIL, while
`count(*) where not pass` did not count it. Both suites now `coalesce(pass,
false)`, so an unknown result is a failure in the summary as well as in the
listing. `db/verify-tenant-isolation.sql` had the same latent miscount and was
corrected with it.

### One thing the rehearsal caught that reading did not

The first version of `enqueue()` sent
`on conflict (tenant_id, kind, dedupe_key) do nothing`. The deduplication index
is **partial** (`where dedupe_key is not null and status in ('queued',
'running')`), and Postgres refuses a targeted conflict clause against a partial
index unless the statement repeats the index's own predicate — which PostgREST
gives no way to send. Measured rather than assumed:

```
ERROR:  there is no unique or exclusion constraint matching the ON CONFLICT specification
```

An untargeted `on conflict do nothing` accepts any arbiter index, inserts every
row that is not a duplicate and skips the ones that are. That is what the code
sends now. Pressing "Process photographs" a second time would have failed the
whole insert, in production, on the first day.


---

## 2026-09-29 — two things found while updating these files

Recorded rather than corrected, per the standing rule: show the discrepancy and
establish which represents production before changing anything. One of the two
has since been established and is closed; the other stands.

### ~~The policy count does not add up, by one~~ — SETTLED, the prose was wrong

Raised because the two schema files build **55** policies while the shape table
above said 53 before the queue, so 54 after. Three possibilities were open: a
mis-transcribed survey total, a reconstruction that added a policy production
does not have, or a policy production gained since.

**Counted directly against production, 2026-09-29:**

```
55 public RLS policies in total, of which `jobs` has exactly 1
```

So production held **54 before S3 and 55 after**, and the earlier 53 was a
counting error in the transcription. `db/test-fixture.sql` and
`db/schema-2026-09.sql` were right all along — **there is no schema
discrepancy**, and nothing in either file needed changing. The shape table above
has been corrected to 54.

Worth keeping rather than deleting, for the same reason the rest of this file
exists: the fixture and the snapshot were doubted on the strength of a number
somebody had typed, and they turned out to be the reliable ones. A prose figure
is not evidence; the two possibilities were "the files are wrong" and "the note
is wrong", and it was the note.

### `db/verify-draft.sql` has been broken since the fixture was regenerated

It fails on a clean build, and has done since the S1 regeneration earlier the
same day — it was simply never in the loop:

```
psql:db/verify-draft.sql:90: ERROR:  duplicate key value violates unique
constraint "site_draft_pkey"
```

Block 1 inserts a `site_draft` row for tenant A **unguarded** (line 72), and the
regenerated fixture already seeds one (`db/test-fixture.sql`, the `insert into
site_draft` near the end). `site_draft`'s primary key is `tenant_id`, so that
first insert raises outside any handler and aborts the transaction — taking the
rest of the file with it. Nothing to do with the queue; `jobs` does not touch
`site_draft`.

The fix is one line either way — the suite should delete or upsert rather than
insert blind, or use its own throwaway tenant as the isolation suite does — and
it is a separate change, not part of the queue's bookkeeping.
