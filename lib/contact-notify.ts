import { createAdminClientOrNull } from '@/lib/supabase/admin'
import { getSiteSettings } from '@/lib/site'
import { EMAIL_PATTERN, escapeHtml, sendEmail } from '@/lib/email'

/**
 * A CONTACT MESSAGE, EMAILED TO THE PHOTOGRAPHER
 * ═══════════════════════════════════════════════
 *
 * The message is always stored first (Admin → Messages); this only tells the
 * photographer. It goes to the address set in Settings → Contact form
 * messages (or the site's public email), from the platform's address with
 * the site's name, and Reply-To is the visitor — so replying from the inbox
 * answers them directly.
 *
 * Never throws: a visitor's "message sent" must not depend on an email
 * service being up. How it went is written on the message, so Admin →
 * Messages can say "emailed" or why not.
 */
export async function notifyMessage(message: {
  id: string
  name: string
  email: string
  subject: string | null
  body: string
}): Promise<void> {
  const admin = createAdminClientOrNull()
  // The settings are read first because the tenant on them is what scopes the
  // write below. This client holds the service-role key and ignores row-level
  // security, so naming the site is the only thing keeping it to one.
  const settings = await getSiteSettings()

  const record = async (error: string | null) => {
    if (!admin || !settings.tenant_id) return
    await admin
      .from('contact_messages')
      .update(error ? { notify_error: error.slice(0, 300) } : { notified_at: new Date().toISOString(), notify_error: null })
      .eq('tenant_id', settings.tenant_id)
      .eq('id', message.id)
  }

  try {
    if (settings.contact_notify === false) return

    const to = settings.contact_notify_email || settings.email_public
    if (!to || !EMAIL_PATTERN.test(to)) {
      await record('No address to send to. Set one in Settings → Contact form messages.')
      return
    }

    const site = settings.site_title || 'your website'
    const subject = message.subject ? `${message.subject} — from ${message.name}` : `New message from ${message.name}`

    const text = [
      `${message.name} <${message.email}> wrote through the contact form on ${site}:`,
      '',
      message.subject ? `Subject: ${message.subject}\n` : '',
      message.body,
      '',
      '—',
      'Reply to this email to answer them directly. Every message is also kept in your admin under Messages.',
    ].join('\n')

    const html = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1c1d1f;max-width:560px">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7a7d82">New message · ${escapeHtml(site)}</p>
  <p style="margin:0 0 16px"><strong>${escapeHtml(message.name)}</strong> &lt;<a href="mailto:${escapeHtml(message.email)}" style="color:#1c1d1f">${escapeHtml(message.email)}</a>&gt;</p>
  ${message.subject ? `<p style="margin:0 0 8px;font-weight:600">${escapeHtml(message.subject)}</p>` : ''}
  <div style="white-space:pre-wrap;margin:0 0 24px">${escapeHtml(message.body)}</div>
  <p style="margin:0;font-size:12px;color:#7a7d82">Reply to this email to answer ${escapeHtml(message.name)} directly. Every message is also kept in your admin under Messages.</p>
</div>`

    const result = await sendEmail({
      to,
      subject,
      text,
      html,
      replyTo: message.email,
      fromName: site,
    })
    await record(result.ok ? null : result.error)
  } catch (e) {
    console.error('[contact] notify failed:', e instanceof Error ? e.message : e)
    await record(e instanceof Error ? e.message : 'Could not send the email.')
  }
}
