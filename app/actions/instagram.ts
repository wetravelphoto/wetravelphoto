'use server'

import { createClient } from '@/lib/supabase/server'
import { syncInstagram, refreshInstagramToken } from '@/lib/instagram'
import { revalidatePath } from 'next/cache'

export async function saveInstagramToken(formData: FormData) {
  const token = (formData.get('instagram_token') as string)?.trim()
  const handle = (formData.get('instagram_handle') as string)?.trim() || null

  const supabase = await createClient()

  const updates: Record<string, unknown> = { instagram_handle: handle }
  if (token) {
    updates.instagram_token = token
    // Assume a fresh long-lived token; the first refresh will correct this
    updates.instagram_token_expires = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString()
  }

  await supabase.from('site_settings').update(updates).eq('id', 1)

  if (token) await syncInstagram()

  revalidatePath('/admin/settings')
  revalidatePath('/')
}

export async function disconnectInstagram() {
  const supabase = await createClient()

  await supabase
    .from('site_settings')
    .update({ instagram_token: null, instagram_token_expires: null, instagram_synced_at: null })
    .eq('id', 1)

  await supabase.from('instagram_media').delete().neq('id', '')

  revalidatePath('/admin/settings')
  revalidatePath('/')
}

export async function syncNow() {
  const result = await syncInstagram()
  revalidatePath('/admin/settings')
  revalidatePath('/')
  return result
}

export async function refreshTokenNow() {
  const result = await refreshInstagramToken()
  revalidatePath('/admin/settings')
  return result
}

export async function updateInstagramDisplay(formData: FormData) {
  const supabase = await createClient()

  await supabase
    .from('site_settings')
    .update({
      show_instagram: formData.get('show_instagram') === 'on',
      instagram_heading: (formData.get('instagram_heading') as string)?.trim() || null,
    })
    .eq('id', 1)

  revalidatePath('/admin/settings')
  revalidatePath('/')
}
