import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClientOrNull } from '@/lib/supabase/admin'
import { getSiteSettings, siteUrl } from '@/lib/site'
import { PROVIDERS, isProviderId, type ProviderId } from '@/lib/newsletter/providers'

/**
 * A site's newsletter connection, and sending sign-ups through it.
 *
 * The connection (service, API key, chosen list) lives in site_secrets next
 * to the Instagram token: only the site's own editors can read it, never a
 * visitor. A visitor's sign-up is sent on by the server, which reads the key
 * with the service-role client for that one site and nothing else.
 */

export type Connection = {
  provider: ProviderId
  key: string
  listId: string | null
  listName: string | null
  doubleOptIn: boolean
}

export async function readConnection(db: SupabaseClient, tenantId: string): Promise<Connection | null> {
  const { data } = await db
    .from('site_secrets')
    .select('newsletter_provider, newsletter_key, newsletter_list_id, newsletter_list_name, newsletter_double_optin')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!data || !isProviderId(data.newsletter_provider) || !data.newsletter_key) return null
  return {
    provider: data.newsletter_provider,
    key: data.newsletter_key as string,
    listId: (data.newsletter_list_id as string) ?? null,
    listName: (data.newsletter_list_name as string) ?? null,
    doubleOptIn: data.newsletter_double_optin === true,
  }
}

/** Sends one email to the connected service. Throws with a readable reason. */
export async function pushOne(connection: Connection, email: string): Promise<void> {
  if (!connection.listId) throw new Error('No list chosen yet in Settings → Newsletter.')
  await PROVIDERS[connection.provider].add(connection.key, connection.listId, email, {
    doubleOptIn: connection.doubleOptIn,
    referrer: await siteUrl(),
  })
}

/** Records how sending went on the sign-up row, for Settings to show. */
async function mark(db: SupabaseClient, tenantId: string, email: string, error: string | null) {
  await db
    .from('newsletter_signups')
    .update(error ? { sync_error: error.slice(0, 300) } : { synced_at: new Date().toISOString(), sync_error: null })
    .eq('tenant_id', tenantId)
    .eq('email', email)
}

/**
 * A visitor just signed up: send them on to the photographer's service, if
 * one is connected. Never throws — the sign-up is already stored, and the
 * visitor's "thanks" does not depend on a third party being up.
 */
export async function forwardSignup(email: string): Promise<void> {
  try {
    const admin = createAdminClientOrNull()
    if (!admin) return
    const settings = await getSiteSettings()
    const tenantId = settings.tenant_id
    if (!tenantId) return

    const connection = await readConnection(admin, tenantId)
    if (!connection || !connection.listId) return

    try {
      await pushOne(connection, email)
      await mark(admin, tenantId, email, null)
    } catch (e) {
      await mark(admin, tenantId, email, e instanceof Error ? e.message : 'Could not send.')
    }
  } catch (e) {
    console.error('[newsletter] forwarding failed:', e instanceof Error ? e.message : e)
  }
}

/**
 * Sends every sign-up not yet sent (or that failed) to the connected service.
 * Run by the photographer from Settings, with their own session.
 */
export async function syncPending(
  db: SupabaseClient,
  tenantId: string,
  limit = 300
): Promise<{ sent: number; failed: number; left: number; lastError: string | null }> {
  const connection = await readConnection(db, tenantId)
  if (!connection) throw new Error('No newsletter service is connected.')
  if (!connection.listId) throw new Error('Choose which list sign-ups should join first.')

  const { data } = await db
    .from('newsletter_signups')
    .select('email')
    .eq('tenant_id', tenantId)
    .is('synced_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  let sent = 0
  let failed = 0
  let lastError: string | null = null
  for (const row of data ?? []) {
    const email = row.email as string
    try {
      await pushOne(connection, email)
      await mark(db, tenantId, email, null)
      sent++
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Could not send.'
      await mark(db, tenantId, email, lastError)
      failed++
      // A bad key or a missing list fails every row the same way; stop early
      // rather than hammer the service with a few hundred identical errors.
      if (failed >= 5 && sent === 0) break
    }
  }

  const { count } = await db
    .from('newsletter_signups')
    .select('email', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('synced_at', null)

  return { sent, failed, left: count ?? 0, lastError }
}
