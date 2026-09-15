'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { verifyAlbumPassword } from '@/lib/album-access'

export async function unlockAlbum(slug: string, formData: FormData) {
  const password = (formData.get('password') as string) ?? ''

  // The hash is read and compared inside lib/album-access.ts and never comes
  // back here. This used to select password_hash with the anon key, which
  // handed it to anyone who could read the album row — and under the old
  // policies, that was anyone.
  const albumId = await verifyAlbumPassword(slug, password)

  if (!albumId) {
    // Deliberately one message for a wrong password, a missing album and an
    // album with no password set: a login form that distinguishes them is a
    // way of enumerating what exists.
    return { error: 'Incorrect password.' }
  }

  const cookieStore = await cookies()
  cookieStore.set(`album_access_${albumId}`, 'granted', {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })

  revalidatePath(`/trips/${slug}`)
  return { error: null }
}
