'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireEditor } from '@/lib/auth'
import { EMAIL_PATTERN } from '@/lib/email'
import { PROVIDERS, isProviderId, type ListOption } from '@/lib/newsletter/providers'
import { forwardSignup, readConnection, syncPending } from '@/lib/newsletter/connection'
import { currentSiteTenantId } from '@/lib/tenant'

/**
 * THE NEWSLETTER
 * ══════════════
 *
 * `subscribe` is the visitor's sign-up: public, like the contact form. The
 * rest are the photographer's, in Settings → Newsletter, and each checks the
 * editor first: connecting their mailing service, choosing the list, sending
 * the sign-ups collected so far, and disconnecting.
 */

export async function subscribe(formData: FormData) {
  const email = (formData.get('email') as string)?.trim().toLowerCase()

  // Bots fill hidden fields; people leave them empty.
  if (formData.get('company')) return { ok: true, message: 'Thanks — you’re on the list.' }

  if (!email || email.length > 200 || !EMAIL_PATTERN.test(email)) {
    return { ok: false, message: 'That email doesn’t look right.' }
  }

  // Whose list this is. Left out, the column default hands the sign-up to the
  // first tenant — so somebody subscribing on one site would join another
  // photographer's mailing list. See the note in app/actions/contact.ts.
  const tenantId = await currentSiteTenantId()
  if (!tenantId) return { ok: false, message: 'This address is not taking sign-ups yet.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('newsletter_signups')
    .insert({ email, tenant_id: tenantId })

  // A duplicate just means they're already subscribed — not an error worth showing
  if (error && error.code !== '23505') {
    console.error('[newsletter] could not save a sign-up:', error.message)
    return { ok: false, message: 'Something went wrong. Try again?' }
  }

  // On to the photographer's own mailing service, if one is connected.
  if (!error) await forwardSignup(email)

  return { ok: true, message: 'Thanks — you’re on the list.' }
}

// ── The photographer's side ──────────────────────────────────────────────────

function done() {
  revalidatePath('/admin/settings')
}

/**
 * Connects a mailing service: checks the key by asking the service for its
 * lists, then saves the service and key. Returns the lists to choose from.
 */
export async function connectNewsletter(
  provider: string,
  key: string
): Promise<{ ok: true; lists: ListOption[] } | { ok: false; message: string }> {
  const { tenantId } = await requireEditor()
  if (!isProviderId(provider)) return { ok: false, message: 'Choose a service.' }

  const clean = (key ?? '').trim()
  if (clean.length < 8 || clean.length > 500 || /\s/.test(clean)) {
    return { ok: false, message: 'Paste the whole key, with nothing before or after it.' }
  }

  let lists: ListOption[]
  try {
    lists = await PROVIDERS[provider].lists(clean)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not reach the service.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('site_secrets').upsert(
    {
      tenant_id: tenantId,
      newsletter_provider: provider,
      newsletter_key: clean,
      // A single list is chosen for them; otherwise they pick.
      newsletter_list_id: lists.length === 1 ? lists[0].id : null,
      newsletter_list_name: lists.length === 1 ? lists[0].name : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' }
  )
  if (error) return { ok: false, message: `Could not save the connection. (${error.message})` }

  done()
  return { ok: true, lists }
}

/** The connected service's lists, fetched again (for changing the choice). */
export async function newsletterLists(): Promise<{ ok: true; lists: ListOption[] } | { ok: false; message: string }> {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const connection = await readConnection(supabase, tenantId)
  if (!connection) return { ok: false, message: 'No service is connected.' }
  try {
    return { ok: true, lists: await PROVIDERS[connection.provider].lists(connection.key) }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not reach the service.' }
  }
}

/** Which list new sign-ups join, and whether they are asked to confirm. */
export async function chooseNewsletterList(listId: string, doubleOptIn: boolean) {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const connection = await readConnection(supabase, tenantId)
  if (!connection) return { ok: false, message: 'No service is connected.' }

  // Checked against the service's own lists, so only a real one is stored.
  let lists: ListOption[]
  try {
    lists = await PROVIDERS[connection.provider].lists(connection.key)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not reach the service.' }
  }
  const list = lists.find((l) => l.id === listId)
  if (!list) return { ok: false, message: 'That list was not found in your account.' }

  const { error } = await supabase
    .from('site_secrets')
    .update({
      newsletter_list_id: list.id,
      newsletter_list_name: list.name,
      newsletter_double_optin: PROVIDERS[connection.provider].doubleOptIn && doubleOptIn === true,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, message: error.message }

  done()
  return { ok: true, message: `New sign-ups will join “${list.name}”.` }
}

/** Sends the sign-ups not yet sent to the connected service. */
export async function syncNewsletter() {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  try {
    const r = await syncPending(supabase, tenantId)
    done()
    if (r.failed && !r.sent) return { ok: false, message: r.lastError ?? 'Could not send them.' }
    return {
      ok: true,
      message:
        `${r.sent} sent${r.failed ? `, ${r.failed} could not be sent (${r.lastError})` : ''}.` +
        (r.left ? ` ${r.left} still waiting — run it again.` : ''),
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not send them.' }
  }
}

/** Forgets the service and its key. Sign-ups already collected are kept. */
export async function disconnectNewsletter() {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  await supabase
    .from('site_secrets')
    .update({
      newsletter_provider: null,
      newsletter_key: null,
      newsletter_list_id: null,
      newsletter_list_name: null,
      newsletter_double_optin: false,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
  done()
  return { ok: true, message: 'Disconnected. Sign-ups are still collected here.' }
}
