# Facts verified against the production database

`db/test-fixture.sql` is written by hand from what production is *believed* to
look like, and it has been wrong three times — the `single_row` constraint on
`site_settings`, `albums.allow_downloads`, and the foreign key below. Each time,
a local rehearsal passed against this repository's idea of the schema and the
first real attempt failed against the database.

This file is the ledger of things that have actually been **checked**, with the
query that checked them and the date. A claim here is a claim somebody ran.
Everything not in this file is still belief.

`db/survey.sql` produces the full picture; its output is not yet committed.
Until it is, this file is the narrow, verified subset.

---

## 2026-09-29 — `photos.album_id`

**Question.** `app/actions/galleries.ts` says *"The database rows cascade"* and
never deletes `photos` rows; `db/test-fixture.sql` declared a plain
`references albums(id)`, which is `NO ACTION`. Under `NO ACTION` that function
would fail with a constraint violation on any album that had photographs, and it
does not fail. One of the two was wrong.

**Query.**

```sql
select
  con.conname,
  pg_get_constraintdef(con.oid) as definition,
  con.confdeltype
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
where rel.relname = 'photos' and con.contype = 'f';

select count(*) from photos p
where not exists (select 1 from albums a where a.id = p.album_id);

select tgname from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where c.relname in ('albums','photos') and not t.tgisinternal;
```

**Result.**

| | |
|---|---|
| `photos.album_id` | `uuid NOT NULL` |
| constraint | `photos_album_id_fkey` |
| definition | `FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE` |
| `confdeltype` | `c` |
| orphaned `photos` rows | **0** |
| triggers on `albums` or `photos` | **none** |

**Conclusion.** The application comment is correct. The fixture was wrong and
has been corrected. Deleting an album deletes its `photos` rows by cascade, with
no application code involved and no trigger in the path.

**What now depends on it.** The photo-usage projection
(`claude/photo-assets-design.md`) parents a `gallery` usage on `photos.id` with
its own `on delete cascade`. Combined with the cascade above, deleting an album
removes the membership rows *and* their projected usage rows with no application
logic at all. That guarantee is only true while this cascade is real, so a
change to it is a change to that design.
