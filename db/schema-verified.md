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

**Shape.** 34 tables in `public`, 473 columns, RLS enabled on all 34, 53
policies, **9 functions**, one trigger (`site_draft_touch` on `site_draft`), and
no trigger anywhere else.

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

## 2026-09-29 — `jobs`, written but NOT YET IN PRODUCTION

`db/migrations/2026-09-29_jobs.sql` creates the `jobs` table, two functions
(`claim_jobs`, `finish_job`), four indexes and the usual tenant policy. It has
been **rehearsed against this fixture and nothing else**.

**`db/test-fixture.sql` deliberately does not contain it.** The fixture's whole
value is that it is a faithful copy of production, and production does not have
this table yet. A fixture that runs ahead of production is the same defect as
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
| `db/verify-jobs.sql` | 48 of 48 |
| `scripts/jobs-concurrency.sh` | 14 of 14 |
| `.mk/jobs.ts` (the worker, against this database) | 41 of 41 |

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
