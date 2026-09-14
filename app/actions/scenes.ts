'use server'

import { createClient } from '@/lib/supabase/server'
import { processExistingOriginal } from '@/lib/derivatives'
import { isQuad, DEFAULT_QUAD } from '@/lib/perspective'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'

/**
 * Room scenes: upload a photograph of a room once, mark where art hangs, and
 * every print in the shop is mocked up in it. Nothing is composited and
 * nothing is cached — see components/shop/RoomScene.tsx — so these rows are
 * the whole feature.
 */

function revalidate() {
  revalidatePath('/admin/shop/scenes')
  revalidatePath('/shop', 'layout')
}

export async function uploadRoomScene(formData: FormData) {
  const file = formData.get('file') as File
  if (!file || file.size === 0) return

  const buffer = Buffer.from(await file.arrayBuffer())

  // Scenes go through the same ladder as photographs, so a thumbnail of a room
  // costs a few kilobytes rather than the full-size file. The path ends in
  // /<size>.webp, which is what srcSetFromPath keys off — scenes have no
  // derivatives column of their own.
  const keyBase = `scenes/${randomUUID()}`
  const processed = await processExistingOriginal(buffer, keyBase, keyBase)

  const supabase = await createClient()

  const { count } = await supabase
    .from('room_scenes')
    .select('id', { count: 'exact', head: true })

  const { error } = await supabase.from('room_scenes').insert({
    name: (formData.get('name') as string)?.trim() || 'Room',
    image_path: processed.displayPath,
    width: processed.width,
    height: processed.height,
    corners: DEFAULT_QUAD,
    sort_order: (count ?? 0) + 1,
  })

  if (error) throw new Error(error.message)
  revalidate()
}

/**
 * Saves one scene's name, corners and whether it's shown.
 *
 * The corners arrive as JSON from the editor. They're checked rather than
 * trusted: a malformed quad would put every print in the shop somewhere
 * ridiculous, and there's no visible error to lead anyone back here.
 */
export async function saveRoomScene(id: string, formData: FormData) {
  const raw = formData.get('corners') as string

  let corners: unknown = null
  try {
    corners = JSON.parse(raw)
  } catch {
    corners = null
  }

  const updates: Record<string, unknown> = {
    name: (formData.get('name') as string)?.trim() || 'Room',
    is_active: formData.get('is_active') === 'on',
  }

  if (isQuad(corners)) updates.corners = corners

  const supabase = await createClient()
  const { error } = await supabase.from('room_scenes').update(updates).eq('id', id)

  if (error) throw new Error(error.message)
  revalidate()
}

export async function deleteRoomScene(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('room_scenes').delete().eq('id', id)

  if (error) throw new Error(error.message)
  revalidate()
}

/** Scenes appear in the thumbnail strip in this order. */
export async function reorderRoomScenes(ids: string[]) {
  const supabase = await createClient()

  await Promise.all(
    ids.map((id, index) =>
      supabase.from('room_scenes').update({ sort_order: index + 1 }).eq('id', id)
    )
  )

  revalidate()
}
