'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function sendMessage(formData: FormData) {
  const name = (formData.get('name') as string)?.trim()
  const email = (formData.get('email') as string)?.trim()
  const message = (formData.get('message') as string)?.trim()
  const honeypot = formData.get('website') as string

  if (honeypot) return { ok: true }
  if (!name || !email || !message) return { ok: false, error: 'Please fill in every field.' }
  if (message.length > 4000) return { ok: false, error: 'That message is a bit too long.' }

  const supabase = await createClient()
  const { error } = await supabase.from('contact_messages').insert({ name, email, message })

  if (error) return { ok: false, error: 'Something went wrong sending that. Try again?' }
  return { ok: true }
}

export async function markRead(id: string, isRead: boolean) {
  const supabase = await createClient()
  await supabase.from('contact_messages').update({ is_read: isRead }).eq('id', id)
  revalidatePath('/admin/messages')
}

export async function deleteMessage(id: string) {
  const supabase = await createClient()
  await supabase.from('contact_messages').delete().eq('id', id)
  revalidatePath('/admin/messages')
}

export async function updateSiteSettings(formData: FormData) {
  const get = (k: string) => (formData.get(k) as string)?.trim() || null

  const featuredIds = (get('featured_post_ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const supabase = await createClient()
  const { error } = await supabase
    .from('site_settings')
    .update({
      site_title: get('site_title') ?? 'WeTravelPhoto',
      tagline: get('tagline'),
      about_heading: get('about_heading'),
      about_body: get('about_body'),
      contact_intro: get('contact_intro'),
      contact_heading: get('contact_heading'),
      show_contact_section: formData.get('show_contact_section') === 'on',
      instagram_url: get('instagram_url'),
      email_public: get('email_public'),
      featured_post_ids: featuredIds,
      hero_kicker: get('hero_kicker'),
      intro_kicker: get('intro_kicker'),
      intro_heading: get('intro_heading'),
      intro_body: get('intro_body'),
      intro_image_path: get('intro_image_path'),
      intro_image_side: get('intro_image_side') ?? 'left',
      carousel_source: get('carousel_source') ?? 'albums',
      carousel_heading: get('carousel_heading'),
      show_newsletter: formData.get('show_newsletter') === 'on',
      newsletter_heading: get('newsletter_heading'),
      newsletter_body: get('newsletter_body'),
    })
    .eq('id', 1)

  if (error) throw new Error(error.message)

  revalidatePath('/admin/site')
  revalidatePath('/about')
  revalidatePath('/contact')
  revalidatePath('/')
}
