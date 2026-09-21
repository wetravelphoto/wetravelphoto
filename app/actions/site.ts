'use server'

import { revalidatePath } from 'next/cache'
import { patchSiteSettings } from '@/lib/site-patch'
import { syncContactSection } from '@/lib/sections/sync'
import { requireUser } from '@/lib/auth'

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
  await requireUser()
  await patchSiteSettings(values)

  revalidatePath('/admin/settings')
  paths.forEach((p) => revalidatePath(p))
}

const text = (formData: FormData, key: string) => (formData.get(key) as string)?.trim() || null

const decimalFrom = (formData: FormData, key: string, fallback: number) => {
  const value = parseFloat((formData.get(key) as string) ?? '')
  return Number.isNaN(value) ? fallback : value
}
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

export async function updateAboutPage(formData: FormData) {
  await patch(
    {
      show_about: on(formData, 'show_about'),
      about_eyebrow: text(formData, 'about_eyebrow'),
      about_heading: text(formData, 'about_heading'),
      about_body: text(formData, 'about_body'),
      about_image_path: text(formData, 'about_image_path'),
      about_image_side: text(formData, 'about_image_side') ?? 'left',
      about_cta_label: text(formData, 'about_cta_label'),
      about_cta_href: text(formData, 'about_cta_href'),
      nav_about_label: text(formData, 'nav_about_label'),
    },
    ['/about', '/admin/pages/about', '/']
  )
}

export async function updateContactPage(formData: FormData) {
  await patch(
    {
      show_contact_section: on(formData, 'show_contact_section'),
      contact_eyebrow: text(formData, 'contact_eyebrow'),
      contact_heading: text(formData, 'contact_heading'),
      contact_intro: text(formData, 'contact_intro'),
      contact_note: text(formData, 'contact_note'),
      contact_tagline: text(formData, 'contact_tagline'),
      contact_image_path: text(formData, 'contact_image_path'),
      contact_image_side: text(formData, 'contact_image_side') ?? 'left',
      email_public: text(formData, 'email_public'),
      nav_contact_label: text(formData, 'nav_contact_label'),
    },
    ['/contact', '/', '/admin/pages/contact']
  )

  // The same copy drives the homepage's contact section — live, and in the
  // canvas's draft if one is open.
  await syncContactSection('home')
}

export async function updateNewsletter(formData: FormData) {
  await patch(
    {
      show_newsletter: on(formData, 'show_newsletter'),
      newsletter_heading: text(formData, 'newsletter_heading'),
      newsletter_body: text(formData, 'newsletter_body'),
      footer_note: text(formData, 'footer_note'),
    },
    ['/']
  )
}


export async function updateJournalPage(formData: FormData) {
  await patch(
    {
      journal_page_eyebrow: text(formData, 'journal_page_eyebrow'),
      journal_page_heading: text(formData, 'journal_page_heading'),
      journal_show_excerpt: on(formData, 'journal_show_excerpt'),
      journal_show_date: on(formData, 'journal_show_date'),
      journal_show_byline: on(formData, 'journal_show_byline'),
      journal_title_scale: decimalFrom(formData, 'journal_title_scale', 1),
      nav_journal_label: text(formData, 'nav_journal_label'),
    },
    ['/journal', '/admin/pages/journal']
  )
}

export async function updateGalleriesPage(formData: FormData) {
  await patch(
    {
      galleries_eyebrow: text(formData, 'galleries_eyebrow'),
      galleries_heading: text(formData, 'galleries_heading'),
      nav_galleries_label: text(formData, 'nav_galleries_label'),
    },
    ['/trips', '/admin/pages/galleries']
  )
}

export async function updateShopPage(formData: FormData) {
  const shipping = parseFloat(
    ((formData.get('shop_shipping_flat') as string) ?? '').replace(/[$,\s]/g, '')
  )

  // Anything outside 2–5 would be rejected by the database check anyway, and a
  // silent fallback beats a saved form that throws.
  const typedColumns = Number(formData.get('shop_columns'))
  const columns = Number.isFinite(typedColumns)
    ? Math.min(5, Math.max(2, Math.round(typedColumns)))
    : 3

  await patch(
    {
      show_shop: on(formData, 'show_shop'),
      shop_mode: text(formData, 'shop_mode') ?? 'curated',
      shop_eyebrow: text(formData, 'shop_eyebrow'),
      shop_heading: text(formData, 'shop_heading'),
      shop_intro: text(formData, 'shop_intro'),
      shop_order_note: text(formData, 'shop_order_note'),
      nav_shop_label: text(formData, 'nav_shop_label'),
      // Typed in dollars, stored in cents
      shop_shipping_flat_cents:
        Number.isFinite(shipping) && shipping >= 0 ? Math.round(shipping * 100) : 0,

      // ── The wall ──────────────────────────────────────────────────────────
      shop_subheading: text(formData, 'shop_subheading'),
      shop_columns: columns,
      shop_show_collection: on(formData, 'shop_show_collection'),
      shop_show_location: on(formData, 'shop_show_location'),
      shop_show_price: on(formData, 'shop_show_price'),
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
    ['/shop', '/', '/admin/pages/shop']
  )
}
