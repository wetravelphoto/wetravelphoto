'use server'

import { createClient } from '@/lib/supabase/server'
import { r2Client } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { processExistingOriginal } from '@/lib/derivatives'
import { estimateReadMinutes, type Block } from '@/lib/blocks'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'

function slugify(input: string): string {
  return (
    input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'post'
  )
}

async function uniqueSlug(supabase: SupabaseClient, base: string, excludeId?: string) {
  const root = slugify(base)
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`
    let q = supabase.from('blog_posts').select('id').eq('slug', candidate)
    if (excludeId) q = q.neq('id', excludeId)
    const { data } = await q.maybeSingle()
    if (!data) return candidate
  }
  return `${root}-${Date.now()}`
}

export async function createPost(formData: FormData) {
  const title = formData.get('title') as string
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const slug = await uniqueSlug(supabase, title)

  const { data, error } = await supabase
    .from('blog_posts')
    .insert({ title, slug, author_id: user?.id, blocks: [] })
    .select()
    .single()

  if (error) throw new Error(error.message)

  revalidatePath('/admin/blog')
  redirect(`/admin/blog/${data.id}`)
}

export async function updatePost(postId: string, formData: FormData) {
  const get = (k: string) => (formData.get(k) as string) ?? ''

  let blocks: Block[] = []
  try {
    blocks = JSON.parse(get('blocks') || '[]')
  } catch {
    blocks = []
  }

  const supabase = await createClient()
  const title = get('title')
  const slug = await uniqueSlug(supabase, get('slug') || title, postId)
  const status = get('status')

  const updates: Record<string, unknown> = {
    title,
    slug,
    excerpt: get('excerpt') || null,
    byline: get('byline') || null,
    category: get('category') || null,
    album_id: get('album_id') || null,
    // Featured image is stored as a storage path so it can come from any
    // album or a standalone upload, with no album link required
    featured_custom_path: get('featured_path') || null,
    featured_photo_id: null,
    blocks,
    read_minutes: estimateReadMinutes(blocks),
    status,
    seo_title: get('seo_title') || null,
    seo_description: get('seo_description') || null,
    noindex: formData.get('noindex') === 'on',
    tags: get('tags')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  }

  if (status === 'published') {
    // Keep the original publish date if it already has one
    const { data: existing } = await supabase
      .from('blog_posts')
      .select('published_at')
      .eq('id', postId)
      .maybeSingle()

    updates.published_at = existing?.published_at ?? new Date().toISOString()
  }

  const { error } = await supabase.from('blog_posts').update(updates).eq('id', postId)
  if (error) throw new Error(error.message)

  revalidatePath('/admin/blog')
  revalidatePath(`/admin/blog/${postId}`)
  revalidatePath('/journal')
  revalidatePath(`/journal/${slug}`)
  revalidatePath('/')
}

export async function deletePost(postId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('blog_posts').delete().eq('id', postId)
  if (error) throw new Error(error.message)

  revalidatePath('/admin/blog')
  revalidatePath('/journal')
  redirect('/admin/blog')
}

/** Feeds the image picker — albums list, or one album's photos. */
export async function fetchAlbumPhotos(albumId: string | null) {
  const supabase = await createClient()

  const { data: albums } = await supabase.from('albums').select('id, title').order('created_at', { ascending: false })

  if (!albumId) {
    return { albums: albums ?? [], photos: [] }
  }

  const { data: photos } = await supabase
    .from('photos')
    .select('id, storage_path, caption')
    .eq('album_id', albumId)
    .order('sort_order')

  return { albums: albums ?? [], photos: photos ?? [] }
}

/**
 * Called once the browser has uploaded a journal image straight to storage.
 * Builds the display sizes and hands back the path blocks should reference.
 */
export async function registerJournalImage(key: string, base: string): Promise<string | null> {
  const object = await r2Client.send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key })
  )

  if (!object.Body) return null

  const buffer = Buffer.from(await object.Body.transformToByteArray())
  const processed = await processExistingOriginal(buffer, base, key)

  return processed.displayPath
}

export async function bulkUpdateStatus(ids: string[], status: 'draft' | 'published') {
  if (ids.length === 0) return

  const supabase = await createClient()
  const updates: Record<string, unknown> = { status }
  if (status === 'published') updates.published_at = new Date().toISOString()

  await supabase.from('blog_posts').update(updates).in('id', ids)

  revalidatePath('/admin/blog')
  revalidatePath('/journal')
}

export async function bulkDelete(ids: string[]) {
  if (ids.length === 0) return

  const supabase = await createClient()
  await supabase.from('blog_posts').delete().in('id', ids)

  revalidatePath('/admin/blog')
  revalidatePath('/journal')
}

export async function duplicatePosts(ids: string[]) {
  if (ids.length === 0) return

  const supabase = await createClient()
  const { data: originals } = await supabase.from('blog_posts').select('*').in('id', ids)

  for (const original of originals ?? []) {
    const slug = await uniqueSlug(supabase, `${original.slug}-copy`)

    // Copies always start as drafts so nothing goes live by accident
    const copy = {
      ...original,
      id: undefined,
      slug,
      title: `${original.title} (copy)`,
      status: 'draft',
      published_at: null,
      created_at: undefined,
      updated_at: undefined,
    }
    delete (copy as Record<string, unknown>).id
    delete (copy as Record<string, unknown>).created_at
    delete (copy as Record<string, unknown>).updated_at

    await supabase.from('blog_posts').insert(copy)
  }

  revalidatePath('/admin/blog')
}
