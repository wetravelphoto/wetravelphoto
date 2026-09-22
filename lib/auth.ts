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

/**
 * WHO MAY EDIT, AND WHICH SITE
 * ════════════════════════════
 *
 * Being signed in is not the same as being allowed to change a site. A signed-in
 * account also has to belong to a site (profiles.tenant_id) with a role that
 * edits it — or be a platform admin, working across every site.
 *
 * Row-level security enforces the same thing in the database, and stays the
 * backstop. This is the gate: it fails with a clear message before any query
 * runs, and it hands back the tenant, so a write can say WHICH site's row it
 * means instead of reaching for "row 1".
 */
export type Editor = {
  userId: string
  tenantId: string
  role: string
  platformAdmin: boolean
}

const EDIT_ROLES = ['owner', 'admin', 'editor']

export const currentEditor = cache(async (): Promise<Editor | null> => {
  const user = await currentUser()
  if (!user) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('tenant_id, role, is_platform_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (!data?.tenant_id) return null

  return {
    userId: user.id,
    tenantId: data.tenant_id as string,
    role: (data.role as string) ?? 'editor',
    platformAdmin: data.is_platform_admin === true,
  }
})

/**
 * The signed-in editor and their site, or a thrown error. Every server action
 * that changes anything calls this first — a server action is a public
 * endpoint, reachable by anyone who can send a POST, whatever page imports it.
 */
export async function requireEditor(): Promise<Editor> {
  await requireUser()

  const editor = await currentEditor()
  if (!editor) {
    throw new Error('This account is not attached to a site yet, so it cannot edit one.')
  }
  if (!editor.platformAdmin && !EDIT_ROLES.includes(editor.role)) {
    throw new Error('This account can view this site but not change it.')
  }
  return editor
}
