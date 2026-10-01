import { SECTIONS, type SectionSettings } from '@/lib/sections/registry'
import { DEVICES, BASE_DEVICE, deviceKey } from '@/lib/sections/devices'
import { normalizeRow } from '@/lib/sections/retired'
import { isSamplePhoto } from '@/lib/images'

/**
 * WHICH PHOTOGRAPHS A SAVED DOCUMENT REFERENCES
 * ═════════════════════════════════════════════
 *
 * P3 (claude/photo-migration-plan.md). Pure: no database, no clock, no I/O.
 * It reads ONE saved source — the text `read_photo_usage_source` returned —
 * and says which slots in it hold a photograph. `lib/photos/usages.ts` sends
 * the answer to `sync_photo_usages`, which checks every reference against the
 * same saved source before it writes anything.
 *
 * Only the DOCUMENT-SHAPED references come from here, because only they need
 * knowledge the database does not have:
 *
 *   page_section  a section's image settings — which keys hold a photograph
 *                 is the registry's to say, read at runtime
 *   story_block   a story's image blocks — which block shapes carry one
 *
 * Everything relational (gallery membership, covers, a story's featured image,
 * a catalogue entry, the legacy page columns, the explicit share images) is
 * read by the database itself, under the parent's lock.
 *
 * BUILT-IN SAMPLES ARE IGNORED, not unresolved. The platform's own sample
 * photographs (isSamplePhoto, lib/images.ts — the one statement of that rule)
 * are served from this origin and never become assets. A sample in a section
 * or a story block is simply not sent. A sample in a slot the database reads
 * for itself — a legacy column, a stored share image — is sent as a `sample`
 * declaration, so the database skips that slot instead of counting it. Either
 * way: no usage, nothing unresolved, nothing malformed, no warning. The same
 * goes for a story's featured image and for sample photographs rows — a
 * sample gallery photograph, a chosen cover that is one, a catalogue entry
 * made from one — each declared by its photo id and stored path. An old
 * path that is NOT a sample still resolves to nothing and is counted.
 *
 * STORED MEANS REFERENCED. A photograph kept in a setting the renderer is not
 * currently drawing — a hidden section, a hero image kept while the hero shows
 * a video, a background photograph kept while the background is a colour — is
 * still stored, and still referenced. What is excluded is excluded BY KEY:
 * the hero's video (declared `kind: 'image'` because the photo picker edits
 * it) is a video, and videos stay out of photo_assets in V1.
 */

/** Settings that are declared `kind: 'image'` but hold no photograph. */
export const EXCLUDED_IMAGE_KEYS: ReadonlySet<string> = new Set(['video_path'])

export type SectionRef = {
  kind: 'page_section'
  page_key: string
  /** The section's ordinal in its page — the slot, not a sort order. */
  position: number
  field: string
  path: string
  decorative: boolean
}

export type BlockRef = {
  kind: 'story_block'
  /** `block:<zero-based index in blocks[]>` — never the browser's block id. */
  field: string
  position: number
  path: string
}

/**
 * Not a usage: "this source, which the database projects itself, holds a
 * built-in sample — skip it". The database proves every one against the
 * source before it counts (sync_photo_usages), and refuses the rest.
 *
 *   a page      page_key + field: a legacy column, or 'page_seo.image'
 *   a story     field 'featured_custom_path'
 *   an album /
 *   catalogue   photo_id + field 'photo': a photographs row, by its stored path
 */
export type SampleRef = {
  kind: 'sample'
  page_key?: string
  photo_id?: string
  position: 0
  field: string
  path: string
}

export type UsageRef = SectionRef | BlockRef | SampleRef

export type Extraction = {
  refs: UsageRef[]
  /** Image-bearing shapes whose photograph slot was not a path at all. */
  malformed: number
}

type Slot = { key: string; decorative: boolean }

const slotCache = new Map<string, Slot[]>()

/**
 * Every settings key of a section type that holds a photograph: each
 * `kind: 'image'` field, and for a `device` field its phone twin too, minus
 * the excluded keys. Read from the registry at runtime — never a list kept
 * beside it.
 */
export function imageSlots(type: string): Slot[] {
  const cached = slotCache.get(type)
  if (cached) return cached
  const def = SECTIONS[type]
  const out: Slot[] = []
  for (const field of def?.fields ?? []) {
    if (field.kind !== 'image' || EXCLUDED_IMAGE_KEYS.has(field.key)) continue
    const decorative = field.accessibilityRole === 'decorative'
    out.push({ key: field.key, decorative })
    if (field.device) {
      for (const device of DEVICES) {
        if (device !== BASE_DEVICE) out.push({ key: deviceKey(field.key, device), decorative })
      }
    }
  }
  slotCache.set(type, out)
  return out
}

/**
 * The type whose fields describe a stored row. The row's own type when the
 * registry knows it — so a hero written in the old "stories" mode keeps its
 * photograph, which is still stored under `image_path` — otherwise the type a
 * retired name is read as. A type nobody knows holds nothing.
 */
function typeOf(row: { type: string; settings: SectionSettings }): string | null {
  if (SECTIONS[row.type]) return row.type
  const read = normalizeRow(row).type
  return SECTIONS[read] ? read : null
}

/** sync_photo_usages' shape rule for a page key (the CHECK is the authority on which exist). */
const PAGE_KEY_SHAPE = /^[a-z][a-z0-9_]{0,31}$/

