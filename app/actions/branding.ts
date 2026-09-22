'use server'

import { createClient } from '@/lib/supabase/server'
import { r2Client } from '@/lib/r2'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { requireEditor } from '@/lib/auth'
import { tenantKey } from '@/lib/storage-keys'

const ALLOWED: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
}

type Slot = 'header' | 'footer'

const COLUMN: Record<Slot, string> = {
  header: 'logo_header_path',
  footer: 'logo_footer_path',
}

type Stored = { ok: true; key: string } | { ok: false; message: string }

/**
 * Validates and stores one brand file, returning its storage key.
 *
 * Logos are stored as uploaded — no resizing. SVGs must stay vector, and a
 * PNG with transparency shouldn't be flattened into a JPEG. Shared by the logo
 * slots and the accent-mark section, so there is one list of allowed types and
 * one size limit rather than two that drift.
 */
async function storeBrandFile(
  tenantId: string,
  prefix: string,
  file: File | null
): Promise<Stored> {
  if (!file || file.size === 0) return { ok: false, message: 'No file chosen.' }

  const extension = ALLOWED[file.type]
  if (!extension) return { ok: false, message: 'Use an SVG, PNG, WebP or JPEG.' }
  if (file.size > 2_000_000) return { ok: false, message: 'That file is over 2 MB.' }

  const key = tenantKey(tenantId, `branding/${prefix}-${randomUUID()}.${extension}`)
  const buffer = Buffer.from(await file.arrayBuffer())

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: file.type,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  )

  return { ok: true, key }
}

/**
 * Stores an accent mark's picture and hands back its key — and does nothing
 * else. Which section shows it is decided by the canvas, which writes the key
 * into that section's settings in the DRAFT. So uploading is not publishing:
 * the file sits in the bucket unseen until the photographer publishes a page
 * that points at it, and Discard leaves nothing on the live site.
 */
export async function uploadMarkImage(
  formData: FormData
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const { tenantId } = await requireEditor()

  const stored = await storeBrandFile(tenantId, 'mark', formData.get('file') as File | null)
  if (!stored.ok) return stored

  return { ok: true, path: stored.key }
}

/**
 * Stores a header or footer logo for the canvas and hands back its key, and
 * does nothing else — like uploadMarkImage. The canvas writes the key into
 * the draft, so the new logo reaches the live site on Publish, not on upload.
 */
export async function uploadChromeLogo(
  formData: FormData
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const { tenantId } = await requireEditor()

  const slot = formData.get('slot') as Slot
  if (!slot || !COLUMN[slot]) return { ok: false, message: 'Unknown logo slot.' }

  const stored = await storeBrandFile(tenantId, slot, formData.get('file') as File | null)
  if (!stored.ok) return stored

  return { ok: true, path: stored.key }
}

/**
 * The Settings page's naming form. Writes only the fields the form actually
 * sent: the header and footer controls moved to the canvas (where they go
 * through the draft), and a missing field must never reset a column to a
 * default.
 */
export async function updateBranding(formData: FormData) {
  const { tenantId } = await requireEditor()

  const text = (key: string) => (formData.get(key) as string)?.trim() || null
  const patch: Record<string, unknown> = {}

  if (formData.has('site_title')) patch.site_title = text('site_title') ?? 'Untitled'
  if (formData.has('owner_name')) patch.owner_name = text('owner_name')
  if (Object.keys(patch).length === 0) return

  const supabase = await createClient()
  const { error } = await supabase.from('site_settings').update(patch).eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)

  revalidatePath('/', 'layout')
  revalidatePath('/admin/settings')
}
