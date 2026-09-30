# Looks as data — and the doors left open

Shipped 2026-09-15, alongside the sections engine.

## The decision that could not be deferred

Whether a site follows a look **live** or takes a **snapshot** of it.

*Live* means editing Field Notes silently redesigns every site using it,
including sites belonging to people who were happy. It also means there is no
such thing as "stay on the old one" — so there is no version of it that could
ever be staged, rolled back, or sold.

*Snapshot* means a site is self-contained. Publishing a new version of a look
changes nothing anywhere until someone chooses it. Whether that choice is free,
prompted, automatic for some plans, or paid for is then a **product** decision
— makeable in a year, changeable twice, reversible — instead of an
architecture decision already made by accident.

**Snapshot, therefore. Plus full history, so every apply is undoable.**

## Content vs design — the line a look may not cross

Every field in `lib/sections/registry.ts` is now marked `content: true` or
left as design. Content is the photographer's: their words, photographs,
links. Design belongs to whichever look they are using.

That is what makes "switch looks, keep your photographs and writing" true by
construction rather than by care — a manifest has no way to express content.

When genuinely ambiguous, it is marked content: keeping a value that should
have changed is one click to fix; losing someone's writing is not.

## What a look is

```
templates              slug, name, version, status, origin, tier, manifest
template_versions      every published manifest, kept forever
site_template          which look, WHICH VERSION, and the snapshot as applied
site_template_history  the page exactly as it was before each change
```

A manifest is `{ schema, pages: { home: [...] }, styles }` — section order,
visibility, design settings, typography. Nothing else.

`tier` on a template row and on a section def are **read by nothing**. They
exist so that gating something later is a value to fill in rather than a
migration against live data.

## The rules, written into the code

1. **A plan may lock. It may not delete.** (`lib/entitlements.ts`) A downgrade
   hides and marks locked; going back up restores exactly what was there. A
   downgrade that deletes is the one mistake in this system that cannot be
   undone.
2. **Every gate-able decision asks `can(tenant, capability)`** — which returns
   true for everything today. Adding plans is one file, not an audit.
3. **History is written before the change, or the change is refused.** No undo
   point, no apply.
4. **A section the new look has no slot for is parked and hidden, never
   removed.**

## Verified

Six checks, run against a simulated live site:

| Check | Result |
|---|---|
| Adopting the look lifted from the site is a no-op | pass |
| The manifest carries no content whatsoever | pass |
| Content survives switching looks (headings, body, photos, featured stories) | pass |
| Design actually changes (mode, alignment, limits, sides) | pass |
| Dropped sections parked and hidden, nothing lost | pass |
| extract(apply(M)) is stable | pass |

## What Gonzalo has to run

```sql
-- db/migrations/2026-09-15_page_sections.sql   (from the sections engine)
-- db/migrations/2026-09-15_templates.sql       (this)
notify pgrst, 'reload schema';
```

Field Notes v1 is seeded **from his live site**, so adopting it changes
nothing — which is also how the no-op claim is verifiable in production and
not just in a test.

Still outstanding from before: `db/migrations/2026-09-14_room_choice.sql`.

## Making look number two

Build it on the real site until it is right, then **Design → Save this design
as a look**. Design only; the manifest cannot carry writing or photographs
even if asked. Publishing a new version of an existing look leaves every site
on it untouched until each one takes the update.

## The bridge that is still on fire

The owner RLS check ignores `tenant_id` on every table, including these. It
has to be fixed everywhere **before a beta tester logs in**. That is the one
genuinely irreversible risk left in the build — everything else on the list
can be changed later.

## Next

1. Global styles as their own mode — colour and spacing join typography in a
   manifest's `styles`.
2. Tenant scoping and the super-admin path.
3. The canvas: the section list drawn against a live preview.
