# The emails Supabase sends

Supabase's auth emails are edited in a dashboard — **Authentication → Emails →
Templates** — which means they live nowhere anybody can read them, review them
or get them back. These files are the copy of record. Change them here, then
paste.

Why they are written the way they are: Supabase's stock templates are one
sentence and a bare link, which is the exact shape of a phishing email and is
scored accordingly. Everything here is a deliberate "this is real mail from a
real sender" signal —

- the sender is named, in words, in the body;
- it says **why** this arrived, which is the single strongest ham signal a
  transactional email has;
- the destination address is written out, so the link is not the only thing
  carrying meaning;
- no images, no tracking pixels, no web fonts, no buttons built from nested
  tables — light HTML scores better and reads better;
- one link, to one domain, and **the same domain the mail is sent from**. A
  message from `@wetravelphoto.com` linking to `lensgrid.co` is the thing spam
  filters are built to catch.

Variables Supabase substitutes: `{{ .ConfirmationURL }}`, `{{ .Token }}`,
`{{ .TokenHash }}`, `{{ .SiteURL }}`, `{{ .Email }}`, `{{ .RedirectTo }}`.

`{{ .Token }}` is the six-digit code. It is included in both templates on
purpose: a code cannot be spent by a link scanner, so when a link arrives
already "expired" — see `claude/beta-readiness.md` — the code in the same email
is the way in, once there is a screen to type it into.
