# Photo assets and photo usages — technical design

**Status: APPROVED IN PRINCIPLE, 2026-09-29.** The tables of §1–§3 are
**deployed** (P1, Supabase `20260930123113`) and so is the ingestion boundary of
§9 (P2, Supabase `20260930191116`), both 2026-09-30: every real photograph
upload now writes its asset. **P3** (deployed 2026-10-01) READS the assets: its
projection resolves usages through them and through `photos.asset_id`. Nothing
that RENDERS reads them — pages, pickers and the editor still use the legacy
paths until P5's resolver. **P4** (§10) is deployed and accepted (Supabase
`20261005192303` and `20261006012958`, 2026-10-05/06): every legacy photograph
has its asset, and `photos.asset_id` / `site_images.asset_id` carry their keys;
its repository closure (final review and commit) is pending. P5–P6 (resolver,
deletion) remain; P5 is paused, not started. The build order is in
`claude/photo-migration-plan.md`.

Revision 8. Not to be redesigned again unless implementation reveals a concrete
contradiction in the real codebase.

---

## Revision history

| rev | change | reason |
|---|---|---|
| 1 | first design | — |
| 2 | usages become a projection; typed FKs; furniture excluded; analysis versioned separately | `replaceSections` is delete-then-insert and five other writers rewrite whole documents |
| 3 | usages read-only; `library` removed; `gallery` parents on `photos.id`; `content_sha256`; state drops `analyzed`; `photo_analysis` deferred; videos out; accessibility role on the field | Gonzalo's review |
| 4 | per-kind partial unique indexes; `alt_effective` removed; composite tenant-aware foreign keys; `sort_order` mirror removed; video fields removed from projection and backfill | Gonzalo's review |
| 5 | cascade question closed against production; status raised to approved | Gonzalo ran the constraint inspection, 2026-09-29 |
| **7** | **P2 ingestion boundary (§9)**: four route-specific SECURITY DEFINER wrappers over one uncallable internal upsert; atomic per route; idempotent and lock-serialised; failure hardening with checked cleanup; normalised EXIF with a 1 KB allowlisted `exif`; latitude/longitude only for gallery uploads; custom covers in scope with `original_path = NULL`; the accent mark excluded; §3.6's rationale corrected | the P2 orientation (2026-09-30) found four upload routes, all running as the photographer; decisions by Gonzalo |
| **8** | **P4 backfill (§10)**: a resumable CLI over narrow service-role RPCs replaces the queue; the closed legacy key grammar; flat files keep their exact display path and record no original; files verified by decoding; P3 stays the only usage writer; the resolver learns the flat era narrowly; the two asset keys behind a separate completeness preflight. Deployed 2026-10-05/06 (`20261005192303`, `20261006012958`) and accepted. | approved rulings 2026-10-05 and a review pass the same day |
| 6 | reconciliation before P1: no tenant default on either new table (§3.6); §3.2 corrected about the parents' defaults; the P1 privilege set stated (§3.7); a `page_key` CHECK matching `isPageKey()` (§2.2, §3.4); a tenant-deletion proof required (§3.5) | the P1 orientation compared this document with the repository, 2026-09-29; decisions by Gonzalo |

---

# 1. `photo_assets` — the canonical photograph

```sql
create table photo_assets (
  id              uuid primary key default gen_random_uuid(),
  -- NO DEFAULT, deliberately (rev 6): every writer names the tenant. §3.6.
  tenant_id       uuid not null references tenants(id) on delete cascade,

  -- ══ Identity and storage ═══════════════════════════════════════════════
  -- key_base identifies one UPLOAD and all its derivatives. It does not
  -- identify identical bytes uploaded again under a new uuid — that is
  -- content_sha256's job.
  key_base        text        not null,
  original_path   text        null,
  display_path    text        not null,
  derivatives     jsonb       not null default '{}'::jsonb,
  original_bytes  bigint      null,
  content_type    text        null,
  filename        text        null,
  content_sha256  text        null,     -- hex sha256 of the original bytes

  -- ══ Dimensions ═════════════════════════════════════════════════════════
  width           integer     null,
  height          integer     null,
  orientation     text        generated always as (
                    case when width is null or height is null then null
                         when width > height then 'landscape'
                         when width < height then 'portrait'
                         else 'square' end) stored,
  aspect_ratio    numeric(8,4) generated always as (
                    case when coalesce(height, 0) = 0 then null
                         else round(width::numeric / height, 4) end) stored,

  -- ══ Capture metadata ═══════════════════════════════════════════════════
  taken_at        timestamptz null,
  latitude        double precision null,
  longitude       double precision null,
  camera_make     text        null,
  camera_model    text        null,
  lens            text        null,
  iso             integer     null,
  aperture        numeric(4,1) null,
  shutter         text        null,
  focal_length    numeric(6,1) null,
  keywords        text[]      not null default '{}',
  exif            jsonb       not null default '{}'::jsonb,

  -- ══ The canonical description ══════════════════════════════════════════
  alt_text        text        null,
  alt_source      text        null,     -- 'photographer' | 'ai'
  alt_reviewed_at timestamptz null,

  -- ══ Ingestion state — FILE READINESS ONLY ══════════════════════════════
  state           text        not null default 'pending',
  derived_at      timestamptz null,
  last_error      text        null,

  -- ══ Lifecycle ══════════════════════════════════════════════════════════
  archived_at        timestamptz null,
  deleted_at         timestamptz null,
  original_purged_at timestamptz null,

  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint photo_assets_state_known
    check (state in ('pending','derived','failed')),
  constraint photo_assets_alt_source_known
    check (alt_source is null or alt_source in ('photographer','ai')),
  constraint photo_assets_alt_source_present
    check (alt_text is null or alt_source is not null),

  -- Target for the tenant-aware foreign key in §3.3.
  constraint photo_assets_id_tenant unique (id, tenant_id)
);

create unique index photo_assets_key on photo_assets (tenant_id, key_base);
create index photo_assets_sha        on photo_assets (tenant_id, content_sha256)
  where content_sha256 is not null;
create index photo_assets_library    on photo_assets (tenant_id, created_at desc)
  where deleted_at is null and archived_at is null;
create index photo_assets_unfinished on photo_assets (state)
  where state in ('pending','failed');
create index photo_assets_sweep      on photo_assets (deleted_at)
  where deleted_at is not null;
create index photo_assets_no_alt     on photo_assets (tenant_id)
  where alt_text is null and deleted_at is null;

select public.apply_tenant_policy('photo_assets');
-- Privileges are stated whole: §3.7.
```

