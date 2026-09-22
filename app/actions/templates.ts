'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { patchSiteSettings } from '@/lib/site-patch'
import { recordHistory } from '@/lib/templates/history'
import { mirrorPage, replaceSections } from '@/lib/sections/store'
import { tierAllowed } from '@/lib/entitlements'
import { applyManifest, type TemplateManifest } from '@/lib/templates/manifest'
import { TOKENS_VERSION } from '@/lib/styles/tokens'
import {
  currentLook,
  liveManifest,
  liveSections,
  manifestForVersion,
} from '@/lib/templates/store'

const PATHS = ['/admin/design']

function done() {
  // 'layout' because a look sets the global style tokens, which are emitted in
  // the root layout — revalidating pages alone would leave every one of them
  // wearing the old colours.
  revalidatePath('/', 'layout')
  PATHS.forEach((p) => revalidatePath(p))
}

/**
 * APPLYING A LOOK
 * ═══════════════
 *
 * Every path through this file writes the page's previous state to
 * site_template_history BEFORE it changes anything. That is not defensive
 * habit, it is the feature: it is what lets the Design page offer "undo" on
 * every row, including on an undo.
 *
 * recordHistory now lives in lib/templates/history.ts, because publishing from
 * the canvas needs the same undo point and two copies of it would eventually
 * disagree.
 *
 * Nothing here deletes a photograph, a story, a price or a word anyone wrote.
 * The manifest has no way to express those — see lib/templates/manifest.ts —
 * and a section the new look has no slot for is parked and switched off
 * rather than removed.
 */

/** Writes the manifest into the live site. Assumes history is already saved. */
async function install(manifest: TemplateManifest, page = 'home') {
  const existing = await liveSections(page)
  const result = applyManifest(manifest, page, existing)

  await replaceSections(page, result.sections)

  if (manifest.styles?.type_styles || manifest.styles?.tokens) {
    await patchSiteSettings({
      ...(manifest.styles.type_styles ? { type_styles: manifest.styles.type_styles } : {}),
      ...(manifest.styles.tokens
        ? { global_styles: manifest.styles.tokens, global_styles_version: TOKENS_VERSION }
        : {}),
    })
  }

  // Keep the old homepage form in step. Transition shim.
  await mirrorPage(page)

  return result
}

// ── Switching look ───────────────────────────────────────────────────────────

