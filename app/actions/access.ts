'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { issueAlbumAccessGrant } from '@/lib/album-access'
import { grantCookieName } from '@/lib/album-grant'

export async function unlockAlbum(slug: string, formData: FormData) {
  // A server action is a public endpoint: whatever arrives is checked for
  // shape. A file, a missing field or a non-form body is a failed attempt.
  const password = formData instanceof FormData ? formData.get('password') : null

  // The hash is read, compared and bound to the grant inside
  // lib/album-access.ts / lib/album-grant.ts and never comes back here. This
  // used to select password_hash with the anon key, which handed it to anyone
  // who could read the album row — and under the old policies, that was anyone.
  const grant = typeof slug === 'string' && typeof password === 'string' ? await issueAlbumAccessGrant(slug, password) : null

  if (!grant) {
    // Deliberately one message for a wrong password, a missing album and an
    // album with no password set: a login form that distinguishes them is a
    // way of enumerating what exists.
    return { error: 'Incorrect password.' }
  }

  // A signed grant (lib/album-grant.ts), not the word `granted` — which any
  // browser could type and which, before P5's F1 correction, opened the
  // gallery. Host-only (no Domain), HttpOnly, SameSite=Lax, Secure everywhere
  // but local development, and never longer than the grant's own lifetime.
  const cookieStore = await cookies()
  cookieStore.set(grantCookieName(grant.albumId), grant.value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV !== 'development',
    maxAge: grant.maxAge,
    path: '/',
  })

  revalidatePath(`/trips/${slug}`)
  return { error: null }
}
