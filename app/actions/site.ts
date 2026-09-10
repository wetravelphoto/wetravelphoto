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
  let heroTitles: Record<string, string> = {}
  try {
    heroTitles = JSON.parse((formData.get('hero_titles') as string) || '{}')
  } catch {
    heroTitles = {}
  }

  await patch(
    {
      featured_post_ids: featuredIds,
      hero_titles: heroTitles,
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
    },
    ['/']
  )
}
