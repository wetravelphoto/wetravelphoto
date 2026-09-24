'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { isSamplePhoto } from '@/lib/images'
import { tenantPrefix } from '@/lib/storage-keys'
import { r2Client } from '@/lib/r2'
import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PLATFORM } from '@/lib/platform'
import { SAMPLE_ALBUM_SLUG, SAMPLE_ALBUM_TITLE, SAMPLE_PHOTOS } from '@/lib/samples'
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

export type NewSite =
  | { ok: true; host: string; tenantId: string; note?: string }
  | { ok: false; message: string }

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
  // No id is given. site_settings.id used to be chosen here — read the highest
  // and add one — which was a race if two sites were ever made at the same
  // moment, and which is now the database's own job:
  // db/migrations/2026-09-23_site_settings_per_site.sql gave the column a
  // sequence, and took away the constraint from the single-site era that made
  // a second row impossible at all.
  //
  // The rule that still holds is tenant_id's unique index: one settings row
  // per site, counted per site rather than in total.
  const { error: settingsError } = await db
    .from('site_settings')
    .insert({ tenant_id: tenantId, ...starterSettings(name) })

  if (settingsError) {
    return undo(
      settingsError.message.includes('single_row') ||
        settingsError.message.includes('null value in column "id"')
        ? 'The database has not been migrated yet — run db/migrations/2026-09-23_site_settings_per_site.sql, then try again.'
        : `The site's settings could not be saved: ${settingsError.message}`
    )
  }

  // ── 4. something to look at ───────────────────────────────────────────────
  // Not fatal. A site with no sample gallery is a working site; a site that
  // could not be made because a sample gallery failed is not.
  const seeded = await seedSamples(db, tenantId)

  // ── 5. the photographer ───────────────────────────────────────────────────
  // An invitation rather than a password: they set their own, and no password
  // ever passes through this screen, this log, or an email you wrote.
  const { data: invited, error: inviteError } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: `https://${host}/admin/login`,
  })

  if (inviteError || !invited?.user) {
    // An account may already exist — theirs, from another site, or a stale
    // one. That is a judgement call rather than something to guess at, so the
    // site is taken back and the reason handed over.
    const why = inviteError?.message ?? 'no reason given'

    /**
     * "Error sending invite email" is all Supabase says when its SMTP provider
     * refuses the message — the provider's own reason never reaches here. In
     * practice it is nearly always one of three things, and saying which three
     * is the difference between a five-minute fix and an afternoon.
     */
    const smtp =
      why.toLowerCase().includes('sending') ||
      why.toLowerCase().includes('smtp') ||
      why.toLowerCase().includes('email')

    return undo(
      why.includes('already')
        ? `${email} already has an account. Attach it to the new site by hand, or invite a different address.`
        : smtp
          ? `The invitation could not be sent, so the site was not made. Supabase does not pass on the provider's reason — check the provider's own log. Usually: the sender domain is not verified, the API key cannot send, or the account is still restricted to its owner's address.`
          : `The invitation could not be sent, so the site was not made: ${why}`
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
  return {
    ok: true,
    host,
    tenantId,
    ...(seeded ? { note: `The site is made, but the sample gallery is not there: ${seeded}` } : {}),
  }
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
  /**
   * The photographs on the HOMEPAGE, not only in the gallery.
   *
   * The first version put the samples in a gallery and left the homepage
   * empty, which missed the point: a photographer cannot picture their site
   * from an outline of one. The hero is the whole first screen, and a hero
   * with no photograph behind it teaches nothing about what the site will
   * look like — it is a grey rectangle with their name on it.
   *
   * So three of the six do double duty. They are the same files, referenced
   * again; nothing is copied. Replacing any of them is one click in the
   * editor, and `removeSamples()` clears any of the three still pointing at a
   * sample — "remove the sample photographs" has to mean all of them, or a
   * photographer who clicked it still has a stranger's picture filling their
   * first screen.
   */
  const photo = (slug: string) =>
    SAMPLE_PHOTOS.find((s) => s.slug === slug)?.storage_path ?? null

  return {
    site_title: name,
    tagline: 'A line about what you photograph',

    // A standing photograph rather than featured stories: there are no
    // stories yet, and the hero is what makes a site look like a site.
    hero_mode: 'fixed',
    hero_image_path: photo('church'),
    hero_fixed_focal: { x: 0.5, y: 0.55, mx: 0.5, my: 0.55 },
    hero_kicker: 'Photography',
    hero_fixed_title: name,
    hero_fixed_subtitle: 'The line people read first. Click it to change it.',
    hero_title_position: 'center',
    show_bird: false,

    show_intro: true,
    intro_kicker: 'Hello',
    intro_heading: 'Say who you are',
    intro_body:
      'A short paragraph about your work — where you shoot, what draws you to it, who you make pictures for. Click this text in the editor to change it.',
    intro_image_path: photo('portrait'),
    intro_image_side: 'left',

    show_galleries: true,
    carousel_heading: 'Recent work',

    show_journal: true,
    journal_heading: 'From the journal',
    journal_page_eyebrow: 'Writing',
    journal_page_heading: 'Journal',

    show_about: true,
    about_eyebrow: 'Who you are',
    about_heading: 'About',
    about_image_path: photo('rickshaw'),
    about_image_side: 'right',
    about_body:
      'The longer version. How you started, what you use, how you work with people — and what a day with you is actually like, which is the thing most visitors are trying to find out before they get in touch.\n\nTwo or three paragraphs is plenty. Write it the way you would say it out loud, and put a photograph of yourself beside it if you have one you can stand.',

    show_contact_section: true,
    contact_eyebrow: 'Say hello',
    contact_heading: 'Get in touch',
    contact_note:
      'Tell me what you have in mind — where, roughly when, and what it is for. I read everything and come back within a day or two.',
    contact_image_path: photo('gull'),
    contact_image_side: 'right',

    // Off until the photographer has something to put in them.
    show_shop: false,
    show_instagram: false,
    show_newsletter: false,
  }
}


/**
 * A SITE THAT ARRIVES WITH PICTURES IN IT
 * ═══════════════════════════════════════
 *
 * The starter WORDS exist so the first screen is a site rather than an
 * outline. The same argument applies to the photographs, and more strongly:
 * a photography site with no photographs does not show what it is for, every
 * layout choice is invisible, and "Recent work" is a heading over nothing.
 *
 * These six are Gonzalo's, and they are the platform's, not the tenant's.
 * The files live in `public/samples/` and are served from this origin (see
 * `isSamplePhoto` in lib/images.ts) — one copy for everybody, rather than the
 * same six photographs paid for once per customer. It also means deleting the
 * gallery can never destroy the files, because there is nothing in anybody's
 * bucket to destroy.
 *
 * The gallery says SAMPLE wherever it appears, and `removeSamples()` takes it
 * away in one click. The thing to avoid is a photographer showing their new
 * site to a client with somebody else's pictures still on it, so the label
 * has to be impossible to miss rather than tasteful.
 */

async function seedSamples(db: SupabaseClient, tenantId: string): Promise<string | null> {
  const {
    data: album,
    error: albumError,
    dropped: albumDropped,
  } = await insertTolerant<{ id: string }>(
    async (row) => await db.from('albums').insert(row).select('id').single(),
    {
      tenant_id: tenantId,
      title: SAMPLE_ALBUM_TITLE,
      slug: SAMPLE_ALBUM_SLUG,
      privacy_type: 'public',
      // Nobody may download somebody else's photographs from a site that is
      // not theirs, however briefly they are sitting on it. Dropped without
      // complaint if this deployment has no such column — the gallery is worth
      // more than the flag.
      allow_downloads: false,
      display_order: 1,
    }
  )

  if (albumError || !album) return albumError ?? 'the gallery could not be made'
  if (albumDropped.length > 0) {
    console.warn(`[samples] albums has no ${albumDropped.join(', ')} on this deployment`)
  }

  const rows = SAMPLE_PHOTOS.map((photo, index) => ({
    tenant_id: tenantId,
    album_id: album.id as string,
    storage_path: photo.storage_path,
    original_path: null,
    derivatives: photo.derivatives,
    width: photo.width,
    height: photo.height,
    caption: photo.caption,
    sort_order: index,
    is_for_sale: false,
  }))

  const { data: inserted, error: photoError } = await insertTolerant<{ id: string }[]>(
    async (row) =>
      await db.from('photos').insert(rows.map((r) => trimTo(r, row))).select('id'),
    rows[0]
  )
  if (photoError) return photoError

  // The first one becomes the cover, so the gallery has a face on every
  // listing rather than a grey rectangle.
  if (inserted?.[0]?.id) {
    await db
      .from('albums')
      .update({ cover_photo_id: inserted[0].id })
      .eq('tenant_id', tenantId)
      .eq('id', album.id)
  }

  // ── One story ─────────────────────────────────────────────────────────────
  // Not fatal either. A site without a sample story is a working site.
  const { data: story } = await db
    .from('blog_posts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('slug', 'a-sample-story')
    .maybeSingle()

  if (!story) {
    await db.from('blog_posts').insert({ tenant_id: tenantId, ...sampleStory() })
  }

  return null
}

/**
 * Fills the homepage with the sample photographs and the starter words — but
 * ONLY where nothing is there yet.
 *
 * `starterSettings()` runs once, when a site is made. This is the same content
 * applied to a site that already exists, which is what makes "Add sample
 * photographs" work on a site rather than only on a brand-new one.
 *
 * Every field is written only if it is currently empty. A photographer who has
 * already put their own photograph in the hero and written their own opening
 * line keeps both; they simply get the parts they have not filled in. Nothing
 * here can overwrite somebody's work, which is why it is safe to offer as a
 * button rather than a decision.
 */
async function fillHomepage(db: SupabaseClient, tenantId: string): Promise<void> {
  const { data: current } = await db
    .from('site_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!current) return

  const { data: tenant } = await db.from('tenants').select('name').eq('id', tenantId).maybeSingle()
  const starter = starterSettings((tenant?.name as string) ?? (current.site_title as string) ?? 'Your site')

  const empty = (value: unknown) =>
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')

  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(starter)) {
    // Booleans and the site's own name are decisions, not blanks — leave them.
    if (key === 'site_title' || typeof value === 'boolean') continue
    if (empty(current[key as keyof typeof current])) patch[key] = value
  }

  // The hero only becomes a standing photograph if we are the ones supplying
  // the photograph. Otherwise their choice of mode stands.
  if (!empty(current.hero_image_path)) delete patch.hero_mode

  if (Object.keys(patch).length > 0) {
    // Same tolerance as the inserts: 37 settings in one update, and one column
    // this deployment does not have would otherwise lose all 37.
    await insertTolerant(
      async (row) => await db.from('site_settings').update(row).eq('tenant_id', tenantId).select('tenant_id'),
      patch
    )
  }
}

/**
 * Takes the sample gallery away. Deliberately not a general "delete album":
 * it only ever touches rows whose storage_path is a built-in sample, so a
 * mistake here cannot reach a photograph somebody took.
 */
export async function removeSamples(): Promise<{ ok: boolean; message: string }> {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { data: album } = await supabase
    .from('albums')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('slug', SAMPLE_ALBUM_SLUG)
    .maybeSingle()

  if (!album) return { ok: true, message: 'There were no samples to remove.' }

  const { data: photos } = await supabase
    .from('photos')
    .select('id, storage_path')
    .eq('tenant_id', tenantId)
    .eq('album_id', album.id)

  const theirs = (photos ?? []).filter((p) => !isSamplePhoto(p.storage_path as string))
  if (theirs.length > 0) {
    return {
      ok: false,
      message: `That gallery now has ${theirs.length} of your own photograph${
        theirs.length === 1 ? '' : 's'
      } in it. Move them somewhere else first, or delete the gallery yourself.`,
    }
  }

  // Clear the cover before deleting what it points at.
  await supabase
    .from('albums')
    .update({ cover_photo_id: null })
    .eq('tenant_id', tenantId)
    .eq('id', album.id)

  await supabase.from('photos').delete().eq('tenant_id', tenantId).eq('album_id', album.id)
  await supabase.from('albums').delete().eq('tenant_id', tenantId).eq('id', album.id)

  // ── And the ones on the homepage ──────────────────────────────────────────
  // Only where they are still a sample. Anything the photographer has already
  // replaced is theirs and is left exactly where it is.
  const { data: settings } = await supabase
    .from('site_settings')
    .select('hero_image_path, intro_image_path, contact_image_path')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const clear: Record<string, unknown> = {}
  if (isSamplePhoto(settings?.hero_image_path as string)) {
    clear.hero_image_path = null
    // With no standing photograph, the hero goes back to featured stories,
    // which is what an empty site shows before anything is chosen.
    clear.hero_mode = 'stories'
    clear.hero_fixed_subtitle = null
  }
  if (isSamplePhoto(settings?.intro_image_path as string)) clear.intro_image_path = null
  if (isSamplePhoto(settings?.contact_image_path as string)) clear.contact_image_path = null

  const cleared = Object.keys(clear).length > 0
  if (cleared) {
    await supabase.from('site_settings').update(clear).eq('tenant_id', tenantId)
  }

  revalidatePath('/admin/trips')
  revalidatePath('/admin')
  revalidatePath('/')

  return {
    ok: true,
    message: cleared
      ? 'The sample gallery is gone, and the sample photographs have been taken off your homepage. Nothing of yours was touched.'
      : 'The sample gallery is gone. Nothing of yours was touched.',
  }
}

/**
 * DELETING A SITE, WHICH NOTHING ELSE CAN UNDO
 * ════════════════════════════════════════════
 *
 * There was no way to do this, which was fine while every site was one Gonzalo
 * had just made and could ignore. It stops being fine the moment a tester
 * leaves, a subdomain is needed back, or a site is made with a typo in the
 * address — and the alternative is hand-written SQL against production at
 * eleven at night, which is how a wrong WHERE clause happens.
 *
 * **Nothing cascades.** The foreign keys to `tenants` carry no ON DELETE
 * clause, so a tenant with a single photograph in it cannot be deleted at all.
 * That is a good accident: it means this function has to name every table it
 * destroys, in an order somebody can read and argue with, rather than one
 * DELETE quietly taking away more than it appears to.
 *
 * **The files go too.** `t/<tenant id>/…` is the whole of a site's storage
 * (lib/storage-keys.ts), so the prefix is the unit of deletion. If listing or
 * deleting them fails the rows are still removed and the caller is told the
 * files were left behind — an orphaned object costs a fraction of a penny; a
 * half-deleted database is a support problem.
 *
 * **The confirmation is the host, typed.** Not "are you sure": a dialogue
 * nobody reads is worse than no dialogue, because it converts a mistake into a
 * mistake somebody has approved. Typing `ana.lensgrid.co` cannot be done by
 * accident.
 */
export type DeleteResult = { ok: boolean; message: string }

/** Every table holding a site's work, in the order they have to go. */
const TENANT_TABLES = [
  // Leaves first — rows that point at photographs, albums or clients.
  'downloads',
  'favorites',
  'page_views',
  'order_items',
  'orders',
  'photo_shop_categories',
  'album_clients',
  'catalog_items',
  'products',
  'print_options',
  'shop_categories',
  'room_scenes',
  'instagram_media',
  'contact_messages',
  'newsletter_signups',
  'site_draft_steps',
  'site_draft',
  'page_sections',
  // Then the things they pointed at.
  'photos',
  'blog_posts',
  'albums',
  'clients',
  'site_settings',
  'tenant_domains',
] as const

export async function deleteSite(formData: FormData): Promise<DeleteResult> {
  const editor = await requireEditor()
  if (!editor.platformAdmin) {
    return { ok: false, message: 'Only a platform admin can delete a site.' }
  }

  const tenantId = clean(formData.get('tenant_id'))
  const typed = clean(formData.get('confirm')).toLowerCase()

  let db
  try {
    db = createAdminClient()
  } catch {
    return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment.' }
  }

  const { data: domains } = await db
    .from('tenant_domains')
    .select('host, is_primary')
    .eq('tenant_id', tenantId)

  const primary =
    (domains ?? []).find((d) => d.is_primary)?.host ?? (domains ?? [])[0]?.host ?? ''

  if (!primary) {
    return {
      ok: false,
      message: 'That site has no address, so there is nothing to type to confirm. Give it one first, or remove it in Supabase.',
    }
  }

  if (typed !== primary.toLowerCase()) {
    return { ok: false, message: `Type ${primary} exactly to confirm.` }
  }

  // ── The people ────────────────────────────────────────────────────────────
  // Read before the rows go, or there is no way to find them afterwards.
  const { data: people } = await db.from('profiles').select('id').eq('tenant_id', tenantId)

  // ── The files ─────────────────────────────────────────────────────────────
  let filesLeft = 0
  try {
    filesLeft = await deleteTenantFiles(tenantId)
  } catch {
    filesLeft = -1
  }

  // ── The rows, leaves first ────────────────────────────────────────────────
  const failed: string[] = []
  for (const table of TENANT_TABLES) {
    const { error } = await db.from(table).delete().eq('tenant_id', tenantId)
    // A table that does not exist on this deployment is not a failure.
    if (error && !/does not exist|schema cache/i.test(error.message)) failed.push(table)
  }

  await db.from('profiles').delete().eq('tenant_id', tenantId)

  const { error: tenantError } = await db.from('tenants').delete().eq('id', tenantId)
  if (tenantError) {
    return {
      ok: false,
      message: `The site's contents were removed but the site itself was not: ${tenantError.message}`,
    }
  }

  for (const person of people ?? []) {
    await db.auth.admin.deleteUser(person.id as string)
  }

  revalidatePath('/admin/sites')

  const notes: string[] = []
  if (failed.length > 0) notes.push(`rows may remain in ${failed.join(', ')}`)
  if (filesLeft === -1) notes.push('the stored files could not be reached and were left in place')
  else if (filesLeft > 0) notes.push(`${filesLeft} file${filesLeft === 1 ? '' : 's'} could not be deleted`)

  return {
    ok: true,
    message:
      `${primary} is gone, along with ${(people ?? []).length} account${
        (people ?? []).length === 1 ? '' : 's'
      }.` + (notes.length > 0 ? ` One thing to know: ${notes.join('; ')}.` : ''),
  }
}

/** Everything under `t/<tenant id>/`. Returns how many could not be deleted. */
async function deleteTenantFiles(tenantId: string): Promise<number> {
  const Bucket = process.env.R2_BUCKET_NAME
  if (!Bucket) return -1

  const prefix = `${tenantPrefix(tenantId)}/`
  let token: string | undefined
  let failures = 0

  do {
    const listed = await r2Client.send(
      new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token })
    )
    const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key)

    for (let i = 0; i < keys.length; i += 1000) {
      const result = await r2Client.send(
        new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.slice(i, i + 1000) } })
      )
      failures += result.Errors?.length ?? 0
    }

    token = listed.IsTruncated ? listed.NextContinuationToken : undefined
  } while (token)

  return failures
}


