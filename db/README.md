# Database

Supabase Postgres. Every schema change lives here as a dated migration so the
database's history is in version control rather than in a chat log.

## Applying a migration

Paste the file into the Supabase SQL editor and run it. Each migration is
wrapped in a transaction and written to be safe to run twice.

## Row level security

**A new table that belongs to a site does not get a hand-written owner policy.**
It calls the one in `2026-09-15_tenant_scoping.sql`:

```sql
select public.apply_tenant_policy('my_table');                        -- has its own tenant_id
select public.apply_tenant_policy_via('my_join_table', 'photo_id', 'photos');  -- scoped through a parent
```

This exists because twenty tables were once given the same owner check by
copy-paste:

```sql
exists (select 1 from profiles p where p.id = auth.uid())
```

which asserts only that *somebody* is signed in. With one account it looks like
ownership. With two, either photographer can read and write the other's data.
One definition, called from everywhere, is the fix — copying the expression is
how the problem happened.

The helpers available to a policy:

| Function | Returns |
|---|---|
| `current_tenant_id()` | The signed-in account's tenant, or null for a visitor |
| `is_platform_admin()` | You, working across every site |
| `tenant_for_insert()` | The caller's tenant, falling back to the first for anonymous writes |

All are `stable security definer` — definer because a policy on `profiles` that
reads `profiles` through a plain function recurses forever, and stable so
Postgres evaluates them once per statement instead of once per row.

### Rehearsing a migration

`db/test-fixture.sql` builds a throwaway copy of this schema in a local
Postgres, so a migration can be run and checked before it is pasted into the
live database:

```bash
createdb wtp && psql -d wtp -f db/test-fixture.sql
psql -d wtp -v ON_ERROR_STOP=1 -f db/migrations/<new>.sql
psql -d wtp -f db/verify-tenant-isolation.sql
```

Worth the five minutes. The tenant scoping migration failed twice against it
first — once on a function defined before the column it reads, once on two
policies calling each other forever — and both would otherwise have been
discovered in production.

### Proving it

`db/verify-tenant-isolation.sql` moves your own account to a throwaway tenant,
checks that your site stops answering to you, checks a platform admin still
reaches it, and always ends by raising an exception so the whole thing rolls
back. Run it after any change to policies.

### How a share link works

`clients`, `album_clients`, `favorites` and `downloads` answer to nobody but
their own site. A share token is not a database credential — the database never
sees it — so authorization happens one level up, in the server, where the token
actually is:

| Module | Guards |
|---|---|
| `lib/gallery-access.ts` | Everything a share token opens |
| `lib/album-access.ts` | Public and password-gated albums by slug |

Both run with the service-role key, so **the scoping in those two files is the
security**. `accessForToken` is the only way to obtain a handle, every other
function demands one and scopes its query to the albums that token actually
opened, and nothing outside those files reads those tables for a visitor. Two
rules when editing them:

1. Never trust an album or photo id from the caller — check it against
   `access.albumIds`.
2. Never export something that returns rows without a verified handle.

`password_hash` is read inside `lib/album-access.ts`, compared there, and never
returned. Before 2026-09-15 the album page selected it with `select('*')` under
the anon key.

## The `if not exists` trap

`add column if not exists` matches on the **column name only**. If a column of
that name already exists with a different type or meaning, the statement
silently does nothing — no error, no warning, and the feature built on top of
it fails at runtime instead of at build time.

This has already cost us once: `albums.sort_order` was the photo sort mode
(`'manual' | 'date_asc' | 'date_desc'`) when a migration tried to add
`sort_order int` for gallery positions. See
`migrations/2026-09-14_ordering_and_missing_columns.sql`.

**After running any migration, run its verify query.** Every migration file
ends with one.

## Why this bites so hard here

`lib/site.ts` types the `site_settings` row, but `getSiteSettings()` does:

```ts
supabase.from('site_settings').select('*').eq('id', 1)
```

and casts the result. TypeScript never checks it against the real table, so a
column that exists in the type but not in the database compiles cleanly and
comes back `undefined`. Adding a field to `SiteSettings` without a matching
migration will not fail the build.

## Regenerating a full schema snapshot

There's no committed `schema.sql` yet because the dashboard can't produce a
trustworthy one. With `psql` installed and the connection string from
Supabase → Settings → Database:

```bash
pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL" > db/schema.sql
```

Otherwise this lists every column, which is enough to diff against `lib/site.ts`:

```sql
select table_name, string_agg(column_name, ', ' order by ordinal_position) as columns
  from information_schema.columns
 where table_schema = 'public'
 group by table_name
 order by table_name;
```
