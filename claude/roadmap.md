# Lens Grid / WeTravelPhoto — the full to-do list, in priority order

Written 2026-09-22 from:
- a fresh audit of the code;
- `claude/audit-2026-09-21.md`;
- every to-do Gonzalo has given in conversation (the future list in
  `claude/lens-grid-platform.md` included).

**This is the master list.** Where it disagrees with older docs, this one wins.

How it is ordered: first what makes **Gonzalo's live site** work properly for
visitors (messages reach him, sign-ups go somewhere), then editor polish, then
**more to build pages with**, then speed and quality, then what must exist
**before other photographers can sign up**, then the growth features.
Each item has a size: **S** is under a day, **M** a few days, **L** a week or
more.

---

## Tier 1 — Make the live site do its job  ✅ done

**Status 2026-09-22: Tier 1 is done.** Items 1, 3, 4, 5, 6 and 7 are built and
item 2's code is built (it switches on once Turnstile keys are added). See
`claude/email-and-newsletter.md` and `claude/the-canvas.md`.

1. ✅ **Contact form sends a real email** (M), built 2026-09-22
   - Each message is emailed to the photographer by the platform (Resend).
     Reply-To is the visitor, and the destination address is set in Settings,
     with a test button.
   - The **email foundation** is reused by items 14 and 23.
2. ✅ **Spam protection on the contact form** (S): the honeypot plus
   Cloudflare Turnstile. The code is built; it needs the Turnstile keys in
   Vercel to switch on.
3. ✅ **Newsletter sign-ups go somewhere** (M), built
   - Built: CSV download, plus connectors for Mailchimp, Kit, MailerLite,
     Brevo and Flodesk (paste a key, pick a list, and new sign-ups are sent
     automatically; "send existing" catches up).
   - **Still to do:** local double opt-in and unsubscribe emails for sites
     that don't connect a service.
4. ✅ **Admin in the Inter typeface** (S), built 2026-09-22: one
   `--admin-font` variable drives the whole admin and the editor. Previews of
   the site keep the site's own fonts.
5. ✅ **Instagram feed updates daily**: the job now runs daily.
6. ✅ **Editable 404 page** (S–M), built 2026-09-22: `notfound` is a built-in
   editor page with its own sections. It can never be a menu entry.
7. ✅ **Site icon (favicon) upload** (S), built 2026-09-22: Settings → Site
   icon, stored per site in R2 and emitted from the root layout.

## Tier 2 — Finish the editor  ← **we are here**

8. ✅ **Keyboard shortcuts** (S), built 2026-09-22: Ctrl/⌘ D duplicates,
   Delete/⌫ removes (with a confirm), Esc deselects, ↑/↓ move the selection,
   alongside the undo/redo keys. One reader (`lib/canvas-keys.ts`) shared by
   the editor and the preview.
9. ✅ **Upload photos straight from the photo picker** (S–M), built
   2026-09-22: drag and drop or Upload, straight to R2, filed under a new
   **Uploads** source (`site_images`) so the photograph is there again next
   time. The picker is now the editor's own rather than the admin's.
10. ✅ **Section background image**, and a full-width vs contained switch (M),
    built 2026-09-22: any section can take a photograph behind it (with a
    darkening scrim, a keep-in-view anchor and a light/dark word switch), and
    can sit at the site's width, narrow, wide or edge to edge.
11. ✅ **Thumbnails in "Add a section"** (S), built 2026-09-22: a small drawing
    of each section type, drawn in code from one visual grammar
    (`components/canvas/SectionThumb.tsx`).
12. **Contrast warning** when text colour is hard to read on its background,
    and **custom font upload** (M). The background photograph (item 10) makes
    the warning worth more: it is now easy to put pale words on a pale picture.
    **Promoted for the beta** — a tester will hit this in their first hour.

### Asked for by the first beta tester (2026-09-23)

12a. **Gallery carousel: arrows and autoplay** (S). Today the carousel is drag
     only, which is not discoverable on a desktop with a mouse — there is
     nothing on screen that says it moves. Arrows under the row, and an
     optional slow autoplay that stops on hover, on focus, on a drag and under
     `prefers-reduced-motion`.
12b. **A hero built from galleries** (M). Today: featured stories in sequence,
     or one standing photograph. Add "your galleries", using each gallery's
     own cover composition — the same sequence machinery, a different source.
12c. ~~Home in the menu~~ — **already built.** Pages & menu → "+ Add a page…"
     → Homepage. Worth checking discoverability rather than building anything;
     the picker calls it "Homepage" while the menu entry reads "Home".

## Tier 3 — More to build pages with