/**
 * Puts the sample gallery into the site you are signed in to.
 *
 * Exists because the seeding inside `createSite` is deliberately non-fatal — a
 * site that could not be made because a sample gallery failed would be a much
 * worse bug than a site without one — and a failure that is not fatal is a
 * failure nobody sees. This is the way to run it again, and to be told exactly
 * why if it does not work.
 */
export async function addSamples(): Promise<{ ok: boolean; message: string }> {
  const { tenantId } = await requireEditor()

  let db
  try {
    db = createAdminClient()
  } catch {
    return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment.' }
  }

  const { data: existing } = await db
    .from('albums')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('slug', SAMPLE_ALBUM_SLUG)
    .maybeSingle()

  if (existing) return { ok: false, message: 'This site already has the sample gallery.' }

  const why = await seedSamples(db, tenantId)
  if (why) return { ok: false, message: `The sample gallery could not be added: ${why}` }

  await fillHomepage(db, tenantId)

  revalidatePath('/admin/trips')
  revalidatePath('/admin')
  revalidatePath('/')
  return {
    ok: true,
    message:
      'Six sample photographs added, a sample story written, and the homepage filled in. Anything you had already written was left alone.',
  }
}

/**
 * ONE STORY, SO THE JOURNAL IS NOT AN EMPTY ROOM
 *
 * The homepage has a "Latest stories" block and the menu has a Journal page.
 * With nothing in either, a photographer sees a heading over a blank space and
 * learns nothing about what a story looks like — how a lead paragraph sits,
 * what a pull quote does, how photographs break up text.
 *
 * So there is one, built from blocks a photographer will actually use, and
 * written about the photographs it contains rather than filled with lorem
 * ipsum. It goes out published, because a draft would not appear on the
 * homepage and the point is to see the homepage.
 */
