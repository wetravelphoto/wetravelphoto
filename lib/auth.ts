import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { currentSite } from '@/lib/tenant'

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
 *
 * ── `tenantId` is the site being EDITED, not the account's home ─────────────
 *
 * For a photographer these are the same thing and always will be. They differ
 * in exactly one case: a **platform admin on somebody else's address**.
 *
 * That case used to be broken, and quietly. The host/tenant check below lets a
 * platform admin through — that is what supporting somebody else's site means
 * — but this function then handed back the ADMIN'S OWN tenant, while every
 * public page at that address resolved the tenant from the host. So opening
 * `ana.lensgrid.co/admin` showed Ana's site on the front and bound the admin
 * to wetravelphoto's data behind it: her galleries on the left, your rows
 * underneath, and anything saved there landing in your live site. Nothing
 * errored. Nothing warned. It was harmless while there was one site and one
 * admin who knew; it stopped being harmless the day a tester asked for help.
 *
 * So the address decides which site is being edited, for everyone. The account
 * decides who is allowed to. `homeTenantId` keeps the account's own site, and
 * `supporting` is set only while the two differ — the admin chrome reads it and
 * says out loud whose site this is, because a silent version of this is the
 * bug again wearing a different hat.
 *
 * Deliberately NOT extended to an `assumed` address (a laptop, a preview
 * build, the host this deployment was configured for). Those resolve to the
 * oldest tenant by guess, and letting a guess redirect an admin's writes is a
 * worse failure than the one being fixed.
 */
export type Editor = {
  userId: string
  /**
   * The site being edited. The account's own, except when a platform admin is
   * working on another site's address — then it is that site.
   */
  tenantId: string
  role: string
  platformAdmin: boolean
  /** The site this account belongs to. Equal to `tenantId` for everybody but a supporting admin. */
  homeTenantId: string
  /** Set only while a platform admin is editing a site that is not their own. */
  supporting: { tenantId: string; host: string } | null
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

  const homeTenantId = data.tenant_id as string
  const platformAdmin = data.is_platform_admin === true

  // Resolved here rather than in requireEditor() so that everything reading an
  // editor agrees on which site it is looking at — including the ones that
  // never call requireEditor(): the draft store, the version history, the
  // look history, the newsletter export, and the upload route that files a
  // photograph under `t/<tenant id>/`. If those kept the admin's own tenant
  // while the writes moved, a photograph uploaded on a tester's site would
  // land in the wrong prefix, which is the same bug split in half.
  const site = await currentSite()
  const supporting =
    platformAdmin && site && !site.assumed && site.tenantId !== homeTenantId
      ? { tenantId: site.tenantId, host: site.host }
      : null

  return {
    userId: user.id,
    tenantId: supporting?.tenantId ?? homeTenantId,
    role: (data.role as string) ?? 'editor',
    platformAdmin,
    homeTenantId,
    supporting,
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

  /**
   * YOU EDIT THE SITE YOU ARE ON.
   *
   * The address decides which site a page shows (lib/tenant.ts); the session
   * decides who is writing. When those two disagree — someone signed in to
   * their own site opens another photographer's address — every screen would
   * show one site and every save would land in the other. Nothing would break
   * loudly; it would just quietly write the wrong site's copy into yours.
   *
   * Only refused when the address is a CLAIMED one. A laptop, a preview build
   * or the address this deployment was configured for resolve by assumption
   * rather than by a row, and blocking on a guess would lock people out of
   * their own editor for no gain.
   *
   * A platform admin is not refused — but is no longer let through holding
   * their own tenant either. `currentEditor()` has already pointed them at the
   * site whose address this is, so for them the two now agree by construction
   * and this check has nothing left to catch. Compared against `homeTenantId`
   * so it keeps asking the question it was written to ask.
   */
  const site = await currentSite()
  if (site && !site.assumed && !editor.platformAdmin && site.tenantId !== editor.homeTenantId) {
    throw new Error(
      `This is not your site. You are signed in to a different one — open your own address to edit it.`
    )
  }

  return editor
}
