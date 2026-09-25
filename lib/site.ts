import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { currentSite } from '@/lib/tenant'

export type SiteSettings = {
  /** The site this row belongs to. Present on every stored row; absent on the built-in fallback. */
  tenant_id?: string
  site_title: string
  owner_name: string | null

  logo_header_path: string | null
  logo_footer_path: string | null
  logo_bird_path: string | null
  /** The site icon shown on the browser tab. Uploaded in Settings → Site icon. */
  favicon_path: string | null
  logo_header_height: number
  logo_footer_height: number
  logo_bird_size: number
  show_bird: boolean
  show_about: boolean
  header_align: string
  header_nav_font: string
  header_nav_scale: number
  header_nav_scale_mobile: number
  logo_header_height_mobile: number
  footer_align: string
  footer_font: string
  footer_scale: number
  footer_scale_mobile: number
  logo_footer_height_mobile: number
  footer_copy: string | null
  galleries_eyebrow: string | null
  galleries_heading: string | null
  journal_page_eyebrow: string | null
  journal_page_heading: string | null
  journal_show_excerpt: boolean
  journal_show_date: boolean
  journal_show_byline: boolean
  journal_title_scale: number
  tagline: string | null
  about_heading: string | null
  about_body: string | null
  about_eyebrow: string | null
  about_image_path: string | null
  about_image_side: 'left' | 'right'
  about_cta_label: string | null
  about_cta_href: string | null

  nav_galleries_label: string | null
  nav_journal_label: string | null
  nav_about_label: string | null
  nav_contact_label: string | null
  contact_intro: string | null
  instagram_url: string | null
  facebook_url: string | null
  youtube_url: string | null
  email_public: string | null
  /** Email each contact-form message to the photographer (lib/contact-notify.ts). */
  contact_notify: boolean
  /** Where those emails go. Empty: the public email address. */
  contact_notify_email: string | null

  featured_post_ids: string[]
  hero_titles: Record<string, string>
  hero_subtitles: Record<string, string>
  hero_focal: Record<string, { x: number; y: number; mx: number; my: number }>
  hero_title_position: string
  hero_story_align: 'left' | 'center'
  hero_show_mark: boolean
  hero_mode: 'stories' | 'fixed'
  hero_image_path: string | null
  hero_fixed_title: string | null
  hero_fixed_subtitle: string | null
  hero_fixed_cta_label: string | null
  hero_fixed_cta_href: string | null
  hero_fixed_focal: { x?: number; y?: number; mx?: number; my?: number }
  hero_kicker: string | null

  show_intro: boolean
  intro_kicker: string | null
  intro_heading: string | null
  intro_body: string | null
  intro_image_path: string | null
  intro_image_side: 'left' | 'right'

  show_galleries: boolean
  carousel_heading: string | null

  show_journal: boolean
  journal_heading: string | null
  journal_count: number

  show_contact_section: boolean
  contact_heading: string | null
  contact_eyebrow: string | null
  contact_note: string | null
  contact_tagline: string | null
  contact_image_side: 'left' | 'right'
  footer_note: string | null
  contact_image_path: string | null
  type_styles: Record<string, { font?: string; color?: string; scale?: number }>
  /**
   * Search and sharing, per editor page (lib/seo.ts): { home: { title,
   * description, image, noindex }, about: {…} }. Anything not set is worked out
   * from the page itself.
   */
  page_seo: Record<string, unknown>
  /** The photographer's own pages (lib/sections/pages.ts): [{ key, slug, title }]. */
  custom_pages: unknown[]
  /** The menu (lib/menu.ts). Null: never set, so the menu is built as it always was. */
  menu: unknown[] | null

  show_newsletter: boolean
  newsletter_heading: string | null
  newsletter_body: string | null

  show_instagram: boolean
  instagram_heading: string | null
  instagram_handle: string | null
  instagram_token: string | null
  instagram_token_expires: string | null
  instagram_synced_at: string | null

  show_shop: boolean
  shop_mode: 'curated' | 'all'
  shop_eyebrow: string | null
  shop_heading: string | null
  shop_intro: string | null
  nav_shop_label: string | null
  shop_currency: string
  shop_shipping_flat_cents: number
  shop_order_note: string | null
  shop_frames: Record<string, { path: string; top: number; left: number; width: number; height: number }>

  /** How the shop wall is laid out and labelled. */
  shop_subheading: string | null
  shop_columns: number
  shop_show_collection: boolean
  shop_show_location: boolean
  shop_show_price: boolean
  shop_wall_texture: string | null
  shop_title_font: string | null
  shop_quote: string | null
  shop_quote_by: string | null

  /** The product page's own words. */
  shop_corner_line: string | null
  shop_show_breadcrumbs: boolean
  shop_feature1_icon: string | null
  shop_feature1_title: string | null
  shop_feature1_body: string | null
  shop_feature2_icon: string | null
  shop_feature2_title: string | null
  shop_feature2_body: string | null
  shop_feature3_icon: string | null
  shop_feature3_title: string | null
  shop_feature3_body: string | null
  shop_related_overline: string | null
  shop_related_heading: string | null
  shop_footer_left: string | null
  shop_footer_right: string | null
  /** Which of the built-in rooms a print is shown hanging in. 'none' for none. */
  shop_room: string

  /**
   * Colour, typography and measure for the whole site. Shape and defaults live
   * in lib/styles/tokens.ts; this is only where the overrides are kept, so an
   * empty object means "the defaults", not "unstyled".
   */
  global_styles: Record<string, unknown>
  global_styles_version: number
}

/**
 * What a site looks like before it has said anything about itself — a brand
 * new tenant whose settings row has not been written yet, or an address with
 * no site behind it.
 *
 * Deliberately NOT named after any one photographer. It used to say
 * "WeTravelPhoto", which was harmless with one site and is a bug with two:
 * the first thing a new photographer would have seen is somebody else's name.
 */
