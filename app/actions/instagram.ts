'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { syncInstagram, refreshInstagramToken, type InstagramTarget } from '@/lib/instagram'
import { revalidatePath } from 'next/cache'

/**
 * The signed-in editor's own site, through their own client — so row-level
 * security scopes every read and write, and each query also says which site.
 */
async function target(): Promise<InstagramTarget> {
  const { tenantId } = await requireEditor()
  return { db: await createClient(), tenantId }
}

export async function saveInstagramToken(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const site = await target()
  const token = (formData.get('instagram_token') as string)?.trim()
  const handle = (formData.get('instagram_handle') as string)?.trim() || null

  await site.db.from('site_settings').update({ instagram_handle: handle }).eq('tenant_id', site.tenantId)

  if (token) {
    // The token goes to site_secrets, which only this site's editors can read —
    // never to site_settings, which the public site reads with the anon key.
    const { error } = await site.db
      .from('site_secrets')
      .upsert({ tenant_id: site.tenantId, instagram_token: token, updated_at: new Date().toISOString() })
    if (error) throw new Error(error.message)

    // Assume a fresh long-lived token; the first refresh will correct this
    await site.db
      .from('site_settings')
      .update({ instagram_token_expires: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString() })
      .eq('tenant_id', site.tenantId)

    await syncInstagram(site)
  }

  revalidatePath('/admin/settings')
  revalidatePath('/')
}

export async function disconnectInstagram() {
  // A server action is a public endpoint: check who is asking before anything else.
  const site = await target()

  await site.db
    .from('site_secrets')
    .update({ instagram_token: null, updated_at: new Date().toISOString() })
    .eq('tenant_id', site.tenantId)

  await site.db
    .from('site_settings')
    .update({ instagram_token_expires: null, instagram_synced_at: null })
    .eq('tenant_id', site.tenantId)

  await site.db.from('instagram_media').delete().eq('tenant_id', site.tenantId)

  revalidatePath('/admin/settings')
  revalidatePath('/')
}

export async function syncNow() {
  // A server action is a public endpoint: check who is asking before anything else.
  const result = await syncInstagram(await target())
  revalidatePath('/admin/settings')
  revalidatePath('/')
  return result
}

export async function refreshTokenNow() {
  // A server action is a public endpoint: check who is asking before anything else.
  const result = await refreshInstagramToken(await target())
  revalidatePath('/admin/settings')
  return result
}

export async function updateInstagramDisplay(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const site = await target()

  await site.db
    .from('site_settings')
    .update({
      show_instagram: formData.get('show_instagram') === 'on',
      instagram_heading: (formData.get('instagram_heading') as string)?.trim() || null,
    })
    .eq('tenant_id', site.tenantId)

  revalidatePath('/admin/settings')
  revalidatePath('/')
}
