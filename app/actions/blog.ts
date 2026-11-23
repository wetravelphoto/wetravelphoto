'use server'

import { requireEditor } from '@/lib/auth'
import { ownsKey } from '@/lib/storage-keys'
import { createClient } from '@/lib/supabase/server'
import { IngestError, fromSupabase, ingestPhoto } from '@/lib/photos/ingest'
import { blockIdentities, estimateReadMinutes, type Block } from '@/lib/blocks'
import { syncPost } from '@/lib/photos/usages'
import { LibraryError, checkWritePairs, pairKey, uploadedItem, type LibraryItem } from '@/lib/photos/library'
import { editorLibraryDb } from '@/lib/photos/editor-library'
import { registrationFailure } from '@/lib/photos/replies'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'

function slugify(input: string): string {
  return (
    input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'post'
  )
}

async function uniqueSlug(supabase: SupabaseClient, tenantId: string, base: string, excludeId?: string) {
  const root = slugify(base)
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`
    let q = supabase.from('blog_posts').select('id').eq('tenant_id', tenantId).eq('slug', candidate)
    if (excludeId) q = q.neq('id', excludeId)
    const { data } = await q.maybeSingle()
    if (!data) return candidate
  }
  return `${root}-${Date.now()}`
}

export async function createPost(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const title = formData.get('title') as string
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const slug = await uniqueSlug(supabase, tenantId, title)

  const { data, error } = await supabase
    .from('blog_posts')
    .insert({ title, slug, author_id: user?.id, blocks: [], tenant_id: tenantId })
    .select()
    .single()

  if (error) throw new Error(error.message)

  revalidatePath('/admin/blog')
  redirect(`/admin/blog/${data.id}`)
}

export async function updatePost(postId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const get = (k: string) => (formData.get(k) as string) ?? ''

  let blocks: Block[] = []
  try {
    blocks = JSON.parse(get('blocks') || '[]')
  } catch {
    blocks = []
  }

  const supabase = await createClient()

  /*
   * An image the picker chose carries its photograph's identity beside its
   * path (P5). Both arrive from the browser, so before they are stored the
   * pair is checked to name ONE photograph of THIS site — the same reader and
   * canonical proof the picker and the section writer use
   * (lib/photos/library.ts `checkWritePairs`). A pair the story already holds
   * may stay while its photograph is unavailable, so editing a story's words
   * never fails on an old image; none is newly written that way. An older
   * block with no identity is left exactly as it is.
   */
  const identities = blockIdentities(blocks)
  if (identities.length) {
    const { data: saved, error: savedError } = await supabase
      .from('blog_posts')
      .select('blocks')
      .eq('tenant_id', tenantId)
      .eq('id', postId)
      .maybeSingle()
    if (savedError) throw new Error('This story could not be saved just now. Try again.')
    let already: Set<string>
    try {
      already = new Set(blockIdentities(saved?.blocks ?? []).map(pairKey))
    } catch {
      // A stored block this version cannot read vouches for nothing.
      already = new Set()
    }
    try {
      await checkWritePairs(await editorLibraryDb(), tenantId, identities, already)
    } catch (e) {
      throw new Error(e instanceof LibraryError ? `A photograph in this story: ${e.message}` : 'This story could not be checked just now. Try again.')
    }
  }

  const title = get('title')
  const slug = await uniqueSlug(supabase, tenantId, get('slug') || title, postId)
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
      .eq('tenant_id', tenantId)
      .eq('id', postId)
      .maybeSingle()

    updates.published_at = existing?.published_at ?? new Date().toISOString()
  }

  const { error } = await supabase
    .from('blog_posts')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('id', postId)
  if (error) throw new Error(error.message)

  // The story's photographs — its featured image and its blocks — projected
  // from the row just saved (P3).
  await syncPost(tenantId, postId)

  revalidatePath('/admin/blog')
  revalidatePath(`/admin/blog/${postId}`)
  revalidatePath('/journal')
  revalidatePath(`/journal/${slug}`)
  revalidatePath('/')
}

export async function deletePost(postId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const { error } = await supabase
    .from('blog_posts')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', postId)
  if (error) throw new Error(error.message)

  revalidatePath('/admin/blog')
  revalidatePath('/journal')
  redirect('/admin/blog')
}

/** Feeds the image picker — albums list, or one album's photos. */
export async function fetchAlbumPhotos(albumId: string | null) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { data: albums } = await supabase
    .from('albums')
    .select('id, title')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (!albumId) {
    return { albums: albums ?? [], photos: [] }
  }

  const { data: photos } = await supabase
    .from('photos')
    .select('id, storage_path, caption')
    .eq('tenant_id', tenantId)
    .eq('album_id', albumId)
    .order('sort_order')

  return { albums: albums ?? [], photos: photos ?? [] }
}

/**
 * Called once the browser has uploaded a journal image straight to storage.
 * Builds the display sizes and hands back the path blocks should reference,
 * the photograph's identity, and the item the picker shows (P5).
 *
 * Every failure is answered `{ ok: false }` with words a photographer can
 * read — Next hides a thrown server-action message in production. Calling it
 * again for the same key and base is how the picker retries a registration
 * whose answer was lost; the database function reuses the asset it already
 * committed for that base.
 */
export async function registerJournalImage(
  key: string,
  base: string
): Promise<{ ok: true; path: string; assetId: string; item: LibraryItem | null } | { ok: false; message: string }> {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()

  // The key comes from the browser. Only this site's own uploads may be
  // registered — see lib/storage-keys.ts.
  if (!ownsKey(tenantId, key) || !ownsKey(tenantId, base) || !key.startsWith(`${base}/`)) {
    return { ok: false, message: 'That upload does not belong to this site.' }
  }

  // Since P2 the image becomes a photograph asset (lib/photos/ingest.ts). Its
  // placement stays in the post that uses it; P3 projects it from there. A
  // path is never handed back for a photograph whose asset was not recorded.
  const supabase = await createClient()
  let result: Awaited<ReturnType<typeof ingestPhoto>>
  try {
    result = await ingestPhoto(
      { route: 'journal', tenantId, keyBase: base, sourceKey: key },
      { db: fromSupabase(supabase) }
    )
  } catch (e) {
    if (e instanceof IngestError && e.reason === 'unreadable') {
      return { ok: false, message: 'The upload could not be read back. Try again.' }
    }
    // Only a fixed sentence: a registration fault may quote the database.
    return { ok: false, message: registrationFailure(e) }
  }

  const item = await editorLibraryDb()
    .then((db) => uploadedItem(db, tenantId, result.assetId, 'document'))
    .catch(() => null)
  return { ok: true, path: result.displayPath, assetId: result.assetId, item }
}

export async function bulkUpdateStatus(ids: string[], status: 'draft' | 'published') {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  if (ids.length === 0) return

  const supabase = await createClient()
  const updates: Record<string, unknown> = { status }
  if (status === 'published') updates.published_at = new Date().toISOString()

  await supabase.from('blog_posts').update(updates).eq('tenant_id', tenantId).in('id', ids)

  revalidatePath('/admin/blog')
  revalidatePath('/journal')
}

export async function bulkDelete(ids: string[]) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  if (ids.length === 0) return

  const supabase = await createClient()
  await supabase.from('blog_posts').delete().eq('tenant_id', tenantId).in('id', ids)

  revalidatePath('/admin/blog')
  revalidatePath('/journal')
}

export async function duplicatePosts(ids: string[]) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  if (ids.length === 0) return

  const supabase = await createClient()
  const { data: originals } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('id', ids)

  for (const original of originals ?? []) {
    const slug = await uniqueSlug(supabase, tenantId, `${original.slug}-copy`)

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

    // The copy carries the original's photographs, so it is projected too (P3).
    const { data: made } = await supabase
      .from('blog_posts')
      .insert({ ...copy, tenant_id: tenantId })
      .select('id')
      .maybeSingle()
    if (made?.id) await syncPost(tenantId, made.id as string)
  }

  revalidatePath('/admin/blog')
}
