'use server'

import { createClient } from '@/lib/supabase/server'
import { r2Client } from '@/lib/r2'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'

const ALLOWED: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
}

type Slot = 'header' | 'footer' | 'bird'

const COLUMN: Record<Slot, string> = {
  header: 'logo_header_path',
  footer: 'logo_footer_path',
  bird: 'logo_bird_path',
}

/**
 * Logos are stored as uploaded — no resizing. SVGs must stay vector, and a
 * PNG with transparency shouldn't be flattened into a JPEG.
 */
export async function uploadLogo(formData: FormData) {
  const slot = formData.get('slot') as Slot
  const file = formData.get('file') as File

  if (!slot || !COLUMN[slot]) return { ok: false, message: 'Unknown logo slot.' }
  if (!file || file.size === 0) return { ok: false, message: 'No file chosen.' }

  const extension = ALLOWED[file.type]
  if (!extension) return { ok: false, message: 'Use an SVG, PNG, WebP or JPEG.' }
  if (file.size > 2_000_000) return { ok: false, message: 'That file is over 2 MB.' }

  const key = `branding/${slot}-${randomUUID()}.${extension}`
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

  const supabase = await createClient()
  const { error } = await supabase
    .from('site_settings')
    .update({ [COLUMN[slot]]: key })
    .eq('id', 1)

  if (error) return { ok: false, message: error.message }

  revalidatePath('/', 'layout')
  revalidatePath('/admin/settings')

  return { ok: true, message: 'Logo updated.' }
}

export async function clearLogo(slot: Slot) {
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
      logo_bird_size: number('logo_bird_size', 64),
      show_bird: formData.get('show_bird') === 'on',

      header_align: text('header_align') ?? 'split',
      header_nav_font: text('header_nav_font') ?? 'Oswald',
      header_nav_scale: decimal('header_nav_scale', 1),
      footer_align: text('footer_align') ?? 'left',
      footer_font: text('footer_font') ?? 'Karla',
      footer_scale: decimal('footer_scale', 1),
    })
    .eq('id', 1)

  if (error) throw new Error(error.message)

  revalidatePath('/', 'layout')
  revalidatePath('/admin/settings')
}