function sampleStory(): Record<string, unknown> {
  const path = (slug: string) =>
    SAMPLE_PHOTOS.find((s) => s.slug === slug)?.storage_path ?? ''

  const blocks = [
    {
      id: 'lead',
      type: 'lead',
      text: 'This is a story — a few hundred words and the photographs that go with them. Delete it whenever you like, or open it in the editor and write over it.',
    },
    {
      id: 'p1',
      type: 'paragraph',
      text: 'A story is where the pictures get their context: why you were there, what the light was doing, what you were waiting for. Most photographers find it is the part clients read.',
    },
    { id: 'im1', type: 'image', image: { path: path('rickshaw'), caption: 'A single image, full width.' } },
    {
      id: 'p2',
      type: 'paragraph',
      text: 'You can put photographs between paragraphs one at a time, in pairs, or as a strip. Each one can carry a caption, and the caption is often where the real story is.',
    },
    {
      id: 'pair',
      type: 'image_pair',
      left: { path: path('monkey'), caption: null },
      right: { path: path('oriole'), caption: null },
    },
    {
      id: 'q',
      type: 'quote',
      text: 'A line worth pulling out of the text and setting on its own.',
      attribution: null,
    },
    {
      id: 'p3',
      type: 'paragraph',
      text: 'When you are ready, this is the button to press: open the Journal, write your own, and delete this one. Nothing here is permanent.',
    },
  ]

  return {
    title: 'A sample story',
    slug: 'a-sample-story',
    status: 'published',
    published_at: new Date().toISOString(),
    excerpt: 'What a story looks like on your site — words, photographs and captions together.',
    featured_custom_path: path('church'),
    blocks,
  }
}

