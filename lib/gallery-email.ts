/**
 * "YOUR GALLERY IS READY" — the email a photographer sends a client
 * ═════════════════════════════════════════════════════════════════
 *
 * Pure: the template, the HTML and the text versions, and the recipient rules
 * the send limit relies on (the limit itself is the database's). The
 * Sharing tab's composer renders its live preview with `renderGalleryEmailHtml`
 * and the server action sends the output of the very same function, so the
 * preview is the email.
 *
 * The email leads with the photograph and one "View gallery" button. The raw
 * link is never the main content — one small "button not working?" line at
 * the bottom carries it for the mail clients that strip buttons.
 */

export type GalleryEmailInput = {
  subject: string
  message: string
  albumTitle: string
  photographerName: string
  /** Absolute URL of the cover photograph, or null for none. */
  coverUrl: string | null
  /** Absolute URL of the client's gallery: <origin>/gallery/<token>. */
  galleryUrl: string
}

export const SUBJECT_MAX = 160
export const MESSAGE_MAX = 2000

/** The first word of a name, for the greeting. */
export function firstName(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return first.slice(0, 40)
}

/** The editable defaults: the approved subject, and a short, warm note in the photographer's voice. */
export function defaultGalleryEmail(input: { albumTitle: string; clientName: string | null; photographerName: string }) {
  const hello = firstName(input.clientName)
  return {
    subject: `Your gallery is ready: ${input.albumTitle}`.slice(0, SUBJECT_MAX),
    message: [
      hello ? `Hi ${hello},` : 'Hi,',
      '',
      'Your photographs are ready. It was a real pleasure making them with you, and I hope you love them as much as I do.',
      '',
      input.photographerName,
    ].join('\n'),
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Only an http(s) URL is ever written into an attribute. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export function clampEmailFields(subject: unknown, message: unknown): { subject: string; message: string } {
  const s = typeof subject === 'string' ? subject.replace(/[\r\n]+/g, ' ').trim().slice(0, SUBJECT_MAX) : ''
  const m = typeof message === 'string' ? message.replace(/\r\n/g, '\n').trim().slice(0, MESSAGE_MAX) : ''
  return { subject: s, message: m }
}

/** The message's paragraphs as HTML: blank lines split paragraphs, single newlines become breaks. */
function paragraphs(message: string): string {
  return message
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.65;color:#2b2622;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`
    )
    .join('')
}

/**
 * The email. Table layout and inline styles, because that is what mail
 * clients render; every piece of text is escaped and every URL checked.
 */
export function renderGalleryEmailHtml(input: GalleryEmailInput): string {
  const gallery = safeUrl(input.galleryUrl) ?? '#'
  const cover = safeUrl(input.coverUrl)
  const title = escapeHtml(input.albumTitle)
  const name = escapeHtml(input.photographerName)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f0ea;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f0ea;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#faf9f6;">
<tr><td style="padding:28px 36px 20px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#6b655e;">${name}</td></tr>
${cover ? `<tr><td style="padding:0;"><a href="${escapeHtml(gallery)}" style="text-decoration:none;"><img src="${escapeHtml(cover)}" width="600" alt="${title}" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></a></td></tr>` : ''}
<tr><td style="padding:36px 36px 8px;">
<h1 style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:32px;line-height:1.15;color:#141210;">${title}</h1>
${paragraphs(input.message)}
</td></tr>
<tr><td style="padding:12px 36px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:#141210;"><a href="${escapeHtml(gallery)}" style="display:inline-block;padding:16px 36px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#faf9f6;text-decoration:none;">View gallery</a></td>
</tr></table>
</td></tr>
<tr><td style="padding:20px 36px 28px;border-top:1px solid #e6e1d8;font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a857e;">Button not working? Paste this into your browser: <a href="${escapeHtml(gallery)}" style="color:#8a857e;word-break:break-all;">${escapeHtml(gallery)}</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

/** The plain-text version, for clients that read text — and for "Copy email" when sending is not set up. */
export function renderGalleryEmailText(input: GalleryEmailInput): string {
  return `${input.message.trim()}\n\nView gallery: ${input.galleryUrl}\n`
}

// ── Sending ─────────────────────────────────────────────────────────────────

/** The sender address. Overridable for a domain still being verified; never a photographer's own. */
export function galleryFromAddress(): string {
  return process.env.GALLERY_MAIL_FROM?.trim() || 'galleries@lensgrid.co'
}

/** Whether the server can send at all: the Resend key is the switch. */
export function galleryEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

/** "Karla Mata via Lens Grid" — the photographer's name, never able to break out of the From header. */
export function galleryFromName(photographer: string, platform: string): string {
  const clean = photographer.replace(/[<>"\\\r\n,;]/g, '').trim().slice(0, 60)
  return clean ? `${clean} via ${platform}` : platform
}

/**
 * The recipient as the database counts it: `lower(btrim(email))` in
 * reserve_gallery_email_send (2026-11-22_gallery_email_send_limits.sql).
 * `btrim` with no second argument strips spaces only, so this does too.
 */
export function normalizeRecipient(email: unknown): string {
  return typeof email === 'string' ? email.replace(/^ +| +$/g, '').toLowerCase() : ''
}

/**
 * The site id exactly as `p_tenant::text` prints it: hyphenated, lowercase
 * hex. Any other spelling (braces, no hyphens, not hex) is null — PostgreSQL
 * would accept some of them and print them differently, so they cannot be
 * hashed here with confidence.
 */
export function canonicalTenantId(id: unknown): string | null {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : null
}

/**
 * The text whose SHA-256 the database returns with a reservation —
 * `<site id>:<lower(btrim(email))>` in UTF-8 — or null where this side cannot
 * reproduce `lower()` with certainty. Only printable ASCII is supported: its
 * lowercasing is the same in JavaScript and in PostgreSQL's usual locales, and
 * its UTF-8 is itself. Anything else is null, so the send fails closed rather
 * than skipping the comparison. (Under a locale that lowercases ASCII
 * differently the digests would simply disagree, which also sends nothing.)
 */
export function recipientBindingText(tenantId: unknown, email: unknown): string | null {
  const tenant = canonicalTenantId(tenantId)
  if (!tenant || typeof email !== 'string') return null
  // Checked BEFORE lowercasing: JavaScript folds some non-ASCII letters into
  // ASCII (U+212A KELVIN SIGN → "k"), and PostgreSQL may not.
  const trimmed = email.replace(/^ +| +$/g, '')
  if (!trimmed || !/^[\x21-\x7e]+$/.test(trimmed)) return null
  return `${tenant}:${normalizeRecipient(trimmed)}`
}

/**
 * The address a send goes to, or null when it cannot be one: no line breaks
 * or other whitespace (it is written into a header), exactly one "@" with
 * something either side, and bounded.
 */
export function sendableRecipient(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const to = email.replace(/^ +| +$/g, '')
  if (!to || to.length > 254 || /[\s<>,;"]/.test(to)) return null
  for (let i = 0; i < to.length; i++) {
    const code = to.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return null
  }
  const at = to.indexOf('@')
  return at > 0 && at === to.lastIndexOf('@') && at < to.length - 1 ? to : null
}

/**
 * THE SEND LIMIT IS IN THE DATABASE: lib/gallery-email-send.ts reserves every
 * provider attempt through the RPC `reserve_gallery_email_send`, which counts
 * at most 30 per site and 3 per recipient per site in any rolling hour, across
 * every server instance. These figures mirror the function's constants; they
 * are not enforced here.
 */
export const GALLERY_EMAIL_LIMITS = [
  { key: 'tenant', max: 30, windowMs: 60 * 60 * 1000 },
  { key: 'recipient', max: 3, windowMs: 60 * 60 * 1000 },
]

/**
 * The RPC's one answer that can permit a send: `reserved:` and the 64
 * lowercase-hex SHA-256 of the recipient it charged
 * (2026-11-22_gallery_email_recipient_binding.sql, Supabase 20261123002952).
 * Anything else — the old bare 'reserved', a limit, an error — means no send.
 */
export const RESERVED_ANSWER = /^reserved:([0-9a-f]{64})$/

/** The digest from an exact reservation answer, or null for any other answer. */
export function reservationDigest(data: unknown): string | null {
  if (typeof data !== 'string') return null
  const m = RESERVED_ANSWER.exec(data)
  return m ? m[1]! : null
}

/** How long a send waits for its reservation before giving up and sending nothing (the function's own lock_timeout is 5s). */
export const RESERVE_TIMEOUT_MS = 8000

/**
 * A fixed-window, in-memory limiter. NOT the send limit, and not used to
 * send: each serverless instance would count on its own. Kept only because
 * .mk/client-gallery-v2.ts still exercises it directly; removable with that.
 */
export function createRateLimiter(limits: { key: string; max: number; windowMs: number }[] = []) {
  const hits = new Map<string, number[]>()
  return {
    /** True and recorded when every limit has room; false (nothing recorded) otherwise. */
    take(keys: Record<string, string>, now = Date.now()): boolean {
      for (const l of limits) {
        const k = `${l.key}:${keys[l.key]}`
        const recent = (hits.get(k) ?? []).filter((t) => now - t < l.windowMs)
        hits.set(k, recent)
        if (recent.length >= l.max) return false
      }
      for (const l of limits) hits.get(`${l.key}:${keys[l.key]}`)!.push(now)
      return true
    },
  }
}