const FALLBACK: SiteSettings = {
  site_title: 'A photography site',
  owner_name: null,
  logo_header_path: null,
  logo_footer_path: null,
  logo_bird_path: null,
  favicon_path: null,
  logo_header_height: 34,
  logo_footer_height: 130,
  logo_bird_size: 64,
  show_bird: true,
  show_about: true,
  header_align: 'split',
  header_nav_font: 'Oswald',
  header_nav_scale: 1,
  header_nav_scale_mobile: 1,
  logo_header_height_mobile: 26,
  footer_align: 'left',
  footer_font: 'Karla',
  footer_scale: 1,
  footer_scale_mobile: 1,
  logo_footer_height_mobile: 90,
  footer_copy: null,
  galleries_eyebrow: null,
  galleries_heading: null,
  journal_page_eyebrow: null,
  journal_page_heading: null,
  journal_show_excerpt: true,
  journal_show_date: false,
  journal_show_byline: false,
  journal_title_scale: 1,
  tagline: null,
  about_heading: 'About',
  about_body: null,
  about_eyebrow: null,
  about_image_path: null,
  about_image_side: 'left',
  about_cta_label: null,
  about_cta_href: null,
  nav_galleries_label: null,
  nav_journal_label: null,
  nav_about_label: null,
  nav_contact_label: null,
  contact_intro: null,
  instagram_url: null,
  facebook_url: null,
  youtube_url: null,
  email_public: null,
  contact_notify: true,
  contact_notify_email: null,
  featured_post_ids: [],
  hero_titles: {},
  hero_subtitles: {},
  hero_focal: {},
  hero_title_position: 'center',
  hero_story_align: 'left',
  hero_show_mark: false,
  hero_mode: 'stories',
  hero_image_path: null,
  hero_fixed_title: null,
  hero_fixed_subtitle: null,
  hero_fixed_cta_label: null,
  hero_fixed_cta_href: null,
  hero_fixed_focal: {},
  hero_kicker: null,
  show_intro: true,
  intro_kicker: null,
  intro_heading: null,
  intro_body: null,
  intro_image_path: null,
  intro_image_side: 'left',
  show_galleries: true,
  carousel_heading: null,
  show_journal: true,
  journal_heading: null,
  journal_count: 3,
  show_contact_section: true,
  contact_heading: null,
  contact_eyebrow: null,
  contact_note: null,
  contact_tagline: null,
  contact_image_side: 'left',
  footer_note: null,
  contact_image_path: null,
  type_styles: {},
  page_seo: {},
  custom_pages: [],
  menu: null,
  show_newsletter: true,
  newsletter_heading: null,
  newsletter_body: null,
  show_instagram: false,
  instagram_heading: null,
  instagram_handle: null,
  instagram_token: null,
  instagram_token_expires: null,
  instagram_synced_at: null,
  show_shop: false,
  shop_mode: 'curated',
  shop_eyebrow: null,
  shop_heading: null,
  shop_intro: null,
  nav_shop_label: null,
  shop_currency: 'usd',
  shop_shipping_flat_cents: 1200,
  shop_order_note: null,
  shop_frames: {},
  shop_subheading: null,
  shop_columns: 3,
  shop_show_collection: true,
  shop_show_location: true,
  shop_show_price: true,
  shop_wall_texture: null,
  shop_title_font: null,
  shop_quote: null,
  shop_quote_by: null,
  shop_corner_line: null,
  shop_show_breadcrumbs: true,
  shop_feature1_icon: null,
  shop_feature1_title: null,
  shop_feature1_body: null,
  shop_feature2_icon: null,
  shop_feature2_title: null,
  shop_feature2_body: null,
  shop_feature3_icon: null,
  shop_feature3_title: null,
  shop_feature3_body: null,
  shop_related_overline: null,
  shop_related_heading: null,
  shop_footer_left: null,
  shop_footer_right: null,
  shop_room: 'living-room',
  global_styles: {},
  global_styles_version: 1,
}

/**
 * This site's settings — the name, the palette, the typefaces, the menu, the
 * favicon. Every public page and every editor screen goes through here.
 *
 * It used to read `.eq('id', 1)`: one row, the same one for everybody. That
 * single line was the whole of "there is only one site", and replacing it is
 * most of what made a second one possible. The site now comes from the
 * address (lib/tenant.ts), and an address with nothing behind it gets the
 * neutral fallback rather than the first row in the table.
 *
 * Cached per request: the layout, the page, the sitemap and a dozen loaders
 * all ask, and without this that is a database round trip each.
 */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  const site = await currentSite()
  if (!site) return FALLBACK

  const supabase = await createClient()
  const { data } = await supabase
    .from('site_settings')
    .select('*')
    .eq('tenant_id', site.tenantId)
    .maybeSingle()

  return (data as SiteSettings) ?? FALLBACK
})

/**
 * This site's own address, with the scheme — for canonical URLs, Open Graph
 * tags, the sitemap and share links.
 *
 * A site answers to every address in `tenant_domains`, but it only CALLS one
 * of them home, and that is the one that belongs in a canonical tag. Falls
 * back to the configured platform address when the site has no primary yet
 * (a tester in their first ten minutes), and to localhost when there is no
 * configuration at all.
 */
export async function siteUrl(): Promise<string> {
  const site = await currentSite()
  if (site?.primaryHost) {
    const scheme = site.primaryHost.startsWith('localhost') || site.primaryHost.startsWith('127.') ? 'http' : 'https'
    return `${scheme}://${site.primaryHost}`
  }
  return platformUrl()
}

/** The address this deployment was configured for. Not a site's own address. */
export function platformUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
}