---

# 2. `photo_usages` — a read-only projection

## 2.1 The rule

> **`photo_usages` is a derived index. It is written by `syncUsages()` and by
> nothing else.** Every value in it is a copy whose authoritative home is the
> document or relationship that owns the placement. Drop the table, re-run
> `syncUsages` over every document, and it comes back identical.

That last sentence is the test, and it is also the criterion for whether a
column may be mirrored at all — see §2.4.

## 2.2 Schema

```sql
create table photo_usages (
  id            uuid primary key default gen_random_uuid(),
  -- NO DEFAULT, deliberately (rev 6): every writer names the tenant. §3.6.
  tenant_id     uuid not null references tenants(id) on delete cascade,
  asset_id      uuid not null,

  scope         text not null default 'live',    -- 'live' | 'draft'
  kind          text not null,

  -- ── Typed parents. Exactly one is set, per the CHECK. ─────────────────
  photo_id      uuid null,
  album_id      uuid null,
  post_id       uuid null,
  product_id    uuid null,
  page_key      text null,                       -- 'home', 'p_a1b2c3d4'

  field         text not null,
  -- A SLOT DISCRIMINATOR, not an ordering. §2.3.
  position      integer not null default 0,

  -- ── MIRRORS. Written only by syncUsages. Never authoritative. §2.4 ────
  alt_override  text    null,
  decorative    boolean not null default false,

  created_at    timestamptz not null default now(),

  -- ══ Tenant-aware foreign keys. §3.3 ══════════════════════════════════
  foreign key (asset_id,   tenant_id) references photo_assets  (id, tenant_id)
    on delete restrict,
  foreign key (photo_id,   tenant_id) references photos        (id, tenant_id)
    on delete cascade,
  foreign key (album_id,   tenant_id) references albums        (id, tenant_id)
    on delete cascade,
  foreign key (post_id,    tenant_id) references blog_posts    (id, tenant_id)
    on delete cascade,
  foreign key (product_id, tenant_id) references catalog_items (id, tenant_id)
    on delete cascade,

  constraint photo_usages_kind_known check (kind in (
    'gallery','gallery_cover','page_section','page_legacy',
    'story_cover','story_block','shop_listing'
  )),
  constraint photo_usages_scope_known check (scope in ('live','draft')),

  -- The SQL twin of isPageKey() in lib/sections/pages.ts (rev 6, §3.4):
  -- a key of PAGES — `notfound` INCLUDED, because isPageKey() includes it and
  -- the 404 page has sections that can hold a photograph — or a photographer's
  -- page, CUSTOM_KEY = /^p_[a-z0-9]{8}$/. This is deliberately NOT the S4
  -- analytics set: record_page_view tracks visitable pages and excludes
  -- `notfound`. A placement is not a visit.
  constraint photo_usages_page_key_shape check (
    page_key is null
    or page_key in ('home','about','contact','journal','galleries','shop','notfound')
    or page_key ~ '^p_[a-z0-9]{8}$'
  ),

  -- Only pages have a draft layer. Albums, posts and the catalog do not, so
  -- a draft-scoped usage of those kinds would be meaningless.
  constraint photo_usages_scope_by_kind check (
    scope = 'live' or kind in ('page_section','page_legacy')
  ),

  constraint photo_usages_one_parent check (
     (kind = 'gallery'
        and photo_id is not null and album_id is null and post_id is null
        and product_id is null and page_key is null)
  or (kind = 'gallery_cover'
        and album_id is not null and photo_id is null and post_id is null
        and product_id is null and page_key is null)
  or (kind in ('story_cover','story_block')
        and post_id is not null and photo_id is null and album_id is null
        and product_id is null and page_key is null)
  or (kind = 'shop_listing'
        and product_id is not null and photo_id is null and album_id is null
        and post_id is null and page_key is null)
  or (kind in ('page_section','page_legacy')
        and page_key is not null and photo_id is null and album_id is null
        and post_id is null and product_id is null)
  )
);
```

## 2.3 Uniqueness — one partial index per slot shape

A ten-column `UNIQUE` over four nullable parent columns is `NULLS DISTINCT` by
default, so for a `page_section` usage — where all four parent columns are null
— two byte-identical rows would both be legal. Such a constraint looks like
protection and provides none, which is worse than no constraint, because nobody
writes a test for a guarantee they believe the database is giving.

**Partial unique indexes, one per kind.** The `photo_usages_one_parent` CHECK
guarantees the relevant column is `NOT NULL` for that kind, so **no index key
contains a nullable column** and NULL semantics never arise.

```sql
create unique index photo_usages_slot_gallery
  on photo_usages (photo_id)                             where kind = 'gallery';

create unique index photo_usages_slot_cover
  on photo_usages (album_id, field)                      where kind = 'gallery_cover';

create unique index photo_usages_slot_section
  on photo_usages (tenant_id, scope, page_key, position, field)
                                                         where kind = 'page_section';

create unique index photo_usages_slot_legacy
  on photo_usages (tenant_id, scope, page_key, field)    where kind = 'page_legacy';

create unique index photo_usages_slot_story_cover
  on photo_usages (post_id)                              where kind = 'story_cover';

create unique index photo_usages_slot_story_block
  on photo_usages (post_id, field, position)             where kind = 'story_block';

create unique index photo_usages_slot_shop
  on photo_usages (product_id)                           where kind = 'shop_listing';

create index photo_usages_asset on photo_usages (asset_id);
```

