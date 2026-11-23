/**
 * A SITE'S INVITATION — send it again
 * ═══════════════════════════════════
 *
 * Until now a lost or expired invitation email meant deleting the whole site
 * and making it again. `resendInvitationWith` sends the same invitation again,
 * to the same account, through Supabase's documented behaviour:
 * `auth.admin.inviteUserByEmail` on an address whose account exists and has
 * NOT confirmed re-sends the invitation to that account; on a confirmed one
 * it refuses. So a resend never creates, replaces or deletes anybody.
 *
 * What this file deliberately does NOT do:
 *
 *   • It never deletes an auth account or a profile. The interface it is
 *     given (`InviteAdmin`) has no delete and no insert, so it cannot.
 *     Deleting was the old fallback when a re-invite was refused, and it
 *     could delete a person who accepted in the moment between "is it still
 *     pending?" and the delete, or strand a site with no profile if the new
 *     invite then failed.
 *   • It never says an earlier link stopped working. Whether a re-sent
 *     invitation invalidates the previous email's link is the provider's
 *     business and nothing here proves it, so the message does not claim it.
 *   • Changing the ADDRESS of an invitation is switched off
 *     (`changeInvitationEmailWith` refuses, touching nothing). Doing it
 *     safely needs a way to withdraw the old invitation that cannot hit a
 *     person who accepts at the same moment, and that cannot leave the site
 *     without its person when the provider fails half-way. The admin API
 *     offers no conditional delete, so there is no such way here yet.
 *
 * Only for an invitation that is provably pending: the profile on THIS site
 * (read with the site named), not a platform admin, and an auth account that
 * exists, is readable, carries the same address and has neither confirmed nor
 * signed in. Missing, unreadable or mismatched is a refusal, never "pending".
 * Only a platform admin reaches this — the page checks, and the actions check
 * again (app/actions/sites.ts), because a page is a view and an action is an
 * endpoint. The service-role client is passed in so the suites can drive
 * every branch with a fake (.mk/invitations.ts).
 */

export type AuthUser = {
  id: string
  email?: string | null
  invited_at?: string | null
  email_confirmed_at?: string | null
  confirmed_at?: string | null
  last_sign_in_at?: string | null
}

type Err = { message?: string } | null
type Query = {
  select: (c: string) => Query
  eq: (c: string, v: unknown) => Query
  order: (c: string, o?: { ascending?: boolean }) => Query
  limit: (n: number) => Query
  maybeSingle: () => PromiseLike<{ data: unknown; error: Err }>
  then: PromiseLike<{ data: unknown; error: Err }>['then']
}

/** Reads, and one provider call that sends. Nothing that deletes or inserts. */
export type InviteAdmin = {
  from: (table: string) => Query
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{ data: { user: AuthUser | null } | null; error: Err }>
      inviteUserByEmail: (email: string, opts: { redirectTo: string }) => Promise<{ data: { user: AuthUser | null } | null; error: Err }>
    }
  }
}

export type InvitationStatus = 'accepted' | 'pending' | 'unknown'

/** Accepted once the person confirmed the address or signed in; pending until then; unknown without an account. */
export function invitationStatus(user: AuthUser | null | undefined): InvitationStatus {
  if (!user) return 'unknown'
  if (user.email_confirmed_at || user.confirmed_at || user.last_sign_in_at) return 'accepted'
  return 'pending'
}

export type InviteResult = { ok: true; message: string } | { ok: false; message: string }

type Profile = { id: string; email: string; is_platform_admin: boolean }

async function profileOf(db: InviteAdmin, tenantId: string, userId: string): Promise<Profile | null | undefined> {
  const { data, error } = await db
    .from('profiles')
    .select('id, email, is_platform_admin')
    .eq('tenant_id', tenantId)
    .eq('id', userId)
    .maybeSingle()
  if (error) return undefined
  if (!data) return null
  const r = data as Record<string, unknown>
  return { id: String(r.id), email: String(r.email ?? ''), is_platform_admin: r.is_platform_admin === true }
}

