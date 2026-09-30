# Lens Grid — the platform name

Decided 2026-09-21 by Gonzalo.

- **Lens Grid** is the platform: the admin, the canvas editor, sign-in, and
  eventually the marketing site at **lensgrid.co**, where photographers sign up
  and where the super-admin lives.
- **WeTravelPhoto** is Gonzalo's own photography site, i.e. one tenant on
  Lens Grid. It is not the platform.

## The rule in code

`lib/platform.ts` exports `PLATFORM = { name: 'Lens Grid', domain: 'lensgrid.co' }`.

- What the photographer sees while working (admin sidebar, login, editor tab
  title, future platform emails) uses `PLATFORM.name`.
- What a visitor to a photographer's site sees uses that site's
  `site_settings.site_title`. Never the platform name, never a hard-coded
  "WeTravelPhoto".

Applied so far (2026-09-21): admin sidebar, login, editor title; the root
layout's metadata and journal post titles now read `site_title` instead of a
hard-coded name.

## Still hard-coded / to do

- `lib/site.ts` default `site_title: 'WeTravelPhoto'` and the fallbacks in
  `app/actions/site.ts` and `app/actions/contact.ts`: fallbacks for his own row
  today; for a new tenant these should come from sign-up.
- The built-in logo files in `public/logos/` are WeTravelPhoto's, so they are
  tenant assets living in the platform repo.
- The marketing site, super-admin and domain routing (lensgrid.co vs tenant
  domains) are not built yet.

## Future to-do list for Lens Grid (Gonzalo, 2026-09-22)

These are ideas to build when the platform side starts, not now. Recorded so
they are not forgotten.

### Sign-up: the site's address

- At sign-up, **ask whether they already own a domain**.
  - **Yes:** walk them through pointing it at Lens Grid, with clear, specific
    instructions for their registrar (GoDaddy, Namecheap, Squarespace Domains,
    Google/Cloudflare). SSL is issued automatically; the Vercel domains API
    handles adding the domain and checking DNS. Show live status ("waiting for
    DNS", "connected").
  - **No, free plan:** the site lives at **lensgrid.co/theirname**. Note: the
    platform audit also mentioned `theirname.lensgrid.co` subdomains. Decide
    between path and subdomain when domain routing is designed: path is what
    Gonzalo described; subdomains keep each site's cookies, SEO and absolute
    links separate and are easier to move to a custom domain later.
- **Paid plans: buying a domain should be as frictionless as possible.**
  Search for a name inside sign-up, see the price, buy it in one step, and
  have it connected automatically with no DNS steps for the photographer. To
  research when this is built: the Vercel Domains API (buy and configure in
  one call) versus a registrar reseller API (e.g. Cloudflare Registrar,
  Namecheap). Also consider including a year's domain in the paid price.

### Instagram connection: a proper how-to

- Connecting Instagram needs a token, and today that is a technical, multi-step
  process. Build a clear **how-to page with screenshots** (and ideally a short
  video), step by step, in plain language. Link it right where the token is
  asked for, in Settings → Instagram.
- Better still, later: a "Connect Instagram" button using Meta's login flow
  (OAuth), so photographers never copy a token by hand. This needs a Meta app
  that has been through App Review.
- Explain the known limits up front: collab posts owned by another account
  don't come through the API.
- The weekly job (`vercel.json`, Sundays 04:00 UTC) refreshes the token and
  re-syncs the feed, so nobody renews the token by hand. A new token is only
  needed if the job stops for about 60 days, the Instagram password changes,
  or access is revoked. Sync could move to daily so new posts appear sooner.

### AI assistant in the editor (idea discussed 2026-09-22)

Gonzalo asked whether the editor could have an AI assistant: create a logo or
accent mark, or build a new section.

**Verdict: feasible, and a strong selling point, if it is scoped to site tasks
and metered.**

The safe design: the AI never writes code or touches the database. It returns
structured values for the section fields that already exist (the registry),
the same values a person would type. Those go through the existing sanitizers
into the **draft**, so everything it does is previewed, undoable, and only
live after Publish.

Ranked by value for cost:

1. **Writing help** (cheapest, most useful):
   - write or rewrite section text in the photographer's voice;
   - SEO titles and descriptions;
   - alt text for photos;
   - FAQ, pricing and testimonial wording.

   Each request is a small language-model call.
2. **"Build me a page / section"**: e.g. "a Weddings page with packages and an
   FAQ" becomes a list of existing section types with their fields filled in.
   Depends on the new section types being built first.
3. **Style suggestions**: a palette and type pairing chosen from the
   photographer's own photos.
4. **Logo / accent mark**: the hardest to do well. Image models are poor at
   clean, scalable logos. Better approaches:
   - a wordmark builder: site name × our fonts × spacing, with AI proposing
     combinations;
   - simple SVG marks drawn by a language model;
   - image generation only as an optional, paid extra.

   Always shown as options to pick from, never applied automatically.

New section *types* (new code) are not something the AI should create at run
time. It composes the types we build.

**Guardrails:**
- Server-side only. Fixed prompts per task: no open chat box, and no user text
  treated as instructions beyond the task.
- Structured output validated by the same sanitizers as manual edits.
- Per-plan monthly credits via `lib/entitlements.ts`, plus per-site rate
  limits and hard caps on tokens and images per request.
- Content moderation on image prompts, and logging of usage per tenant.
- The free plan gets a small allowance, and paid plans get more.

### New section types for new kinds of pages

Photographers can now create their own pages (Weddings, Workshops, …). Those
pages will need sections we don't have yet. Candidates, roughly in order of
usefulness:

- **Pricing / packages**: 2–4 columns, each with name, price, what's
  included, and a button.
- **FAQ**: questions that open to show their answers.
- **Testimonials**: quotes with name, photo and optional star rating.
- **Photo grid / single gallery**: a chosen set of photos (not a whole
  album), in a grid, masonry or slideshow.
- **Text block**: rich text with no photo, for long copy.
- **Image + text rows** that alternate sides, for "how it works" or
  "what to expect".
- **Schedule / itinerary**: day by day, for workshops and tours.
- **Call-to-action banner**: a headline and button over a photo.
- **Video**: YouTube/Vimeo embed or uploaded clip.
- **Booking / inquiry form** with custom fields (date, location, package).
- **Logos / "as seen in"** strip.
- **Map / location.**
- **Spacer / divider.**

Follow the section registry pattern (`claude/sections-engine.md`): one entry
in `lib/sections/registry.ts`, one renderer, fields with `when`/`folded`/`live`.
This ties in with the last roadmap item (3–5 layouts per section type plus
templates): a "Weddings" or "Workshop" page template would be a preset list of
these sections.
