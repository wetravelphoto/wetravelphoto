'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEditor } from '@/lib/auth'
import { PLATFORM } from '@/lib/platform'
import { EMAIL_PATTERN } from '@/lib/email'

/**
 * MAKING A SITE
 * ═════════════
 *
 * Four rows and an invitation, in one place, so that a beta tester costs a
 * form rather than an evening in the SQL editor:
 *
 *   1. `tenants`         — the site
 *   2. `tenant_domains`  — the address it answers to
 *   3. `site_settings`   — its name, palette and starter words
 *   4. `profiles`        — the photographer, attached to it as owner
 *
 * plus a Supabase invitation so they set their own password. Nobody ever
 * hands anybody a password.
 *
 * **Why a platform admin and not a sign-up page.** A real sign-up flow needs
 * plans, payment, abuse handling and a domain-purchase step, and none of those
 * exist yet. Inviting three friends does not need any of it. When sign-up is
 * built, this stops being a screen and becomes the thing sign-up calls.
 *
 * **There is no transaction.** Supabase is reached over HTTP, so four writes
 * are four requests and any of them can be the one that fails. The order is
 * chosen so the damage is always the same shape — a site with nothing in it —
 * and `undo` below deletes what was made rather than leaving half a
 * photographer behind. The one thing it will not do is delete a site that
 * already existed.
 */

export type NewSite = { ok: true; host: string; tenantId: string } | { ok: false; message: string }

/** Only a subdomain of the platform, for now. Lower-case, no dots inside. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/

/**
 * Addresses nobody should be given: the platform's own, and the names that
 * will mean something on it later. Cheaper to refuse now than to take one back
 * from somebody who has printed it on a card.
 */
const RESERVED = new Set([
  'www', 'admin', 'api', 'app', 'mail', 'email', 'smtp', 'imap', 'ftp', 'ns1', 'ns2',
  'help', 'support', 'docs', 'blog', 'status', 'billing', 'account', 'accounts',
  'dashboard', 'studio', 'staging', 'dev', 'test', 'demo', 'preview', 'cdn', 'img',
  'images', 'static', 'assets', 'files', 'go', 'link', 'lensgrid', 'about', 'pricing',
])

function clean(input: FormDataEntryValue | null): string {
  return typeof input === 'string' ? input.trim() : ''
}

export async function createSite(formData: FormData): Promise<NewSite> {
  const editor = await requireEditor()
  if (!editor.platformAdmin) {
    return { ok: false, message: 'Only a platform admin can make a site.' }
  }

  const name = clean(formData.get('name')).slice(0, 80)
  const label = clean(formData.get('label')).toLowerCase()
  const email = clean(formData.get('email')).toLowerCase()

  if (!name) return { ok: false, message: 'Give the site a name — the photographer can change it later.' }
  if (!LABEL.test(label)) {
    return {
      ok: false,
      message: 'The address can use letters, numbers and hyphens, and has to start and end with one of those.',
    }
  }
  if (RESERVED.has(label)) return { ok: false, message: `“${label}” is kept for the platform. Pick another.` }
  if (!EMAIL_PATTERN.test(email)) return { ok: false, message: 'That email doesn’t look right.' }

  const host = `${label}.${PLATFORM.domain}`

  let db
  try {
    db = createAdminClient()
  } catch {
    return {
      ok: false,
      message: 'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment, so a site cannot be made here.',
    }
  }

  // Taken already? The unique index would catch it, but "that address is
  // already in use" is a better sentence than a constraint violation.
  const { data: taken } = await db.from('tenant_domains').select('id').eq('host', host).maybeSingle()
  if (taken) return { ok: false, message: `${host} already belongs to a site.` }

  // ── 1. the site ───────────────────────────────────────────────────────────
  const { data: tenant, error: tenantError } = await db
    .from('tenants')
    .insert({ name, domain: host })
    .select('id')
    .single()

  if (tenantError || !tenant) {
    return { ok: false, message: tenantError?.message ?? 'The site could not be made.' }
  }
  const tenantId = tenant.id as string

  /** Takes back everything this call made, in the reverse order it made it. */
  const undo = async (why: string): Promise<NewSite> => {
    await db.from('site_settings').delete().eq('tenant_id', tenantId)
    await db.from('tenant_domains').delete().eq('tenant_id', tenantId)
    await db.from('tenants').delete().eq('id', tenantId)
    return { ok: false, message: why }
  }

  // ── 2. the address ────────────────────────────────────────────────────────
  const { error: domainError } = await db
    .from('tenant_domains')
    .insert({ tenant_id: tenantId, host, is_primary: true })

  if (domainError) return undo(`The address could not be saved: ${domainError.message}`)

  // ── 3. its settings ───────────────────────────────────────────────────────
  // site_settings.id is an integer with no default, so it has to be chosen.
  // Racing two creations would collide here; with one person making sites by
  // hand that is not a race worth locking for, and the insert would fail
  // loudly rather than quietly.
  const { data: highest } = await db
    .from('site_settings')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error: settingsError } = await db
    .from('site_settings')
    .insert({ id: ((highest?.id as number) ?? 0) + 1, tenant_id: tenantId, ...starterSettings(name) })

  if (settingsError) return undo(`The site's settings could not be saved: ${settingsError.message}`)

  // ── 4. the photographer ───────────────────────────────────────────────────
  // An invitation rather than a password: they set their own, and no password
  // ever passes through this screen, this log, or an email you wrote.
  const { data: invited, error: inviteError } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: `https://${host}/admin/login`,
  })

  if (inviteError || !invited?.user) {
    // An account may already exist — theirs, from another site, or a stale
    // one. That is a judgement call rather than something to guess at, so the
    // site is taken back and the reason handed over.
    return undo(
      inviteError?.message?.includes('already')
        ? `${email} already has an account. Attach it to the new site by hand, or invite a different address.`
        : `The invitation could not be sent: ${inviteError?.message ?? 'no reason given'}`
    )
  }

  const { error: profileError } = await db.from('profiles').insert({
    id: invited.user.id,
    email,
    tenant_id: tenantId,
    role: 'owner',
  })

  if (profileError) {
    await db.auth.admin.deleteUser(invited.user.id)
    return undo(`The account could not be attached to the site: ${profileError.message}`)
  }

  revalidatePath('/admin/sites')
  return { ok: true, host, tenantId }
}

/**
 * What a brand-new site says before anybody has written a word.
 *
 * A site with nothing in it renders a page with nothing on it, and the first
 * thing a photographer sees should not be a blank screen — it should be a
 * site, with the shape of one, saying what to replace. The words are
 * deliberately obvious placeholders: something that reads as finished is
 * something that gets published by accident.
 */
function starterSettings(name: string): Record<string, unknown> {
  return {
    site_title: name,
    tagline: 'A line about what you photograph',

    show_intro: true,
    intro_kicker: 'Hello',
    intro_heading: 'Say who you are',
    intro_body:
      'A short paragraph about your work — where you shoot, what draws you to it, who you make pictures for. Click this text in the editor to change it.',

    show_galleries: true,
    carousel_heading: 'Recent work',

    show_journal: true,
    journal_heading: 'Latest stories',

    show_about: true,
    about_heading: 'About',
    about_body:
      'The longer version: how you started, how you work, what a day with you is like. This page is yours to fill.',

    show_contact_section: true,
    contact_heading: 'Get in touch',
    contact_note: 'Tell me what you have in mind and I’ll come back to you.',

    // Off until the photographer has something to put in them.
    show_shop: false,
    show_instagram: false,
    show_newsletter: false,
  }
}
