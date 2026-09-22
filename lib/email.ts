/**
 * SENDING EMAIL — the platform's own
 * ═════════════════════════════════
 *
 * One account for the whole platform (Resend), set up once by Lens Grid, not
 * by each photographer. That is the point: a photographer never touches DNS
 * or an email service to get their contact-form messages. They only say
 * where messages should go (Settings → Contact form messages).
 *
 * Mail goes out FROM the platform's address, with the site's own name as the
 * sender name ("WeTravelPhoto <messages@…>"), and Reply-To set to the visitor,
 * so pressing Reply answers the visitor directly.
 *
 * Configured by two server-only environment variables:
 *   RESEND_API_KEY      the platform's Resend key
 *   MAIL_FROM_ADDRESS   an address on a domain verified in Resend. Today that
 *                       is wetravelphoto.com; once lensgrid.co exists it
 *                       becomes e.g. messages@mail.lensgrid.co for every site.
 *
 * Without them nothing is sent, and everything that uses this keeps working:
 * messages are still stored and shown in Admin → Messages.
 *
 * Plain fetch to Resend's REST API rather than an SDK: one call, no extra
 * dependency, and easy to point at another provider later.
 */

export type EmailResult = { ok: true; id: string | null } | { ok: false; error: string }

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM_ADDRESS
}

/** A display name that cannot break out of the From header. */
function senderName(name: string): string {
  return name.replace(/[<>"\\\r\n]/g, '').trim().slice(0, 60) || 'Your website'
}

/** Escapes text for the HTML version of an email. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function sendEmail(input: {
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string
  /** Shown as the sender's name: the photographer's site. */
  fromName: string
}): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM_ADDRESS
  if (!key || !from) return { ok: false, error: 'Email sending is not set up on the server yet.' }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${senderName(input.fromName)} <${from}>`,
        to: [input.to],
        subject: input.subject.replace(/[\r\n]+/g, ' ').slice(0, 200),
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    })

    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string }
    if (!response.ok) return { ok: false, error: body.message ?? `The email service said ${response.status}.` }
    return { ok: true, id: body.id ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not reach the email service.' }
  }
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