**Why not `NULLS NOT DISTINCT`.** It would work on PostgreSQL 15 and later, but
it is the wrong shape regardless: one ten-column index in which four columns are
always null for every row, wider and less useful than seven narrow ones. The
partial indexes are version-independent, and each doubles as the lookup index
for its kind.

| kind | slot | why |
|---|---|---|
| `gallery` | `photo_id` | one `photos` row is one membership |
| `gallery_cover` | `album_id`, `field` | an album has a cover photo *and* may have a custom cover path |
| `page_section` | `page_key`, `position`, `field` | **`position` is the section's ordinal on the page.** Two `intro` sections on one page both have an `image_path`, so page + field alone is not a slot. Section ids die at publish and positions are rewritten server-side to 0..n, so the ordinal is the stable discriminator within a rebuild |
| `page_legacy` | `page_key`, `field` | one settings column, one value |
| `story_cover` | `post_id` | one cover |
| `story_block` | `post_id`, `field`, `position` | `field = 'block:<blockId>'` (block ids are stable, `lib/blocks.ts`), `position` = index within that block's `images[]` |
| `shop_listing` | `product_id` | `catalog_items.photo_id` is already `unique` |

**`position` is a slot discriminator, never an ordering.** Order is read from
`photos.sort_order`, where it is authoritative — mirroring it would have exactly
the staleness problem §2.4 rejects.

## 2.4 Alt text is resolved, not materialized — and the rule that decides

`photo_assets.alt_text` changes independently of the documents that trigger a
rebuild, most obviously when the alt-text feature writes it in bulk. A
materialized effective value would therefore be stale with no rebuild to correct
it, and the only invalidation would be a fan-out re-sync of every usage of that
asset on every canonical alt write — write amplification the feature would hit
on its first batch run.

> **A value may be mirrored into `photo_usages` only if its authoritative source
> lives inside the document whose rewrite triggers the rebuild.** Anything that
> can change independently of that document must be resolved at read time.

| candidate | authoritative source | mirrored? |
|---|---|---|
| `alt_override` | the section's `<field>_alt` key / `BlockImage.alt` — **inside the document** | **yes** |
| `decorative` | the registry field's `accessibilityRole` — **in code** | **yes, with a stated invalidation** |
| `alt_effective` | partly `photo_assets.alt_text` — **outside** | no |
| `sort_order` | `photos.sort_order` — **outside** | no |
| `focal` | section settings — inside, but nothing in V1 reads the mirror | no (deferred) |

`decorative` is the one mirror whose source is not a document, and it is
mirrored because there is no alternative: the declaration lives in TypeScript
and a SQL query cannot join to it. Its invalidation is explicit and bounded —
**changing a field's `accessibilityRole` requires a re-sync job for that field**,
which goes on the deploy checklist. A rare, deliberate act, not an ordinary
write.

### Resolution order

```
usage.decorative === true   → alt=""
usage.alt_override          → the override
asset.alt_text              → the canonical description
otherwise                   → missing: empty alt, and a warning in the editor
```

### The "needs alt" query

```sql
select u.id, u.kind, u.page_key, u.post_id, u.album_id, u.field, a.id as asset_id
from photo_usages u
join photo_assets a on a.id = u.asset_id and a.tenant_id = u.tenant_id
where u.tenant_id = $1
  and u.scope = 'live'
  and u.decorative = false
  and u.alt_override is null
  and a.alt_text is null
  and a.deleted_at is null;
```

```sql
create index photo_usages_needs_alt on photo_usages (tenant_id, asset_id)
  where scope = 'live' and decorative = false and alt_override is null;
```

---

# 3. Tenant integrity

## 3.1 The hole this closes

`photo_usages.tenant_id` plus a plain `references albums(id)` does not prevent a
row with `tenant_id = A` pointing at an album owned by B. RLS would refuse that
write for a signed-in editor — but **the service-role client bypasses RLS**, and
the backfill, the jobs drain and any future admin tool all run under it.

## 3.2 What the parents look like

All four already have what is needed: `id uuid primary key` and `tenant_id uuid
not null`.

*Corrected in rev 6.* Earlier revisions said here that
`2026-09-24_no_guessing_tenant.sql` had dropped these four tables' defaults.
**It did not.** That migration drops only a `tenant_id` default naming
`default_tenant_id()`. Per `db/schema-2026-09.sql`, `photos`, `albums`,
`blog_posts`, `catalog_items` (and `site_images`) all still carry
`tenant_id uuid not null default tenant_for_insert()` in production; the five
tables that migration did change are listed in `db/schema-verified.md`
(*"NO DEFAULT on five tenant columns"*). Nothing in this design depends on the
parents' defaults, and **P1 does not change them** — that would be its own
decision. The new tables do not copy them: §3.6.

## 3.3 Tenant-aware composite foreign keys

```sql
alter table photos        add constraint photos_id_tenant        unique (id, tenant_id);
alter table albums        add constraint albums_id_tenant        unique (id, tenant_id);
alter table blog_posts    add constraint blog_posts_id_tenant    unique (id, tenant_id);
alter table catalog_items add constraint catalog_items_id_tenant unique (id, tenant_id);
-- photo_assets carries its own, declared inline in §1.
```

`photo_usages` then references `(parent_id, tenant_id)` — the five foreign keys
in §2.2.

- **Enforced by the planner on every write**, including service-role writes.
  Nothing bypasses it and no code has to remember it.
- **`MATCH SIMPLE`, the default, does exactly what is wanted**: a composite
  foreign key is not checked when any referencing column is null, so each parent
  key binds only when that parent is set, while `asset_id` — `NOT NULL` beside a
  `NOT NULL` tenant — always binds.
- **It matches the codebase's philosophy.** `apply_tenant_policy` exists because
  *"twenty tables were once given the same owner check by copy-paste"* and *"one
  definition, called from everywhere, is the fix"*.
- **Cost: four redundant btree indexes**, roughly 10 MB on `photos` at 200,000
  rows.

**Rejected:** a trigger calling the existing `tenant_of()` helper. It would
work, but a trigger is invisible at the point of the write — the specific
failure mode the ad-blocker and `.cv-sr` incidents both turned on. A foreign key
shows up in the table definition.

