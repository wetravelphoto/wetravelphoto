'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { r2Client } from '@/lib/r2'
import { DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { revalidatePath } from 'next/cache'

/**
 * Removes a gallery, its photo records, and the underlying files in R2.
 * The database rows cascade; the storage objects have to go explicitly.
 */
/**
 * Removes a gallery and its photo records. Files are only deleted from
 * storage when nothing else points at them — journal posts and site settings
 * reference photos by path, and deleting those files would silently break
 * whatever was using them.
 */
export async function deleteAlbum(albumId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { data: album } = await supabase
    .from('albums')
    .select('cover_custom_path, cover_video_path')
    .eq('tenant_id', tenantId)
    .eq('id', albumId)
    .maybeSingle()

  const { data: photos } = await supabase
    .from('photos')
    .select('storage_path')
    .eq('tenant_id', tenantId)
    .eq('album_id', albumId)

  const candidates = [
    ...(photos ?? []).map((p) => p.storage_path),
    album?.cover_custom_path,
    album?.cover_video_path,
  ].filter(Boolean) as string[]

  // Anything still referenced elsewhere stays in storage
  const inUse = new Set<string>()

  const { data: posts } = await supabase
    .from('blog_posts')
    .select('featured_custom_path, blocks')
    .eq('tenant_id', tenantId)
    .not('featured_custom_path', 'is', null)

  for (const post of posts ?? []) {
    if (post.featured_custom_path) inUse.add(post.featured_custom_path)
  }

  // Images used inside post bodies count too
  const { data: allPosts } = await supabase.from('blog_posts').select('blocks')
    .eq('tenant_id', tenantId)
  for (const post of allPosts ?? []) {
    const json = JSON.stringify(post.blocks ?? [])
    for (const path of candidates) {
      if (json.includes(path)) inUse.add(path)
    }
  }

  const { data: settings } = await supabase
    .from('site_settings')
    .select('intro_image_path, contact_image_path, logo_header_path, logo_footer_path, logo_bird_path')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  for (const value of Object.values(settings ?? {})) {
    if (typeof value === 'string') inUse.add(value)
  }

  const deletable = candidates.filter((key) => !inUse.has(key))

  if (deletable.length > 0) {
    // DeleteObjects takes up to 1000 keys per call
    for (let i = 0; i < deletable.length; i += 1000) {
      await r2Client.send(
        new DeleteObjectsCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Delete: { Objects: deletable.slice(i, i + 1000).map((Key) => ({ Key })) },
        })
      )
    }
  }

  const { error } = await supabase
    .from('albums')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', albumId)
  if (error) throw new Error(error.message)

  revalidatePath('/admin/trips')
  revalidatePath('/admin')
  revalidatePath('/')
  revalidatePath('/trips')

  return { kept: candidates.length - deletable.length }
}

/**
 * Persists the order shown on the admin grid and the public index.
 *
 * This writes `display_order`, not `sort_order`. `albums.sort_order` is text
 * and holds the photo sort mode *inside* an album ('manual' | 'date_asc' |
 * 'date_desc') — writing positions into it silently destroyed that setting.
 */
export async function reorderAlbums(ids: string[]) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  await Promise.all(
    ids.map((id, index) =>
      supabase
        .from('albums')
        .update({ display_order: index + 1 })
        .eq('tenant_id', tenantId)
        .eq('id', id)
    )
  )

  revalidatePath('/admin/trips')
  revalidatePath('/trips')
  revalidatePath('/')
}