/**
 * WRITING A ROW WHEN THE SCHEMA IS NOT FULLY KNOWN
 * ════════════════════════════════════════════════
 *
 * `db/test-fixture.sql` is written by hand from what production is believed to
 * look like, and twice now that belief has been wrong in a way only production
 * could reveal: `site_settings.single_row`, a constraint the fixture did not
 * have, and `albums.allow_downloads`, a column the fixture has and PostgREST
 * says it cannot find. Both failed the same way — locally green, live broken.
 *
 * Seeding is decoration. A sample gallery is worth having and worth nothing at
 * all compared to the site existing, so one unrecognised column must not take
 * the whole row down with it. This writes the row, and if the database says it
 * does not know a column, drops that column and tries again.
 *
 * It is deliberately narrow: it only ever REMOVES fields, never invents them,
 * and only in response to the database saying that field does not exist. A row
 * that fails for any other reason — a constraint, a foreign key, a bad value —
 * fails, because those are real errors and hiding them is how the last two
 * bugs stayed hidden.
 *
 * Returns the columns it had to drop, so they can be said out loud rather than
 * quietly tolerated forever.
 */
type Tolerant<T> = { data: T | null; error: string | null; dropped: string[] }

const UNKNOWN_COLUMN = /Could not find the '([^']+)' column|column "([^"]+)" of relation .* does not exist/

async function insertTolerant<T>(
  run: (row: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>,
  row: Record<string, unknown>
): Promise<Tolerant<T>> {
  const dropped: string[] = []
  const attempt = { ...row }

  // Bounded: one pass per field at worst, and it stops the moment the error is
  // anything other than "no such column".
  for (let i = 0; i <= Object.keys(row).length; i++) {
    const { data, error } = await run(attempt)
    if (!error) return { data, error: null, dropped }

    const match = UNKNOWN_COLUMN.exec(error.message)
    const column = match?.[1] ?? match?.[2]
    if (!column || !(column in attempt)) {
      return { data: null, error: error.message, dropped }
    }

    delete attempt[column]
    dropped.push(column)
  }

  return { data: null, error: 'too many unknown columns', dropped }
}


/** The same keys as `shape`, taken from `full`. Used to apply a column drop
 *  worked out on one row to every row in the batch. */
function trimTo(full: Record<string, unknown>, shape: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(full)) out[key] = key in shape ? full[key] : undefined
  return out
}
