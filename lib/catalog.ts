import { createClient } from '@/lib/supabase/server'
import type { Derivatives } from '@/lib/image-sizes'

export type CatalogItem = {
  id: string
  photo_id: string
  title: string | null
  description: string | null
  /** Where it was taken. Shown under the title in the shop. */
  location: string | null
  tags: string[]
  is_published: boolean
  sort_order: number
}

export type CatalogPhoto = {
  id: string
  storage_path: string
  derivatives: Derivatives | null
  caption: string | null
  alt_text: string | null
  width: number | null
  height: number | null
}

export type CatalogProduct = {
  id: string
  size_label: string | null
  type: string | null
  price_cents: number
  is_active: boolean
  sort_order: number
}

export type CatalogEntry = CatalogItem & {
  photo: CatalogPhoto
  products: CatalogProduct[]
  categoryIds: string[]
}

/** Falls back through caption then filename so nothing ever shows as blank. */
export function displayTitle(item: { title: string | null }, photo: CatalogPhoto): string {
  if (item.title?.trim()) return item.title.trim()
  if (photo.caption?.trim()) return photo.caption.trim()

  // photos/<album>/<uuid>/2400.webp — the uuid folder is the closest thing
  // to a name, and is at least stable
  const parts = photo.storage_path.split('/')
  const name = parts.length > 1 ? parts[parts.length - 2] : parts[0]
  return name?.slice(0, 8) ? `Untitled ${name.slice(0, 8)}` : 'Untitled'
}

/** Orientation decides which mockup frame a photograph is shown in. */
export type Orientation = 'landscape' | 'portrait' | 'square'

export function orientationOf(width: number | null, height: number | null): Orientation {
  if (!width || !height) return 'landscape'
  const ratio = width / height
  if (ratio >= 1.15) return 'landscape'
  if (ratio <= 0.87) return 'portrait'
  return 'square'
}

export type Frame = {
  path: string
  top: number
  left: number
  width: number
  height: number
}

const FALLBACK_FRAME: Frame = {
  path: '/frames/frame-landscape.webp',
  top: 18.42,
  left: 17.33,
  width: 65.33,
  height: 59.02,
}

/**
 * Picks the frame for a photograph's shape, falling back to landscape when the
 * matching orientation hasn't been uploaded. A panorama sits in the landscape
 * frame with mat above and below, which is how one is actually mounted.
 */
export function frameFor(
  frames: Record<string, Frame> | null | undefined,
  orientation: Orientation
): Frame {
  const set = frames ?? {}
  return set[orientation] ?? set.landscape ?? FALLBACK_FRAME
}

const PHOTO_COLS = 'id, storage_path, derivatives, caption, alt_text, width, height'

/** Every photograph marked for sale, with its catalogue entry and prices. */
export async function getCatalog(): Promise<CatalogEntry[]> {
  const supabase = await createClient()

  const { data: photos } = await supabase
    .from('photos')
    .select(
      `${PHOTO_COLS}, ` +
        'catalog_items(id, photo_id, title, description, location, tags, is_published, sort_order), ' +
        'products(id, size_label, type, price_cents, is_active, sort_order), ' +
        'photo_shop_categories(category_id)'
    )
    .eq('is_for_sale', true)
    .order('created_at', { ascending: false })

  type Row = CatalogPhoto & {
    catalog_items: CatalogItem[] | CatalogItem | null
    products: CatalogProduct[] | null
    photo_shop_categories: { category_id: string }[] | null
  }

  return ((photos ?? []) as unknown as Row[]).map((row) => {
    // A one-to-one embed comes back as an array from some PostgREST versions
    const raw = Array.isArray(row.catalog_items) ? row.catalog_items[0] : row.catalog_items

    const item: CatalogItem = raw ?? {
      id: '',
      photo_id: row.id,
      title: null,
      description: null,
      location: null,
      tags: [],
      is_published: true,
      sort_order: 0,
    }

    return {
      ...item,
      tags: item.tags ?? [],
      photo: {
        id: row.id,
        storage_path: row.storage_path,
        derivatives: row.derivatives,
        caption: row.caption,
        alt_text: row.alt_text,
        width: row.width,
        height: row.height,
      },
      products: (row.products ?? []).sort((a, b) => a.sort_order - b.sort_order),
      categoryIds: (row.photo_shop_categories ?? []).map((c) => c.category_id),
    }
  })
}

