import { createClient } from '@/lib/supabase/server'
import { photoUrl } from '@/lib/images'
import { srcSetFromPath } from '@/lib/srcset'
import { toQuad, type Quad } from '@/lib/perspective'

/**
 * Room scenes: a photograph of a room and the four corners of the wall space
 * where art hangs. Uploaded once and shared by every print in the shop, which
 * is the whole point — a new photograph is sellable, and mocked up in every
 * room, the moment it's published.
 */
export type RoomSceneRecord = {
  id: string
  name: string
  imageUrl: string
  srcSet?: string
  width: number | null
  height: number | null
  corners: Quad
  /**
   * The room photograph already contains a frame and a mat, so the corners
   * mark the artwork opening and only the photograph is placed. False means an
   * empty wall, and the whole framed piece is drawn onto it.
   */
  hasFrame: boolean
  sortOrder: number
  isActive: boolean
}

type Row = {
  id: string
  name: string | null
  image_path: string
  width: number | null
  height: number | null
  corners: unknown
  has_frame: boolean | null
  sort_order: number
  is_active: boolean
}

function shape(row: Row): RoomSceneRecord {
  const url = photoUrl(row.image_path)

  return {
    id: row.id,
    name: row.name?.trim() || 'Room',
    imageUrl: url,
    // Scenes are written by the same ladder as everything else, so the srcset
    // comes from the path rather than a derivatives column of their own.
    srcSet: srcSetFromPath(url),
    width: row.width,
    height: row.height,
    corners: toQuad(row.corners),
    // A database that hasn't had the migration yet has no column; a room with
    // a frame in it is the commoner case, so that's the assumption.
    hasFrame: row.has_frame !== false,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

/**
 * has_frame arrived after the table did, so a database that's a migration
 * behind still lists its rooms rather than showing none.
 */
const COLS = 'id, name, image_path, width, height, corners, has_frame, sort_order, is_active'
const COLS_LEGACY = 'id, name, image_path, width, height, corners, sort_order, is_active'

const isMissingColumn = (message: string | undefined) => !!message && /has_frame/i.test(message)

export async function getRoomScenes(includeInactive = false): Promise<RoomSceneRecord[]> {
  const supabase = await createClient()

  const run = (select: string) => {
    const query = supabase
      .from('room_scenes')
      .select(select)
      .order('sort_order', { ascending: true })

    return includeInactive ? query : query.eq('is_active', true)
  }

  let { data, error } = await run(COLS)

  if (error && isMissingColumn(error.message)) {
    ;({ data, error } = await run(COLS_LEGACY))
  }

  // A shop with no rooms is normal; a shop that couldn't read them is not, and
  // either way the product page still has its plain framed view to fall back on
  if (error) {
    console.error('[scenes] getRoomScenes failed:', error.message)
    return []
  }

  return ((data ?? []) as Row[]).map(shape)
}

export async function getRoomScene(id: string): Promise<RoomSceneRecord | null> {
  const supabase = await createClient()

  const run = (select: string) =>
    supabase.from('room_scenes').select(select).eq('id', id).maybeSingle()

  let { data, error } = await run(COLS)

  if (error && isMissingColumn(error.message)) {
    ;({ data, error } = await run(COLS_LEGACY))
  }

  if (error) console.error('[scenes] getRoomScene failed:', error.message)
  if (!data) return null

  return shape(data as Row)
}
