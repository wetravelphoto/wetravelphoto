'use server'

import { revalidatePath } from 'next/cache'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { requireEditor } from '@/lib/auth'
import { restoreDraftFrom } from '@/lib/drafts/store'
import { listVersions, readVersion, type VersionRow } from '@/lib/drafts/versions'

/**
 * VERSION HISTORY AND REVIEW LINKS — the editor's two ways of looking at the
 * site other than the draft in front of you.
 *
 * Server actions are public endpoints: each checks the editor itself, and
 * every query names the editor's own site as well as relying on row-level
 * security.
 */

// ── Versions ─────────────────────────────────────────────────────────────────

export async function getVersions(): Promise<{ versions: VersionRow[]; missing: boolean }> {
  await requireEditor()
  return listVersions()
}

/**
 * Puts a kept version into the draft. The live site is untouched until
 * Publish, and Undo takes it straight back out.
 */
export async function restoreVersion(id: string) {
  await requireEditor()
  const version = await readVersion(id)
  if (!version) throw new Error('That version is no longer kept.')

  const when = new Date(version.createdAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  await restoreDraftFrom(version.snapshot, `Restored the version from ${when}`)

  revalidatePath('/edit', 'layout')
  revalidatePath('/preview', 'layout')
}

// ── Review links ─────────────────────────────────────────────────────────────

export type ShareRow = {
  id: string
  token: string
  createdAt: string
  expiresAt: string
  note: string | null
}

const DAYS = [3, 7, 14, 30]

export async function getShares(): Promise<{ shares: ShareRow[]; missing: boolean }> {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('draft_shares')
    .select('id, token, created_at, expires_at, note')
    .eq('tenant_id', tenantId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (error) return { shares: [], missing: true }
  return {
    shares: (data ?? []).map((r) => ({
      id: r.id as string,
      token: r.token as string,
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
      note: (r.note as string) ?? null,
    })),
    missing: false,
  }
}

/** A new review link, valid for a few days. Returns its token. */
export async function createShare(days: number, note?: string) {
  const { tenantId, userId } = await requireEditor()
  const valid = DAYS.includes(days) ? days : 7
  const token = randomBytes(32).toString('base64url')
  const label = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim().slice(0, 60) : ''

  const supabase = await createClient()
  const { error } = await supabase.from('draft_shares').insert({
    tenant_id: tenantId,
    token,
    expires_at: new Date(Date.now() + valid * 86_400_000).toISOString(),
    created_by: userId,
    note: label || null,
  })
  if (error) throw new Error(`Could not create the link. (${error.message})`)

  return { token }
}

/** Switches a review link off at once. */
export async function revokeShare(id: string) {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const { error } = await supabase
    .from('draft_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', id)
  if (error) throw new Error(error.message)
}
