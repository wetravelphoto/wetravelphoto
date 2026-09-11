'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Settings are split by page so each form only writes its own fields —
 * a single shared action would blank out anything not present in the form.
 */
async function patch(values: Record<string, unknown>, paths: string[]) {
  const supabase = await createClient()
  const { error } = await supabase.from('site_settings').update(values).eq('id', 1)
  if (error) throw new Error(error.message)

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

export async function updateHomepage(formData: FormData) {
  const featuredIds = (text(formData, 'featured_post_ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const count = parseInt((formData.get('journal_count') as string) ?? '3', 10)

  // Hero display names, keyed by story id — the story's own title is untouched
  const parseJson = <T,>(key: string, fallback: T): T => {
    try {
      return JSON.parse((formData.get(key) as string) || 'null') ?? fallback
    } catch {
      return fallback
    }
  }

  const heroTitles = parseJson<Record<string, string>>('hero_titles', {})
  const heroSubtitles = parseJson<Record<string, string>>('hero_subtitles', {})
  const typeStyles = parseJson<Record<string, unknown>>('type_styles', {})
  const heroFocal = parseJson<Record<string, unknown>>('hero_focal', {})
  const heroFixedFocal = parseJson<Record<string, unknown>>('hero_fixed_focal', {})

  await patch(
    {
      featured_post_ids: featuredIds,
      hero_titles: heroTitles,
      hero_subtitles: heroSubtitles,
      hero_focal: heroFocal,
      hero_title_position: text(formData, 'hero_title_position') ?? 'center',
      hero_show_mark: on(formData, 'hero_show_mark'),

      hero_mode: text(formData, 'hero_mode') ?? 'stories',
      hero_image_path: text(formData, 'hero_image_path'),
      hero_fixed_title: text(formData, 'hero_fixed_title'),
      hero_fixed_subtitle: text(formData, 'hero_fixed_subtitle'),
      hero_fixed_cta_label: text(formData, 'hero_fixed_cta_label'),
      hero_fixed_cta_href: text(formData, 'hero_fixed_cta_href'),
      hero_fixed_focal: heroFixedFocal,
      type_styles: typeStyles,
      hero_kicker: text(formData, 'hero_kicker'),

      show_intro: on(formData, 'show_intro'),
      intro_kicker: text(formData, 'intro_kicker'),
      intro_heading: text(formData, 'intro_heading'),
      intro_body: text(formData, 'intro_body'),
      intro_image_path: text(formData, 'intro_image_path'),
      intro_image_side: text(formData, 'intro_image_side') ?? 'left',

      show_galleries: on(formData, 'show_galleries'),
      carousel_heading: text(formData, 'carousel_heading'),

      show_journal: on(formData, 'show_journal'),
      journal_heading: text(formData, 'journal_heading'),
      journal_count: isNaN(count) ? 3 : count,

      show_contact_section: on(formData, 'show_contact_section'),
      contact_heading: text(formData, 'contact_heading'),
      contact_eyebrow: text(formData, 'contact_eyebrow'),
      contact_note: text(formData, 'contact_note'),
      contact_tagline: text(formData, 'contact_tagline'),
      contact_image_path: text(formData, 'contact_image_path'),
      contact_image_side: text(formData, 'contact_image_side') ?? 'left',

      show_instagram: on(formData, 'show_instagram'),
      instagram_heading: text(formData, 'instagram_heading'),
    },
    ['/', '/admin/pages/home']
  )
}

export async function updateAboutPage(formData: FormData) {
  await patch(
    {
      about_heading: text(formData, 'about_heading'),
      about_body: text(formData, 'about_body'),
    },
    ['/about', '/admin/pages/about']
  )
}

export async function updateContactPage(formData: FormData) {
  await patch(
    {
      contact_intro: text(formData, 'contact_intro'),
      email_public: text(formData, 'email_public'),
    },
    ['/contact', '/', '/admin/pages/contact']
  )
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
