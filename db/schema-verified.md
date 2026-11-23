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

*That was the survey. After S3, S4, P1, the S3 tenant-guard hotfix, P2, P3,
P4, P5 and the P6 sweeper migration, production was **37 tables, 553
columns, 32 functions, 56 policies, 158 constraints, 102 indexes**, RLS on
all 37 — totals Codex directly surveyed on 2026-11-21. The client gallery v2
cover migration (2026-11-22) adds 3 columns, 4 constraints and 2 indexes, and
the square-layout migration after it replaces one CHECK under its own name,
changing no count. Production is now **37 tables, 556 columns, 32 functions,
56 policies, 162 constraints, 104 indexes**, RLS on all 37 — totals
independently counted after both migrations (relayed 2026-11-22). The two
gallery email migrations after them add 1 table, 4 columns, 1 function, 3
constraints and 2 indexes, so production is now **38 tables, 560 columns,
33 functions, 56 policies, 165 constraints, 106 indexes**, RLS on all 38 —
DERIVED from the counted figures, not independently counted. See the
deployment sections below.*

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
builds the fixture, records 403 facts about `jobs`, drops the lot, lets the
migration build it instead, and diffs. Shown to catch a single changed column
default. It covers `page_views` the same way since S4 — see below.

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

## 2026-09-29 — analytics, DEPLOYED TO PRODUCTION

**Supabase migration version `20260929231653`,
`analytics_instrumentation_2026_09_29`.** The file's SHA256 was checked against
the committed copy before it was applied:

```
c1acb1ae3a68c21094622820c768343e1e5fba63de6ee2f769ba5d4ddd4bfbdf
```

### The preflight, run immediately before

`tenant_id` comes out of this migration NOT NULL and `page_views_identity`
requires exactly one of `page_key`/`album_id`/`post_id`, so the migration cannot
be applied to a table holding a row that satisfies neither. It refuses rather
than inventing a site or deleting anything — proved locally by seeding such a row
and watching it roll back without even adding the column. One query settles it in
advance, and it was run:

| | |
|---|---|
| `page_views` total | **77** |
| album only | 54 |
| post only | 23 |
| both album and post | **0** |
| neither | **0** |
| rows failing the new identity rule | **0** |

So there was no blocker: every existing row could be attributed to a site, and
every one already satisfied the constraint that was about to be added.

### Verified against the live database afterwards, not assumed

| | |
|---|---|
| the 77 rows | all still there |
| `tenant_id` | populated on all 77, `uuid NOT NULL`, FK to `tenants(id)` ON DELETE CASCADE |
| ownership | **0** rows where the site disagrees with the row's album or story |
| identity | **0** rows failing `page_views_identity` |
| the five metadata columns | still NULL on every legacy row — `path`, `page_key`, `referrer_host`, `session_hash`, `device` |
| preserved columns | `id`, `album_id`, `post_id`, `visitor_hash`, `viewed_at` — names, types and meanings unchanged |
| indexes | `page_views_pkey`, `page_views_album_idx`, `page_views_post_idx`, `page_views_tenant_time` |
| constraints | the three FKs, plus `page_views_identity`, `_path_is_a_path`, `_page_key_shape`, `_referrer_is_a_host`, `_session_shape`, `_device_bucket`, `_visitor_is_a_hash` |
| RLS | enabled, and `Tenant members manage` is the **only** policy: ALL, `tenant_id = current_tenant_id() or is_platform_admin()`, both USING and WITH CHECK |
| `"Anyone can record a view"` | **gone** |
| table grants | `anon`: none. `authenticated`: SELECT. `service_role`: SELECT, DELETE. **No direct INSERT for anybody.** |
| `record_page_view` | DEFINER, `search_path = ''`, returns `uuid`, EXECUTE to `service_role` only among application roles |
| its session rule | the FINAL one: a NULL session is accepted, a non-null one must match `^[0-9a-f]{32}$` |

### And a live smoke test, as the role that actually writes

Run as `service_role` against production: the homepage, `page_key = home`,
`device = desktop`, `referrer_host = instagram.com`, **`session_hash = NULL`**.
`record_page_view` created the row. The test row was deleted and `page_views`
returned to exactly 77.

That the smoke test used a NULL session is the point of it. The first version of
this migration refused one, which would have made a browser with site data
blocked an uncounted visitor — systematic undercounting of exactly the people
most likely to have blocked storage, over a column that exists only for
within-visit funnels. The deployed function accepts it.

### The counts, and one that went DOWN

Production is now **35 tables, 494 columns, 13 functions, 54 policies**, RLS on
all 35. No table was added or dropped.

**54 is one fewer than the 55 after the queue**, and that is the change rather
than an error in it: `"Anyone can record a view"` was `for insert with check
(true)` — anybody at all, no account needed, could POST to PostgREST and write a
view against any gallery on the platform with any visitor hash and any timestamp.
Dropping it is most of what S4 was for. `Tenant members manage` was dropped and
recreated in the same migration, so it is a replacement and not a second policy.

### The reconciliation, and what now stops it drifting

`db/schema-2026-09.sql` and `db/test-fixture.sql` were updated in the same
sitting. The table definition, all seven CHECKs, the tenant foreign key, both
indexes, the policy, the grant block and `record_page_view` were **copied from
the migration**, and the fixture's own two seeded views gained the `tenant_id`
their parents belong to, because the column is NOT NULL. Both files were
confirmed to declare `page_views` identically to each other, and the rebuilt
fixture's table was compared against the production description column by column.

`scripts/fixture-matches-migration.sh` now guards both tables. It builds the
fixture, records the facts, then **strips everything S4 added** — the policy
first (the column cannot be dropped while a policy names it), then the six
columns, which takes their CHECKs and indexes with them, then the function, then
the grants back to their pre-S4 breadth — and lets the migration put it all back.
403 facts compared for `jobs`, 175 for `page_views`. Shown to bite twice: making
the fixture's session CHECK case-insensitive, and adding a fourth device bucket,
each reported as drift with a clean diff and exit 1.

### One thing the extended guard found, which was the guard's own fault

The first version compared each column's raw `attnum`. Dropping six columns and
letting the migration add them back leaves gaps, so the rebuilt ones came back as
12–17 where the fixture had 6–11 — identical names, identical types, identical
order, reported as drift. The same would have been true between the two databases
anyway: production reached those columns by `add column` (6–11) and the fixture
declares them inline (1–11), so the raw numbers were never comparable.

Position is now compared as a **rank among the live columns**, which still
catches a reordering and is immune to the drop. Dropping the position from the
comparison altogether would have been the easy fix and the wrong one — column
order is exactly the kind of thing a careless edit to the fixture gets wrong.

### From the advisors, after deployment

No S4-specific security finding. `page_views_tenant_time` and
`page_views_post_idx` report as unused, which is expected immediately after
creation and worth re-checking once there is real traffic — the same follow-up
already recorded for the queue's three indexes.

---

## 2026-11-22 — Client gallery v2, the gallery email send limit, DEPLOYED TO PRODUCTION

Two migrations, each reviewed by Work and applied once to production, the
second as a forward correction of the first, from the hash-verified files,
which have not been edited since — their bytes are the deployments'
identity, and their "CANDIDATE — NOT DEPLOYED" headers are historical:

