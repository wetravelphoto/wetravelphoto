'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { assessRemoval } from '@/lib/photos/deletion'
import { revalidatePath } from 'next/cache'

/**
 * Removes a gallery and its photo records — and nothing in storage (P6,
 * retention-first). Every original, display size, custom cover and cover
 * video stays, and so does every asset: a section, a draft, a story or
 * another gallery may still show them. Physical cleanup is a later step.
 *
 * `kept` is the number of this gallery's files that another canonical source
 * of this site is KNOWN to name, read fresh before anything is removed
 * (lib/photos/deletion.ts). It is not the number of files retained — they
 * all are. If that evidence cannot be read whole, the gallery is not removed:
 * an unreadable site is never reported as `kept: 0`.
 *
 * The rows cascade as before: the photographs' memberships, captions,
 * catalogue entries, products, favourites and downloads go with the gallery,
 * and keeping the files does not bring them back.
 */
export async function deleteAlbum(albumId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { found, assessment } = await assessRemoval(supabase, tenantId, { kind: 'album', albumId })
  if (!assessment.complete) {
    throw new Error('This site’s photographs could not all be read, so the gallery was not deleted.')
  }
  if (!found) throw new Error('That gallery is not on this site.')

  const { error } = await supabase
    .from('albums')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', albumId)
  if (error) throw new Error('That gallery could not be deleted.')

  revalidatePath('/admin/trips')
  revalidatePath('/admin')
  revalidatePath('/')
  revalidatePath('/trips')

  return { kept: assessment.counts.referenced }
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