13. **New section types** (L, can ship one at a time), in this order:
    - pricing/packages, FAQ, testimonials;
    - photo grid (chosen photos), text block, image + text rows;
    - call-to-action banner, video;
    - booking/inquiry form (see 14);
    - schedule/itinerary, logos strip, map, divider.

    Each follows the registry pattern, and each wants a drawing in
    `SectionThumb.tsx` (it falls back to a plain one without). Details are in
    `claude/lens-grid-platform.md`.

    **The method, decided 2026-09-23.** For every new type, look at two or
    three real references first — [21st.dev](https://21st.dev), Squarespace's
    and Format's own sections, whatever is doing it well — decide which
    arrangements are worth supporting, and *then* write the registry
    declaration. That is how the contact section got its split/centred choice,
    and it is the step that stops a section shipping with one layout and no
    opinion.

    **What cannot be pasted in, and why.** A 21st.dev block is Tailwind
    utilities with hard-coded colours, type and spacing. Our sections read
    `--ink` / `--surface` / `--ember`, their own per-section typography,
    `--sec-pad-*`, `--sec-measure`, and tag their text so the canvas can select
    and edit it. A pasted block would ignore Style mode, ignore the Section
    group, and be uneditable — the one part of the site that is not the
    photographer's. (Tailwind itself is not the obstacle; it is already in the
    project and the admin uses it.)

    **What IS worth lifting:** interaction mechanics — an accordion's keyboard
    handling, a marquee's seamless loop, a carousel's physics — re-skinned to
    tokens. And anything for the ADMIN, which is ours and needs no theming.
    Check the licence per component: the 21st repo is MIT but individual
    submissions carry no standard one.

    **The caution:** that house style is SaaS landing page — gradients, glows,
    bento grids. A photographer's portfolio wants the opposite. Used
    uncritically it would make every Lens Grid site look like a developer tool.
14. **Inquiry / booking form with custom fields** (M): date, location, package,
    budget, "how did you hear about us". Emails via the item 1 foundation and
    is stored in Messages.
15. **Legal pages** (S–M): a privacy policy and terms template the photographer
    fills in, linked from the footer. Needed once there are sign-ups and
    contact forms, and required in the EU/California. A cookie notice only
    once analytics or marketing pixels are added.

## Tier 4 — Speed, quality, search

16. **Caching public pages** (M): public reads use a cookie-free database
    client, so pages can be cached. Faster for visitors and cheaper on Vercel.
    Best done together with tenant resolution (item 24).
17. **Instagram photos stored on our own storage** (M), plus pinned posts. The
    section gets faster and stops breaking when Instagram's links expire.
18. **Image delivery check** (S–M): AVIF/WebP everywhere, and correct `sizes` on
    every image. Galleries are the product.
19. **Structured data for Google** (S): Person/Organization, ImageGallery,
    Article.
20. **Accessibility pass** (M): alt text asked for on upload, visible focus
    states, colour contrast.
21. **Simple visitor stats in Admin** (M): views are already recorded by
    `ViewTracker`; show them.
22. **Error monitoring** (S): e.g. Sentry, so a broken page is known before a
    visitor reports it. Also confirm database backups (Supabase
    point-in-time recovery) before other photographers join.

## Tier 5 — Before other photographers can sign up (the platform)

23. **Transactional email for the platform** (S, on top of item 1): sign-up
    confirmation, password reset, proofing selections, and later receipts.
    Also switch `MAIL_FROM_ADDRESS` to a verified lensgrid.co subdomain.
24. **Find the site by its address** (L, **critical, blocks every other item
    in this tier**)
    - Public pages and anonymous actions (contact form, sign-ups,
      favourites) must work out which photographer's site they belong to
      from the domain.
    - Today public reads use "row 1". Everything else in this tier depends on
      it.
25. **Sign-up and onboarding** (L)
    - Name, then "do you already own a domain?". Free plan:
      lensgrid.co/yourname; decide path vs subdomain here.
    - Then pick a template, upload a first gallery and publish, in under ten
      minutes.
    - Replace the hard-coded WeTravelPhoto defaults and logos with
      per-site ones.
26. **Plans and billing** (L): Stripe subscriptions, with limits enforced
    through `lib/entitlements.ts` (already stubbed).
27. **Custom domains** (M–L): connect a domain they own with guided
    instructions and live status. Paid plans can **buy one in a single step**
    (Vercel Domains API or a registrar API), connected automatically.
28. **Instagram how-to page with screenshots** (S), and later a "Connect
    Instagram" button (Meta login; needs Meta app review) (M).
29. **Super-admin at lensgrid.co** (L): every site, plan, usage, and support
    log-in as the photographer.
30. **Backups and export** (M): photographers can download their site and
    photos. A trust feature.
31. **Lens Grid marketing site** (M–L) at lensgrid.co: what it is, pricing,
    examples, sign-up.

