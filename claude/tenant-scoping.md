# Tenant scoping — the bridge that was on fire

Shipped 2026-09-15. Database only; no application changes were needed.

## Run these in this order

```sql
-- 1. db/migrations/2026-09-15_tenant_scoping.sql
-- 2. db/migrations/2026-09-15_page_sections.sql
-- 3. db/migrations/2026-09-15_templates.sql
notify pgrst, 'reload schema';
-- then, to prove it:
-- db/verify-tenant-isolation.sql
```

2 and 3 refuse to run before 1 — they'd otherwise create the same unscoped
policy this fixes. All three are safe to run twice.

## What was actually wrong

Twenty-two policies across the schema carried the same copy-pasted check:

```sql
exists (select 1 from profiles p where p.id = auth.uid())
```

It asserts only that *somebody* has a profile. With one account that reads as
ownership. With two, either photographer reads and writes the other's
galleries, clients, orders and messages — and nothing fails loudly.

A second landmine sat behind it: `default_tenant_id()` was
`select id from tenants limit 1` with **no ORDER BY**, and almost every
`tenant_id` column defaults to it. With two tenants, every insert that omits
`tenant_id` lands in an arbitrary site.

## What replaced it

- `current_tenant_id()`, `is_platform_admin()`, `tenant_for_insert()`,
  `tenant_of()` — all `stable security definer`.
- `profiles.is_platform_admin`, backfilled so no one can be locked out.
- `site_settings.tenant_id` — it had none. Added and backfilled while there is
  one row to backfill. Reads still key on `id = 1` until domain routing lands;
  the **data** is now the right shape, which is the expensive part.
- Insert defaults now resolve to the caller's own tenant.
- **`apply_tenant_policy()` / `apply_tenant_policy_via()`** — one definition of
  "belongs to this site", called from everywhere. Copying the expression is how
  the problem happened, so the fix is that there is now nothing to copy.
- A guard at the end of the migration that **aborts** if any old-style policy
  survives. A rewrite that half-lands is worse than none, because policies OR
  together — one forgotten permissive policy makes the whole thing decorative.

## Rehearsed, not hoped

`db/test-fixture.sql` rebuilds this schema from the survey output in a local
Postgres. The migration was run against it before going anywhere near
production, and **failed twice**:

1. `is_platform_admin()` was defined before the column it reads. A `language
   sql` body is parsed at creation, so this errored immediately.
2. **Infinite recursion between `albums` and `album_clients`.** `albums` has a
   policy that reads `album_clients` (that is how share links work), so a new
   policy on `album_clients` that read `albums` made the two call each other
   until Postgres gave up — taking down every gallery page with them. Fixed by
   reading the parent's tenant through `tenant_of()`, a definer function that
   never re-enters RLS.

Neither would have shown up in review. Both would have shown up in production.

## The proof

`db/verify-tenant-isolation.sql` moves your own account to a throwaway tenant,
checks your site stops answering to you, checks a platform admin still reaches
it, and always ends by raising an exception so everything rolls back.

| Check | Result |
|---|---|
| own tenant can write its settings | ok |
| own tenant can read its galleries | ok |
| other tenant cannot write settings | ok |
| other tenant cannot read private work | ok |
| other tenant cannot write into yours | ok (blocked by `with check`) |
| platform admin reaches every site | ok |
| anonymous cannot write settings | ok |
| anonymous cannot read private work | ok |
| anonymous cannot list clients | **fails — known, below** |

## Still open, deliberately

Four policies are `using (true)` because the share-link flow reads them with no
login. Closing them needs application changes, not a policy edit, so they were
left alone rather than bundled in:

| Table | What is exposed to anyone with the public anon key |
|---|---|
| `clients` | Every client row, including email |
| `album_clients` | Every share token |
| `favorites` | Read and write of anyone's favourites |
| `albums` | Any album with a share row — including its `password_hash` |

The fix is a `security definer` function that takes a share token and returns
that one gallery, so these tables stop being world-readable. **This is now the
sharpest remaining edge** — it is not a tenancy problem, it is a
today-with-one-user problem.

## Next

1. Close the share-link hole above.
2. Global styles as their own mode.
3. Domain routing — `tenants.domain` already exists, and `site_settings` now
   has the tenant column it needs.
