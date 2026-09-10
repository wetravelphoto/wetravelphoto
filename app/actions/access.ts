'use server'

import { createClient } from '@/lib/supabase/server'
import { verifyPassword } from '@/lib/password'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

export async function unlockAlbum(slug: string, formData: FormData) {
  const password = formData.get('password') as string

  const supabase = await createClient()
  const { data: album } = await supabase
    .from('albums')
    .select('id, password_hash')
    .eq('slug', slug)
    .maybeSingle()

  if (!album?.password_hash) {
    return { error: 'This album is not password protected.' }
  }

  let valid = false
  try {
    valid = verifyPassword(password, album.password_hash)
  } catch {
    valid = false
  }

  if (!valid) {
    return { error: 'Incorrect password.' }
  }

  const cookieStore = await cookies()
  cookieStore.set(`album_access_${album.id}`, 'granted', {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })

  revalidatePath(`/trips/${slug}`)
  return { error: null }
}
