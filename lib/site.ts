import { createClient } from '@/lib/supabase/server'

export type SiteSettings = {
  site_title: string
  owner_name: string | null

  logo_header_path: string | null
  logo_footer_path: string | null
  logo_bird_path: string | null
  logo_header_height: number
  logo_footer_height: number
  logo_bird_size: number
  show_bird: boolean
  show_about: boolean
  header_align: string
  header_nav_font: string
  header_nav_scale: number
  footer_align: string
  footer_font: string
  footer_scale: number
  footer_copy: string | null
  galleries_eyebrow: string | null
  galleries_heading: string | null
  journal_page_eyebrow: string | null
  journal_page_heading: string | null
  tagline: string | null
  about_heading: string | null
  about_body: string | null
  contact_intro: string | null
  instagram_url: string | null
  facebook_url: string | null
  youtube_url: string | null
  email_public: string | null

  featured_post_ids: string[]
  hero_titles: Record<string, string>
  hero_subtitles: Record<string, string>
  hero_focal: Record<string, { x: number; y: number; mx: number; my: number }>
  hero_title_position: string
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

  show_newsletter: boolean
  newsletter_heading: string | null
  newsletter_body: string | null

  show_instagram: boolean
  instagram_heading: string | null
  instagram_handle: string | null
  instagram_token: string | null
  instagram_token_expires: string | null
  instagram_synced_at: string | null
}

const FALLBACK: SiteSettings = {
  site_title: 'WeTravelPhoto',
  owner_name: null,
  logo_header_path: null,
  logo_footer_path: null,
  logo_bird_path: null,
  logo_header_height: 34,
  logo_footer_height: 130,
  logo_bird_size: 64,
  show_bird: true,
  show_about: true,
  header_align: 'split',
  header_nav_font: 'Oswald',
  header_nav_scale: 1,
  footer_align: 'left',
  footer_font: 'Karla',
  footer_scale: 1,
  footer_copy: null,
  galleries_eyebrow: null,
  galleries_heading: null,
  journal_page_eyebrow: null,
  journal_page_heading: null,
  tagline: 'Travel photography and field notes',
  about_heading: 'About',
  about_body: null,
  contact_intro: null,
  instagram_url: null,
  facebook_url: null,
  youtube_url: null,
  email_public: null,
  featured_post_ids: [],
  hero_titles: {},
  hero_subtitles: {},
  hero_focal: {},
  hero_title_position: 'center',
  hero_show_mark: true,
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
  show_newsletter: true,
  newsletter_heading: null,
  newsletter_body: null,
  show_instagram: false,
  instagram_heading: null,
  instagram_handle: null,
  instagram_token: null,
  instagram_token_expires: null,
  instagram_synced_at: null,
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const supabase = await createClient()
  const { data } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle()
  return (data as SiteSettings) ?? FALLBACK
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
}
