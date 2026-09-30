# S4 — Analytics instrumentation

## DEPLOYED TO PRODUCTION 2026-09-29

**Supabase migration version `20260929231653`,
`analytics_instrumentation_2026_09_29`.** The committed file's SHA256 was checked
before it was applied:

```
c1acb1ae3a68c21094622820c768343e1e5fba63de6ee2f769ba5d4ddd4bfbdf
```

Reconciled into `db/schema-2026-09.sql`, `db/test-fixture.sql` and
`db/schema-verified.md` in the sitting after, and `scripts/fixture-matches-migration.sh`
now guards `page_views` as well as `jobs`. **The application code is pushed after
this**, deliberately, so the app is never live against a schema without these
columns.

Done now rather than later for one reason: **traffic cannot be reconstructed.**
Everything else on the roadmap can be built next month against the same data. A
week of visits nobody wrote down is gone.

### The preflight, run immediately before

| | |
|---|---|
| `page_views` total | **77** |
| album only | 54 |
| post only | 23 |
| both album and post | **0** |
| neither | **0** |
| rows failing the new identity rule | **0** |

No blocker: every existing row could be attributed to a site, and every one
already satisfied the constraint that was about to be added.

### Verified against the live database afterwards

All 77 rows still there, all with `tenant_id` populated, **0** ownership
mismatches, **0** identity failures, and the five new metadata columns still NULL
on every legacy row. RLS enabled with `Tenant members manage` as the only policy;
`"Anyone can record a view"` gone. Grants: `anon` none, `authenticated` SELECT,
`service_role` SELECT and DELETE, **no direct INSERT for anybody**.
`record_page_view` DEFINER, `search_path = ''`, returns uuid, EXECUTE to
`service_role` only, carrying the final nullable-session behaviour. The full
table is in `db/schema-verified.md`.

**And a live smoke test as `service_role`:** the homepage, `page_key = home`,
`device = desktop`, `referrer_host = instagram.com`, **`session_hash = NULL`**.
The row was created, then deleted; `page_views` returned to exactly 77. That it
used a NULL session is the point of it — see *A missing session is not a missing
view* below.

**Counts after:** 35 tables, 494 columns, 13 functions, **54 policies**, RLS on
all 35. One policy FEWER than before, which is the change rather than an error in
it.

**Advisors:** no S4-specific security finding. The two new indexes report as
unused, expected immediately after creation.

---

## What the old system was

One table, `page_views`, five columns: `id`, `album_id`, `post_id`,
`visitor_hash`, `viewed_at`. One writer, `app/api/view/route.ts`, which took
`{ albumId, postId }` from the browser, hashed `ip | user-agent | today` and
inserted. One component, `components/ViewTracker.tsx`, dropped **by hand into
two pages**: `app/trips/[slug]/page.tsx` and `app/journal/[slug]/page.tsx`.

So the whole of what was counted was: somebody opened a gallery, somebody opened
a story. Of the nine public addresses a site has, **two recorded anything**:

```
  NOTHING   /              NOTHING   /trips
  NOTHING   /about         NOTHING   /shop
  NOTHING   /contact       NOTHING   /weddings   (any custom page)
  NOTHING   /journal
  recorded  /trips/public-gallery
  recorded  /journal/first-light
```

The admin overview said so in its own type, which is the honest version of a
dashboard that cannot answer *how many people came to my site this week*:

> `/** Views of those galleries and stories. NOT every page of the site — the
> site's own pages are not instrumented, and saying "page views" without saying
> which pages is the kind of number nobody can act on. */`