## 3.4 The residual hole, stated plainly

**`page_key` has no parent row and therefore no foreign key.** Mitigated, not
closed:

1. `syncUsages` derives `page_key` from a document already read under the
   caller's tenant; no path supplies a key from outside.
2. A CHECK on the key's format, `photo_usages_page_key_shape` (§2.2), the SQL
   twin of `isPageKey()` in `lib/sections/pages.ts`: a key of `PAGES`
   including `notfound`, or `CUSTOM_KEY`. **Required in P1** (rev 6), with a
   test that the two agree (§3.5). Consequence: a new built-in page now costs a
   line in this CHECK, as it already costs one in `record_page_view`'s map.
3. The nightly orphan sweep reports usages whose `page_key` is not in that
   tenant's `custom_pages` or built-in set.

Closing it properly means giving custom pages a real table — a much larger
change, and not one this migration should force.

## 3.5 Tests

Run as a role that **bypasses RLS**, so a pass proves the database's
constraints are doing the work and not a policy: a usage with tenant A and a
parent owned by B is rejected, for each of the five foreign keys; a tenant
mismatch against its own asset is rejected; updating a usage's `tenant_id` is
rejected; moving a parent row to another tenant while a usage points at it is
rejected. Each assertion names the constraint that refused, not merely that
something did.

*Rev 6, on which role.* Earlier revisions said "the service-role client". In P1
`service_role` holds **no privilege** on either table (§3.7), so its insert
would be refused by the grant layer before any foreign key was consulted —
proving nothing about the key. Until a later phase grants a writer, these
proofs run as the **table owner** (which also bypasses RLS), and the suite
separately asserts that `service_role` is refused by privilege.

Isolation, as the real roles: a photographer reads their own assets and usages,
a foreign tenant reads 0 of each, `anon` reads nothing (refused by privilege),
and a platform admin still reaches across.

**Tenant deletion (rev 6).** Deleting a tenant cascades to `photo_assets` and to
`photo_usages`, while `photo_usages.asset_id` is `on delete restrict`. Whether
that deletion succeeds is to be **measured, not reasoned about**: a throwaway
tenant, one asset, one valid usage of it; delete the tenant; assert the tenant,
the asset and the usage are all gone. If PostgreSQL refuses, P1 **stops** and
reports the exact behaviour — `restrict` is not changed and no P6 deletion code
is pulled forward without a decision. If it succeeds, the proof is recorded and
`deleteSite` / `TENANT_TABLES` stay at their approved phase boundary (P6).

**Page keys (rev 6).** The SQL CHECK and `isPageKey()` must give the same
answer for every key in `PAGES`, a well-formed custom key, and near-misses
(upper case, wrong length, missing `p_`, non-ASCII letters, a trailing newline,
the empty string, and an object-prototype name such as `constructor`).

## 3.6 No tenant default on the new tables (rev 6)

`photo_assets.tenant_id` and `photo_usages.tenant_id` are `uuid NOT NULL` with
**no default**. `tenant_for_insert()` is `coalesce(current_tenant_id(),
default_tenant_id())`, and under the service-role client there is no current
tenant, so it falls back to the **oldest tenant on the platform**. The backfill
and the job handlers run under that client. A forgotten tenant must fail as a
NOT NULL violation rather than land in somebody else's site — the same
reasoning as `jobs`, `page_views` and `2026-09-24_no_guessing_tenant.sql`.

*Corrected in rev 7.* Earlier text said ingestion also runs under the
service-role client. **It does not**: the four upload routes run as the signed-in
photographer (§9), and for a platform admin editing another site
`current_tenant_id()` is the admin's OWN site — so a default would guess wrong
there too. The decision stands; the reason given for ingestion was wrong. The
P2 wrappers take the tenant as an explicit parameter and validate it.

## 3.7 Privileges in P1 (rev 6)

For **both** tables, stated whole because a `grant` is additive:

```sql
revoke all on table public.photo_assets, public.photo_usages
  from public, anon, authenticated, service_role;
grant select on table public.photo_assets, public.photo_usages to authenticated;
```

| role | P1 |
|---|---|
| `public`, `anon` | nothing |
| `authenticated` | SELECT, narrowed by `Tenant members manage` to their own site; a platform admin reaches across |
| `service_role` | nothing |
| owner | owner privileges |

**No application role may INSERT, UPDATE or DELETE in P1**, because nothing
writes these tables yet, and there is no SECURITY DEFINER write function
either. Each later phase introduces the narrowest write capability it actually
needs, deliberately and in its own migration — P2 (ingestion) is the first.

---

# 4. Usage kinds, parents and fields

*P3 deployed 2026-10-01 (Supabase `20261001005946`, `20261001010021`): the
eight kinds below are live, with `page_share` the eighth. Built-in sample
photographs (`isSamplePhoto()`) are never usages and never unresolved.*

| kind | parent | fields (V1) | maintained by |
|---|---|---|---|
| `gallery` | `photo_id` → `photos` | `'photo'` | created with the `photos` row; **removed by cascade** |
| `gallery_cover` | `album_id` → `albums` | `cover_photo_id`, `cover_custom_path` | `syncUsages` on album save; the CHOSEN cover only — the implicit first photograph is not a usage |
| `page_section` | `page_key` | `image_path`, `image_path_mobile`, `video_poster`, `video_poster_mobile`, `bg_image` | `syncUsages` after `replaceSections`, `materializeSections`, and every draft write (`upsertDraft`, `deleteDraft`) |
| `page_legacy` | `page_key` | `hero_image_path`, `intro_image_path`, `contact_image_path` (home), `about_image_path` (about) — **only while the live page has zero section rows**; with rows they are mirrors and never projected | `syncUsages` after `patchSiteSettings` |
| `page_share` (P3) | `page_key` | `page_seo.image` — the EXPLICITLY stored share image; the automatic fallback in `lib/seo.ts` is never a usage. Live and draft. | `syncUsages` after `patchSiteSettings` (`page_seo`) and every draft write |
| `story_cover` | `post_id` → `blog_posts` | `featured_custom_path` | `syncUsages` on post save |
| `story_block` | `post_id` → `blog_posts` | `block:<zero-based block index>` — **never the block id** (ids are browser-generated and can repeat); position 0 (image), 0/1 (pair), array index (gallery, masonry) | `syncUsages` on post save |
| `shop_listing` | `product_id` → `catalog_items` | `'photo'` | `syncUsages` on catalog save |

