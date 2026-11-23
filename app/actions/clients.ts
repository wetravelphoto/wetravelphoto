'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  addClientToAlbumWith,
  removeClientFromAlbumWith,
  type ShareDb,
  type ShareResult,
} from '@/lib/clients/share'

export async function createContact(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const name = formData.get('name') as string
  const email = formData.get('email') as string

  const supabase = await createClient()
  const { error } = await supabase.from('clients').insert({ name, email, tenant_id: tenantId })

  if (error) throw new Error(error.message)

  revalidatePath('/admin/clients')
}

export async function deleteContact(clientId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', clientId)

  if (error) throw new Error(error.message)

  revalidatePath('/admin/clients')
}

// The clients page's share/unshare. Both the album and the client must be this
// site's: row-level security alone is not enough, because a platform admin
// passes every tenant check. The helpers read each with the editor's site named.
export async function shareAlbumWithClient(albumId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const clientId = formData.get('client_id')
  if (typeof clientId !== 'string' || !clientId) return

  const supabase = await createClient()
  const result = await addClientToAlbumWith(supabase as unknown as ShareDb, tenantId, albumId, { clientId })
  if (!result.ok) throw new Error(result.error)

  revalidatePath(`/admin/trips/${albumId}/settings`)
}

export async function unshareAlbumWithClient(albumId: string, clientId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const result = await removeClientFromAlbumWith(supabase as unknown as ShareDb, tenantId, albumId, clientId)
  if (!result.ok) throw new Error(result.error)

  revalidatePath(`/admin/trips/${albumId}/settings`)
}

/**
 * THE SHARING TAB'S "ADD CLIENT": pick an existing contact or create one
 * inline, and share the album with them — one action. Answers with a result
 * rather than throwing, because a thrown server-action error reaches the
 * photographer redacted ("Minified React error"), not as the sentence.
 */
export async function addClientToAlbum(
  albumId: string,
  input: { clientId?: string; name?: string; email?: string }
): Promise<ShareResult> {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const result = await addClientToAlbumWith(supabase as unknown as ShareDb, tenantId, albumId, input ?? {})
  if (result.ok) {
    revalidatePath(`/admin/trips/${albumId}/settings`)
    revalidatePath('/admin/clients')
  }
  return result
}

/** The Sharing tab's "Remove" — both the album and the client must be this site's. */
export async function removeClientFromAlbum(albumId: string, clientId: string): Promise<{ ok: boolean; error?: string }> {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const result = await removeClientFromAlbumWith(supabase as unknown as ShareDb, tenantId, albumId, clientId)
  if (result.ok) revalidatePath(`/admin/trips/${albumId}/settings`)
  return result
}