const sample = (page_key: string, field: string, path: string): SampleRef =>
  ({ kind: 'sample', page_key, position: 0, field, path })

const photoSample = (photo_id: string, path: string): SampleRef =>
  ({ kind: 'sample', photo_id, position: 0, field: 'photo', path })

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** One page's ordered sections → its photograph references. */
export function extractSections(pageKey: string, sections: unknown): SectionRef[] {
  const refs: SectionRef[] = []
  if (!Array.isArray(sections)) return refs
  sections.forEach((row: unknown, position) => {
    if (!isRecord(row) || typeof row.type !== 'string') return
    const settings = isRecord(row.settings) ? (row.settings as SectionSettings) : {}
    const type = typeOf({ type: row.type, settings })
    if (!type) return
    for (const slot of imageSlots(type)) {
      const value = settings[slot.key]
      // Empty is "nothing chosen", not a reference; a built-in sample is
      // never an asset and is not one either.
      if (typeof value !== 'string' || value === '' || isSamplePhoto(value)) continue
      refs.push({ kind: 'page_section', page_key: pageKey, position, field: slot.key, path: value, decorative: slot.decorative })
    }
  })
  return refs
}

/**
 * A story's blocks → its photograph references. Only the four image-bearing
 * block shapes (lib/blocks.ts) are read; the JSON is never repaired. A block
 * whose image slot is not an object with a string path is counted as
 * malformed and skipped; an empty path is a block still waiting for its
 * photograph, which is not a reference.
 */
export function extractBlocks(blocks: unknown): Extraction {
  const refs: BlockRef[] = []
  let malformed = 0
  if (!Array.isArray(blocks)) return { refs, malformed }

  const take = (index: number, position: number, image: unknown) => {
    if (!isRecord(image) || typeof image.path !== 'string') {
      malformed++
      return
    }
    if (image.path === '' || isSamplePhoto(image.path)) return
    refs.push({ kind: 'story_block', field: `block:${index}`, position, path: image.path })
  }

  blocks.forEach((block: unknown, index) => {
    if (!isRecord(block)) return
    switch (block.type) {
      case 'image':
        take(index, 0, block.image)
        break
      case 'image_pair':
        take(index, 0, block.left)
        take(index, 1, block.right)
        break
      case 'gallery':
      case 'masonry':
        if (!Array.isArray(block.images)) {
          malformed++
          break
        }
        block.images.forEach((image: unknown, position: number) => take(index, position, image))
        break
    }
  })
  return { refs, malformed }
}

/**
 * One saved source, as `read_photo_usage_source` shaped it, → its document
 * references. Album and catalogue sources have none: everything they project
 * is relational and read by the database.
 */
export function extract(source: unknown): Extraction {
  if (!isRecord(source)) return { refs: [], malformed: 0 }
  switch (source.parent) {
    case 'live_page': {
      const page = String(source.page)
      const refs: UsageRef[] = extractSections(page, source.sections)
      if (isRecord(source.legacy)) {
        for (const [field, value] of Object.entries(source.legacy)) {
          if (isSamplePhoto(value as string)) refs.push(sample(page, field, value as string))
        }
      }
      if (isSamplePhoto(source.share as string)) refs.push(sample(page, 'page_seo.image', source.share as string))
      return { refs, malformed: 0 }
    }
    case 'draft': {
      const refs: UsageRef[] = []
      let malformed = 0
      if (source.exists === true && isRecord(source.pages)) {
        for (const [pageKey, sections] of Object.entries(source.pages)) {
          // The same shape rule sync_photo_usages applies before anything
          // else; a key outside it is not a page and is counted, not sent.
          if (!PAGE_KEY_SHAPE.test(pageKey)) {
            malformed++
            continue
          }
          refs.push(...extractSections(pageKey, sections))
        }
        if (isRecord(source.page_seo)) {
          for (const [pageKey, seo] of Object.entries(source.page_seo)) {
            const image = isRecord(seo) ? seo.image : undefined
            if (isSamplePhoto(image as string)) refs.push(sample(pageKey, 'page_seo.image', image as string))
          }
        }
      }
      return { refs, malformed }
    }
    case 'post': {
      if (source.exists !== true) return { refs: [], malformed: 0 }
      const out = extractBlocks(source.blocks)
      const refs: UsageRef[] = out.refs
      if (isSamplePhoto(source.featured as string)) {
        refs.push({ kind: 'sample', position: 0, field: 'featured_custom_path', path: source.featured as string })
      }
      return { refs, malformed: out.malformed }
    }
    case 'album': {
      // Gallery rows and covers are the database's; only the samples among
      // the album's photographs are named, so it can skip them.
      const refs: UsageRef[] = []
      for (const photo of Array.isArray(source.photos) ? source.photos : []) {
        if (isRecord(photo) && typeof photo.id === 'string' && isSamplePhoto(photo.storage_path as string)) {
          refs.push(photoSample(photo.id, photo.storage_path as string))
        }
      }
      return { refs, malformed: 0 }
    }
    case 'catalog_item':
      return source.exists === true && typeof source.photo === 'string' && isSamplePhoto(source.storage_path as string)
        ? { refs: [photoSample(source.photo, source.storage_path as string)], malformed: 0 }
        : { refs: [], malformed: 0 }
    default:
      return { refs: [], malformed: 0 }
  }
}