**Not in the projection or the backfill:** `albums.cover_video_path` and the
hero's `video_path`. Videos stay outside `photo_assets` in V1, and all existing
video handling is untouched — same columns, same settings keys, same renderers,
same delete path. `video_poster` **is** included: it is an image from the image
picker. **The hero's `video_path` is declared `kind: 'image'` in the registry**
(and edited through the photo picker), so the extractor must exclude it **by
key** — the field kind cannot tell it apart (recorded rev 7, for P3).

**The accent mark is not a photograph (rev 7).** `mark.image_path` is uploaded
raw through the branding path, may be SVG, and never passes through the WebP
ladder. It is site furniture like the logos: excluded from ingestion (P2), from
the projection (P3), from the backfill (P4), and from `photo_assets`. The
`decorative` role §4.1 lists for it therefore never reaches a usage.

**The page share image is the eighth kind, `page_share` (P3, 2026-09-30).**
`PageSettings` sets a per-page share image through the photo picker. Only the
explicitly stored value is a usage; a page with no stored image and a
photograph on it has no page_share, whatever `lib/seo.ts` would show.

**`live` for a story means the saved story**, whatever its status: every saved
`blog_posts` row projects `scope = 'live'`. It is not visitor visibility.

## 4.1 Accessibility roles

```ts
/** What this image slot IS, for a screen reader. */
accessibilityRole?: 'content' | 'decorative'
```

*As built in P3 (2026-09-30):* two values, not three — `'user-selectable'` is a
Scene-era idea, below, and nothing needs it yet. Metadata only: the projection
mirrors it to `photo_usages.decorative`; no panel and no renderer reads it
before P5. A `device` field's phone twin inherits it.

Default for `kind: 'image'` is `'content'`.

| field | section | role |
|---|---|---|
| `image_path` | `hero` | **`content`** — a photographer's primary hero image is meaningful and must not vanish from the screen-reader experience |
| `video_poster` (and `video_poster_mobile`) | `hero` | `decorative` |
| `image_path` | `mark` | *(no role: the accent mark is a custom field, excluded from assets and usages — rev 7)* |
| `image_path` | `intro` / `about` / `contact` | `content` |
| `bg_image` | shared, every section | `decorative` |

**Not a permanent semantic rule for every hero.** When the Scene architecture
lands, the accessibility role belongs to **each Scene slot**: a Scene declares
its own hero image as `content`, `decorative`, or eventually `user-selectable`,
depending on the composition. `bg_image` stays `decorative` by default under any
Scene.

No photographer sees a decorative toggle in V1 — the composition declares its
own semantics, the same idea as `Field.content` declaring the design/content
line rather than a human deciding it per value.

---

# 5. V1 tables and deferred work

## Created in V1

`photo_assets`, `photo_usages`, `photos.asset_id`, `site_images.asset_id`
(deprecated on arrival), four `unique (id, tenant_id)` constraints on the parent
tables, `lib/photos/*`, `Field.accessibilityRole`, and one `<field>_alt` sibling
key per image field.

## Documented, not created

`photo_analysis` (lands with the first analyzer), `photo_embeddings` (Step 8;
dimensions deferred entirely to a benchmark then).

```sql
-- NOT created in V1.
create table photo_analysis (
  asset_id    uuid not null references photo_assets(id) on delete cascade,
  analyzer    text not null,      -- 'identity' | 'colour' | 'quality' | 'labels' | 'faces'
  version     integer not null,
  result      jsonb not null,
  model       text null,
  cost_micros bigint null,
  created_at  timestamptz not null default now(),
  primary key (asset_id, analyzer, version)
);
select public.apply_tenant_policy_via('photo_analysis', 'asset_id', 'photo_assets');
```

## Deferred columns

`photo_usages.focal`, `crop`, `treatment`, `caption_override`;
`photo_assets.default_focal`, `caption`, `usage_count`; kinds `portfolio`,
`venue`, `social`, `marketing`; **videos**.

---

# 6. Ingestion, backfill, rendering, deletion, scale

**Ingestion.** One `ingest()`, **four** routes (gallery, site/editor, journal,
custom cover — rev 7; the earlier "three callers" missed the cover), idempotent
on `key_base`, with a `.mk` scan proving no `processExistingOriginal(` or
`processPhoto(` call site skips it except one named, temporary exemption. EXIF
**normalisation** becomes universal; geolocation does not (§9.5). The whole
boundary is §9.

**Backfill.** *Superseded by §10 (rev 8):* not queued, and no derive job — the
backfill mints an asset only for files it has verified, writes nothing to
storage, and writes no usage. Still true: duplicate detection is the unique
index on `(tenant_id, key_base)`; furniture, history snapshots and video paths
are excluded; the backfill and `syncUsages` share **one** extractor module, so
they cannot disagree about what a document references.

**Rendering.** Nothing changes until the resolver lands; then `resolveImage`
prefers the asset and falls back to the path, which is never removed.
`srcSetFromPath` is retired only when a query reports zero path-only usages —
not in this sequence.

**Deletion.** `on delete restrict` on `asset_id` means the database refuses to
delete an asset that is still used. Soft delete, 30-day grace, and the sweeper
re-checks zero **live and draft** usages immediately before removing storage.
`deleteAlbum`'s `JSON.stringify().includes()` scan becomes an indexed count.

**Scale.** ~120 MB of assets and ~30 MB of usages at 200,000 photographs.
"Where is this used" is an index scan on `photo_usages (asset_id)`; "which are
unused" is an anti-join on the same index. Neither parses JSON.

---

# 7. The cascade — CLOSED against production, 2026-09-29

Verified by inspection of the production database. Recorded in
`db/schema-verified.md`.

