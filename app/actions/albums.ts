'use server'

import { requireEditor } from '@/lib/auth'
import { tenantKey } from '@/lib/storage-keys'
import { createClient } from '@/lib/supabase/server'
import { hashPassword } from '@/lib/password'
import { r2Client } from '@/lib/r2'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { fromSupabase, ingestPhoto } from '@/lib/photos/ingest'
import { syncAlbum } from '@/lib/photos/usages'
import { randomUUID } from 'crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clampFocal, clampZoom, hexColor, storableCoverPreset } from '@/lib/covers/registry'
import { DEFAULT_LAYOUT, storableLayout } from '@/lib/gallery/layouts'

function slugify(input: string): string {
  return (
    input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'album'
  )
}

async function uniqueSlug(supabase: SupabaseClient, tenantId: string, base: string, excludeId?: string): Promise<string> {
  const root = slugify(base)
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`
    let query = supabase.from('albums').select('id').eq('tenant_id', tenantId).eq('slug', candidate)
    if (excludeId) query = query.neq('id', excludeId)
    const { data } = await query.maybeSingle()
    if (!data) return candidate
  }
  return `${root}-${Date.now()}`
}

export async function createAlbum(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const title = formData.get('title') as string
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const slug = await uniqueSlug(supabase, tenantId, title)

  // Justified is the default layout for a new album (client-gallery-v2);
  // the column's own default is still `masonry`, which only a migration
  // could change, so it is named here.
  const { data, error } = await supabase
    .from('albums')
    .insert({ title, slug, created_by: user?.id, tenant_id: tenantId, layout_style: DEFAULT_LAYOUT })
    .select()
    .single()

  if (error) throw new Error(error.message)

  revalidatePath('/admin')
  revalidatePath('/')
  redirect(`/admin/trips/${data.id}`)
}

export async function updateAlbumSettings(albumId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const get = (k: string) => formData.get(k) as string
  const num = (k: string, fallback: number) => {
    const v = parseFloat(formData.get(k) as string)
    return isNaN(v) ? fallback : v
  }

  const title = get('title')
  const supabase = await createClient()
  const slug = await uniqueSlug(supabase, tenantId, get('slug') || title, albumId)

  const updates: Record<string, unknown> = {
    title,
    slug,
    description: get('description') || null,
    location: get('location') || null,
    trip_start_date: get('trip_start_date') || null,
    cover_date_format: get('cover_date_format') || 'month_year',
    show_tags: formData.get('show_tags') === 'on',
    gallery_hero: formData.get('gallery_hero') === 'on',
    description_align: get('description_align') || 'left',
    description_scale: num('description_scale', 1),
    tags: (get('tags') || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
    privacy_type: get('privacy_type'),
    cover_photo_id: get('cover_photo_id') || null,
    cover_focal_x: num('cover_focal_x', 0.5),
    cover_focal_y: num('cover_focal_y', 0.5),
    cover_title_enabled: formData.get('cover_title_enabled') === 'on',
    cover_title_text: get('cover_title_text'),
    cover_subtitle: get('cover_subtitle') || null,
    cover_preset: get('cover_layout') || 'anchor',
    cover_font: get('cover_font') || 'Oswald',
    cover_title_scale: num('cover_title_scale', 1),
    cover_title_color: get('cover_title_color') || '#FAF9F6',
    cover_show_location: formData.get('cover_show_location') === 'on',
    cover_show_date: formData.get('cover_show_date') === 'on',
    cover_show_button: formData.get('cover_show_button') === 'on',
    cover_button_text: get('cover_button_text') || 'View gallery',
    layout_style: get('layout_style'),
    sort_order: get('sort_order'),
    cover_overlay_type: get('cover_overlay_type') || 'none',
    cover_overlay_opacity: num('cover_overlay_opacity', 0.35),
    // An unchecked box sends nothing, so absent means off — which is the
    // answer we want anyway for a switch that hands over full-size files.
    allow_downloads: formData.get('allow_downloads') === 'on',
    // client-gallery-v2 (migration 20261122233150): NULL means "not chosen",
    // and the renderer then uses the style's own default.
    cover_background: hexColor(get('cover_background')),
    cover_zoom: formData.get('cover_zoom') === null || get('cover_zoom') === '' ? null : clampZoom(get('cover_zoom')),
    cover_secondary_photo_id: get('cover_secondary_photo_id') || null,
  }

  /*
   * VALUES FROM A FORM ARE CHECKED AGAINST WHAT IS DECLARED, never written as
   * sent (a server action is a public endpoint). An unknown value keeps what
   * the album already has, as every other field of this form falls back
   * rather than failing:
   *
   *   cover_preset  a prefixed cover style (`v2:<key>`, lib/covers/registry.ts)
   *                 or one of the legacy layouts, exactly — the contract keeps
   *                 both valid, and a bare `plate` is always the legacy Plate
   *   layout_style  only what albums_layout_style_check accepts (`square`
   *                 since 20261122233837); `editorial` renders but is not
   *                 storable yet, and the database would otherwise reach the
   *                 photographer as a redacted server error
   *   colours       exactly #RRGGBB — never a CSS fragment
   */
  if (!storableCoverPreset(updates.cover_preset)) delete updates.cover_preset
  if (!storableLayout(updates.layout_style)) delete updates.layout_style
  const titleColor = hexColor(updates.cover_title_color)
  if (titleColor) updates.cover_title_color = titleColor
  else delete updates.cover_title_color
  updates.cover_title_scale = Math.min(2.2, Math.max(0.5, updates.cover_title_scale as number))
  updates.cover_focal_x = clampFocal(updates.cover_focal_x)
  updates.cover_focal_y = clampFocal(updates.cover_focal_y)
  if (!['full', 'month_year', 'year'].includes(updates.cover_date_format as string)) updates.cover_date_format = 'month_year'

  /*
   * THE SECOND PHOTOGRAPH (diptych) IS ONE OF THIS ALBUM'S OWN, on this site.
   * The database holds that too (albums_cover_secondary_photo_fk, a key on
   * (photo, album, site)); asking first turns a refusal into "keep what it
   * had" rather than a failed save.
   */
  if (updates.cover_secondary_photo_id) {
    const { data: own } = await supabase
      .from('photos')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('album_id', albumId)
      .eq('id', updates.cover_secondary_photo_id as string)
      .maybeSingle()
    if (!own) delete updates.cover_secondary_photo_id
  }

  /*
   * THE CHOSEN COVER IS ONE OF THIS GALLERY'S OWN PHOTOGRAPHS.
   *
   * The picker only offers them, but the id arrives from a form, and a server
   * action is a public endpoint. The database refuses a cover on another site
   * (albums_cover_photo_fk, P3); the narrower rule — this album, not merely
   * this site — is the application's. Anything else keeps the cover the album
   * already has, the way every other field of a form falls back rather than
   * failing. Empty still means "no chosen cover".
   */
  if (updates.cover_photo_id) {
    const { data: own } = await supabase
      .from('photos')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('album_id', albumId)
      .eq('id', updates.cover_photo_id as string)
      .maybeSingle()
    if (!own) delete updates.cover_photo_id
  }

  const password = get('password')
  if (updates.privacy_type === 'password' && password) {
    updates.password_hash = hashPassword(password)
  }

  const save = (row: Record<string, unknown>) =>
    supabase.from('albums').update(row).eq('tenant_id', tenantId).eq('id', albumId)

  let { error } = await save(updates)

  /**
   * DEPLOY ORDER MUST NOT MATTER.
   *
   * `allow_downloads` arrives with `db/migrations/2026-09-24_allow_downloads.sql`.
   * If this code reaches production before that migration is run, PostgREST
   * rejects the whole statement for naming a column it does not know — and the
   * casualty would not be downloads, it would be **saving gallery settings at
   * all**. A photographer renaming an album would get an error about a switch
   * they never touched.
   *
   * So the one field that might not exist yet is dropped and the save retried.
   * Only that field, only on that error. The same tolerance
   * `app/actions/sites.ts` needed for the same reason.
   */
  if (error && /allow_downloads/.test(error.message)) {
    const { allow_downloads: _dropped, ...withoutIt } = updates
    void _dropped
    ;({ error } = await save(withoutIt))
  }

  if (error) throw new Error(error.message)

  // The chosen cover may have changed (P3).
  await syncAlbum(tenantId, albumId)

  revalidatePath('/admin')
  revalidatePath('/')
  revalidatePath(`/admin/trips/${albumId}`)
  revalidatePath(`/admin/trips/${albumId}/settings`)
  redirect(`/admin/trips/${albumId}`)
}

export async function updateLayoutStyle(albumId: string, layoutStyle: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  // Only what albums_layout_style_check accepts; anything else changes nothing.
  if (!storableLayout(layoutStyle)) return
  const supabase = await createClient()
  const { error } = await supabase
    .from('albums')
    .update({ layout_style: layoutStyle })
    .eq('tenant_id', tenantId)
    .eq('id', albumId)
  if (error) throw new Error(error.message)
  revalidatePath(`/admin/trips/${albumId}`)
}

export async function uploadCustomCover(albumId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const file = formData.get('file') as File
  if (!file || file.size === 0) return

  const buffer = Buffer.from(await file.arrayBuffer())

  // Covers go through the same ladder as photographs. This used to write a
  // single 2800px JPEG, which meant a cover drawn 475px wide in the carousel
  // still cost ~650KB with no smaller file to fall back on. The path ends in
  // /<size>.webp, which is what srcSetFromPath keys off to build the srcset —
  // covers have no derivatives column of their own.
  //
  // Since P2 the cover is a photograph asset too, and the album's cover is set
  // in the SAME database transaction that records it (lib/photos/ingest.ts,
  // `register_album_cover`). Still only the sizes are stored: a cover has
  // never kept its original, and its asset says so with `original_path` NULL.
  const keyBase = tenantKey(tenantId, `covers/${albumId}/${randomUUID()}`)
  const supabase = await createClient()
  await ingestPhoto(
    { route: 'cover', tenantId, albumId, keyBase, bytes: buffer, filename: file.name },
    { db: fromSupabase(supabase) }
  )

  // register_album_cover changed the album's cover; project it (P3). Taken
  // after that transaction committed, under the same album lock it held.
  await syncAlbum(tenantId, albumId)

  revalidatePath('/admin')
  revalidatePath(`/admin/trips/${albumId}/settings`)
  revalidatePath('/')
  revalidatePath('/trips')
}

export async function clearCustomCover(albumId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const { error } = await supabase
    .from('albums')
    .update({ cover_custom_path: null })
    .eq('tenant_id', tenantId)
    .eq('id', albumId)
  if (error) throw new Error(error.message)
  await syncAlbum(tenantId, albumId)
  revalidatePath('/admin')
  revalidatePath(`/admin/trips/${albumId}/settings`)
}

/** Video covers are stored as-is — no server-side transcoding. */
export async function uploadCoverVideo(albumId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const file = formData.get('file') as File
  if (!file || file.size === 0) return

  const buffer = Buffer.from(await file.arrayBuffer())
  const ext = file.type === 'video/webm' ? 'webm' : 'mp4'
  const key = tenantKey(tenantId, `covers/${albumId}/${randomUUID()}.${ext}`)

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: file.type || 'video/mp4',
    })
  )

  const supabase = await createClient()
  const { error } = await supabase
    .from('albums')
    .update({ cover_video_path: key })
    .eq('tenant_id', tenantId)
    .eq('id', albumId)
  if (error) throw new Error(error.message)

  revalidatePath('/admin')
  revalidatePath(`/admin/trips/${albumId}/settings`)
}

export async function clearCoverVideo(albumId: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const { error } = await supabase
    .from('albums')
    .update({ cover_video_path: null })
    .eq('tenant_id', tenantId)
    .eq('id', albumId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
  revalidatePath(`/admin/trips/${albumId}/settings`)
}