/** One catalogue entry, for the editor. */
export async function getCatalogEntry(photoId: string): Promise<CatalogEntry | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('photos')
    .select(
      `${PHOTO_COLS}, ` +
        'catalog_items(id, photo_id, title, description, location, tags, is_published, sort_order), ' +
        'products(id, size_label, type, price_cents, is_active, sort_order), ' +
        'photo_shop_categories(category_id)'
    )
    .eq('id', photoId)
    .maybeSingle()

  // A query failure and a missing print are different problems
  if (error) console.error('[catalog] getCatalogEntry failed:', error.message)
  if (!data) return null

  const row = data as unknown as CatalogPhoto & {
    catalog_items: CatalogItem[] | CatalogItem | null
    products: CatalogProduct[] | null
    photo_shop_categories: { category_id: string }[] | null
  }

  const raw = Array.isArray(row.catalog_items) ? row.catalog_items[0] : row.catalog_items

  const item: CatalogItem = raw ?? {
    id: '',
    photo_id: photoId,
    title: null,
    description: null,
    location: null,
    tags: [],
    is_published: true,
    sort_order: 0,
  }

  return {
    ...item,
    tags: item.tags ?? [],
    photo: {
      id: row.id,
      storage_path: row.storage_path,
      derivatives: row.derivatives,
      caption: row.caption,
      alt_text: row.alt_text,
      width: row.width,
      height: row.height,
    },
    products: (row.products ?? []).sort((a, b) => a.sort_order - b.sort_order),
    categoryIds: (row.photo_shop_categories ?? []).map((c) => c.category_id),
  }
}

// ── Public shop ──────────────────────────────────────────────────────────────

const PUBLIC_SELECT =
  `${PHOTO_COLS}, ` +
  'catalog_items!inner(id, photo_id, title, description, location, tags, is_published, sort_order), ' +
  'products(id, size_label, type, price_cents, is_active, sort_order), ' +
  'photo_shop_categories(category_id)'

type PublicRow = CatalogPhoto & {
  catalog_items: CatalogItem[] | CatalogItem | null
  products: CatalogProduct[] | null
  photo_shop_categories: { category_id: string }[] | null
}

function shape(row: PublicRow, fallbackId: string): CatalogEntry {
  const raw = Array.isArray(row.catalog_items) ? row.catalog_items[0] : row.catalog_items

  const item: CatalogItem = raw ?? {
    id: '',
    photo_id: fallbackId,
    title: null,
    description: null,
    location: null,
    tags: [],
    is_published: true,
    sort_order: 0,
  }

  return {
    ...item,
    tags: item.tags ?? [],
    photo: {
      id: row.id,
      storage_path: row.storage_path,
      derivatives: row.derivatives,
      caption: row.caption,
      alt_text: row.alt_text,
      width: row.width,
      height: row.height,
    },
    // Only sizes actually on offer — an unlisted size must never reach a price
    products: (row.products ?? [])
      .filter((p) => p.is_active)
      .sort((a, b) => a.sort_order - b.sort_order),
    categoryIds: (row.photo_shop_categories ?? []).map((c) => c.category_id),
  }
}

/**
 * Published prints for the shop index.
 *
 * !inner on catalog_items means a photograph with no catalogue entry simply
 * doesn't appear, rather than showing up untitled and unpriced.
 */
export async function getPublishedCatalog(categoryId?: string | null): Promise<CatalogEntry[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('photos')
    .select(PUBLIC_SELECT)
    .eq('is_for_sale', true)
    .eq('catalog_items.is_published', true)
    .order('created_at', { ascending: false })

  if (error) console.error('[shop] getPublishedCatalog failed:', error.message)

  let entries = ((data ?? []) as unknown as PublicRow[]).map((row) => shape(row, row.id))

  if (categoryId) {
    entries = entries.filter((e) => e.categoryIds.includes(categoryId))
  }

  return entries
}

/** One published print. Returns null when it isn't for sale or isn't published. */
export async function getPublishedEntry(photoId: string): Promise<CatalogEntry | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('photos')
    .select(PUBLIC_SELECT)
    .eq('id', photoId)
    .eq('is_for_sale', true)
    .eq('catalog_items.is_published', true)
    .maybeSingle()

  if (error) console.error('[shop] getPublishedEntry failed:', error.message)
  if (!data) return null

  return shape(data as unknown as PublicRow, photoId)
}

/**
 * Three other prints to show underneath. Prefers ones sharing a category —
 * a customer looking at wildlife is more likely to want more wildlife — and
 * tops up with the newest when that isn't enough.
 */
export async function getRelated(entry: CatalogEntry, limit = 3): Promise<CatalogEntry[]> {
  const all = (await getPublishedCatalog()).filter((e) => e.photo_id !== entry.photo_id)

  const sameCategory = all.filter((e) =>
    e.categoryIds.some((id) => entry.categoryIds.includes(id))
  )

  const rest = all.filter((e) => !sameCategory.includes(e))

  return [...sameCategory, ...rest].slice(0, limit)
}