| | |
|---|---|
| `photos.album_id` | `uuid NOT NULL` |
| constraint | `photos_album_id_fkey` |
| definition | `FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE` |
| `confdeltype` | `c` |
| orphaned `photos` rows | **0** |
| triggers on `albums` or `photos` | **none** |

**The application comment was right and the fixture was wrong.**
`db/test-fixture.sql` has been corrected: `album_id uuid not null references
albums(id) on delete cascade`, with a note saying it is verified and what
depends on it.

**What this settles.** `deleteAlbum` deletes only the album row, and every
`photos` row under it goes by cascade with no application code and no trigger in
the path. Combined with `photo_usages.photo_id → photos(id, tenant_id) on delete
cascade`, deleting an album removes:

1. the album row,
2. its `photos` membership rows, by the production cascade,
3. their projected `gallery` usage rows, by ours.

**No application-level deletion logic is required for that relationship**, and
`gallery` is therefore the only usage kind that never participates in
`syncUsages` — it is created beside the `photos` row on upload and destroyed
with it.

This guarantee is only true while that cascade is real. A change to
`photos_album_id_fkey` is a change to this design, and `db/schema-verified.md`
says so.

---

# 8. Status

**Approved in principle.** No open blocking decisions.

*Settled:* per-kind partial unique indexes · usages as a disposable, read-only
projection · contextual alt override plus canonical asset alt, resolved at read
time · composite tenant-aware foreign keys · gallery usage parented by
`photos.id` · no synthetic `library` usage · site furniture outside the
photograph model · videos outside V1 · 30-day deletion grace with a final
live/draft re-check · `site_images` retained but deprecated · no Phase D this
quarter · embeddings deferred to Step 8 · `hero.image_path` is `content` today,
with future Scenes declaring their own slot semantics · `photo_analysis`
deferred until the first analyzer exists · usage-specific editable values owned
by their source documents and relationships, never by `photo_usages` ·
**(rev 6)** no tenant default on either new table · P1 grants SELECT to
`authenticated` only · a `page_key` CHECK matching `isPageKey()` · tenant
deletion proven by test, `restrict` unchanged unless that test fails and a
decision is made.

Not to be redesigned again unless implementation reveals a concrete
contradiction in the real codebase.

---

# 9. P2 — the ingestion boundary (rev 7; DEPLOYED 2026-09-30, Supabase `20260930191116`)

Decided in the P2 design pass, 2026-09-30. The build order and tests are in
`claude/photo-migration-plan.md`, P2. Function names follow the repository's
existing `verb_object` convention (`enqueue_jobs`, `claim_jobs`, `finish_job`,
`record_page_view`, `push_draft_step`) and the application's own verbs
(`registerPhoto`, `registerSiteImage`, `registerJournalImage`).

## 9.1 Shape of the boundary

- **No direct table grant.** `authenticated` keeps SELECT only on
  `photo_assets` and `photo_usages`; `service_role` keeps nothing; no upload
  route moves to the service-role client.
- **Four route-specific wrappers**, SECURITY DEFINER, `search_path = ''`, every
  reference fully qualified, EXECUTE revoked from `public`, `anon`,
  `authenticated` and `service_role` first, then granted **to `authenticated`
  only** — the four routes run as the signed-in photographer.
- **One internal helper** that does the asset upsert, SECURITY **INVOKER**,
  `search_path = ''`, EXECUTE revoked from every application role and granted
  to none. It runs only inside a wrapper (i.e. as the owner); an application
  role that somehow reached it would lack both EXECUTE and any table privilege.
- **Each wrapper accepts only what its route may set.** There is no parameter
  for `state`, `alt_text`, `alt_source`, `alt_reviewed_at`, `archived_at`,
  `deleted_at`, `original_purged_at` or `created_by` — they cannot be passed,
  not merely rejected. Latitude/longitude parameters exist on the gallery
  wrapper only. The cover wrapper has no `original_path` parameter.

## 9.2 The proposed signatures

Shared "file facts" (server-computed, §9.4) and "capture" (normalised EXIF,
§9.5) parameters, typed so the database checks their types:

```
-- file facts
p_key_base text, p_original_path text, p_display_path text, p_derivatives jsonb,
p_width integer, p_height integer, p_original_bytes bigint,
p_content_sha256 text, p_content_type text
-- capture
p_taken_at timestamptz, p_camera_make text, p_camera_model text, p_lens text,
p_iso integer, p_aperture numeric, p_shutter text, p_focal_length numeric,
p_keywords text[], p_exif jsonb
```

| function | route | extra parameters | returns |
|---|---|---|---|
| `register_gallery_photo(p_tenant uuid, p_album uuid, <file facts>, <capture>, p_latitude double precision, p_longitude double precision)` | A | album; **latitude/longitude** | `table (photo_id uuid, asset_id uuid)` |
| `register_site_image(p_tenant uuid, <file facts>, p_filename text, <capture>)` | B | filename | `table (site_image_id uuid, asset_id uuid)` |
| `register_journal_image(p_tenant uuid, <file facts>, <capture>)` | C | — | `uuid` (the asset) |
| `register_album_cover(p_tenant uuid, p_album uuid, <file facts WITHOUT p_original_path>, p_filename text, <capture>)` | D | album; filename | `uuid` (the asset) |
| `upsert_photo_asset(…all of the above, p_filename, p_latitude, p_longitude, p_created_by uuid)` | internal | — | `uuid` |

## 9.3 What each wrapper enforces, in order

1. **Tenant.** `p_tenant` not null and a real tenant; `p_tenant =
   public.current_tenant_id() or public.is_platform_admin()` — the established
   rule, so a platform admin may act on the host site it is editing, and
   nobody else may name a site they are not in. Refused with `42501`.
   **Written `(…) is not true`, never `not (…)`:** for a caller with no profile
   `current_tenant_id()` is NULL, the comparison is NULL, and `if not (NULL)`
   does not raise — the check silently passes. P2's suite caught exactly that
   in the first draft, and found the same pattern live in S3's `enqueue_jobs`
   (`claude/open-items.md` §10).
