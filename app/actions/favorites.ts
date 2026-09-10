'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function toggleFavorite(
  token: string,
  albumId: string,
  photoId: string,
  isFavorited: boolean
) {
  const supabase = await createClient()

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('access_token', token)
    .maybeSingle()

  if (!client) throw new Error('Invalid access token')

  if (isFavorited) {
    await supabase
      .from('favorites')
      .delete()
      .eq('album_id', albumId)
      .eq('photo_id', photoId)
      .eq('client_id', client.id)
  } else {
    await supabase.from('favorites').insert({
      album_id: albumId,
      photo_id: photoId,
      client_id: client.id,
    })
  }

  revalidatePath(`/gallery/${token}`)
}
