import { createClient } from '@/lib/supabase/server'

export type SiteSettings = {
  site_title: string
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