2. **Parent ownership** (A, D). The album exists **with** `tenant_id =
   p_tenant`; "does not exist" and "belongs to another site" give the same
   answer. (A's `gallery` usage is additionally bound by P1's composite
   foreign key.)
3. **Storage-key ownership, per route**, as an exact string built in SQL:
   - A: `t/<p_tenant>/photos/<p_album>/<uuid>`
   - B: `t/<p_tenant>/site-images/<uuid>`
   - C: `t/<p_tenant>/journal/<uuid>`
   - D: `t/<p_tenant>/covers/<p_album>/<uuid>`

   — the shapes `/api/upload-url` and `uploadCustomCover` mint today. A key
   from another route, another site or another album cannot be registered.
4. **Paths inside the key** (in the helper, for every route): `p_original_path`
   = `<key_base>/original.<jpg|png|webp|tif|avif>` (A–C) or absent (D); every
   `p_derivatives` entry is `"<size>": "<key_base>/<size>.webp"` with `<size>`
   in 400/800/1600/2400, `400` always present; `p_display_path` is the largest
   one present — exactly what `processExistingOriginal` produces.
5. **Facts** (helper): `p_content_sha256 ~ '^[0-9a-f]{64}$'`;
   `p_original_bytes > 0`; **`p_width > 0` and `p_height > 0`** (final P2
   ruling: a processed photograph has real dimensions, the row and the asset
   agree on them, and a file that yields none fails ingestion — it is not
   optional metadata to be NULLed); `p_content_type` NULL or in
   `image/jpeg|png|webp|tiff|avif|heif`; `p_filename` ≤ 120 characters, no
   control characters.

   *Content type, per route (final P2 rule):* it comes from the format sharp
   detects in the server's bytes. **Gallery, site and journal** — the three
   signed-upload routes, which `/api/upload-url` limits to five image types —
   **must** have a recognised type: a NULL is refused by the application
   before anything is written, and by the wrapper (`22023`). **Only a custom
   cover** may record NULL: it arrives in the form, may be any format sharp
   decodes (a GIF, an SVG), and refusing those would turn a cover upload that
   succeeds today into a failure. The type is never used to authorise
   anything. *(Tightened in the integrity pass: "recognised" means exactly
   `image/jpeg|png|webp|tiff|avif` for the signed routes — HEIF is refused
   there; a cover may be HEIF or NULL.)*
6. **Capture** (helper): §9.5 limits; `p_exif` an object of allowlisted keys
   only, each of the allowlisted JSON type, ≤ 1024 bytes serialised.
7. **The transaction**: helper upsert → the route's relationship (below) →
   return. Errors use the S3 SQLSTATEs: `42501` ownership, `22023` a bad value,
   `23502` a missing one.

Route relationships — **every file fact of a relationship row is taken from
the canonical asset row, never from the call's arguments** (integrity pass,
2026-09-30). On a first registration they are the same values; on a retry
against an asset whose relationship was deleted meanwhile, the helper does not
rewrite the asset, so the recreated row must be built from the asset or the
two would disagree. The album cover path likewise comes from the asset.
Also enforced in SQL in that pass: latitude and longitude **both or neither**
(`22023`), and the signed-upload routes' content type **exactly** one of the
five `/api/upload-url` types (HEIF refused there; only a cover may be HEIF or
unrecognised).

- **A** — reuse `photos` where `(tenant_id, album_id, asset_id)` match, else
  insert with the columns `registerPhoto` writes today (`storage_path` =
  display path, `original_path`, `original_bytes`, `derivatives`, `width`,
  `height`, `sort_order` = the album's max + 1 as today, `tags` = the
  keywords, `taken_at`, `latitude`, `longitude`) plus `asset_id`; then the
  `gallery` usage (`field = 'photo'`), `on conflict (photo_id) where kind =
  'gallery' do nothing`.
- **B** — reuse `site_images` where `(tenant_id, asset_id)` match, else insert
  as `registerSiteImage` does today plus `asset_id`.
- **C** — the asset only. The post owns placement; P3 projects it.
- **D** — `update albums set cover_custom_path = <display path>,
  cover_photo_id = null where id = p_album and tenant_id = p_tenant`, exactly
  today's update, required to touch one row.

## 9.4 The internal upsert, and why it is safe to retry

```
insert into public.photo_assets (…) values (…)
  on conflict (tenant_id, key_base) do nothing;
select id, content_sha256, archived_at, deleted_at
  from public.photo_assets
 where tenant_id = p_tenant and key_base = p_key_base
   for update;
```

- On first insert the helper sets `state = 'derived'` and `derived_at = now()`
  itself (P2 ingestion is synchronous: the ladder exists before the call), and
  `created_by = p_created_by`, which each wrapper passes as `auth.uid()` — the
  real uploader, so a platform admin uploading to another site is recorded as
  themselves while `tenant_id` is the host site.
