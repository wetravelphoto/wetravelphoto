# The sections engine — Phase 2, shipped 2026-09-15

The homepage is no longer a hard-coded layout. It is an ordered list of
sections, each one a type from a registry plus its own settings.

## The contract (`lib/sections/registry.ts`)

This is the piece that has to be right. Four rules:

1. **Never remove or repurpose a key.** Rows in the database carry it.
2. **Adding a key is free** — put it in `defaults`, add its field. Every read
   merges defaults under stored settings, so old rows get the new value with no
   database migration.
3. **Bump `version` only when an existing key changes shape or meaning,** and
   write `migrate` in the same commit.
4. **A renderer may only read keys that exist in `defaults`.** That is what
   makes rule 2 safe: there is no such thing as an undefined setting.

A section type also declares its **fields** (kind, label, help, grouping,
`when` conditions). One declaration drives three things: the settings panel
draws itself, the save action coerces the form, and nothing needs per-section
form code. Adding section #20 costs a def, a component and one line in the
renderer map.

## Files

| File | What it is |
|---|---|
| `db/migrations/2026-09-15_page_sections.sql` | The table. Seeds nothing on purpose. |
| `lib/sections/registry.ts` | The contract: types, defaults, fields, `resolveSettings`. |
| `lib/sections/load.ts` | Reads a page; falls back when the table is missing or empty. |
| `lib/sections/context.ts` | Fetches only the data the visible sections need. |
| `lib/sections/legacy.ts` | The only file that knows the old column names. Both directions. |
| `lib/site-patch.ts` | The missing-column-tolerant write, lifted out of `actions/site.ts`. |
| `components/sections/*` | One component per type + the renderer map. |
| `components/admin/SectionList.tsx` | Drag to reorder, hide, add, remove. |
| `components/admin/SectionFields.tsx` | Settings panel generated from the field declarations. |
| `app/actions/sections.ts` | Reorder, visibility, add, remove, save, materialize, mirror. |

## Three states, one page

The page renders identically whether `page_sections` is **missing** (migration
not run), **empty** (run, nothing edited) or **populated**. That means the SQL
and the deploy can happen in either order — the mistake that broke the shop.

Nothing is written until the editor is used. The first reorder or save
materializes the six current sections as real rows.

## The transition shim

Two editors describe the homepage right now: the new section list, and the old
form (moved to `/admin/pages/home/details`, "Stories & type") which still owns
the featured stories, hero crops and typography. `legacyColumns` mirrors every
section save back into the old columns, and `syncSectionsFromSettings` pushes
the old form's saves into the section rows. Neither can get ahead of the other.

Verified: legacy → section → columns → section round-trips with no drift, and
no setting resolves to `undefined`.

All of this goes when the hero picker moves into the section panel.

## What Gonzalo has to run

```sql
-- db/migrations/2026-09-15_page_sections.sql, then:
notify pgrst, 'reload schema';
```

Still outstanding from before: `db/migrations/2026-09-14_room_choice.sql`.

## Known behaviour changes

- The header goes transparent when a hero is actually drawn, rather than when
  featured stories exist. Same result on the live site today.
- The bird mark travels with the hero, so hiding the hero hides it too.
- Hidden sections no longer cost a query: a page with no journal and no
  galleries makes no content query at all.

## Next

1. Hero picker (stories, crops) into the section panel — retires the old form
   and the shim.
2. Global styles as their own mode, previewed over his photographs.
3. Pages beyond home; then template-as-data.
