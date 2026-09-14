# Database

Supabase Postgres. Every schema change lives here as a dated migration so the
database's history is in version control rather than in a chat log.

## Applying a migration

Paste the file into the Supabase SQL editor and run it. Each migration is
wrapped in a transaction and written to be safe to run twice.

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
