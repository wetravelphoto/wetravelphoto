# The draft layer — how the canvas edits without touching the live site

Phase 3 of the builder plan. Written 2026-09-16, after the global styles pass.

## The decision

Everything the editor changes lands in **one `site_draft` row per site**,
holding a JSONB snapshot:

```
pages          { "home": [ {id, type, position, visible, version, settings}, … ] }
global_styles  null = this draft has not touched style
type_styles    null = same
```

The obvious alternative was a `status` column on `page_sections` plus a filter
in every query. Rejected, and the reason is worth keeping: that design puts the
safety of a photographer's live homepage in the hands of whoever writes the
next query and remembers the filter. The day one of them forgets is the day an
unpublished homepage goes live.

With a blob, the live read path **cannot see a draft even by mistake, because
it never asks**. `app/page.tsx` does not know drafts exist.

## The lifecycle

| | |
|---|---|
| nothing | no row. The canvas shows the live site. |
| first edit | `ensureDraft()` copies the live state in, then edits it |
| more edits | `writeDraftPage` / `writeDraftStyles` patch the row |
| Publish | undo point → `replaceSections` + `patchSiteSettings` → row deleted |
| Discard | row deleted |

Publish reuses **the same two write functions applying a look uses**. There is
one way for section rows to change and one way for settings to change, whatever
asked for it. And a publish is now an ordinary entry in
`site_template_history`, so there is one Undo list, not two.

Seeding from the live state is what makes the canvas feel like editing the site
rather than building a new one — including for a site that has never opened the
editor, because `ensureDraft` goes through `loadPageSections` and gets the
legacy adapter's six synthesized sections for free.

## Why the preview is its own route, not draft mode

Next's `draftMode()` would let the editor preview the real URL. It reads a
cookie — and reading one in the homepage's data path opts that route out of the
cache **for every visitor**. The homepage is the one page that most needs to
stay cached: it queries every public album and attaches a cover to each.

So `/preview/[page]` is a separate, dynamic, admin-gated route, and
`app/page.tsx` keeps `revalidate = 60`.

The cost of a separate route is that it could drift from the real page. That is
paid off by `components/PageBody.tsx`: **both routes render the same tree.** The
only differences are where the sections came from and whether each one is tagged
for clicking. If the preview ever needs its own renderer, something has gone
wrong upstream.

## Security

`site_draft` is **not world-readable**, and it is the one place in the schema
that differs from the table it shadows. `page_sections` is public because the
live page is public. A draft is unpublished work — an unannounced rebrand, next
season's prices, a gallery a client has not seen.

Gating is doubled on purpose: the middleware matcher covers `/preview`, *and*
the route checks the session itself. A page that reveals unpublished work should
not be the one component that trusts someone else to have done the checking.
`/preview` is also in robots.txt and carries `noindex`.

## What the rehearsal caught

Run against a real local Postgres before shipping, as everything since the
tenant migration has been:

- A foreign key into Supabase's `auth.users`. Changed to `profiles(id)` — same
  id, public schema, already tenant-scoped.
- `db/test-fixture.sql` was **stricter than production**: it granted on the
  tables it created and nothing else, while Supabase sets default privileges so
  new tables are reachable automatically. The fixture now sets them too. Without
  this the rehearsal room sends you off adding grants the real database does not
  need.
- `updated_at := now()` cannot be tested, because `now()` is the *transaction's*
  start time and does not move within one. Switched to `clock_timestamp()`,
  which is also what "updated at" is supposed to mean.
- `RAISE` uses `%` as its placeholder; `format()` uses `%s`. Both verification
  scripts had this muddled, which is why the isolation test's summary line had a
  stray `s` in it.

`db/verify-draft.sql` — 7 checks, all green, always rolls back. The one that
matters is *another site cannot read the draft*, asked from the other side by
moving the account to a throwaway tenant.

## Still to build

The canvas shell itself: dark chrome, the iframe, left rail of section
thumbnails, right rail bound to the selection, Publish / Discard bar. The wire
is already in — `components/preview/PreviewBridge.tsx` posts `select` outward
and accepts `refresh` and `select` inward.

"Changes appear instantly" is done with `router.refresh()`, not optimistic DOM
patching: refresh re-runs the server components, so what appears is what the
real renderer produces from what is really in the draft. Patching would be
faster by a few hundred milliseconds and would drift from the page it claims to
be showing.

Then Phase 3's last step: **retire `/admin/pages/*`**. The plan is explicit that
if the old forms survive alongside the canvas the confusion doubles rather than
halves.