## Tier 6 — Growth and the photographer's business

32. **Client galleries, fuller proofing** (L): comments, download limits,
    passwords and expiry dates, and a "final selection" email.
33. **Watermarks** on proofing images (M).
34. **Print store checkout** (L), **on hold by decision**: Stripe plus a print
    lab (Prodigi, WHCC or Printful).
35. **AI assistant in the editor** (L, after item 13)
    - Start with writing help, then "build me a page", style suggestions, and
      a wordmark/logo maker.
    - Scoped to site tasks, metered per plan, and everything it does lands in
      the draft. Design notes are in `claude/lens-grid-platform.md`.
36. **Camera details (EXIF)** in the lightbox, optional (S).
37. **3–5 layouts per section type plus ~5 templates** (L), **last by
    decision**. Templates become preset pages (e.g. "Weddings") built from
    the new sections.

---

## Done (for reference)

**Security and editor basics:**
- security sweep;
- spacing, background and show-on per section;
- duplicate and "+ between";
- undo/redo;
- keyboard shortcuts.

**Pages and sharing:**
- per-page search and sharing settings;
- custom pages and the menu builder;
- header and footer in the editor;
- version history;
- private review links;
- editable 404 page.

**Editor capabilities:**
- scaled real-width preview;
- per-section typography;
- instant slider feedback;
- all six built-in pages in the editor;
- the admin and the editor in one typeface (Inter);
- thumbnails in "Add a section";
- upload photographs from inside the editor;
- a photograph behind any section, and a per-section width.

**Messages and sign-ups:**
- contact email;
- spam protection (code built);
- newsletter connectors;
- daily Instagram sync.

**Site identity:**
- site icon (favicon) upload.

## Recommended next step

Tier 2 has one item left: **12, the contrast warning and custom font upload**.
The warning is worth more now than it was this morning — a photograph behind a
section is the easiest way yet to end up with words nobody can read, and the
editor should say so rather than leave it to be noticed on a phone in daylight.

After that, Tier 3 item 13: the **new section types**, starting with
pricing/packages, FAQ and testimonials. Those are what a Weddings or Workshops
page actually needs, and everything built in Tier 2 — spacing, background,
width, shortcuts, the picker, the thumbnails — is machinery each new type gets
for free.

---

## What today's trouble means at selling scale

Written 2026-09-23, after a day of DNS, SMTP, DMARC and expired links.

**Most of it does not recur.** Everything above was first-time setup, done once
for the platform rather than once per customer: the address resolution, the
sending domain, the authentication records, the single-tenant leftovers in the
schema. The second photographer costs none of it.

### Disappears

- **DNS per tester.** A wildcard removes it entirely (see
  `claude/cloudflare-move.md`). Required by item 25 anyway.
- **The single-site leftovers.** `single_row`, WeTravelPhoto's logos as the
  default — one-time debts from a codebase that used to serve one site. Found
  by a friend rather than a customer, which is the whole point of this round.

### Gets BETTER with scale

- **Spam.** Counter-intuitive but true: reputation is earned by steady volume
  from an authenticated domain. A brand-new sender with no history is the
  hardest case there is, and that is exactly where we are. It improves from
  here, provided the records stay right.

### Gets worse, and needs real work

- **Prefetched links.** More corporate recipients means more scanners —
  Outlook Safe Links opens every link in every message by policy. This is
  permanently solved by the six-digit code, which is why every serious SaaS
  ships one. Worth remembering *why* it is there before anyone "simplifies" it
  away.
- **Email volume.** Supabase's custom-SMTP default is 30 messages an hour.
  Adjustable, and it will need adjusting.
- **Deliverability becomes a job, not a setup.** Google Postmaster Tools,
  bounce and complaint handling, and eventually **separate subdomains for
  separate kinds of mail** — one photographer's newsletter complaints must not
  sink everybody's password resets. Resend's own guidance: transactional and
  marketing from different verified subdomains.
- **Support.** Today a problem is debugged in a chat window. At fifty
  customers it needs item 29 (log in as the photographer) and item 22 (error
  monitoring), or every fault arrives as "it's broken" with no detail.

### Must be decided before money changes hands

- **Vercel's Hobby plan forbids commercial use.** Their words: "the Hobby plan
  restricts users to non-commercial, personal use only." It also caps **50
  domains per project**, which is a hard ceiling on tenants; Pro is unlimited.
  Pro is $20/seat/month. **This is a blocker for selling, not a nice-to-have.**
- Supabase's free tier has the same shape of question — check its limits
  against real usage before the first invoice goes out.
- Legal pages (item 15) and billing (item 26) are both on this list already.
  Selling also brings taxes, refunds and a support address.