- On an existing row it **changes nothing**: `created_by`, facts and state are
  never rewritten by a retry. A different `content_sha256` at the same key is
  refused (one key is one upload); an archived or deleted asset is refused (its
  lifecycle is P6's).
- The row lock serialises concurrent registrations of one upload; the
  relationship lookup that follows runs after the lock, so under READ
  COMMITTED it sees the winner's committed row and reuses it. No new unique
  constraint on `photos` or `site_images` is needed.
- The server computes `content_sha256` and `original_bytes` from the exact
  bytes it processed; `content_type` from the format sharp detects; `filename`
  from the route's own metadata, normalised. None is trusted for
  authorisation — ownership is §9.3.

## 9.5 Normalised EXIF — one module, four routes

Columns, each NULL when absent or out of range (never an error):

| column | source | rule |
|---|---|---|
| `taken_at` | DateTimeOriginal, else CreateDate | as `registerPhoto` parses it today |
| `camera_make`, `camera_model` | Make, Model | trimmed, control characters removed, ≤ 64 |
| `lens` | LensModel, else LensInfo as text | trimmed, ≤ 96 |
| `iso` | ISO / ISOSpeedRatios | integer 1–1 000 000 |
| `aperture` | FNumber | rounded to 0.1, 0.5–99.9 |
| `shutter` | ExposureTime | `1/250` below one second, `2s` / `2.5s` at or above; ≤ 16 |
| `focal_length` | FocalLength | rounded to 0.1, 0.1–9 999.9 |
| `keywords` | IPTC Keywords, else XMP subject | **today's `photos.tags` rule** — trimmed, lower-cased, empties dropped, first 25 — plus each truncated to 200 characters |
| `latitude`, `longitude` | GPS | **route A only** (it stores them today); B, C and D have no parameter, so NULL — no silent expansion of geolocation. *Measured in P2:* `exifr` returns `latitude`/`longitude` even with `gps: false`, so the gates are the normaliser (drops them unless the route is gallery) and the database signature (no parameter) — both tested |

`exif` — an allowlisted, normalised subset, **`{}` when there is nothing**,
otherwise:

```json
{
  "v": 1,
  "orientation": 1,
  "offset_time": "+02:00",
  "exposure_program": "aperture_priority",
  "exposure_mode": "auto",
  "exposure_bias_ev": -0.7,
  "metering_mode": "pattern",
  "flash_fired": false,
  "white_balance": "auto",
  "focal_length_35mm": 600,
  "lens_make": "Sony",
  "color_space": "srgb",
  "software": "Adobe Lightroom Classic 13.2"
}
```

- Every key optional except `v`; enumerations closed:
  `exposure_program` ∈ manual, program, aperture_priority, shutter_priority,
  creative, action, portrait, landscape, other · `exposure_mode` ∈ auto,
  manual, bracket · `metering_mode` ∈ average, center_weighted, spot,
  multi_spot, pattern, partial, other · `white_balance` ∈ auto, manual ·
  `color_space` ∈ srgb, adobe_rgb, uncalibrated. Numbers ranged
  (`orientation` 1–8, `exposure_bias_ev` ±20, `focal_length_35mm` 1–5000);
  strings ≤ 64.
- **Never stored**, whatever the file carries: any GPS tag, body/lens/internal
  serial numbers, CameraOwnerName, Artist, Copyright, ImageDescription and
  UserComment (free text), MakerNote and every binary blob or thumbnail, XMP
  history and document ids, IPTC contact fields.
- **Ceiling: 1024 bytes serialised**, enforced in SQL along with the key
  allowlist and each key's JSON type. The largest shape above is ~420 bytes.

---

# 10. P4 — the legacy backfill (rev 8; DEPLOYED 2026-10-05/06, ACCEPTED)

Approved rulings, 2026-10-05; the build order, files and tests are in
`claude/photo-migration-plan.md`, P4. The schema shape does not change. Deployed
as unit 1 `20261005192303` (sha256
`aa46c4789f85f1280a17ab01af400d9fff5459792d334a44acfe7b351e4f3eb8`) and unit 2
`20261006012958` (sha256
`1bc2276e2ba325255be44509f203cc1695f8fafa276678b5f6b315a77c1d46d5`); the backfill
wrote 74 assets and linked 71 photographs, and the P3 rebuild then resolved all
102 references P3 had left unresolved. Record: `db/schema-verified.md`, P4.

## 10.1 What a legacy asset records

| era / source | `key_base` | `display_path` | `derivatives` | original fields | width/height |
|---|---|---|---|---|---|
| flat gallery `photos/<a>/<u>.jpg` (± an old-job ladder) | `photos/<a>/<u>` | the row's `storage_path`, exactly | the row's ladder, or `{}` | **NULL** — a resized JPEG is not an original; the old job's `<u>/original.jpg` beside it is a copy of that JPEG and is ignored | the row's |
| folder gallery / Uploads, unprefixed or prefixed | the folder | the row's `storage_path` | the row's ladder | the row's `original_path`, or the ONE sibling found among five names; read, decoded, hashed | the row's |
| flat cover / journal named only by a document | extensionless base | the flat file | `{}` (or found sizes) | NULL (covers never keep one) | NULL |
| folder file named only by a document | the folder | the largest size found | the sizes found | the one sibling found, hashed | the original's, **upright** — or NULL |

`state = 'derived'` (every display file was read and decoded), `derived_at`
NULL (unknown), `created_by` NULL (nobody uploaded anything now). For a gallery
row, `taken_at` and latitude/longitude (both or neither) are the row's, read by
the database at the write. Its keywords follow §9.5's rule through the ONE
normaliser, `normalizeKeywords()` — trimmed, lower-cased, control characters
removed, each cut to 200, empties dropped, the first 25 — applied by the
backfill to the row's tags and bound to them: the raw tags are sent too and
must equal the locked row's, or the write is `stale`. The row's own tags are
never rewritten; existing P2 assets are not touched. "Upright" means EXIF
orientations 5–8 swap the axes; 1–4 and out-of-range values do not.

## 10.2 Ownership of a key

A prefixed key must carry the site's own id. An unprefixed gallery or cover key
must name one of the site's albums. An unprefixed **journal** key names nothing
it could be owned through: it is backfilled only with an operator-reviewed
manifest entry for exactly that site and key, and only if no other site's rows,
documents or history mention it — checked by the CLI before and by the writer
again, under a per-key lock. A saved reference alone is never proof.

## 10.3 Boundaries

- One writer for assets from legacy data, `register_legacy_photo_asset`,
  service_role only plus a run-time role check, `search_path = ''`. It binds the
  site, the source and its snapshot (for a document: one image slot of P3's own
  source, under P3's projection lock, legacy columns only by P3's fallback),
  creates or reuses — never rewrites — and fills a NULL `asset_id` in the same
  transaction. P2's helper is not weakened or reused.
- P3 remains the only writer of `photo_usages`.
- The resolver's flat rule is narrow (exact extensionless base, exact
  membership), and ambiguity resolves to nothing.
- Storage: HEAD and bounded GET only; no write, copy, move, delete or listing.
- The two asset keys are added only behind a completeness preflight that holds
  the tables still; their success is not taken as proof of completeness.