| | Supabase version | name | file | sha256 |
|---|---|---|---|---|
| send limit | `20261123001300` | `gallery_email_send_limits` | `db/migrations/2026-11-22_gallery_email_send_limits.sql` | `6460b642d7ade6e3b0d5451381509579705b07da08b2e7a032f783b06c9b26a0` |
| recipient binding | `20261123002952` | `gallery_email_recipient_binding` | `db/migrations/2026-11-22_gallery_email_recipient_binding.sql` | `fbea8b9fbbe73a4548e8850c61c5154585336a9d188e58db05f57014d0b9258c` |

**Source of every production fact below:** Work's reviews and the read-only
postflights, as relayed to Claude Code on 2026-11-22. **Claude Code did not
read production**; anything "measured locally" is loopback rehearsal only.

### Production, as the postflights recorded it

| | |
|---|---|
| `gallery_email_send_attempts` | new; `id uuid NOT NULL DEFAULT gen_random_uuid()`, `tenant_id uuid NOT NULL` (no default), `recipient_hash bytea NOT NULL`, `attempted_at timestamptz NOT NULL` (no default) |
| its constraints | `_pkey PRIMARY KEY (id)`; `_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`; `_hash_shape CHECK (octet_length(recipient_hash) = 32)` |
| its index | `gallery_email_send_attempts_tenant_recipient (tenant_id, recipient_hash, attempted_at)` (plus the primary key's) |
| RLS | enabled, not forced, **no policy**; no trigger |
| table privileges | **none** for PUBLIC, anon, authenticated or service_role — the owner alone |
| `reserve_gallery_email_send(p_tenant uuid, p_album uuid, p_client uuid)` | returns text; plpgsql, SECURITY DEFINER, VOLATILE, `search_path=""`, `lock_timeout=5s`; owner **postgres**; EXECUTE to **authenticated only** (anon, service_role and PUBLIC: none) |
| its success result | since `20261123002952`: `'reserved:' \|\| encode(<recipient hash>, 'hex')` — the hash the same call inserted. `'site_limited'` and `'recipient_limited'` unchanged, carrying no hash; every refusal's SQLSTATE and message unchanged |
| data | the table **empty** |

**What it means.** The limit lives in the database: at most 30 reserved
attempts per site and 3 per recipient per site in any rolling hour, reserved
before the provider is called and never given back. The function derives the
recipient itself (this site's client, on this site's gallery, shared with
that client) and restates the editor-of-this-site-or-platform-admin rule
NULL-safely.

**Retention, as it actually behaves.** Rows are pruned **lazily**: each call
deletes its own site's rows older than the hour, inside the per-site lock,
and nothing else ever deletes them — no job, no cross-site statement. So a
site that goes quiet keeps its last rows (at most 30) until its next call,
or until the site is deleted (the tenant cascade). "A row lives at most an
hour", as the first migration's header puts it, is true of what is counted,
not of what is stored.

**The hash is pseudonymous, not anonymised.** `recipient_hash =
sha256(utf8(<tenant id> || ':' || lower(btrim(email))))`: no plaintext
address is stored, and keying by the site stops one person's rows being
joined across sites, but the key is not a secret and there is no salt —
anyone holding a row who guesses an address can confirm it (the
`visitor_hash` shape). The binding's answer discloses the same hash, and only
to a caller who passed the function's own rule. A retained row is therefore
personal data under a pseudonym, held until pruned as above.

**Not exercised in production, deliberately:** no reservation was made; the
behaviour is proved locally (`db/verify-gallery-email-limits.sql` for the
pre-binding contract, `db/verify-gallery-email-recipient-binding.sql` for the
present one). Nothing in the deployed application calls the function yet.

### The reconciliation (local, 2026-11-22)

`db/schema-2026-09.sql` and `db/test-fixture.sql` carry the table, its
index, RLS, its revoke, the function **as the binding left it** (never the
first migration's `'reserved'` body) and its grant block — every statement
copied from the two files, in one block at the end of each (in the fixture,
before the seed rows). Postgres reports the function's body exactly as
written, so a copy that differs by one character is drift.

`scripts/fixture-matches-migration.sh` strips both FIRST (the function, then
the table, each by name) and replays them LAST, after the square layout, in
order — the binding's own preflight refuses any body but the first
migration's or its own. A fact set of its own compares
`gallery_email_send_attempts` whole (columns by rank, constraints, indexes,
RLS, policies, triggers, table grants, owner) and the function's definition,
owner and ACL. `scripts/fixture-matches-migration.mjs` reads those steps from
the shell file; it was changed only to expect the third fact set, plus three
parser refusals and eleven fixture mutants for these objects.

**A historical-stage caveat, not changed here:** `scripts/p4-local-db.mjs`'s
stages strip nothing of client gallery v2 (as before for the cover and
square migrations), so a historical stage now also carries this table and
function.

---

## 2026-11-22 — Client gallery v2, layout_style admits 'square', DEPLOYED TO PRODUCTION

The second client gallery v2 migration, independently reviewed and applied
once to production after the cover migration (next section), from the
hash-verified file, which has not been edited since — its bytes are the
deployment's identity, and its "CANDIDATE — NOT DEPLOYED" header is
historical:

| | Supabase version | name | file | sha256 |
|---|---|---|---|---|
| square layout | `20261122233837` | `album_layout_square` | `db/migrations/2026-11-22_album_layout_square.sql` | `487555e35d61227cbb46995a1f3bbddbb290c33156d45f633785e849da489a49` |

**Source of every production fact below:** the read-only postflight and an
independent count of the totals, as relayed to Claude Code on 2026-11-22.
**Claude Code did not read production.**

### Production, as the postflight recorded it

| | |
|---|---|
| `albums_layout_style_check` | exactly `CHECK ((layout_style = ANY (ARRAY['masonry'::text, 'grid'::text, 'single_column'::text, 'square'::text])))` — the three original values in their order, plus `square`; same name, on `albums` |
| `albums.layout_style` | unchanged: `text NOT NULL DEFAULT 'masonry'::text` |
| unchanged | existing rows; grants, policies, triggers and indexes |
| totals | **37 tables · 556 columns · 32 functions · 56 policies · 162 constraints · 104 indexes**, independently counted — a replaced CHECK changes no count |

The editor's "square" layout, refused before with 23514, is now admitted.
Narrowing the check again would fail while any album is saved as `square`
(the migration's own rollback note).

### The reconciliation (local, 2026-11-22)

`db/schema-2026-09.sql` and `db/test-fixture.sql` declare
`albums_layout_style_check` with the four values, in place among albums'
other survey-era CHECKs. Creation order is not observable for a CHECK
(PostgreSQL evaluates them in name order), unlike the foreign keys above.

`scripts/fixture-matches-migration.sh` strips it before the cover strip
(it is newer) by putting the check back to production's three-value
definition — the one state the migration replaces; it refuses any other —
and replays it after the cover migration. `albums` is compared whole, so the
check's full definition is a fact. `scripts/fixture-matches-migration.mjs`
reads its steps from the shell file and needed no change; its parser also
requires every listed migration to be replayed exactly once.

---

## 2026-11-22 — Client gallery v2, three cover columns on albums, DEPLOYED TO PRODUCTION

One migration, independently reviewed by Work and applied once to production
from the hash-verified file, which has not been edited since — its bytes are
the deployment's identity, and its "CANDIDATE — NOT DEPLOYED" header is
historical:

| | Supabase version | name | file | sha256 |
|---|---|---|---|---|
| cover v2 | `20261122233150` | `album_cover_v2` | `db/migrations/2026-11-22_album_cover_v2.sql` | `645e22aab80c75f69e333032c184220d9c872b0b749f7c409cff11c43ca59c62` |

**Source of every production fact below:** the read-only postflight, as
relayed to Claude Code on 2026-11-22. **Claude Code did not read
production**; anything "measured locally" is loopback rehearsal only.

### Production, as the postflight recorded it

| | |
|---|---|
| `albums` columns | `cover_background text NULL`, `cover_zoom numeric NULL`, `cover_secondary_photo_id uuid NULL` — no defaults, no column ACL; added by ALTER TABLE, so the table's last three columns (after `access_revision`) |
| `albums_cover_zoom_range` | `CHECK (((cover_zoom >= 1.0) AND (cover_zoom <= 2.5)))` |
| `albums_cover_background_hex` | `CHECK ((cover_background ~ '^#[0-9A-Fa-f]{6}$'::text))` |
| `photos_id_album_tenant` | `UNIQUE (id, album_id, tenant_id)` — a key target only; `photos.id` is already the primary key, so it refuses nothing |
| `albums_cover_secondary_photo_fk` | `FOREIGN KEY (cover_secondary_photo_id, id, tenant_id) REFERENCES photos(id, album_id, tenant_id) ON DELETE SET NULL (cover_secondary_photo_id)` — MATCH SIMPLE, NO ACTION on update, not deferrable, validated |
| `albums_cover_secondary_photo` | `CREATE INDEX … ON public.albums USING btree (cover_secondary_photo_id) WHERE (cover_secondary_photo_id IS NOT NULL)` |
| unchanged | existing data fingerprints; grants, policies and application triggers (including `albums_access_revision`) |
| data | 9 albums · 87 photos · every new column NULL |

**Totals:** the 2026-11-21 surveyed baseline (553 columns, 158 constraints,
102 indexes) plus this migration — **556 columns, 162 constraints, 104
indexes**; tables 37, functions 32, policies 56 unchanged. The index figure
counts the UNIQUE's own backing index as well as the partial one, as
`pg_indexes` does. First derived; since confirmed by an independent count
after the square-layout migration (next section), which changes no total.

**What it means for deletion.** Deleting a photograph that is some album's
second cover photograph nulls `cover_secondary_photo_id` and nothing else;
deleting an album still removes its photographs by `photos_album_id_fkey`'s
cascade; `deleteSite()` (photos, then albums, explicitly) is unaffected. Moving
such a photograph to another album or site is refused (NO ACTION on update).

### The reconciliation (local, 2026-11-22)

`db/schema-2026-09.sql` and `db/test-fixture.sql` declare the three columns
last on `albums`, and the four constraints and the index in one block after
P4 unit 2's keys — the order production created them in, since foreign-key
triggers fire in creation order. Every statement is the migration's own DDL.

`scripts/fixture-matches-migration.sh` strips this migration first (the key,
its index, `photos_id_album_tenant`, the two CHECKs, the three columns — each
by name) and replays it last, after the sweeper; `albums` and `photos` are
compared whole. `scripts/fixture-matches-migration.mjs` reads its steps from
the shell file and needed no change.

---

## 2026-11-21 — P6, the sweeper's lifecycle columns and grants, DEPLOYED TO PRODUCTION

One migration, reviewed by Work and applied once by Codex with Gonzalo's explicit approval, from the
hash-verified file, which has not been edited since — its bytes are the
deployment's identity:

| | Supabase version | file | sha256 |
|---|---|---|---|
| P6 | `20261121173616` | `db/migrations/2026-11-03_photo_sweeper.sql` | `0acfb119ef1d143f8fbe4d8c41657601e592eb18c1e4caff24324ee8d5b508e9` |

Gate `P6-20261104-four-column-migration-02`, Work review recorded in
`REVIEW.md`. Migration only: **no application was deployed, and no sweep,
dry run or storage deletion was run.**

**Source of every production fact below:** Codex's postflight, and a separate
read-only re-read of production by Codex for this reconciliation — both
relayed 2026-11-21. **Claude Code did not read production**; the "measured
locally" facts further down are loopback rehearsal only.

### Production, as Work and Codex recorded it

| | |
|---|---|
| history | the migration applied once; postflight passed |
| `photo_assets` columns | `unreferenced_since timestamptz NULL`, `sweep_checked_at timestamptz NULL`, `swept_at timestamptz NULL` — **no defaults**; added by ALTER TABLE, so the table's last three columns |
| constraint | `photo_assets_swept_after_unreferenced CHECK (swept_at IS NULL OR unreferenced_since IS NOT NULL)` |
| index | `photo_assets_sweep_queue ON public.photo_assets (sweep_checked_at NULLS FIRST, unreferenced_since) WHERE swept_at IS NULL` |
| `service_role` | SELECT on `photo_assets` and `photo_usages`; column-level UPDATE on **exactly four** `photo_assets` columns — `deleted_at`, `unreferenced_since`, `sweep_checked_at`, `swept_at` |
| `authenticated` | SELECT only on both tables — unchanged |
| everything else | existing row fingerprints, policies and prior schema objects unchanged |
| data | 74 photo assets · 105 usages · every new lifecycle field NULL · **0** deleted · **0** originals purged |

**Totals**, directly surveyed by Codex on 2026-11-21: 37 tables · **553** columns (550 + 3)
· 32 functions · 56 policies · **158** constraints (157 + 1) · **102** indexes
(101 + 1), RLS on all 37 — the P5 figures plus this migration's additions,
reproduced exactly by the reconciled fixture (below).

### Measured locally, 2026-11-21 (Postgres 16.15, loopback only)

- **Equivalence.** The fixture as it stood before this reconciliation, plus
  the deployed migration, compared against the reconciled fixture: **77
  catalog facts identical** — every `photo_assets` column by rank, type,
  nullability and default; its constraints; its indexes; table and column
  privileges on both tables for `anon`, `authenticated`, `service_role` and
  PUBLIC.
- **Idempotence.** The migration applied twice onto the old fixture, and once
  onto the reconciled one, is a no-op each repeat — and its embedded
  exhaustive privilege assertion passes every time, which it cannot do if
  `service_role` holds one column too many or too few.
- **The drift guard.** `scripts/fixture-matches-migration.sh` now replays this
  migration last, after the P5-R1 correction; **all nine tables ok**, 2,128
  facts for `photo_assets`. The Node runner used on Windows,
  `scripts/fixture-matches-migration.mjs`, reads its steps from the shell file
  and reports the same nine — its step trace ends at
  `db/migrations/2026-11-03_photo_sweeper.sql`.
- **Shown to bite.** Each of these turned the guard red and was reverted:
  leaving the migration out of the replay (drift on `photo_assets` AND
  `photo_usages`); declaring the three columns beside `original_purged_at`
  instead of last (drift on rank — production added them with ALTER TABLE);
  and granting `service_role` UPDATE on three columns, omitting `deleted_at`.

### Why `deleted_at` is in the grant

`deleted_at` already means "unavailable" to the deployed render reader and the
picker. The sweeper writes it **only at purge time**, alongside `swept_at`,
when the asset's files are genuinely gone — so the filters that already ship
stop offering a photograph that no longer exists, without teaching each reader
about `swept_at`. Writing it while a clock merely runs was the withdrawn first
design, and it would have hidden photographs thirty days early;
`.mk/sweep.ts` asserts it cannot come back.

**Not tested in production, deliberately:** no sweep, no dry run, no row
written. The sweeper application is code-complete and awaiting its own
release review; until it ships, these columns exist and nothing writes them,
which is the safe order (deployment rule 5).

---

## 2026-10-08 — P5, the album access revision and the render read, DEPLOYED TO PRODUCTION

Three migrations, each applied once by Work (ChatGPT) with Gonzalo's
explicit approval, from the hash-verified files, which have not been edited
since — their bytes are the deployments' identity, and the "CANDIDATE — NOT
DEPLOYED" headers inside them are historical:

| | Supabase version | name | file | sha256 |
|---|---|---|---|---|
| F1 | `20261008154244` | `album_access_revision_p5_f1_2026_10_08` | `db/migrations/2026-10-08_album_access_revision.sql` | `78d283589a2f151931c804aeca411419b355f369cc356aa19c9df35148d7ccec` |
| render read | `20261008154343` | `photo_render_read_p5_2026_10_07` | `db/migrations/2026-10-07_photo_render_read.sql` | `fa2e0594e12299338f00ad017b346b1fb6b424b9b7b8d73ebf15d423b8d7128b` |
| P5-R1 | `20261008180722` | `photo_render_record_fix_p5_r1_2026_10_08` | `db/migrations/2026-10-08_photo_render_record_fix.sql` | `736c9a0b9e934b91fa11f6c939d256504715ce4255d8f701c7f4920324ad3bca` |

**Source of every production fact below: Work's records**,
`.ai-handoff/p5-f1-production-deployment-20261008.md` / `.json` (the first
two, final observation 15:52:17 UTC, gate
`P5-20261008-album-grant-security-migration-02`, BLOCKED by P5-R1) and
`.ai-handoff/p5-r1-production-deployment-20261008.md` / `.json` (the third,
final observation 18:10:42 UTC, gate `P5-20261008-render-cold-session-fix-01`,
DEPLOYED_VERIFIED). **Neither Claude Code nor Codex read production for this
reconciliation**; the "measured locally" facts further down are loopback
rehearsal only.

### Production, as Work recorded it

| | |
|---|---|
| history | 12 entries; each P5 version exactly once; the earlier nine unchanged |
| totals | 37 tables · **32** public functions (30 + `albums_access_revision` + `read_photo_render_assets`; `sync_photo_usages` replaced) · 56 policies · table owners/RLS, constraints and indexes unchanged |
| `albums.access_revision` | `uuid NOT NULL DEFAULT gen_random_uuid()`, no column ACL, albums' 48th (last) column; all 8 albums distinct and non-null, unchanged after initialisation (revision fingerprint `f28c6663…`) |
| `albums_access_revision()` | plpgsql, SECURITY INVOKER, VOLATILE, `search_path=""`, owner postgres, ACL `{postgres=X/postgres}` only |
| trigger | `CREATE TRIGGER albums_access_revision BEFORE INSERT OR UPDATE ON public.albums FOR EACH ROW EXECUTE FUNCTION albums_access_revision()`, tgtype 23, enabled `O` |
| `albums` ACL | before F1 `anon/authenticated/service_role=arwdDxtm`; after `arwdDxm` — TRIGGER (`t`) removed and nothing else; no PUBLIC entry either side. No application role can create an album trigger or execute the trigger function |
| `read_photo_render_assets(uuid, jsonb)` | returns jsonb, plpgsql, STABLE, SECURITY DEFINER, `search_path=""`, owner postgres, ACL `{postgres=X/postgres,service_role=X/postgres}`; prosrc md5 `0f73aec4d8bb7c12b6c10fbabe9bdfb6` from 15:43 to 18:07 UTC, then **`afb20e567041072e63324eb5f13b2940`** (full definition md5 `f3eadc33e3b8283e082fa67bc25addbd`) — the R1 correction changed that one expression and nothing else in any of the 32 functions |
| `sync_photo_usages(uuid, text, text, text, jsonb)` | replaced by the render read's §2; DEFINER, VOLATILE, `search_path=""`, ACL unchanged (postgres + service_role); prosrc md5 `74102d2413a429873f9c8ea52706a8d5`, unchanged by the correction |
| data | 8 albums · 83 photos (71 linked, 12 unlinked samples) · 74 assets · 102 usages · 0 `site_images`; ten content fingerprints unchanged by all three migrations (albums compared without the new column) |
| smoke | anon/authenticated refused by the ACL (42501); a bare owner by the reader's role check; seven malformed/oversize/null-tenant requests 22023; all 74 assets read under their own site, all 74 cross-site references `missing`; **after the correction**, ten genuinely fresh-backend scenarios (invalid, invalid path, missing, foreign id/path, mismatch-then-valid, negative-then-valid, valid-then-negative, empty, valid) and a warmed control all exact — the 55000 of P5-R1 gone. All READ ONLY, rolled back |
| advisors | the same 19 pre-existing WARN findings, none new |

**P5-R1 (resolved).** The render read as first deployed named `v_a.id` — a
field of an untyped record no lookup had assigned yet — in its result line, so
a backend's first call that began with an invalid, missing, foreign,
mismatched or ambiguous reference raised 55000 `record "v_a" is not assigned
yet`. `20261008180722` replaced that expression with `v_asset`; production
has carried the corrected body since 18:07 UTC.

**Not tested in production, deliberately:** no album was written to watch
the trigger fire; the trigger's behaviour and the TRIGGER-privilege bypass
are proved locally (`.mk/album-revision-db.ts`, as the real roles). No
application and no real `ALBUM_ACCESS_SECRET` is deployed — the database half
alone changes nothing a visitor sees.

### The reconciliation (local, 2026-10-08, after Work's R1 postflight)

Independently reviewed locally by Codex (schema and snapshot parity, all
historical stages, the guard and its mutations, the suites). That is a local
review only: it does not deploy the P5 application or the real
`ALBUM_ACCESS_SECRET`, accept the visible UI, approve any further scope or
close P5.

`db/schema-2026-09.sql` and `db/test-fixture.sql` carry all three, every
statement **cut from the deployed files by a script**
(`.ai-handoff/p5-reconcile-apply.cjs`, which refuses unless the three files
hash to the deployed values): the revision column as albums' last column,
the trigger function (the migration's dynamic CREATE written out statically
with the identical body and attributes), its owner-only ACL, the trigger, the
TRIGGER revoke placed after the broad table grant, P5's projector in place of
P3's, the **corrected** reader (never the `v_a.id` body) and the render
read's grant block. The fixture's seeded albums get random revisions from the
trigger on every build; no production row or revision is in either file.

**Measured locally (PostgreSQL 17.6, loopback scratch databases):**

- **Against Work's recorded catalogue** (`.ai-handoff/p5-reconcile-catalog-check.mjs`
  over the JSON records — record-derived, not a production read): all 21
  photo functions (P2–P5) match production's `prosrc`, `pg_get_functiondef`,
  ACL, owner and attributes exactly, as do the trigger, the revision column
  and its position, and the 48 album columns. **That broad check is not
  green and is not claimed to be:** it reported 140 passed / 32 failed, every
  failure outside P5 and present before the reconciliation. It compares
  against the *exported* `prosrc` strings, several of which carry CRLF, so it
  over-counts body differences. Against Work's **server-computed**
  `final.functions[].body_md5` (authoritative;
  `.ai-handoff/p5-reconcile-export-aware.mjs`), **26 of 32** bodies match;
  five more (`current_tenant_id`, `default_tenant_id`, `is_platform_admin`,
  `push_draft_step`, `tenant_of`) differ only in the export's line endings.
  The pre-existing differences, none of them P5's, all left alone
  (`claude/open-items.md` §13):
  - **six real server-body differences**: `apply_tenant_policy`,
    `apply_tenant_policy_via`, `tenant_for_insert` (reconstructed or
    commentary-less locally), `claim_jobs`, `finish_job` (extra explanatory
    comments locally) — and `touch_site_draft`, which is a **semantic**
    difference, not formatting: the fixture sets `updated_at := now()`,
    production `clock_timestamp()`;
  - **MAINTAIN**: production grants PostgreSQL 17's MAINTAIN (`m`) to
    anon/authenticated/service_role on **33** recorded tables, not only
    `albums`; the fixture's explicit seven-privilege grant predates it. P5's
    narrowing still removes only TRIGGER from each environment's baseline;
  - **`push_draft_step`**: production also grants EXECUTE to service_role — a
    real effective-permission difference;
  - eight helpers have a NULL `proacl` locally and an explicit list in
    production (PUBLIC, postgres, anon, authenticated, service_role). Both
    give PUBLIC EXECUTE, so the effective EXECUTE set is the same; this is a
    representation difference, not automatically a permission one.
- **Catalogue identity** (`.ai-handoff/p5-reconcile-stage-proof.mjs`): the
  reconciled fixture equals the pre-reconciliation fixture plus the three
  files in production's order — every function definition, ACL and owner,
  every table's owner, RLS and ACL, every column with its default,
  nullability and column ACL, constraint, index, policy and trigger.
- **The drift guard** (`scripts/fixture-matches-migration.sh`, run through
  `.mjs`) strips P5 first — the reader, the trigger, function and column, and
  TRIGGER given back as before F1 — and replays P1 → … → unit 2 → the
  revision → the render read → the correction; albums and the 19 photo
  functions are compared whole, now with function owners, the table owner,
  column ACLs and triggers (definition and enablement): 409 `jobs` + 175
  `page_views` + 2489 photo-table facts. `--mutations` shows it catching 14
  P5 fixture defects (revision column nullable / without default / with a
  column grant; trigger disabled / UPDATE-only / missing; TRIGGER not
  revoked; revision function DEFINER / executable / foreign-owned; the reader
  back to `v_a.id`, VOLATILE, executable by authenticated; the projector's
  blank rule changed) and the 7 P4 ones (proof: a green baseline + 21
  mutants, 22 passed), plus eight parser checks — a green baseline and seven
  refusals, two of them new for the P5 replays (8 passed).
- **Historical stages** (`scripts/p4-local-db.mjs`): `pre_r1`,
  `pre_p5_render`, `pre_p5` — and `pre_unit2`/`pre_p4`, which now strip P5
  too — each rebuilt from the migration files' own text and proved
  catalogue-identical to the true historical state. A plain fixture load now
  refuses a fixture that is not the present.

### Advisors

Not re-run for the reconciliation (it changes no database). Work's last
record: 19 pre-existing WARN findings — mutable `search_path` 3, anon-callable
definer 5, authenticated-callable definer 10, leaked-password protection 1 —
unchanged by all three migrations.

---

## 2026-10-05 / 2026-10-06 — P4, the legacy backfill and the asset keys, DEPLOYED TO PRODUCTION

Two migrations, each applied once from the reviewed file and verified against
the live database (evidence and reviews: the ignored `.ai-handoff/` packets;
the Unit 2 deployment was independently accepted by ChatGPT Work on
2026-10-06 UTC). Neither file has been edited since; their hashes are the
deployed bytes:

| | Supabase version | name | file | sha256 |
|---|---|---|---|---|
| unit 1 | `20261005192303` | `photo_backfill_p4_unit1_2026_10_05` | `db/migrations/2026-10-05_photo_backfill.sql` | `aa46c4789f85f1280a17ab01af400d9fff5459792d334a44acfe7b351e4f3eb8` |
| unit 2 | `20261006012958` | `photo_assets_fk_p4_unit2_2026_10_05` | `db/migrations/2026-10-05_photo_assets_fk.sql` | `1bc2276e2ba325255be44509f203cc1695f8fafa276678b5f6b315a77c1d46d5` |

### The production sequence, as it ran

Each step separately approved, in the plan's order
(`claude/photo-migration-plan.md`, P4):

1. **Unit 1** applied (functions only: 25 → 30). The deployed bodies of
   `photo_backfill_foreign_claim`, `read_photo_backfill_inventory`,
   `read_photo_backfill_claims` and the replaced `photo_usage_resolve_path`
   were compared with the file afterwards and match.
2. **The application deployment that retired the old derivative writer**
   (Vercel `dpl_AwanseKzTb8wSEVjNBvcb5wN4AsX`, built from a source snapshot of
   commit `4e262d2` plus the reviewed, then-uncommitted P4 working tree; scope
   "application retirement only").
3. **Legacy deployments isolated, then verified drained by read-only
   observation** (no drain command was invoked). A Vercel firewall rule,
   `rule_p4_legacy_deployment_isolation_Tt14RW` (firewall config version 3),
   denies every host except the current deployment's seven aliases and its own
   immutable hostname, so no retained older deployment — the old
   `photo.derivatives` writer — can be reached. A 15-minute read-only
   observation (2026-10-05 22:37–22:52 UTC) then saw zero legacy invocations,
   `jobs` 0 with nothing running and no live lease, and every count and
   source fingerprint unchanged. **The rule is still enabled**; removing it is
   its own decision, not part of P4's closure.
4. **The reviewed dry run and journal provenance manifest.**
5. **The backfill writes** (2026-10-06 00:24–00:26 UTC,
   `scripts/backfill-photo-assets.ts --all --apply --manifest …`, exit 0):
   **74 assets** (52 with a verified original, 22 display-only), **71 photos
   linked**, 3 document-only uploads, the 12 built-in samples left unlinked;
   per site 50 assets / 47 links and 24 / 24, the other two sites none. Storage
   was read only (375 reads compared, content unchanged). The idempotence dry
   run straight afterwards planned nothing for all four sites.
6. **A P3 rebuild per site** (`scripts/rebuild-photo-usages.ts --tenant <id>`,
   00:57–00:59 UTC): 38 parents, 0 failed, **0 unresolved** (the 102 P3 left
   for P4), 0 malformed, **102 usages** — 74 / 28 / 0 / 0 by site; by kind
   gallery 71, gallery_cover 5 (4 chosen, 1 custom), story_block 9,
   page_section 8, shop_listing 5, story_cover 3, page_share 1.
7. **Unit 2** applied once (01:29:51–01:29:58 UTC, success, no retry). Its
   preflight read zero on all five rules immediately before.

### Verified against the live database afterwards

| | |
|---|---|
| totals | **37 tables, 549 columns, 30 public functions, 56 policies, 157 constraints, 101 indexes** (constraints 155 → 157, indexes 99 → 101) |
| data | 74 assets, 83 photos, 71 linked, 102 usages, 12 unlinked built-in samples, 0 `site_images`, 0 `jobs` (none running, no live lease) |
| `photos_asset_fk` | `FOREIGN KEY (asset_id, tenant_id) REFERENCES photo_assets(id, tenant_id)` through `photo_assets_id_tenant`; validated, NOT DEFERRABLE, MATCH SIMPLE, NO ACTION on update and delete |
| `site_images_asset_fk` | the same, on `site_images` |
| `photos_asset_tenant`, `site_images_asset_tenant` | valid, ready, non-unique btree `(asset_id, tenant_id) WHERE asset_id IS NOT NULL` |
| internal triggers | four RI triggers per key, eight in all; every other trigger unchanged |
| completeness | all five unit-2 rules still zero; every non-NULL link tenant-bound and display-consistent |
| unchanged | every other constraint and index definition; all 30 function bodies, owners, security modes, `search_path` and ACLs; all 56 policies, RLS flags and table/schema/default grants; all 102 usage rows (ids and timestamps included) |

**Not tested in production, deliberately:** no write was attempted to watch a
key refuse, cascade or roll back. Those behaviours are proved locally — the
five refusals, the lock race, run-twice and the rollback by
`scripts/photo-assets-fk.mjs`, and the keys themselves by
`db/verify-photo-assets-fk.sql`.

**MATCH SIMPLE still admits a NULL link.** The five completeness rules were the
migration's preconditions, not permanent CHECK constraints; nothing in the
database now stops a future writer leaving a non-sample photograph unlinked.
P2's wrappers always link and the backfill has finished; whether a permanent
rule is wanted is for a later phase to decide.

### Advisors, after deployment

**Security:** unchanged by finding identity — mutable `search_path` 3,
anon-callable definer 5, authenticated-callable definer 10, leaked-password
protection 1. All pre-existing; P4 added none and remediated none. (The
"authenticated may execute five definer functions" note further down counts
the five *application* doors; the advisor's figures count more — reconciling
the two is part of the standing read-only advisor pass in `claude/open-items.md`.)
**Performance:** one new INFO finding, expected — `site_images_asset_tenant` is
unused, on an empty table (unused-index count 11 → 12). Keep it. Everything else
unchanged.

### A sentence in the unit 2 file that is wrong — corrected here, not there

The migration's header says *"Deleting a SITE still works: tenants cascade to
photos, site_images and photo_assets in one statement."* **That is not
production's shape.** `photos_tenant_id_fkey` (like `albums_tenant_id_fkey`)
is NO ACTION; `deleteSite()` in `app/actions/sites.ts` removes a site's photos
and albums **explicitly**, before the tenant row. `site_images` and
`photo_assets` do cascade from `tenants`. Unit 2's NO ACTION keys are checked at
the end of each statement, so neither path is blocked by them. The file stays
byte-for-byte as deployed — its hash is the deployment's identity — and this
paragraph, the fixture's comment beside the keys, and the plan carry the
correction.

### The reconciliation

`db/schema-2026-09.sql` and `db/test-fixture.sql` carry both units, every P4
statement **copied from the migration files by a script**: unit 1's five new
functions and its replaced resolver verbatim, its grant block verbatim, and
unit 2's two keys and two indexes — created **after** every P1 and P3 key, as
production created them (trigger firing order is creation order; see the P3
note below). The fixture's seeded rows are not production's: its three seeded
gallery photographs keep a NULL `asset_id`, which MATCH SIMPLE admits.

`scripts/fixture-matches-migration.sh` now strips P4's additions by name (the
keys and indexes first, then unit 1's five functions; the resolver goes with
P3's), rebuilds P1 → P2 → P3 A → P3 B → unit 1 → unit 2, and compares all
seventeen photo functions with `photo_assets`' facts and the keys and indexes
with `photos`' and `site_images`' whole-table facts: 409 `jobs` + 175
`page_views` + 2223 photo-table facts. Unit 2's preflight is not weakened — in
its scratch database only, the seeded photographs are linked first.
`node scripts/fixture-matches-migration.mjs` runs that same script's SQL where
there is no psql, and `--mutations` shows it biting on seven fixture defects
(a CASCADE key, a predicate-less index, an extra EXECUTE grant, an INVOKER
writer, the LIMIT-1 resolver, a weakened foreign-claim check, and missing keys).

`db/verify-photo-assets.sql` asserts the deployed keys exactly by default; its
original "no foreign key yet" assertion is kept and runs when a harness has
rebuilt the pre-unit-2 stage on purpose (`wtp.p4_stage`).

---

## 2026-10-01 — P3, the photo-usage projection, DEPLOYED TO PRODUCTION

Two migrations, reviewed and applied by ChatGPT, each SHA256 verified against
the file before it was applied:

| | Supabase version | name | file | sha256 |
|---|---|---|---|---|
| A | `20261001005946` | `album_cover_tenant_fk_2026_09_30` | `db/migrations/2026-09-30_album_cover_tenant_fk.sql` | `fad895dc3b16c4ac2bf5859a77bfb6b8d361be2a240351402ff1aad5a93f93ed` |
| B | `20261001010021` | `photo_usages_sync_2026_09_30` | `db/migrations/2026-09-30_photo_usages_sync.sql` | `cad8cabf96345c288964f81fcebab953e1947a744e5aff4b7806b76dd82e642d` |

### Verified against the live database afterwards

| | |
|---|---|
| totals | **37 tables, 549 columns, 25 public functions, 56 public policies** (18 → 25: B's seven) |
| `albums_cover_photo_fk` | `FOREIGN KEY (cover_photo_id, tenant_id) REFERENCES photos(id, tenant_id) ON DELETE SET NULL (cover_photo_id)` |
| cross-site chosen covers | **0** (A's preflight and an independent check) |
| `page_share` | in `photo_usages_kind_known`, `_scope_by_kind` and `_one_parent`; `photo_usages_slot_share (tenant_id, scope, page_key) where kind = 'page_share'`; `photo_usages_share_slot`: `kind <> 'page_share' or (field = 'page_seo.image' and position = 0)` |
| the seven P3 functions | `photo_usage_lock`, `photo_usage_parent_key`, `photo_usage_source`, `photo_usage_resolve_path` (internal: executable by no application role), `read_photo_usage_source`, `list_photo_usage_parents`, `sync_photo_usages`; all `search_path = ''` |
| the three service functions | SECURITY DEFINER; EXECUTE to `service_role` ONLY (authenticated, anon: none); a run-time role check also refuses an owner connection that has not SET ROLE service_role |
| `photo_usages` table grants | unchanged: `authenticated` SELECT only; `service_role` no SELECT, INSERT, UPDATE or DELETE |
| `register_gallery_photo`, `register_album_cover` | SECURITY DEFINER, `search_path = ''`, EXECUTE to `authenticated` only, exactly one `photo_usage_lock` call each; no other P2 behaviour or grant changed |

### Live smoke tests, run in production and cleaned up

- **Security:** `service_role` allowed; `authenticated` `42501`; an owner
  connection without the service role `42501`.
- **A sample and canonical album:** the canonical gallery photograph → 1
  gallery usage; the sample gallery photograph → 0; the sample chosen cover →
  0 `gallery_cover`; unresolved **0**; a forged sample declaration → `22023`.
- **Cover key:** deleting the chosen photograph set `cover_photo_id` to NULL
  and left `albums.tenant_id` unchanged.
- **Stale snapshot:** an old snapshot synced after a newer album state →
  `stale = true`, `written = 0`; the fresh sync → `stale = false`,
  `written = 2`; the final projection held the 2 canonical gallery usages.
- Cleanup complete: `photo_assets` 0, `photo_usages` 0, `jobs` 0.

### Activation — the one-time production rebuild (2026-10-01)

The P3 application, commit `cd018bdaca5c504c573304511bea17f6f2be8c41`, was
deployed by Vercel ("success — Deployment has completed");
`SUPABASE_SERVICE_ROLE_KEY` was confirmed present in Vercel Production. Then
`scripts/rebuild-photo-usages.ts --all` ran against production — under a
one-time, explicitly authorised override of CLAUDE.md deployment rule 7, data
only, through the canonical projector — **twice**:

| | pass 1 | pass 2 |
|---|---|---|
| exit code | 0 | 0 |
| sites / failed sites | 4 / 0 | 4 / 0 |
| parents / failed parents | 38 / 0 | 38 / 0 |
| written | 0 | 0 |
| unresolved | 102 | 102 |
| malformed | 0 | 0 |

The second pass was identical to the first, report and log: the projection
converged. Unresolved by site:

| site | unresolved | where |
|---|---|---|
| `0f48b91a-dae4-4341-9c81-ab44d2ed14c5` | **74** | albums 52 · stories 12 · catalogue entries 5 · live pages 5 |
| `6a7350e3-2fca-4d3f-adb7-10d69bc1f8f7` | **28** | album 24 · live pages 4 |
| the other two sites | **0** | |

All unresolved reasons are `photo_has_no_asset` and `no_asset` (files from
before P2); no sample path was counted; no errors; no stale or non-converging
parent. Production therefore still holds `photo_assets` 0, `photo_usages` 0,
`jobs` 0 — **expected**: nothing can resolve until P4's backfill mints assets
for those 102 references.

### The reconciliation

`db/schema-2026-09.sql` and `db/test-fixture.sql` carry both migrations, every
P3 statement **copied from the migration files by a script**: the cover key,
the three restated CHECKs and the share-slot CHECK, the slot index, the seven
functions with their grants, and the two re-locked wrappers. The reconciled
fixture alone produces the **same catalogue fingerprint** (constraints,
indexes, policies, table ACLs, columns, and every function's signature,
security, search_path, ACL and body) as the pre-P3 fixture plus A plus B, and
re-applying either migration to it changes nothing.

**One thing the reconciliation found: creation ORDER is observable.** The
first reconciled fixture declared the new cover key with albums' other keys,
i.e. before photo_usages' — and `db/verify-photo-assets.sql` then failed one
check: moving a photograph that is a chosen cover to another site was refused
by `albums_cover_photo_fk` instead of `photo_usages_photo_fk`. Both keys
refuse it; PostgreSQL fires foreign-key triggers in creation order, and in
production Migration A created the cover key AFTER P1's keys. No catalogue
definition differed, so the fingerprint could not see it. The fixture and the
snapshot now create the cover key after photo_usages' keys, as production did,
and the check passes; a comment there says why it must not move back.

`scripts/fixture-matches-migration.sh` now rebuilds the photo tables as
production reached them — P1, P2, then A, then B — after restoring the cover key
to its pre-P3 form in the strip. It compares the twelve photo functions
(P2's five, two re-locked by B, and B's seven) with `photo_assets`' facts, the
page_share constraints and index with `photo_usages`', and the cover key with
`albums`': 1616 P1/P2/P3 facts. Shown to bite on: the cover key reverted to one
column, the share-slot CHECK weakened, the share slot index missing `scope`, an
authenticated EXECUTE grant on `sync_photo_usages`, `register_gallery_photo`
without its lock, the resolver without its same-site filter, and a missing
P3 function (refused at the strip, which drops every function by name).

---

## 2026-09-30 — the S3 tenant-guard hotfix and P2, DEPLOYED TO PRODUCTION

Two migrations, reviewed and applied by ChatGPT, each SHA256 verified against
the file before it was applied:

| | Supabase version | name | file | sha256 |
|---|---|---|---|---|
| S3 hotfix | `20260930184309` | `enqueue_jobs_tenant_guard_2026_09_30` | `db/migrations/2026-09-30_enqueue_jobs_tenant_guard.sql` | `fb5e1689de95048f39c76f19a42ca2a7d18e2eecb3c0b8e69d0cbf8c7c4b1bc3` |
| P2 | `20260930191116` | `photo_ingest_2026_09_30` | `db/migrations/2026-09-30_photo_ingest.sql` | `6b83b8176f2f669e61e828eea59f84244d3954c47e123b48965031b7af880b9d` |

### What they fixed and added

**The hotfix.** The deployed `enqueue_jobs` guarded the site with
`if not (p_tenant = current_tenant_id() or is_platform_admin())`. SQL is
three-valued: for a signed-in account with **no profiles row**,
`current_tenant_id()` is NULL, the predicate is NULL, `not NULL` is NULL, and the
IF did not raise — such an account could queue work on any site (found by P2's
suite; confirmed against production). The guard is now
`(…) is not true`. Nothing else about the function changed.

**P2.** Five functions — the internal `upsert_photo_asset` and the four
`register_*` wrappers, the one way a photograph enters `photo_assets`. P2
changed **functions only**: no table, column, index, policy or table grant.

### Verified against the live database afterwards

| | |
|---|---|
| totals | **37 tables, 549 columns, 18 public functions, 56 public policies** (13 → 18: the five P2 functions) |
| `enqueue_jobs` | SECURITY DEFINER, `search_path = ''`, EXECUTE: `authenticated` yes, `anon` no, `service_role` no; guard NULL-safe (`is not true`) |
| `register_gallery_photo`, `register_site_image`, `register_journal_image`, `register_album_cover` | SECURITY DEFINER, `search_path = ''`, EXECUTE to `authenticated` only (`anon`, `service_role`: none) |
| `upsert_photo_asset` | SECURITY **INVOKER**, `search_path = ''`, EXECUTE to **no** application role |
| `photo_assets`, `photo_usages` table grants | unchanged from P1: `authenticated` SELECT only; `anon`, `service_role` none |

### Live smoke tests, run in production and cleaned up

- **Hotfix:** a normal photographer enqueueing on their own site → 1 job;
  onto a foreign site → `42501`; an authenticated account with no profile →
  `42501`. No smoke job remained.
- **P2, all four routes** registered successfully: gallery, site image, journal
  image, custom gallery cover.
- **Canonical retry:** a gallery membership recreated after deletion took the
  existing canonical asset's facts; a custom-cover retry kept the canonical
  asset's display path.
- **Boundary:** a half GPS coordinate → `22023`; a wrong tenant → `42501`; an
  authenticated account with no profile → `42501`.
- Cleanup complete: `photo_assets` 0, `photo_usages` 0, `jobs` 0, the temporary
  smoke album gone.

### Advisors, after deployment — the definer warnings are INTENDED

The security advisor warns that `authenticated` may execute five SECURITY
DEFINER functions: `enqueue_jobs` and the four `register_*` wrappers. **This is
the design and must not be "fixed."** Each is a deliberately narrow door: it
restates the tenant rule NULL-safely, validates the resource (the album, the
photograph), the exact storage-key shape, every value it accepts, and has no
parameter for anything the database should decide. The alternative the
advisor's rule implies — direct INSERT/UPDATE grants to `authenticated` — would
let a browser write any value RLS cannot see (RLS decides rows, not values: the
S3 lesson). Revoking EXECUTE would not close a hole; it would remove the only
validated path. All of this is proved by `db/verify-jobs.sql` and
`db/verify-photo-ingest.sql`, as the real roles.

The P1 performance notes stand, unchanged and informational: unused photo
indexes, several composite foreign keys and `photo_assets.created_by` without a
covering index. Not acted on (see `claude/open-items.md`).

### The reconciliation

`db/schema-2026-09.sql` and `db/test-fixture.sql` now carry the hardened
`enqueue_jobs` and all five P2 functions with their exact grants — the guard
lines and every function **copied from the migration files by a script**, not
retyped. The reconciled fixture alone passes `db/verify-jobs.sql` (including
the no-profile gate) and `db/verify-photo-ingest.sql`; re-applying either
migration to it changes nothing (catalogue fingerprint identical).

`scripts/fixture-matches-migration.sh` now rebuilds `jobs` from the jobs
migration **plus the hotfix**, and P2's five functions from the P2 migration,
comparing their definitions and EXECUTE grants — 409 `jobs` facts, 550 for
`photo_assets` with the functions. It also now drops `enqueue_jobs` by name:
before, `drop table jobs cascade` never removed it (it returns an integer, not
a jobs row), so that one function had been compared against the fixture's own
copy. Shown to bite on a reverted NULL-blind guard, a dropped check in the
helper, an extra EXECUTE grant on the helper, a wrapper made SECURITY INVOKER,
and a missing function.

---

## 2026-09-30 — photo assets (P1), DEPLOYED TO PRODUCTION

**Supabase migration version `20260930123113`, `photo_assets_p1_2026_09_29`**,
from `db/migrations/2026-09-29_photo_assets.sql`. Reviewed and applied by
ChatGPT, which verified the file's SHA256 independently before applying it:

```
fedb6e7f457f9a7e7568efefcb2116ca7ca1b38db113dd3b1d1bf47bdc887eef
```

(That is the file with LF line endings, which is what git stores. With
`core.autocrlf=true` and no `.gitattributes`, a Windows checkout is CRLF and
hashes differently — hash the committed blob.)

### Verified against the live database afterwards, not assumed

| | |
|---|---|
| totals | **37 tables, 549 columns, 13 public functions, 56 public RLS policies** |
| `photo_assets` | exists, **38 columns, 0 rows**, RLS enabled |
| `photo_usages` | exists, **15 columns, 0 rows**, RLS enabled |
| `tenant_id` on both | `uuid NOT NULL`, **NO DEFAULT** |
| policy on both | `Tenant members manage` is the **only** policy |
| grants on both | `anon`: none. `authenticated`: SELECT. `service_role`: none. `postgres`: owner. |
| parent targets | `photos_id_tenant`, `albums_id_tenant`, `blog_posts_id_tenant`, `catalog_items_id_tenant`, each `UNIQUE (id, tenant_id)` |
| `photo_assets` constraints | `photo_assets_pkey`, `photo_assets_id_tenant`, `photo_assets_tenant_fk` ON DELETE CASCADE, `photo_assets_created_by_fk` ON DELETE SET NULL, `_state_known`, `_alt_source_known`, `_alt_source_present` |
| `photo_usages` constraints | `photo_usages_pkey`, `_tenant_fk` ON DELETE CASCADE; `_asset_fk` **(asset_id, tenant_id) → photo_assets(id, tenant_id) ON DELETE RESTRICT**; `_photo_fk`, `_album_fk`, `_post_fk`, `_product_fk`, each composite on `(parent, tenant_id)` ON DELETE CASCADE; `_kind_known`, `_scope_known`, `_scope_by_kind`, `_page_key_shape`, `_one_parent` |
| slot indexes | all seven partial unique indexes live: `photo_usages_slot_gallery`, `_cover`, `_section`, `_legacy`, `_story_cover`, `_story_block`, `_shop` |
| supporting indexes | live |
| `photos.asset_id` | nullable `uuid`, **no foreign key** (P4 adds it) |
| `site_images.asset_id` | nullable `uuid`, **no foreign key** (P4 adds it) |

The pre-P1 totals were 35 / 494 / 13 / 54. The difference is exactly the
migration: +2 tables, +55 columns (38 + 15 + two `asset_id`), no function, +2
policies.

### Live smoke tests, run in production and cleaned up

1. **Cross-tenant asset protection.** A usage on site A pointing at site B's
   asset was refused by PostgreSQL with SQLSTATE `23503`.
2. **The tenant-deletion graph.** A temporary tenant with an asset and usages
   was deleted; afterwards tenant = 0, asset = 0, usages = 0. The tenant
   CASCADE and the asset RESTRICT therefore compose in production exactly as
   they did in the local rehearsal — the question P1 was told to measure rather
   than reason about.
3. **RLS.** Temporary assets on two sites. As an ordinary signed-in
   photographer: own assets 1, foreign assets 0, unfiltered visible 1. The same
   account as platform admin: 2.

All smoke-test rows were removed: production holds **0** rows in both tables.

### Advisors, after deployment

**Security:** no P1-specific finding. **Performance:** informational only —
the new indexes show as unused (expected at zero rows); several of
`photo_usages`' composite foreign keys, and `photo_assets.created_by`, are
reported as lacking a covering index. **Deliberately not acted on**: recorded
in `claude/open-items.md` for a measured review once P2/P3 put rows in the
tables. Some existing leading-column and partial indexes may already serve the
real query and delete shapes; that is a question for query plans, not for the
advisor.

### The reconciliation

`db/schema-2026-09.sql` and `db/test-fixture.sql` were updated in the same
sitting, with every P1 statement **copied from the migration** — including the
CHECK predicates, verbatim, unlike the survey-era ones this file lists as
reconstructed. The rebuilt fixture was counted: 37 / 549 / 13 / 56, RLS on all
37, 0 rows in both tables — production's figures.

`scripts/fixture-matches-migration.sh` now guards P1 as it guards the queue and
analytics: it builds the fixture, records every fact about **both new tables
and all five parents P1 altered** (compared whole, so it also proves the
migration changed nothing else on a parent), strips exactly what P1 added,
lets the migration rebuild it, and diffs — 435 P1 facts. Shown to bite before
it was trusted, on a slot index missing `position`, a guessing tenant default,
an extra INSERT grant, a changed `aspect_ratio` rounding, a missing
`albums_id_tenant`, and a parent target with its columns reversed.

`db/verify-tenant-isolation.sql` gained the photo tables — own site reads its
rows, a foreign site reads 0 and still reads its own, anon and service_role are
refused by privilege, a platform admin reaches across — now 25 checks. It was
deliberately NOT touched before deployment, when the fixture had no such tables.

---

## 2026-09-29 — two things found while updating these files

Recorded rather than corrected, per the standing rule: show the discrepancy and
establish which represents production before changing anything. Both are now
closed: the policy count on 2026-09-29, the draft suite on 2026-10-12.

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

### `db/verify-draft.sql` was broken since the fixture was regenerated — HISTORICAL, RESOLVED 2026-10-12

*Historical record, kept as found on 2026-09-29.* It failed on a clean build,
and had done since the S1 regeneration earlier the same day — it was simply
never in the loop:

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

**Resolution, 2026-10-12 (local only; the suite changed, the fixture and the
schema snapshot did not).** The suite now:

- **clears the seeded row inside its own transaction** — block 1 deletes tenant
  A's `site_draft` row and checks it is gone before writing its own, so "exactly
  one draft" is measured from zero; the closing rollback restores the seed;
- **pins `updated_at` to a known old timestamp** (`2000-01-01 00:00:00+00`) on
  that insert, so "the trigger moved it later" holds under either trigger body
  (the fixture's `now()` or production's `clock_timestamp()`) and still fails
  with no trigger;
- **measures publish history as a count delta** (after minus before = +1)
  rather than an absolute count;
- **adds own-tenant positive controls** — as `authenticated`, still in its own
  site, the account must read and write its draft (1 row each) — so the
  cross-site zeros are attributable to the tenant policy rather than to a
  missing grant or a deny-all policy;
- **records a privilege refusal or a NULL result as an explicit failure**
  (`permission denied` / `no row`, and `coalesce(pass, false)` in the count)
  instead of aborting or passing silently.

It passed **9 of 9**, twice, in independent runs. Six scratch-database
mutations each failed the assertion expected of it: an open policy, the `updated_at` trigger missing, the `site_draft` primary key
missing, the `site_template_history` action check missing, the grants
missing, and a deny-all policy. It is now in the standard SQL run.
