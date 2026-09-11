'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function sendMessage(formData: FormData) {
  const name = (formData.get('name') as string)?.trim()
  const email = (formData.get('email') as string)?.trim()
  const subject = (formData.get('subject') as string)?.trim() || null
  const message = (formData.get('message') as string)?.trim()
  // Bots fill hidden fields; humans leave them empty
  const honeypot = formData.get('website') as string

  if (honeypot) return { ok: true }
  if (!name || !email || !message) {
    return { ok: false, error: 'Please fill in every field.' }
  }
  if (message.length > 4000) {
    return { ok: false, error: 'That message is a bit too long.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('contact_messages').insert({ name, email, subject, message })

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

  const supabase = await createClient()
  const { error } = await supabase
    .from('site_settings')
    .update({
      site_title: get('site_title') ?? 'WeTravelPhoto',
      tagline: get('tagline'),
      about_heading: get('about_heading'),
      about_body: get('about_body'),
      contact_intro: get('contact_intro'),
      instagram_url: get('instagram_url'),
      email_public: get('email_public'),
    })
    .eq('id', 1)

  if (error) throw new Error(error.message)

  revalidatePath('/admin/site')
  revalidatePath('/about')
  revalidatePath('/contact')
  revalidatePath('/')
}
