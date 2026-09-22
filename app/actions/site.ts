'use server'

import { revalidatePath } from 'next/cache'
import { patchSiteSettings } from '@/lib/site-patch'
import { requireEditor } from '@/lib/auth'
import { getSiteSettings } from '@/lib/site'
import { EMAIL_PATTERN, emailConfigured, sendEmail } from '@/lib/email'

/**
 * Settings are split by page so each form only writes its own fields —
 * a single shared action would blank out anything not present in the form.
 *
 * The write itself, including the tolerance for a column the database does not
 * have yet, lives in lib/site-patch.ts so the section actions can use it too.
 */
async function patch(values: Record<string, unknown>, paths: string[]) {
  // Every action in this file writes through here, so this one check covers
  // them all. A server action is a public endpoint whatever page imports it;
  // row-level security is the backstop, not the gate.
  await requireEditor()
  await patchSiteSettings(values)

  revalidatePath('/admin/settings')
  paths.forEach((p) => revalidatePath(p))
}

const text = (formData: FormData, key: string) => (formData.get(key) as string)?.trim() || null

const on = (formData: FormData, key: string) => formData.get(key) === 'on'

export async function updateIdentity(formData: FormData) {
  await patch(
    {
      site_title: text(formData, 'site_title') ?? 'WeTravelPhoto',
      tagline: text(formData, 'tagline'),
      email_public: text(formData, 'email_public'),
      instagram_url: text(formData, 'instagram_url'),
      facebook_url: text(formData, 'facebook_url'),
      youtube_url: text(formData, 'youtube_url'),
    },
    ['/', '/about', '/contact']
  )
}

/**
 * The site's menu: what each link is called, and whether the About page
 * exists at all.
 *
 * These used to be scattered one per page form, which meant the header was
 * configured from six places. Navigation belongs to the site, not to any one
 * page, so it is set in one panel in Settings.
 */
export async function updateMenu(formData: FormData) {
  await patch(
    {
      show_about: on(formData, 'show_about'),
      nav_galleries_label: text(formData, 'nav_galleries_label'),
      nav_journal_label: text(formData, 'nav_journal_label'),
      nav_about_label: text(formData, 'nav_about_label'),
      nav_contact_label: text(formData, 'nav_contact_label'),
      nav_shop_label: text(formData, 'nav_shop_label'),
    },
    []
  )

  // The header and footer are drawn in the root layout, so every page.
  revalidatePath('/', 'layout')
}

/**
 * How the shop runs, and what its two pages share: open or closed, what is for
 * sale, shipping, each print's own page, the wall and the closing quote.
 *
 * The shop PAGE's own layout — its title lines, prints across, captions — is
 * a print-wall section in the canvas now, and deliberately not written here:
 * two forms writing one column is how a published change gets undone.
 */
export async function updateShopSettings(formData: FormData) {
  const shipping = parseFloat(
    ((formData.get('shop_shipping_flat') as string) ?? '').replace(/[$,\s]/g, '')
  )

  await patch(
    {
      show_shop: on(formData, 'show_shop'),
      shop_mode: text(formData, 'shop_mode') ?? 'curated',
      shop_order_note: text(formData, 'shop_order_note'),
      // Typed in dollars, stored in cents
      shop_shipping_flat_cents:
        Number.isFinite(shipping) && shipping >= 0 ? Math.round(shipping * 100) : 0,

      // ── The wall ──────────────────────────────────────────────────────────
      // An empty string is a plain wall; null means the plaster we ship with,
      // so the two have to stay distinguishable.
      shop_wall_texture: on(formData, 'shop_plain_wall')
        ? ''
        : text(formData, 'shop_wall_texture'),
      shop_title_font: text(formData, 'shop_title_font'),
      shop_quote: text(formData, 'shop_quote'),
      shop_quote_by: text(formData, 'shop_quote_by'),

      // ── The product page ──────────────────────────────────────────────────
      shop_corner_line: text(formData, 'shop_corner_line'),
      shop_show_breadcrumbs: on(formData, 'shop_show_breadcrumbs'),
      shop_feature1_icon: text(formData, 'shop_feature1_icon'),
      shop_feature1_title: text(formData, 'shop_feature1_title'),
      shop_feature1_body: text(formData, 'shop_feature1_body'),
      shop_feature2_icon: text(formData, 'shop_feature2_icon'),
      shop_feature2_title: text(formData, 'shop_feature2_title'),
      shop_feature2_body: text(formData, 'shop_feature2_body'),
      shop_feature3_icon: text(formData, 'shop_feature3_icon'),
      shop_feature3_title: text(formData, 'shop_feature3_title'),
      shop_feature3_body: text(formData, 'shop_feature3_body'),
      shop_related_overline: text(formData, 'shop_related_overline'),
      shop_related_heading: text(formData, 'shop_related_heading'),
      shop_footer_left: text(formData, 'shop_footer_left'),
      shop_footer_right: text(formData, 'shop_footer_right'),
    },
    ['/shop', '/admin/shop/settings']
  )
}

/**
 * Contact-form messages: whether each one is emailed to the photographer, and
 * to which address (empty: the public email). See lib/contact-notify.ts.
 */
export async function updateContactEmail(
  notify: boolean,
  address: string
): Promise<{ ok: boolean; message: string }> {
  const clean = address.trim() || null
  if (clean && (clean.length > 200 || !EMAIL_PATTERN.test(clean))) {
    return { ok: false, message: 'That email address doesn’t look right.' }
  }
  await patch({ contact_notify: notify === true, contact_notify_email: clean }, [])
  return { ok: true, message: 'Saved.' }
}

/** Sends a test email to the address messages go to, so the photographer can see it arrive. */
export async function sendTestEmail(): Promise<{ ok: boolean; message: string }> {
  await requireEditor()
  if (!emailConfigured()) {
    return { ok: false, message: 'Email sending is not set up on the server yet (RESEND_API_KEY and MAIL_FROM_ADDRESS).' }
  }
  const settings = await getSiteSettings()
  const to = settings.contact_notify_email || settings.email_public
  if (!to) return { ok: false, message: 'Add an address to send messages to first, and save.' }

  const site = settings.site_title || 'your website'
  const result = await sendEmail({
    to,
    fromName: site,
    subject: `Test: contact messages from ${site} reach you`,
    text: `This is a test from your website's settings.\n\nWhen someone uses the contact form on ${site}, their message will arrive here like this, and replying will answer them directly.`,
  })
  return result.ok
    ? { ok: true, message: `Sent to ${to}. Check your inbox (and the spam folder, the first time).` }
    : { ok: false, message: `Could not send: ${result.error}` }
}
