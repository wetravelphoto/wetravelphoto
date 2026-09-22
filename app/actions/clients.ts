'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createContact(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const name = formData.get('name') as string
  const email = formData.get('email') as string

  const supabase = await createClient()
  const { error } = await supabase.from('clients').insert({ name, email })

  if (error) throw new Error(error.message)

  revalidatePath('/admin/clients')
}

export async function deleteContact(clientId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()
  const { error } = await supabase.from('clients').delete().eq('id', clientId)

  if (error) throw new Error(error.message)

  revalidatePath('/admin/clients')
}

export async function shareAlbumWithClient(albumId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const clientId = formData.get('client_id') as string
  if (!clientId) return

  const supabase = await createClient()
  const { error } = await supabase
    .from('album_clients')
    .insert({ album_id: albumId, client_id: clientId })

  // Ignore duplicate-share errors (code 23505 = unique violation)
  if (error && error.code !== '23505') throw new Error(error.message)

  revalidatePath(`/admin/trips/${albumId}/settings`)
}

export async function unshareAlbumWithClient(albumId: string, clientId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()
  const { error } = await supabase
    .from('album_clients')
    .delete()
    .eq('album_id', albumId)
    .eq('client_id', clientId)

  if (error) throw new Error(error.message)

  revalidatePath(`/admin/trips/${albumId}/settings`)
}
