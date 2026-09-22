'use server'

import { requireEditor } from '@/lib/auth'
import { tenantKey } from '@/lib/storage-keys'
import { createClient } from '@/lib/supabase/server'
import { hashPassword } from '@/lib/password'
import { r2Client } from '@/lib/r2'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { processExistingOriginal } from '@/lib/derivatives'
import { randomUUID } from 'crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'

function slugify(input: string): string {
  return (
    input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'album'
  )
}

async function uniqueSlug(supabase: SupabaseClient, base: string, excludeId?: string): Promise<string> {
  const root = slugify(base)
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`
    let query = supabase.from('albums').select('id').eq('slug', candidate)
    if (excludeId) query = query.neq('id', excludeId)
    const { data } = await query.maybeSingle()
    if (!data) return candidate
  }
  return `${root}-${Date.now()}`
}

export async function createAlbum(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const title = formData.get('title') as string
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const slug = await uniqueSlug(supabase, title)

  const { data, error } = await supabase
    .from('albums')
    .insert({ title, slug, created_by: user?.id })
    .select()
    .single()

  if (error) throw new Error(error.message)

  revalidatePath('/admin')
  revalidatePath('/')
  redirect(`/admin/trips/${data.id}`)
}

export async function updateAlbumSettings(albumId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const get = (k: string) => formData.get(k) as string
  const num = (k: string, fallback: number) => {
    const v = parseFloat(formData.get(k) as string)
    return isNaN(v) ? fallback : v
  }

  const title = get('title')
  const supabase = await createClient()
  const slug = await uniqueSlug(supabase, get('slug') || title, albumId)

  const updates: Record<string, unknown> = {
    title,
    slug,
    description: get('description') || null,
    location: get('location') || null,
    trip_start_date: get('trip_start_date') || null,
    cover_date_format: get('cover_date_format') || 'month_year',
    show_tags: formData.get('show_tags') === 'on',
    gallery_hero: formData.get('gallery_hero') === 'on',
    description_align: get('description_align') || 'left',
    description_scale: num('description_scale', 1),
    tags: (get('tags') || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
    privacy_type: get('privacy_type'),
    cover_photo_id: get('cover_photo_id') || null,
    cover_focal_x: num('cover_focal_x', 0.5),
    cover_focal_y: num('cover_focal_y', 0.5),
    cover_title_enabled: formData.get('cover_title_enabled') === 'on',
    cover_title_text: get('cover_title_text'),
    cover_subtitle: get('cover_subtitle') || null,
    cover_preset: get('cover_layout') || 'anchor',
    cover_font: get('cover_font') || 'Oswald',
    cover_title_scale: num('cover_title_scale', 1),
    cover_title_color: get('cover_title_color') || '#FAF9F6',
    cover_show_location: formData.get('cover_show_location') === 'on',
    cover_show_date: formData.get('cover_show_date') === 'on',
    cover_show_button: formData.get('cover_show_button') === 'on',
    cover_button_text: get('cover_button_text') || 'View gallery',
    layout_style: get('layout_style'),
    sort_order: get('sort_order'),
    cover_overlay_type: get('cover_overlay_type') || 'none',
    cover_overlay_opacity: num('cover_overlay_opacity', 0.35),
  }

  const password = get('password')
  if (updates.privacy_type === 'password' && password) {
    updates.password_hash = hashPassword(password)
  }

  const { error } = await supabase.from('albums').update(updates).eq('id', albumId)
  if (error) throw new Error(error.message)

  revalidatePath('/admin')
  revalidatePath('/')
  revalidatePath(`/admin/trips/${albumId}`)
  revalidatePath(`/admin/trips/${albumId}/settings`)
  redirect(`/admin/trips/${albumId}`)
}

export async function updateLayoutStyle(albumId: string, layoutStyle: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()
  const { error } = await supabase.from('albums').update({ layout_style: layoutStyle }).eq('id', albumId)
  if (error) throw new Error(error.message)
  revalidatePath(`/admin/trips/${albumId}`)
}

export async function uploadCustomCover(albumId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const file = formData.get('file') as File
  if (!file || file.size === 0) return

  const buffer = Buffer.from(await file.arrayBuffer())

  // Covers go through the same ladder as photographs. This used to write a
  // single 2800px JPEG, which meant a cover drawn 475px wide in the carousel
  // still cost ~650KB with no smaller file to fall back on. The path ends in
  // /<size>.webp, which is what srcSetFromPath keys off to build the srcset —
  // covers have no derivatives column of their own.
  const keyBase = tenantKey(tenantId, `covers/${albumId}/${randomUUID()}`)
  const processed = await processExistingOriginal(buffer, keyBase, keyBase)

  const supabase = await createClient()
  const { error } = await supabase
    .from('albums')
    .update({ cover_custom_path: processed.displayPath, cover_photo_id: null })
    .eq('id', albumId)

  if (error) throw new Error(error.message)
  revalidatePath('/admin')
  revalidatePath(`/admin/trips/${albumId}/settings`)
  revalidatePath('/')
  revalidatePath('/trips')
}

export async function clearCustomCover(albumId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()
  const { error } = await supabase.from('albums').update({ cover_custom_path: null }).eq('id', albumId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
  revalidatePath(`/admin/trips/${albumId}/settings`)
}

/** Video covers are stored as-is — no server-side transcoding. */
export async function uploadCoverVideo(albumId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const file = formData.get('file') as File
  if (!file || file.size === 0) return

  const buffer = Buffer.from(await file.arrayBuffer())
  const ext = file.type === 'video/webm' ? 'webm' : 'mp4'
  const key = tenantKey(tenantId, `covers/${albumId}/${randomUUID()}.${ext}`)

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: file.type || 'video/mp4',
    })
  )

  const supabase = await createClient()
  const { error } = await supabase.from('albums').update({ cover_video_path: key }).eq('id', albumId)
  if (error) throw new Error(error.message)

  revalidatePath('/admin')
  revalidatePath(`/admin/trips/${albumId}/settings`)
}

export async function clearCoverVideo(albumId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()
  const { error } = await supabase.from('albums').update({ cover_video_path: null }).eq('id', albumId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
  revalidatePath(`/admin/trips/${albumId}/settings`)
}