/** Where the invitation lands: the site's own sign-in page, at its home address. */
async function redirectFor(db: InviteAdmin, tenantId: string, fallbackDomain: string): Promise<string | null> {
  const { data, error } = await db
    .from('tenant_domains')
    .select('host, is_primary')
    .eq('tenant_id', tenantId)
    .order('is_primary', { ascending: false })
    .limit(1)
  if (error) return null
  const host = Array.isArray(data) && data[0] ? String((data[0] as Record<string, unknown>).host ?? '') : ''
  return `https://${host || fallbackDomain}/admin/login`
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== ''

/** The provably pending person on this site, or the reason there is none. */
async function pendingPerson(db: InviteAdmin, tenantId: string, userId: string): Promise<{ profile: Profile } | { error: string }> {
  if (typeof tenantId !== 'string' || typeof userId !== 'string' || !tenantId || !userId) return { error: 'That person is not on this site.' }
  const profile = await profileOf(db, tenantId, userId)
  if (profile === undefined) return { error: 'The site’s people could not be read. Nothing was sent.' }
  if (!profile) return { error: 'That person is not on this site.' }
  if (profile.is_platform_admin) return { error: 'A platform admin is never re-invited from here.' }

  const { data, error } = await db.auth.admin.getUserById(userId)
  if (error) return { error: 'The account could not be read. Nothing was sent; try again.' }
  const user = data?.user ?? null
  const status = invitationStatus(user)
  if (status === 'unknown' || !user || user.id !== userId) {
    return { error: `No sign-in account was found for ${profile.email}, so there is no invitation to send again. Nothing was sent.` }
  }
  if (status === 'accepted') return { error: `${profile.email} has already accepted, so there is no invitation to send again.` }
  // The invitation is re-sent to the profile's address, and Supabase re-sends
  // only to the account that already holds that address — so the two must be
  // the same, or the provider would mint a second, unattached account.
  if (!same(user.email, profile.email)) {
    return { error: `The sign-in account’s address does not match ${profile.email}. Nothing was sent.` }
  }
  return { profile }
}

export async function resendInvitationWith(
  db: InviteAdmin,
  input: { tenantId: string; userId: string; fallbackDomain: string }
): Promise<InviteResult> {
  const found = await pendingPerson(db, input.tenantId, input.userId)
  if ('error' in found) return { ok: false, message: found.error }
  const redirectTo = await redirectFor(db, input.tenantId, input.fallbackDomain)
  if (!redirectTo) return { ok: false, message: 'The site’s address could not be read. Nothing was sent; try again.' }

  const email = found.profile.email
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo })
  if (error) {
    const why = error.message ?? 'no reason given'
    // Supabase refuses a re-invite to an address that has confirmed: the person
    // accepted after the check above. Nothing to do, and nothing is undone.
    if (why.toLowerCase().includes('already')) {
      return { ok: false, message: `${email} seems to have accepted in the meantime, so nothing was sent. Reload to see.` }
    }
    return { ok: false, message: `The invitation could not be sent; nothing was changed, so you can try again: ${why}` }
  }
  const user = data?.user ?? null
  if (!user) return { ok: false, message: `Supabase did not confirm the invitation to ${email}. Nothing was changed; try again.` }
  if (user.id !== input.userId) {
    // Not the account the site knows. Reported, never cleaned up from here:
    // deleting accounts is exactly what this file refuses to do.
    return { ok: false, message: `Supabase answered with a different account (${user.id}) for ${email}. Nothing on the site was changed; check that account in Supabase.` }
  }
  if (invitationStatus(user) === 'accepted') {
    return { ok: false, message: `${email} has accepted in the meantime. Nothing was changed.` }
  }
  return { ok: true, message: `The invitation was sent again to ${email}. Ask them to use the newest email.` }
}

/**
 * Switched off: see the header. Refuses before reading or sending anything,
 * whatever it is given, so no account or profile can be touched from here.
 * The parameters stay so callers keep compiling; they are deliberately
 * discarded, never read.
 */
export async function changeInvitationEmailWith(
  db: InviteAdmin,
  input: { tenantId: string; userId: string; email: unknown; fallbackDomain: string }
): Promise<InviteResult> {
  void db
  void input
  return { ok: false, message: CHANGE_DISABLED }
}

export const CHANGE_DISABLED =
  'Changing an invitation’s address is switched off for now: there is no safe way yet to withdraw the old invitation without risking someone who accepts it at that moment. Nothing was changed.'
