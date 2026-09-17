import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * WHO IS ASKING — once per request.
 *
 * `supabase.auth.getUser()` is not a local cookie read: it calls the Supabase
 * auth server to validate the token. That is correct and worth doing, but it
 * costs a network round trip every time, and the canvas was paying for two or
 * three of them on a single keystroke — one in the action's own check, another
 * inside the draft write, and a third in whatever it called next.
 *
 * React's cache() makes the call once per request and hands the same promise to
 * everyone else who asks during it. Nothing is cached BETWEEN requests, so this
 * changes no security property: every request still validates the token exactly
 * once before trusting it.
 */
export const currentUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user
})

/** The signed-in user, or a thrown error. For server actions, which are public. */
export async function requireUser() {
  const user = await currentUser()
  if (!user) {
    throw new Error('You are signed out. Sign in again and your draft will still be here.')
  }
  return user
}
