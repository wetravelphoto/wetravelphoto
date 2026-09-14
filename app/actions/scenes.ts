'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Which of the built-in rooms prints are shown hanging in.
 *
 * One choice, three options, nothing to upload. Rooms live in code — see
 * lib/preset-rooms.ts — so this is the only thing a site stores about them.
 */
export async function setShopRoom(room: string) {
  const supabase = await createClient()

  const { error } = await supabase.from('site_settings').update({ shop_room: room }).eq('id', 1)

  // A site that hasn't run the migration keeps its default rather than erroring
  if (error && !/shop_room/i.test(error.message)) throw new Error(error.message)

  revalidatePath('/admin/shop/scenes')
  revalidatePath('/shop', 'layout')
}
