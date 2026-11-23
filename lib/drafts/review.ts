import { createAdminClientOrNull } from '@/lib/supabase/admin'
import { parseDraftRow, type SiteDraft } from '@/lib/drafts/store'
import { currentSiteTenantId } from '@/lib/tenant'

/**
 * REVIEW LINKS — showing an unpublished draft to someone without an account
 * ═════════════════════════════════════════════════════════════════════════
 *
 * The draft is private: row-level security lets only the site's own editors
 * read it. A review link is the one way around that, and it is deliberately
 * narrow:
 *
 *   - The token is 32 random bytes, stored in draft_shares with an expiry
 *     date, and can be revoked. It is the only credential; knowing it is
 *     knowing the link.
 *   - It is checked here, server-side, with the service-role client. That
 *     client reads exactly two things — the share row by its token, then that
 *     share's site's draft — and hands back a cleaned draft. Nothing here
 *     writes, and nothing here can reach another site's draft: the share is
 *     looked up only among the shares of the site whose address this is, and
 *     the draft read is that share's own site.
 *   - The page that shows it (app/review/[token]) is read-only, never
 *     indexed, and sends no Referer, so the token does not leak to sites the
 *     reviewer clicks through to.
 *
 * The link shows the draft as it is when opened, so a reviewer sees each edit
 * after a reload. Once the draft is published (or discarded) there is nothing
 * left to review, and the page says so.
 */

export type OpenedShare =
  | { status: 'ok'; draft: SiteDraft; expiresAt: string; tenantId: string }
  | { status: 'published' }
  | { status: 'invalid' }

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/

export async function openShare(token: string): Promise<OpenedShare> {
  if (!TOKEN.test(token)) return { status: 'invalid' }

  const admin = createAdminClientOrNull()
  if (!admin) return { status: 'invalid' }

  // A link opens on the address of the site that minted it, and nowhere
  // else (P5). Read by the Host, like every public page: one site's draft is
  // never drawn under another's address, and another site's token is simply
  // not found here — the same answer as a wrong or expired one.
  const hostTenant = await currentSiteTenantId()
  if (!hostTenant) return { status: 'invalid' }

  const { data: share } = await admin
    .from('draft_shares')
    .select('tenant_id, expires_at, revoked_at')
    .eq('tenant_id', hostTenant)
    .eq('token', token)
    .maybeSingle()

  if (!share || share.revoked_at || new Date(share.expires_at as string).getTime() < Date.now()) {
    return { status: 'invalid' }
  }

  const { data: row } = await admin
    .from('site_draft')
    .select('*')
    .eq('tenant_id', share.tenant_id as string)
    .maybeSingle()

  if (!row) return { status: 'published' }
  return { status: 'ok', draft: parseDraftRow(row), expiresAt: share.expires_at as string, tenantId: share.tenant_id as string }
}