Read by two places, both admin-only: `lib/admin/overview.ts` (the audience
tile) and `app/admin/trips/[id]/stats/page.tsx` (one gallery's 30 days).

**And it was wide open.** The table's policy was `for insert with check (true)`
and `anon` held INSERT. Anybody at all, no account needed, could POST to
PostgREST and write a row naming **any gallery on the platform** with any
visitor hash and any timestamp. Measured, by restoring the old grant and policy
inside a transaction and trying it as `anon`:

```
PRE-S4  anon writing a view against another site's gallery: ACCEPTED
PRE-S4  rows it left behind: 1
POST-S4 the same insert: refused: permission denied for table page_views
```

Nothing read those rows as a security decision, so the consequence was numbers
rather than access. That is a reason it was never noticed, not a reason it was
all right.

---

## The schema, after

Six columns added to `page_views`. Nothing dropped, renamed or repurposed;
`album_id`, `post_id`, `visitor_hash` and `viewed_at` keep their names, their
types and their meanings.

| column | |
|---|---|
| `tenant_id uuid not null` | FK to `tenants` ON DELETE CASCADE. **Backfilled from each row's album or story.** |
| `path text` | a pathname. No query string, no fragment, no host. |
| `page_key text` | `home` `about` `contact` `journal` `galleries` `shop`, or `p_xxxxxxxx`. Null for a gallery or story, whose identity is already `album_id` / `post_id`. |
| `referrer_host text` | a bare host. No scheme, no port, no path, no search. |
| `session_hash text` | 16 random bytes as hex, **or null** when the browser would not keep one. |
| `device text` | `phone` \| `tablet` \| `desktop`. |

### `tenant_id` was not on the list, and the feature does not work without it

`page_views` had no site of its own. A row hung off an album or a story and RLS
reached the site *through that parent*:

```sql
using ( tenant_of('albums', album_id) = current_tenant_id()
     or tenant_of('blog_posts', post_id) = current_tenant_id() ... )
```

A homepage view has neither parent, so that policy is false for every such row
and **a photographer could not read their own homepage views at all**. The
feature would have been write-only: rows going in that nobody on the platform is
permitted to see. So the policy is now `tenant_id = current_tenant_id() or
is_platform_admin()` — replaced rather than added to, because the direct form
agrees with the old one on every row that exists (the backfill came from exactly
those parents) and also covers the rows S4 makes possible, which the old one
could not see.

### Seven CHECK constraints, and why they are a second copy

`record_page_view` says these things too. The function is the door; the
constraints are what the table *is*, and a future migration, a backfill or
somebody at a psql prompt goes round the door. Where the two disagree the table
wins, which is the right way round.

```
page_views_identity             num_nonnulls(page_key, album_id, post_id) = 1
page_views_path_is_a_path       '^/[^?#[:space:]]*$', ≤ 255
page_views_page_key_shape       the six built-ins, or p_[a-z0-9]{8}
page_views_referrer_is_a_host   a hostname with a dot in it, ≤ 253
page_views_session_shape        null, or exactly '^[0-9a-f]{32}$'
page_views_device_bucket        phone | tablet | desktop
page_views_visitor_is_a_hash    8–64 chars, no space @ / :, not all digits-and-dots
```

The last one is the one worth reading twice. **`visitor_hash` is where an IP
address would go** if somebody ever decided hashing it was inconvenient, so the
table refuses one: no colon rules out IPv6, `^[0-9.]+$` rules out IPv4, and no
space, `@` or `/` rules out a user-agent, an email and a URL.

### `tenant_id` NOT NULL was the one thing the migration could refuse to do

The backfill covers every row the application has ever written, because the old
route always required an album or a post. It could not cover a row somebody
POSTed by hand, which the open policy allowed. Such a row has nothing to
attribute it to, and the migration would not invent a site for it or quietly
delete it: it raises, names the count, and rolls back. Proved, by seeding one
such row:

```
ERROR:  S4: 1 page_views row(s) carry neither an album nor a story, so they
        cannot be attributed to a site. Nothing has been changed. …
```

and confirming nothing was applied — `tenant_id` did not even get added. The
preflight above is that query, and production answered 0.

---

## Two indexes, and the ones left out

```sql
create index page_views_tenant_time on page_views (tenant_id, viewed_at desc);
create index page_views_post_idx    on page_views (post_id, viewed_at desc)
                                     where post_id is not null;
```

`page_views_tenant_time` because every read after S4 begins the same way — this
site, this window — and every aggregate the analytics screen will want (views,
visitors, top pages, referrers, devices) is that scan followed by a group-by.
Without it one site's dashboard reads every other site's rows and throws them
away.

`page_views_post_idx` is **not new work**: `lib/admin/overview.ts` has run
`.in('post_id', postIds).gte('viewed_at', since)` since it was written, and
there has never been an index for it while its album twin has had one all along.
Partial, because page views will outnumber story views, so indexing the nulls
would be most of the index doing nothing.

**Left out on purpose,** and this is the discipline rather than an oversight:

- `(tenant_id, path, viewed_at)` — *top pages in a window* does not need it;
  that is a range scan on tenant+time and a group-by. It earns its place the day
  a screen asks about **one** path over time.
- `(session_hash, …)` — within-session funnels are why the column exists, but no
  query asks for one yet. The column is recorded now because history cannot be
  recovered; the index can be added in seconds, later, against data already
  there.
- `(referrer_host, …)`, `(device, …)` — three values and a few dozen. A group-by
  reads them off the rows it already has.

### And a lesson about testing a plan

The assertion for these is `set local enable_seqscan = off` and then look for
the index name, because at fixture scale a sequential scan over eight hundred
rows is genuinely the right plan — measured, both queries are `Seq Scan` with
scans allowed. So what is asserted is that the index **can serve the query
shape**, which is what a wrong column order or a bad partial clause gets wrong.
Whether production's planner prefers them is a question about volume, answered
by the advisor's "unused index" report after real traffic.

The first version of that block put all four hundred story views on the
fixture's single story, which made `post_id = <that story>` match half the table
— not selective at all — so the planner's choice between the two indexes was a
near-tie decided by rounding. Adding two unrelated rows in another block flipped
it, and the assertion began reporting a `Bitmap Index Scan on
page_views_tenant_time` as a failure. **The test was wrong, not the index.** The
views are now spread over ten stories, which is the shape `overview.ts` actually
queries, and the plan is no longer a tie. Deterministic over repeated runs
afterwards.

---

## The tracking flow, after

```
  the browser                     the server
  ───────────                     ──────────
  usePathname() changes
  path = cleanPathname(…)    ──►  path reduced again
  skip /admin /edit /preview      currentSite()  → tenant, from the Host header
       /gallery/ /review/         identify(path) → this site's own pages,
       /shop/ /api /_next                          galleries and stories
  session from sessionStorage     device  ← one of three words from the UA
    (null if blocked — still      visitor ← sha256(ip | UA | today)
     sends)                       ▼
  ref = host of document.referrer record_page_view(...)   ── SECURITY DEFINER,
  POST { path, session, ref }                                service_role only
```

**The browser sends three fields, and not one of them identifies anything.** The
site comes from the address the request arrived on, which a visitor cannot
forge. The page comes from looking the pathname up in *this site's* pages,
galleries and stories — so another photographer's gallery is not at any address
here and the lookup simply does not find it. **The spoof cannot be expressed
rather than being caught.** And the `path` that gets stored is written back out
from what was found, never echoed, so the slug in the row is the slug the album
row carries.

The body is built by one exported function, `visitBody(path, session, ref)` in
`lib/analytics/visit.ts`, so the shape can be asserted by calling it rather than
by reading a literal — and so the "session is optional" rule lives in one place.

Mounted **once**, in `app/layout.tsx`, inside the branch that has a site. The
public pages are not under a shared segment — `app/page.tsx`, `app/about`,
`app/contact`, `app/journal`, `app/trips`, `app/shop` and `app/[slug]` are
siblings at the top, alongside `app/admin`, `app/edit` and `app/preview` — so
the only layout all the public ones share is the root one, which the private
ones share too. A route group would move seven directories and every import
pointing into them to make a mount point tidier. The invariant is held instead
by `isTrackablePath`, and held a second time by the server, which refuses an
address that is not a page of the site whatever asks it to.

`usePathname()` is a hook, so the component re-renders on a client-side
navigation even though the layout does not, and a ref holding **the last address
sent** (not a "have I run" flag) is what makes it once per page rather than once
per mount.

### Two things the old placement got for free

A **password-protected gallery** shows a password box, not photographs. The old
tracker was rendered below that gate so it never fired; the new one is mounted
site-wide and cannot see the gate, so the gate is re-checked when the view is
recorded — the same `album_access_<id>` cookie, read from the same request.
Otherwise every locked gallery would start accumulating views nobody had. Same
for a `client_only` gallery and a **draft story**, neither of which is served at
that address at all.

---

## `visitor_hash` and `session_hash` are opposites

| | `visitor_hash` | `session_hash` |
|---|---|---|
| what it is | `sha256(ip \| user-agent \| YYYY-MM-DD)`, first 32 chars | 16 random bytes, hex |
| made where | the server, per request | the browser, per tab |
| kept where | nowhere — both inputs are discarded | `sessionStorage`, gone when the tab closes |
| derived from | the request | **nothing** |
| answers | how many people, within one day | did this visit go from the homepage to a gallery |
| lifetime | rotates at midnight, so nobody is followed across two days | the visit |
| when unavailable | cannot be — it comes from the request | **null, and the view is still recorded** |

`visitor_hash` is **unchanged from before S4**, deliberately, so the
unique-visitor counts either side of the deployment mean the same thing.

`sessionStorage` rather than the two obvious alternatives: a **cookie** would be
sent on every request including images, would need a consent banner in most of
the world, and would outlive the visit — which is the definition of the thing
this is not. **`localStorage`** is worse: permanent, so the "session" id would
quietly become a durable identifier for one person across months, which is how
an analytics feature turns into tracking without anybody deciding to.

### A MISSING SESSION IS NOT A MISSING VIEW

This is the correction made after the first review, and it is worth stating on
its own because the first version got it backwards.

`sessionStorage` throws outright in a Safari private window and wherever a
browser has site data blocked. The first version treated that as a reason to
record **nothing** — no id, no request, no row. That is systematic undercounting
of exactly the people most likely to have blocked storage, and it made a funnel
feature a precondition for the basic count. `session_hash` exists for
within-visit funnels; the page view does not depend on it.

So:

| | |
|---|---|
| storage works | mint or reuse the 16-byte id, record it |
| storage throws, is blocked, or forgets | **record the page view anyway**, with `session_hash = null` |
| an id of the wrong shape arrives | send and store null, not the bad value |
| a cookie, `localStorage`, or anything derived from the request | **never** |

Three places enforce it: `visitBody()` sends null rather than dropping the
request, the route accepts a null session and holds a non-null one to the exact
shape, and `record_page_view` accepts `p_session is null` while refusing
anything else that is not 32 **lower-case** hex characters. `~` is
case-sensitive in Postgres, so upper-case hex is refused on purpose — one
canonical spelling, or the column cannot be grouped by.

Optional means "may be absent", not "may be anything". A view with no session
is a whole view: `visitor_hash`, `device`, `path` and the identity are all
there, because none of them comes from browser storage. **Production's smoke
test was exactly this case**, and it recorded.

---

## Privacy, as rules rather than intentions

Not stored, and each one has an assertion behind it: raw IP, full user-agent,
full referrer URL, query string, analytics cookie, `localStorage` identifier,
any fingerprint (canvas, fonts, hardware), email or account id, any cross-site
identifier. No country or location in this phase. No third party.

Three mechanisms, and the order matters: **the browser reduces before it sends**
(a pathname, not a URL; a hostname, not a referrer), so the discarded part never
crosses the wire; **the server reduces again**, because what arrives over a
network is never what was sent; and **the table refuses the discarded shapes
outright**, so no future writer can put them back.

One thing carried over unchanged and worth stating: the day in `visitor_hash` is
a **bucket, not a secret**. The hash is a function of public inputs, so given an
IP and a user-agent it can be recomputed. Rotating daily is what limits that.
Left as it is by this phase — see *Found and not fixed* below.

---

## RLS and grants

```
page_views   anon           nothing at all
             authenticated  SELECT            (narrowed by RLS to their own site)
             service_role   SELECT, DELETE
             policy         Tenant members manage / ALL
                            tenant_id = current_tenant_id() or is_platform_admin()

record_page_view            SECURITY DEFINER, search_path = ''
                            EXECUTE: service_role only
```

**No INSERT for anybody, including `service_role`.** The function is DEFINER, so
the row is written with the owner's rights, and the absence of the grant is what
stops the admin client from going round the validation. The browser has no
database path to analytics whatsoever, not even a narrow one — which is stricter
than the queue, where a photographer holds EXECUTE on `enqueue_jobs`.

Stated by revoking from `public`, `anon`, `authenticated` and `service_role`
first. **A grant is additive**, and that lesson cost S3 an afternoon. An
assertion reads the grants back out of `information_schema` and compares the
whole string, so the migration's header and its SQL cannot drift apart again —
they had, once, and the comment was corrected in the same round as the session
fix.

### The grant bug this found

The first version granted `service_role` DELETE and not SELECT, reasoning that
the route writes through the function and nothing else needs to look.

`app/actions/sites.ts` `deleteSite()` runs `delete from page_views where
tenant_id = $1`. **A filtered DELETE reads the column it filters on**, so DELETE
without SELECT fails with *permission denied for table page_views* — and
`deleteSite` swallows only errors matching `/does not exist/`, which that one
does not, so deleting a site would have reported *"rows may remain in
page_views"* for ever.

Found because `db/verify-analytics.sql` runs that block as the real role. As the
table's owner it passes either way. Same shape as S3's defect, found the same
way.

### And the call that has never worked

`page_views` has been in `deleteSite`'s `TENANT_TABLES` all along, deleting by
`tenant_id` — a column that did not exist. PostgREST answered *column
page_views.tenant_id does not exist*, which matches the *"a table that does not
exist on this deployment is not a failure"* guard, so it was silently skipped
every time. Nothing was left behind, because `page_views.album_id` cascades from
`albums` and the albums were deleted a few lines later. **It works now**, and the
FK cascade from `tenants` is there as a backstop for a path nobody thought of.

---

## Files

**The implementation**

| | |
|---|---|
| `db/migrations/2026-09-29_analytics.sql` | new — the whole schema change |
| `db/verify-analytics.sql` | new — 76 assertions, the database boundary |
| `.mk/analytics.ts` | new — 295 assertions, everything above the database |
| `lib/analytics/visit.ts` | new — the reductions and `visitBody`, shared by browser and server |
| `lib/analytics/session.ts` | new — the tab-scoped id, store injected |
| `lib/analytics/pages.ts` | new — the tracked built-ins, derived from `PAGES` |
| `lib/analytics/record.ts` | new — resolution and the write |
| `app/api/view/route.ts` | rewritten |
| `components/ViewTracker.tsx` | rewritten — path-driven, mounted once |
| `app/layout.tsx` | mounts it |
| `app/trips/[slug]/page.tsx`, `app/journal/[slug]/page.tsx` | the hand-placed trackers removed |
| `lib/admin/overview.ts`, `app/admin/trips/[id]/stats/page.tsx` | `.eq('tenant_id', …)` added to three reads |
| `scripts/check-tenant-scoping.mjs` | `page_views` added to `SCOPED` |

**The reconciliation, after deployment**

| | |
|---|---|
| `db/schema-2026-09.sql` | 1,738 → 2,054 lines: the six columns, the tenant FK, seven CHECKs, two indexes, the replaced policy, the narrowed grant block, `record_page_view`, and the header counts |
| `db/test-fixture.sql` | 1,826 → 2,152 lines: the same, plus `tenant_id` on the two seeded views, because the column is NOT NULL |
| `db/schema-verified.md` | 535 → 651 lines: the deployment record, the preflight, every verified fact, the smoke test, the advisors |
| `scripts/fixture-matches-migration.sh` | 132 → 231 lines: guards `page_views` as well as `jobs` |

No new environment variable. `SUPABASE_SERVICE_ROLE_KEY`, already required and
already set, is what the route writes through; without it the route stops
recording and keeps serving.

---

## Tests

| | |
|---|---|
| `db/verify-analytics.sql` | **76**, all passing |
| `.mk/analytics.ts` | **295**, all passing |
| `scripts/fixture-matches-migration.sh` | **403** facts for `jobs`, **175** for `page_views` |
| `db/verify-jobs.sql` | 107 |
| `.mk/jobs.ts` | 64 |
| `scripts/jobs-concurrency.sh` | 17 |
| `db/verify-tenant-isolation.sql` | 14 |
| `.mk/section-values.ts` · `settings` · `textvars` · `perdevice` · `blockable` · `preview-chrome` | 1557 · 408 · 94 · 75 · 749 · 31 |

`tsc --noEmit` clean, eslint clean on every file S4 touches, `check:tenants`
passes, `sandbox-build.sh` reports `BUILD EXIT: 0`. Three clean rounds of every
suite against the reconciled fixture; both migrations still apply on top of it
twice with no error.

### The drift guard, extended

`scripts/fixture-matches-migration.sh` used to cover `jobs` only. It now does
both, and the interesting part is that the two tables need opposite treatment.

`jobs` is dropped outright, because the fixture seeds none and nothing points at
it. **`page_views` cannot be** — S4 is an ADDITIVE migration over a table that
existed before it, so dropping the table would leave the migration with nothing
to alter and it would fail on the first `alter table`. What gets dropped instead
is everything S4 *added*: the policy first (a column cannot be dropped while a
policy names it), then the six columns, which takes their CHECKs and indexes with
them, then the function, then the grants back to their pre-S4 breadth. Then the
migration puts it all back and the facts are compared.

Shown to bite twice: making the fixture's session CHECK case-insensitive, and
adding a fourth device bucket. Each reported as drift with a clean diff and
exit 1; reverting each restored exit 0.

### And it found something — which was the guard's own fault

The first version compared each column's raw `attnum`. Dropping six columns and
letting the migration add them back leaves gaps, so the rebuilt ones came back as
**12–17 where the fixture had 6–11** — identical names, identical types,
identical order, reported as drift. And the same would have been true between the
two databases anyway: production reached those columns by `add column` (6–11)
and the fixture declares them inline (1–11), so the raw numbers were never
comparable.

Position is now compared as a **rank among the live columns**, which still
catches a reordering and is immune to the drop. Dropping the position from the
comparison altogether would have been the easy fix and the wrong one.

### The assertions were shown to bite

A green suite on its first run is not evidence, so each mutation below was
applied, the suite run, and the mutation reverted:

| mutation | caught |
|---|---|
| phones tested before tablets in `deviceFrom` | 4 |
| query string not stripped in `cleanPathname` | 3 |
| `isTrackablePath` allows the editor and share links | 10 |
| the password gate not re-checked | 2 |
| the `client_only` check removed | 2 |
| the migration's page map drifts from `PAGES` | 1 |
| the tracker starts sending an `albumId` again | 1 |
| `liveLookups` drops `.eq('tenant_id', …)` | `check:tenants` fails |
| the harness's album lookup drops its tenant filter | 2 — **after a fix, see below** |
| the tracker returns early again when there is no session | 1 |
| `visitBody` passes a malformed session through | 6 |
| the SQL goes back to refusing a null session | 40+ |
| the fixture's session CHECK becomes case-insensitive | drift guard, exit 1 |
| a fourth device bucket in the fixture | drift guard, exit 1 |

**And one of them found a hole in the suite rather than in the code.** Dropping
the tenant filter from the album lookup passed 215/215: the resolver handed the
database a cross-tenant album, the database refused it, no row was written, and
`ok === false` looked like success. The assertion was satisfied for the wrong
reason. It now asserts **`why`** — `'not-a-page'`, meaning it never became an
identity at all, as distinct from `'refused'`, meaning the database had to catch
it — and `identify()` is asserted to return null directly. With that, the
mutation fails.

That is the whole argument for mutating a green suite: the defence in depth was
real and working, and it was hiding a test that could not tell which layer did
the work.

The session-optional rule has its own assertions: the same id survives
same-tab navigation; a store that throws and a store that forgets both yield no
id; the page view is recorded anyway with `session_hash` null, for **all nine
page kinds** round-tripped through the real function; six malformed ids are
dropped rather than sent; the body is exactly three fields; the tracker uses
`visitBody` and builds no body of its own; and — a negative assertion about
control flow, in the file where the regression would go — there is **no early
return between the session call and the fetch**.

---

## Found and not fixed

1. **`visitor_hash` has no secret in it.** `sha256(ip | ua | day)` is a function
   of public inputs, so anybody with the table and a candidate IP can confirm a
   match. Daily rotation limits it to one day's window. Preserving the current
   privacy model was an explicit requirement of this phase, so it is unchanged —
   but a server-side pepper (`ANALYTICS_SALT`, mixed in alongside the day) would
   close it without changing the rotation or any count, and is a small, separate
   change. **Recorded in `claude/open-items.md`.**

2. **A single print's page (`/shop/<photo id>`) is not tracked.** Its identity is
   a photograph id; there is no column to hold or validate one, and an
   unvalidated id inside `path` is exactly the boundary S4 exists to close. The
   shop's front page **is** tracked. Two honest ways forward — a fourth identity
   column, or a `catalog_listing` page kind — and neither belongs in this phase.
   **Recorded in `claude/open-items.md`.**

3. **The audience tile still counts galleries and stories only.** `page_views`
   now holds homepage and About views, and widening that number is a decision
   about what a dashboard claims, not a side effect of a migration. The field's
   own comment stays true until somebody makes it.

4. **`page_views_visitor_is_a_hash` is looser than what the route writes.** The
   route writes 32 hex characters; the constraint allows 8–64 of anything that
   is not an address or a user-agent, because `db/test-fixture.sql` seeds
   `hash-one` and `hash-two` and **a migration that cannot be rehearsed against
   the fixture is a migration that gets applied untested**. Tightening it now
   means a migration in production and two seed values in the fixture — small,
   separate, and not urgent, because the negative clauses are what actually keep
   an address out.

5. **The route handler is not exercised end to end locally.** There is no
   Supabase and no running server in the sandbox, so what is proven is every
   function it composes — including against a real Postgres carrying the
   fixture — and not the composition. Same position S3's drain route was in. The
   one thing this left genuinely unverified was `currentSite()` inside a route
   handler; production's smoke test exercised `record_page_view` but not the
   route around it, so this is closed only once the code is deployed and a real
   view appears.

6. **`db/verify-draft.sql` is still broken** from the S1 fixture regeneration.
   Unrelated, unchanged, still open, and deliberately untouched by this
   reconciliation.

---

## Corrections after review

Two, both made 2026-09-29 (late), before deployment.

**1. A missing session no longer costs the page view.** Written up in full above.
The only executable SQL that changed is one condition in `record_page_view`,
verified by diffing the two versions with comments stripped:

```
- if p_session is null or p_session !~ '^[0-9a-f]{32}$' then
-   raise exception 'record_page_view: session id must be 32 hex characters';
+ if p_session is not null and p_session !~ '^[0-9a-f]{32}$' then
+   raise exception
+     'record_page_view: a session id must be 32 lower-case hex characters, or null';
```

Nothing else in the migration's SQL differed. `page_views.session_hash` was
already nullable, so the column did not change. Production's smoke test then
used a NULL session, which is why that test is the one worth having run.

**2. A stale comment in the migration header** said `anon` and `authenticated`
were both left with SELECT. The SQL was right and the prose was not: `anon` has
nothing at all, `authenticated` has SELECT, `service_role` has SELECT and
DELETE. Comment only. Worth noting that the assertion which compares the whole
grant string against `information_schema` was already passing — the drift was
between the header and the statements, which is the kind a test cannot see and a
reader can.

---

## Reconciled, and what comes next

The three production-truth files and the drift guard are updated, so what this
repository believes about the database matches what the database is. The counts
in both schema headers read **35 tables, 494 columns, 13 functions, 54
policies**, and the policy figure going DOWN by one is recorded as the change
rather than as an error in it.

One thing corrected in passing: both headers had said 54 policies after the
queue, which was the transcription error already established and closed in
`db/schema-verified.md` — the correct figures are 54 before the queue, 55 after
it, and 54 again after analytics.

**The application code is committed and pushed** (2026-09-30). The database went
first and was verified; the code followed, so the app was never live against a
schema without these columns.

No P1, P2, photo-asset, AI or embedding work. Nothing in the upload flow, the
Instagram schedule, the newsletter or the queue was touched, and
`db/verify-draft.sql` was left exactly as it was.
