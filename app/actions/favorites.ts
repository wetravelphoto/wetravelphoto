'use server'

import { revalidatePath } from 'next/cache'
import { accessForToken, setFavorite } from '@/lib/gallery-access'

export async function toggleFavorite(
  token: string,
  albumId: string,
  photoId: string,
  isFavorited: boolean
) {
  // A server action is a public endpoint: anyone can post to it with any
  // arguments. The token is checked here, and setFavorite refuses an album the
  // token does not open, so a guessed album id gets nothing.
  const access = await accessForToken(token)
  if (!access) throw new Error('Invalid access token')

  await setFavorite(access, albumId, photoId, isFavorited)

  revalidatePath(`/gallery/${token}`)
}
