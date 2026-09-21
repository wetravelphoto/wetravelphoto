'use server'

import { createClient } from '@/lib/supabase/server'
import { r2Client } from '@/lib/r2'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'

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
async function storeBrandFile(prefix: string, file: File | null): Promise<Stored> {
  if (!file || file.size === 0) return { ok: false, message: 'No file chosen.' }

  const extension = ALLOWED[file.type]
  if (!extension) return { ok: false, message: 'Use an SVG, PNG, WebP or JPEG.' }
  if (file.size > 2_000_000) return { ok: false, message: 'That file is over 2 MB.' }

  const key = `branding/${prefix}-${randomUUID()}.${extension}`
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

export async function uploadLogo(formData: FormData) {
  await requireUser()

  const slot = formData.get('slot') as Slot
  if (!slot || !COLUMN[slot]) return { ok: false, message: 'Unknown logo slot.' }

  const stored = await storeBrandFile(slot, formData.get('file') as File | null)
  if (!stored.ok) return stored

  const supabase = await createClient()
  const { error } = await supabase
    .from('site_settings')
    .update({ [COLUMN[slot]]: stored.key })
    .eq('id', 1)

  if (error) return { ok: false, message: error.message }

  revalidatePath('/', 'layout')
  revalidatePath('/admin/settings')

  return { ok: true, message: 'Logo updated.' }
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
  await requireUser()

  const stored = await storeBrandFile('mark', formData.get('file') as File | null)
  if (!stored.ok) return stored

  return { ok: true, path: stored.key }
}

export async function clearLogo(slot: Slot) {
  await requireUser()
  if (!COLUMN[slot]) return { ok: false, message: 'Unknown logo slot.' }

  const supabase = await createClient()
  await supabase
    .from('site_settings')
    .update({ [COLUMN[slot]]: null })
    .eq('id', 1)

  revalidatePath('/', 'layout')
  revalidatePath('/admin/settings')

  return { ok: true, message: 'Reverted to the built-in mark.' }
}

export async function updateBranding(formData: FormData) {
  await requireUser()

  const number = (key: string, fallback: number) => {
    const value = parseInt((formData.get(key) as string) ?? '', 10)
    return Number.isNaN(value) ? fallback : value
  }

  const decimal = (key: string, fallback: number) => {
    const value = parseFloat((formData.get(key) as string) ?? '')
    return Number.isNaN(value) ? fallback : value
  }

  const text = (key: string) => (formData.get(key) as string)?.trim() || null

  const supabase = await createClient()
  const { error } = await supabase
    .from('site_settings')
    .update({
      site_title: text('site_title') ?? 'Untitled',
      owner_name: text('owner_name'),
      footer_copy: text('footer_copy'),
      logo_header_height: number('logo_header_height', 34),
      logo_footer_height: number('logo_footer_height', 130),

      header_align: text('header_align') ?? 'split',
      header_nav_font: text('header_nav_font') ?? 'Oswald',
      header_nav_scale: decimal('header_nav_scale', 1),
      header_nav_scale_mobile: decimal('header_nav_scale_mobile', 1),
      logo_header_height_mobile: number('logo_header_height_mobile', 26),
      footer_align: text('footer_align') ?? 'left',
      footer_font: text('footer_font') ?? 'Karla',
      footer_scale: decimal('footer_scale', 1),
      footer_scale_mobile: decimal('footer_scale_mobile', 1),
      logo_footer_height_mobile: number('logo_footer_height_mobile', 90),
    })
    .eq('id', 1)

  if (error) throw new Error(error.message)

  revalidatePath('/', 'layout')
  revalidatePath('/admin/settings')
}