export async function applyLook(slug: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No look called "${slug}".`)

  // Always true today. Here so that gating a look later is a value in the
  // database, not a change to this file. See lib/entitlements.ts.
  if (!(await tierAllowed(null, data.tier as string | null, 'templates.premium'))) {
    throw new Error(`${data.name} is not included in your plan.`)
  }

  await recordHistory({
    action: 'apply',
    templateId: data.id as string,
    templateSlug: data.slug as string,
    templateName: data.name as string,
    version: data.version as number,
  })

  const result = await install(data.manifest as TemplateManifest)

  await supabase.from('site_template').upsert(
    {
      template_id: data.id,
      version: data.version,
      // The manifest AS APPLIED — so this site can still answer "what was I
      // given?" after the look itself moves on.
      snapshot: data.manifest,
      adopted_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' }
  )

  done()
  return result.summary
}

/**
 * Takes a newer version of the look this site is already on.
 *
 * Deliberate, never automatic. Publishing a new version of a look changes
 * nothing on anyone's site until they do this.
 */
export async function takeUpdate() {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const current = await currentLook()
  if (!current.look) throw new Error('This site is not using a look yet.')
  if (!current.updateAvailable) throw new Error('You are already on the newest version.')

  const manifest =
    (await manifestForVersion(current.look.id, current.look.version)) ?? current.look.manifest

  await recordHistory({
    action: 'update',
    templateId: current.look.id,
    templateSlug: current.look.slug,
    templateName: current.look.name,
    version: current.look.version,
    note: `From version ${current.version} to ${current.look.version}.`,
  })

  const result = await install(manifest)

  const supabase = await createClient()
  await supabase.from('site_template').upsert(
    {
      template_id: current.look.id,
      version: current.look.version,
      snapshot: manifest,
      adopted_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' }
  )

  done()
  return result.summary
}

// ── The way back ─────────────────────────────────────────────────────────────

/**
 * Restores the page exactly as it was before a given change.
 *
 * A restore is itself recorded, so going back is never a one-way door either.
 */
export async function revertTo(historyId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('site_template_history')
    .select('*')
    .eq('id', historyId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('That undo point is no longer there.')

  await recordHistory({
    action: 'revert',
    templateId: (data.from_template_id as string) ?? null,
    templateSlug: null,
    templateName: null,
    version: (data.from_version as number) ?? null,
    note: `Undid the change of ${new Date(data.created_at as string).toLocaleString()}.`,
  })

  const sections = (data.sections_before ?? []) as {
    type: string
    visible: boolean
    version: number
    settings: Record<string, unknown>
  }[]

  await replaceSections('home', sections)

  // Either shape: { type_styles, tokens } from 2026-09-16 on, or a bare
  // type_styles map before that.
  const before = (data.styles_before ?? {}) as Record<string, unknown>
  const hasBothHalves = 'type_styles' in before || 'tokens' in before

  await patchSiteSettings(
    hasBothHalves
      ? {
          type_styles: before.type_styles ?? {},
          global_styles: before.tokens ?? {},
          global_styles_version: TOKENS_VERSION,
        }
      : { type_styles: before }
  )

  await mirrorPage('home')

  if (data.from_template_id) {
    const snapshot = await manifestForVersion(
      data.from_template_id as string,
      (data.from_version as number) ?? 1
    )

    await supabase.from('site_template').upsert(
      {
        template_id: data.from_template_id,
        version: data.from_version ?? 1,
        snapshot: snapshot ?? {},
        adopted_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' }
    )
  }

  done()
}

// ── Authoring ────────────────────────────────────────────────────────────────

/**
 * Lifts this site's current design into a new look.
 *
 * This is how look number two gets made, and number twenty: build it on a
 * real site until it is right, then capture it. Design only — the manifest
 * cannot carry writing or photographs even if you ask it to.
 */
export async function captureLook(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const name = ((formData.get('name') as string) ?? '').trim()
  if (!name) throw new Error('Give the look a name.')

  const slug =
    ((formData.get('slug') as string) ?? '').trim() ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

  const manifest = await liveManifest()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('templates')
    .insert({
      slug,
      name,
      blurb: ((formData.get('blurb') as string) ?? '').trim() || null,
      status: 'draft',
      origin: 'system',
      version: 1,
      manifest,
    })
    .select('id, version')
    .maybeSingle()

  if (error) {
    throw new Error(
      error.message.includes('duplicate')
        ? `There is already a look called "${slug}".`
        : error.message
    )
  }

  if (data) {
    await supabase.from('template_versions').insert({
      template_id: data.id,
      version: data.version,
      manifest,
      notes: 'Captured from the live site.',
    })
  }

  done()
  return slug
}

/**
 * Publishes this site's current design as the next version of an existing
 * look. Sites already on it are untouched until each one takes the update.
 */
export async function publishLookVersion(slug: string, notes?: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()

  const { data: look, error } = await supabase
    .from('templates')
    .select('id, version')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!look) throw new Error(`No look called "${slug}".`)

  const manifest = await liveManifest()
  const next = ((look.version as number) ?? 1) + 1

  const { error: versionError } = await supabase.from('template_versions').insert({
    template_id: look.id,
    version: next,
    manifest,
    notes: notes ?? null,
  })

  if (versionError) throw new Error(versionError.message)

  await supabase
    .from('templates')
    .update({
      version: next,
      manifest,
      status: 'published',
      updated_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
    })
    .eq('id', look.id)

  done()
  return next
}
