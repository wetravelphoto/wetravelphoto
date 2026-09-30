# The builder — architecture and plan

Supersedes the earlier version of this doc. Written after surveying the repo
and after Gonzalo's product brief (Squarespace + Framer + Showit + Format,
photography-first, "hard to make it look bad").

## What the survey found

| Thing | Reality |
|---|---|
| Settings fields | **125** on `SiteSettings` |
| Fields the current home preview represents | **~25** — already drifted from the real page |
| Places that write `site_settings` | **11**, across 6 files, all hardcoding `.eq('id', 1)` |
| `tenant_id` on `site_settings` | **Does not exist.** Singleton row. |
| RLS on writes | any logged-in user can write any site's data |
| Block system | **Already exists and is good** — `lib/blocks.ts`, 11 typed blocks, drag-reorder, live preview through the *real* renderer |
| Iframe preview | `components/admin/LivePreview.tsx` exists, works, imported by nothing |

## The decision that matters most: what a template is

> "Right now we only have 1 template and that is perfect, we will add several more later."

This is the fork in the road, and it is cheap to get right now and expensive later.

**A template must not be a layout.** If a template is its own set of page
components, then N templates is N codebases, switching template destroys the
site, and every new section has to be built N times. This is Squarespace 7.0,
and they spent years escaping it.

**A template is a preset.** One rendering engine; a template is a saved
configuration of it:

```
Template = section list (order + settings)
         + global style values
         + demo content
```

Switching template then keeps the photographs and the words, and changes the
design. That is what makes "try another look" safe, and it is the single
feature that will make this feel like Squarespace rather than like WordPress.

**Consequence:** the work is not "build template #2". It is "make template #1
expressible as data". Once it is data, the second template is an afternoon.

## The tension in the brief, named plainly

Showit and Squarespace are pulling in opposite directions, and the brief asks
for both.

Showit's drag-anything freedom is exactly what lets unskilled users make ugly
sites, and it is why Showit sites are notoriously poor on phones — it keeps
two separate canvases and asks the user to design twice. Squarespace's
constraint is not a limitation they failed to remove; it is the product.

The stated philosophy — *"enough freedom to feel unique, enough structure that
it is difficult to look bad"* — is the right one, and it resolves the tension
if the dial is set per-axis rather than globally:

**Free** — which sections, in what order; typography; colour; spacing scale;
image treatment (crop, ratio, corner, mat); gallery density; captions;
transitions; page width.

**Not free** — absolute position, overlap, z-index, per-breakpoint layout,
font pairing that fails, colour combinations that fail contrast, arbitrary
CSS.

A photographer who can pick the sections, set the type and control the image
treatment will produce a site that feels like theirs. One who can drag a text
box on top of a photograph will eventually produce a mess, on a phone, and
blame the platform.

## Sections are the moat, not the editor

The section list in the brief — Editorial Gallery, Photo Story, Fine-Art
Print, Featured Albums, Client Galleries — is the genuinely differentiated
part. Every builder has "Image Grid". Almost none has a gallery section that
understands aspect ratio, mat, frame and print price.

Two consequences:

1. **Six sections done beautifully beat seventeen done adequately.** The list
   is a roadmap, not a release.
2. **Several already exist and work**: hero, gallery carousel, journal row,
   Instagram, contact, and the print wall with the frame and room system. The
   first release is mostly *re-expressing what is built* as sections, not
   building new ones.

## Global styles will remove settings, not add them

A good chunk of the 125 fields exist because there is no global style system —
every page carries its own font, scale and heading fields. A proper token set
(roughly 20 values: two typefaces, a type scale, a palette, a spacing scale,
image radius, gallery gap, page width, button style) absorbs them.

Expect the field count to fall. That is the clearest sign the system is right.

## The editor should look like Lightroom, not like an admin

- **Dark chrome.** You cannot judge a photograph against white. Every serious
  photo tool is dark for this reason.
- **The canvas is the product.** Panels are quiet, narrow and collapsible.
- **Left: the page as thumbnails**, not a list of words — sections you can
  drag.
- **Right: whatever is selected**, and nothing else.
- **Style is a mode, not a panel.** Changing a typeface affects every page, so
  you want to see every page while you do it.
- **Preview against their own photographs, never placeholders.** This instinct
  is already in the codebase — the header settings screen loads a real cover
  because "a real cover makes the header preview honest about legibility".
  That should be a rule everywhere.

## Where the money actually is

Squarespace has ~1,800 employees. Format and Pixpa exist anyway — because
Squarespace is mediocre at client galleries, proofing, print fulfilment and
image delivery, and those are the things photographers pay for.

The builder is table stakes. The photography workflow is the moat. The
sequencing that follows: build the *minimum* builder that gets a beautiful
site up, and spend the surplus on client galleries, proofing and print sales —
where this project is already unusually far along.

## Plan

### Phase 0 — the seam (small, invisible)
`lib/tenant.ts` → `currentSiteId()`; route all 11 settings writes through one
helper; add `site_settings.tenant_id`. A few hours now versus a bad day later,
because the builder multiplies settings write-paths.

### Phase 1 — global styles
Extract ~20 design tokens; render the whole site from them; collapse the
per-page font and scale settings into them. Ends with a Style mode where
changing one value visibly changes everything.

### Phase 2 — the home page becomes sections
Generalise `lib/blocks.ts` from journal bodies to page sections. The home page
renders from an ordered array instead of hardcoded order plus toggles. Reuse
`BlockEditor`'s drag-and-reorder.

### Phase 3 — the canvas
Real site in an iframe, draft settings, click a section to select it, edit in
the right rail, changes appear instantly, Publish promotes the draft. Retires
`/admin/pages/*` — if the old forms survive alongside it, the confusion
doubles rather than halves.

### Phase 4 — template as data
Serialise the current site to a template preset. Then build the second one,
which should take an afternoon and will prove whether the architecture is
right.

### Phase 5 — tenancy
`tenant_id` everywhere, RLS rewritten per tenant, super-admin to create sites,
domain routing.

## Two things that stay true regardless

**The RLS hole is real** and the migrations already admit it: *"Once a second
photographer has a login, that lets either of them read and write the other's
data."* Irrelevant today, blocking the day a beta tester logs in.

**Vercel Hobby is non-commercial.** Fine now. Not fine the day the shop takes
money, and not fine for hosting other photographers.
