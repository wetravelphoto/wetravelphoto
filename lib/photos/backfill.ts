import { createHash } from 'crypto'
import sharp from 'sharp'

import { isSamplePhoto } from '@/lib/images'
import { extract } from '@/lib/photos/extract'
import { normalizeKeywords, readCapture, type Capture } from '@/lib/photos/exif'
import { contentTypeOf } from '@/lib/photos/ingest'
import {
  LADDER,
  ORIGINAL_EXTENSIONS,
  flatFileOf,
  keyBaseFor,
  type KeyRefusal,
  type OwnershipContext,
  type ParsedKey,
} from '@/lib/photos/legacy-key'
import { TooLargeError, type BackfillStorage } from '@/lib/photos/backfill-storage'

/**
 * THE BACKFILL — every photograph from before P2 gets its asset
 * ═════════════════════════════════════════════════════════════
 *
 * P4 (claude/photo-migration-plan.md, claude/photo-assets-design.md §10).
 * Internal: run by lib/photos/backfill-cli.ts, never by a request.
 *
 * For one site:
 *
 *   1. READ the inventory (read_photo_backfill_inventory): every photos and
 *      site_images row, used or not; every album's custom cover; the assets
 *      already there; and the saved source of every live page, the draft and
 *      every story — the same text P3 projects from. A malformed inventory is
 *      an error, never an empty site.
 *   2. CLAIMS. Every path those hold: the rows' own files, the covers, and the
 *      document slots P3's extractor finds (sections, hidden or not, mobile
 *      twins, backgrounds, video posters; story blocks) plus the slots P3
 *      reads for itself — a live page's legacy columns ONLY while the page has
 *      no section rows (otherwise they are mirrors), share images, a story's
 *      featured image. Each document claim carries its exact SLOT, which the
 *      writer binds to. Built-in samples are counted and skipped; furniture,
 *      videos, frozen history and Instagram never get this far. An existing
 *      asset_id is CHECKED — an asset of this site whose display file is the
 *      row's — and a bad one is reported, never rewritten.
 *   3. GROUP by key base (keyBaseFor — the closed grammar, plus this site's
 *      ownership rules). One group is one upload is one asset.
 *   4. FACTS, verified rather than believed. Every file that makes the asset
 *      usable — the display file and each size — is READ (GET, bounded) and
 *      DECODED in full: it must be a photograph, of the format its name says,
 *      not truncated. A true original is read, decoded and hashed. A document-
 *      only upload's files are found among a BOUNDED set of known siblings (the
 *      flat file, four sizes, five original names) — never a listing. Nothing is
 *      invented: a flat-era JPEG is not an original and is never hashed as one;
 *      an unknown is NULL; dimensions are upright (EXIF orientation applied).
 *   5. WRITE (only with apply) through register_legacy_photo_asset, which binds
 *      the site, the source and its snapshot, and the facts, then creates or
 *      reuses the asset and fills the row's NULL asset_id — one transaction per
 *      call. A source that changed since step 1 answers `stale`, one that
 *      vanished answers `gone`; either way the site is re-read and re-planned
 *      from a fresh inventory, at most MAX_PASSES times, so another source of
 *      the same upload (a story naming a deleted gallery photograph) gets its
 *      asset. Only a fresh plan that no longer contains the attempt settles it;
 *      anything still provisional when the passes run out is a failure.
 *
 * The DRY RUN reads and decodes exactly what apply would and calls no writer.
 *
 * Failure: a writer call that RETURNS an error is that item's failure — logged,
 * and the run carries on. A call that THROWS (the connection or the process
 * went away) ends the site's run: nobody knows whether it committed, and a
 * rerun resumes safely because every write is idempotent.
 *
 * Never writes a usage: P3's sync stays the only writer of photo_usages, and
 * scripts/rebuild-photo-usages.ts runs separately, after. Never writes
 * storage. A second run finds everything linked and writes nothing.
 */

// ── What the database hands back ───────────────────────────────────────────

type Derivs = Record<string, string>

export type PhotoRow = {
  id: string
  album_id: string
  storage_path: string
  original_path: string | null
  derivatives: Derivs | null
  width: number | null
  height: number | null
  tags: string[] | null
  asset_id: string | null
}

export type SiteImageRow = {
  id: string
  storage_path: string
  original_path: string | null
  derivatives: Derivs | null
  width: number | null
  height: number | null
  filename: string | null
  asset_id: string | null
}

export type AlbumRow = { id: string; cover_custom_path: string | null }

export type AssetRow = {
  id: string
  key_base: string
  original_path: string | null
  display_path: string
  derivatives: Derivs
  width: number | null
  height: number | null
  original_bytes: number | null
  content_sha256: string | null
  content_type: string | null
  archived: boolean
  deleted: boolean
}

export type DocParent = 'live_page' | 'draft' | 'post'
export type SourceRow = { parent: DocParent; key: string | null; source: unknown }

export type Inventory = {
  tenant: string
  photos: PhotoRow[]
  site_images: SiteImageRow[]
  albums: AlbumRow[]
  assets: AssetRow[]
  sources: SourceRow[]
}

type RpcResult = { data: unknown; error: { message: string } | null }
export type BackfillRpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult> }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isStrOrNull = (v: unknown) => v === null || typeof v === 'string'
const isIntOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isInteger(v))
const usable = (v: unknown): v is string => typeof v === 'string' && v !== ''

/**
 * The inventory, checked rather than cast. Anything off-shape throws: a site
 * the backfill cannot read correctly must fail loudly, not look empty.
 */
export function validateInventory(tenantId: string, data: unknown): Inventory {
  const bad = (what: string): never => {
    throw new Error(`malformed inventory for ${tenantId}: ${what}`)
  }
  if (!isRecord(data)) return bad('not an object')
  if (data.tenant !== tenantId) bad(`it describes ${String(data.tenant)}`)
  for (const k of ['photos', 'site_images', 'albums', 'assets', 'sources']) if (!Array.isArray(data[k])) bad(`${k} is not a list`)
  const derivsOk = (d: unknown) => d === null || isRecord(d) || Array.isArray(d) || typeof d === 'string'
  for (const p of data.photos as unknown[]) {
    if (!isRecord(p) || !isStr(p.id) || !isStr(p.album_id) || !isStr(p.storage_path) || !isStrOrNull(p.original_path)
        || !derivsOk(p.derivatives) || !isIntOrNull(p.width) || !isIntOrNull(p.height) || !isStrOrNull(p.asset_id)
        || !(p.tags === null || (Array.isArray(p.tags) && p.tags.every((t) => t === null || isStr(t))))) bad(`a photos row: ${JSON.stringify(p)}`)
  }
  for (const s of data.site_images as unknown[]) {
    if (!isRecord(s) || !isStr(s.id) || !isStr(s.storage_path) || !isStrOrNull(s.original_path) || !derivsOk(s.derivatives)
        || !isIntOrNull(s.width) || !isIntOrNull(s.height) || !isStrOrNull(s.asset_id) || !isStrOrNull(s.filename)) bad(`a site_images row: ${JSON.stringify(s)}`)
  }
  for (const a of data.albums as unknown[]) if (!isRecord(a) || !isStr(a.id) || !isStrOrNull(a.cover_custom_path)) bad('an album')
  for (const a of data.assets as unknown[]) {
    if (!isRecord(a) || !isStr(a.id) || !isStr(a.key_base) || !isStr(a.display_path) || !isRecord(a.derivatives)) bad('an asset')
  }
  for (const s of data.sources as unknown[]) {
    if (!isRecord(s) || !['live_page', 'draft', 'post'].includes(s.parent as string) || !isStrOrNull(s.key)) bad('a source')
  }
  return data as unknown as Inventory
}

// ── Claims ──────────────────────────────────────────────────────────────────

export type Locator =
  | { source: 'photo'; id: string }
  | { source: 'site_image'; id: string }
  | { source: 'album_cover'; id: string }
  /** `slot` is the writer's slot grammar (register_legacy_photo_asset). */
  | { source: 'document'; parent: DocParent; key: string | null; slot: string }

export type Claim = { path: string; at: Locator }

/**
 * Every path one saved source holds a photograph in, each with its slot. The
 * section and block slots come from P3's own extractor — the same answer the
 * projection will act on — and the slots P3 reads for itself straight from the
 * same source, by P3's rules: a live page's legacy columns only while it has
 * no section rows. Samples are counted, not claimed.
 */
export function documentClaims(row: SourceRow): { claims: Claim[]; samples: number; malformed: number } {
  const claims: Claim[] = []
  let samples = 0
  const doc = (slot: string, path: unknown) => {
    if (!usable(path)) return
    if (isSamplePhoto(path)) {
      samples++
      return
    }
    claims.push({ path, at: { source: 'document', parent: row.parent, key: row.key, slot } })
  }
  const src = row.source
  const { refs, malformed } = extract(src)
  const blocks = isRecord(src) && Array.isArray(src.blocks) ? src.blocks : []
  for (const ref of refs) {
    if (ref.kind === 'sample') continue // the relational slots below count their own
    if (ref.kind === 'page_section') {
      doc(row.parent === 'draft' ? `pages/${ref.page_key}/${ref.position}/${ref.field}` : `sections/${ref.position}/${ref.field}`, ref.path)
    } else {
      const i = Number(ref.field.slice('block:'.length))
      const type = isRecord(blocks[i]) ? (blocks[i] as Record<string, unknown>).type : null
      const slot = type === 'image' ? `blocks/${i}/image`
        : type === 'image_pair' ? `blocks/${i}/${ref.position === 0 ? 'left' : 'right'}`
        : `blocks/${i}/images/${ref.position}`
      doc(slot, ref.path)
    }
  }
  // The extractor drops sample section and block photographs without saying;
  // count them here so the report adds up.
  samples += countSampleSlots(src)
  if (isRecord(src)) {
    if (src.parent === 'live_page') {
      // P3's fallback: legacy columns are a placement only on a page with NO
      // section rows. With rows they are mirrors — not claimed.
      if (Array.isArray(src.sections) && src.sections.length === 0 && isRecord(src.legacy)) {
        for (const [field, value] of Object.entries(src.legacy)) doc(`legacy/${field}`, value)
      }
      doc('share', src.share)
    } else if (src.parent === 'draft' && src.exists === true && isRecord(src.page_seo)) {
      for (const [page, seo] of Object.entries(src.page_seo)) if (isRecord(seo)) doc(`page_seo/${page}`, seo.image)
    } else if (src.parent === 'post' && src.exists === true) {
      doc('featured', src.featured)
    }
  }
  return { claims, samples, malformed }
}

function countSampleSlots(src: unknown): number {
  if (!isRecord(src)) return 0
  let n = 0
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (isSamplePhoto(v)) n++
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (isRecord(v)) Object.values(v).forEach(walk)
  }
  if (src.parent === 'live_page') walk(src.sections)
  else if (src.parent === 'draft') walk(src.pages)
  else if (src.parent === 'post') walk(src.blocks)
  return n
}

// ── The plan ────────────────────────────────────────────────────────────────

export type RefusalReason =
  | KeyRefusal['reason']
  | 'foreign_claim'
  | 'conflicting_rows'
  | 'conflicts_with_asset'
  | 'asset_retired'
  | 'display_not_a_file_of_its_era'
  | 'bad_derivatives'
  | 'bad_dimensions'
  | 'bad_original'
  | 'flat_has_original'
  | 'cover_has_original'
  | 'ambiguous_original'
  | 'missing_object'
  | 'empty_object'
  | 'undecodable'
  | 'format_mismatch'
  | 'unsupported_format'
  | 'too_large'
  | 'storage_error'
  | 'not_a_member'
  | 'invalid_link'
  | 'link_disagrees'
  | 'sample_has_asset'
  | 'malformed_source'

export type Refusal = { reason: RefusalReason; path?: string; keyBase?: string; where: string; detail?: string }

/** One call to register_legacy_photo_asset. */
export type Write = {
  id: string
  keyBase: string
  at: Locator
  sourcePath: string
  mode: 'create' | 'reuse'
  args: Record<string, unknown>
}

export type Plan = {
  writes: Write[]
  refusals: Refusal[]
  counts: {
    photos: number
    photoSamples: number
    photosLinked: number
    siteImages: number
    siteImagesLinked: number
    references: number
    referenceSamples: number
    malformed: number
    assetsExisting: number
    assetsPlanned: number
    rowsToLink: number
    filesDecoded: number
    originalsRead: number
  }
}

export type PlanDeps = {
  storage: BackfillStorage
  /** Unprefixed journal key bases reviewed for THIS site (the manifest). */
  provenance: ReadonlySet<string>
  /** Whether another site claims each key (read_photo_backfill_claims). */
  claims: (keyBases: string[]) => Promise<Record<string, boolean>>
  maxOriginalBytes?: number
  maxDisplayBytes?: number
}

export const MAX_ORIGINAL_BYTES = 256 * 1024 * 1024
export const MAX_DISPLAY_BYTES = 64 * 1024 * 1024
/** read_photo_backfill_claims takes at most this many keys per call. */
export const CLAIMS_BATCH = 1000

type Group = {
  keyBase: string
  parsed: ParsedKey
  photos: PhotoRow[]
  images: SiteImageRow[]
  others: Claim[]
}

export const where = (at: Locator) =>
  at.source === 'document' ? `${at.parent}${at.key ? ':' + at.key : ''} ${at.slot}` : `${at.source}:${at.id}`

const derivsOf = (d: unknown): Derivs | null => (d === null || d === undefined ? {} : isRecord(d) ? (d as Derivs) : null)
const derivKey = (d: Derivs | null) => JSON.stringify(Object.entries(d ?? {}).sort(([a], [b]) => Number(a) - Number(b)))
const sameDerivs = (a: unknown, b: unknown) => derivKey(derivsOf(a)) === derivKey(derivsOf(b))

function isLadderOf(keyBase: string, d: Derivs): boolean {
  return Object.entries(d).every(([size, path]) => (LADDER as readonly string[]).includes(size) && path === `${keyBase}/${size}.webp`)
}

const membersOf = (f: { display: string; original: string | null; derivatives: Derivs }) =>
  new Set([f.display, ...(f.original ? [f.original] : []), ...Object.values(f.derivatives)])

const largest = (d: Derivs) => {
  for (const size of [...LADDER].reverse()) if (d[size]) return d[size]!
  return null
}

const EMPTY_CAPTURE = {
  p_taken_at: null, p_camera_make: null, p_camera_model: null, p_lens: null, p_iso: null,
  p_aperture: null, p_shutter: null, p_focal_length: null, p_keywords: null, p_exif: {},
}

function captureArgs(c: Capture): Record<string, unknown> {
  return {
    p_taken_at: c.taken_at, p_camera_make: c.camera_make, p_camera_model: c.camera_model, p_lens: c.lens,
    p_iso: c.iso, p_aperture: c.aperture, p_shutter: c.shutter, p_focal_length: c.focal_length,
    p_keywords: c.keywords, p_exif: c.exif,
  }
}

class Refused extends Error {
  constructor(readonly reason: RefusalReason, readonly path?: string, readonly detail?: string) {
    super(reason)
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Whether a KNOWN sibling exists — absent and empty are both "no". HEAD only. */
async function present(storage: BackfillStorage, key: string): Promise<boolean> {
  try {
    const h = await storage.head(key)
    return h.exists && h.bytes > 0
  } catch (e) {
    throw new Refused('storage_error', key, errText(e))
  }
}

async function getObject(storage: BackfillStorage, key: string, max: number): Promise<Buffer> {
  let bytes: Buffer | null
  try {
    bytes = await storage.get(key, max)
  } catch (e) {
    if (e instanceof TooLargeError) throw new Refused('too_large', key, e.message)
    throw new Refused('storage_error', key, errText(e))
  }
  if (!bytes) throw new Refused('missing_object', key)
  if (bytes.byteLength === 0) throw new Refused('empty_object', key)
  return bytes
}

export type Decoded = { format: string; compression?: string; width: number; height: number }

/**
 * Decodes an image IN FULL (truncated or corrupt pixel data fails, not just a
 * bad header) and measures it UPRIGHT: EXIF orientations 5–8 (and only those)
 * turn the image a quarter, so its upright width is the stored height.
 * `sharp().rotate().metadata()` does NOT do that — metadata describes the input.
 */
export async function decodeImage(bytes: Buffer): Promise<Decoded> {
  const meta = await sharp(bytes, { failOn: 'error' }).metadata()
  await sharp(bytes, { failOn: 'error' }).resize(16, 16, { fit: 'inside' }).raw().toBuffer()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  if (!(w > 0 && h > 0) || !meta.format) throw new Error('no dimensions')
  return { format: meta.format, compression: meta.compression, ...uprightSize(w, h, meta.orientation) }
}

/**
 * Stored size → upright size. EXIF orientations 5–8 are the four quarter-
 * turned ones and swap the axes; 1–4 keep them; anything else (absent, 0, 9…)
 * is not an orientation and changes nothing.
 */
export function uprightSize(width: number, height: number, orientation: number | undefined): { width: number; height: number } {
  const o = orientation ?? 1
  const turned = o >= 5 && o <= 8
  return turned ? { width: height, height: width } : { width, height }
}

/** The sharp format a display file must decode as, from its own name. */
const formatOfName = (key: string) => (key.endsWith('.webp') ? 'webp' : key.endsWith('.jpg') ? 'jpeg' : null)

async function inspectDisplayFile(storage: BackfillStorage, key: string, max: number): Promise<Decoded> {
  const bytes = await getObject(storage, key, max)
  let d: Decoded
  try {
    d = await decodeImage(bytes)
  } catch (e) {
    throw new Refused('undecodable', key, errText(e))
  }
  if (d.format !== formatOfName(key)) throw new Refused('format_mismatch', key, `named ${formatOfName(key)}, decodes as ${d.format}`)
  return d
}

/** The one original among the five names an upload could have used — or none. */
async function discoverOriginal(storage: BackfillStorage, keyBase: string): Promise<string | null> {
  const found: string[] = []
  for (const ext of ORIGINAL_EXTENSIONS) {
    const key = `${keyBase}/original.${ext}`
    if (await present(storage, key)) found.push(key)
  }
  if (found.length > 1) throw new Refused('ambiguous_original', keyBase, found.join(', '))
  return found[0] ?? null
}

type OriginalFacts = {
  p_original_bytes: number
  p_content_sha256: string
  p_content_type: string
  width: number
  height: number
  capture: Capture
}

/** Reads a TRUE original, decodes it in full, hashes the exact bytes. */
async function readOriginal(storage: BackfillStorage, key: string, max: number): Promise<OriginalFacts> {
  const bytes = await getObject(storage, key, max)
  let d: Decoded
  try {
    d = await decodeImage(bytes)
  } catch (e) {
    throw new Refused('undecodable', key, errText(e))
  }
  const type = contentTypeOf(d.format, d.compression)
  if (!type) throw new Refused('unsupported_format', key, d.format)
  return {
    p_original_bytes: bytes.byteLength,
    p_content_sha256: createHash('sha256').update(bytes).digest('hex'),
    p_content_type: type,
    width: d.width,
    height: d.height,
    capture: await readCapture(bytes, { gps: false }),
  }
}

const writeId = (at: Locator, keyBase: string) =>
  `${at.source}:${at.source === 'document' ? `${at.parent}:${at.key ?? ''}:${at.slot}` : at.id}:${keyBase}`

/** Plans one site. Reads storage (HEAD, and bounded GET + decode); writes nothing. */
export async function planTenant(inv: Inventory, deps: PlanDeps): Promise<Plan> {
  const tenant = inv.tenant
  const maxOriginal = deps.maxOriginalBytes ?? MAX_ORIGINAL_BYTES
  const maxDisplay = deps.maxDisplayBytes ?? MAX_DISPLAY_BYTES
  const refusals: Refusal[] = []
  const writes: Write[] = []
  const counts: Plan['counts'] = {
    photos: inv.photos.length, photoSamples: 0, photosLinked: 0,
    siteImages: inv.site_images.length, siteImagesLinked: 0,
    references: 0, referenceSamples: 0, malformed: 0,
    assetsExisting: inv.assets.length, assetsPlanned: 0, rowsToLink: 0, filesDecoded: 0, originalsRead: 0,
  }
  const ctx: OwnershipContext = { albums: new Set(inv.albums.map((a) => a.id)), provenance: deps.provenance }
  const assets = new Map(inv.assets.map((a) => [a.key_base, a]))
  const assetById = new Map(inv.assets.map((a) => [a.id, a]))
  const groups = new Map<string, Group>()

  const place = (path: string, at: Locator): ParsedKey | null => {
    const k = keyBaseFor(path, tenant, ctx)
    if (!k.ok) {
      refusals.push({ reason: k.reason, path, where: where(at) })
      return null
    }
    if (!groups.has(k.keyBase)) groups.set(k.keyBase, { keyBase: k.keyBase, parsed: k, photos: [], images: [], others: [] })
    return k
  }

  /** An existing link is checked, never trusted and never rewritten. */
  const linkOk = (row: PhotoRow | SiteImageRow, at: Locator): boolean => {
    const a = assetById.get(row.asset_id!)
    if (!a) {
      refusals.push({ reason: 'invalid_link', path: row.storage_path, where: where(at), detail: `asset_id ${row.asset_id} is no asset of this site` })
      return false
    }
    if (a.display_path !== row.storage_path) {
      refusals.push({ reason: 'link_disagrees', path: row.storage_path, keyBase: a.key_base, where: where(at), detail: `its asset displays ${a.display_path}` })
      return false
    }
    return true
  }

  // ── Rows: every one, used or not ──
  for (const ph of inv.photos) {
    const at: Locator = { source: 'photo', id: ph.id }
    if (isSamplePhoto(ph.storage_path)) {
      counts.photoSamples++
      if (ph.asset_id) refusals.push({ reason: 'sample_has_asset', path: ph.storage_path, where: where(at) })
      continue
    }
    if (ph.asset_id) {
      if (linkOk(ph, at)) counts.photosLinked++
      continue
    }
    const k = place(ph.storage_path, at)
    if (k) groups.get(k.keyBase)!.photos.push(ph)
  }
  for (const si of inv.site_images) {
    const at: Locator = { source: 'site_image', id: si.id }
    if (si.asset_id) {
      if (linkOk(si, at)) counts.siteImagesLinked++
      continue
    }
    const k = place(si.storage_path, at)
    if (k) groups.get(k.keyBase)!.images.push(si)
  }

  // ── Covers and documents ──
  const claims: Claim[] = []
  for (const al of inv.albums) {
    if (!usable(al.cover_custom_path)) continue
    if (isSamplePhoto(al.cover_custom_path)) {
      counts.referenceSamples++
      continue
    }
    claims.push({ path: al.cover_custom_path, at: { source: 'album_cover', id: al.id } })
  }
  for (const s of inv.sources) {
    const d = documentClaims(s)
    claims.push(...d.claims)
    counts.referenceSamples += d.samples
    counts.malformed += d.malformed
    if (d.malformed > 0) {
      refusals.push({ reason: 'malformed_source', where: `${s.parent}${s.key ? ':' + s.key : ''}`, detail: `${d.malformed} image slot(s) that are not a path` })
    }
  }
  counts.references = claims.length
  for (const c of claims) {
    const k = place(c.path, c.at)
    if (k) groups.get(k.keyBase)!.others.push(c)
  }

  // ── Another site's claim on an unprefixed journal key, in batches ──
  const journal = [...groups.values()].filter((g) => g.parsed.route === 'journal' && g.parsed.prefixTenant === null).map((g) => g.keyBase)
  const foreign: Record<string, boolean> = {}
  for (let i = 0; i < journal.length; i += CLAIMS_BATCH) Object.assign(foreign, await deps.claims(journal.slice(i, i + CLAIMS_BATCH)))

  for (const g of groups.values()) {
    try {
      if (g.parsed.route === 'journal' && g.parsed.prefixTenant === null) {
        if (foreign[g.keyBase] === true) throw new Refused('foreign_claim', g.keyBase)
        if (foreign[g.keyBase] !== false) throw new Refused('foreign_claim', g.keyBase, 'the claim check did not answer for this key')
      }
      await planGroup(g)
    } catch (e) {
      if (!(e instanceof Refused)) throw e
      const sources = [...g.photos.map((p) => `photo:${p.id}`), ...g.images.map((i) => `site_image:${i.id}`), ...g.others.map((c) => where(c.at))]
      refusals.push({ reason: e.reason, path: e.path, keyBase: g.keyBase, where: sources.join(', '), detail: e.detail })
    }
  }

  return { writes, refusals, counts }

  async function planGroup(g: Group): Promise<void> {
    const kb = g.keyBase
    const journalProvenance = g.parsed.route === 'journal' && g.parsed.prefixTenant === null
    const common = { p_tenant: tenant, p_key_base: kb, p_provenance_reviewed: journalProvenance }
    const existing = assets.get(kb)
    const rows: { at: Locator; row: PhotoRow | SiteImageRow }[] = [
      ...g.photos.map((row) => ({ at: { source: 'photo' as const, id: row.id }, row })),
      ...g.images.map((row) => ({ at: { source: 'site_image' as const, id: row.id }, row })),
    ]
    // A photograph's keywords: its row's tags through the ONE normaliser
    // (normalizeKeywords), sent with the raw tags they came from, which the
    // database holds against the row under its lock — different tags, stale.
    const tagArgs = (row: PhotoRow | SiteImageRow) => {
      const tags = 'tags' in row ? row.tags ?? [] : []
      return { p_source_tags: tags, p_keywords: normalizeKeywords(tags) }
    }
    const locator = (at: Locator) => ({
      p_source: at.source,
      p_source_id: at.source === 'document' ? null : at.id,
      p_parent: at.source === 'document' ? at.parent : null,
      p_parent_key: at.source === 'document' ? at.key : null,
      p_slot: at.source === 'document' ? at.slot : null,
    })

    // ── An asset is already at this key: reuse it, or refuse. Never rewrite. ──
    if (existing) {
      if (rows.length > 0 && (existing.archived || existing.deleted)) throw new Refused('asset_retired', kb)
      for (const { at, row } of rows) {
        const agrees = row.storage_path === existing.display_path
          && sameDerivs(row.derivatives, existing.derivatives)
          && row.width === existing.width && row.height === existing.height
          && (row.original_path === null || row.original_path === existing.original_path)
        if (!agrees) {
          refusals.push({ reason: 'conflicts_with_asset', path: row.storage_path, keyBase: kb, where: where(at) })
          continue
        }
        counts.rowsToLink++
        writes.push({
          id: writeId(at, kb), keyBase: kb, at, sourcePath: row.storage_path, mode: 'reuse',
          args: {
            ...common, ...locator(at), ...EMPTY_CAPTURE,
            p_source_path: row.storage_path,
            p_original_path: existing.original_path, p_display_path: existing.display_path,
            p_derivatives: existing.derivatives ?? {}, p_width: existing.width, p_height: existing.height,
            p_original_bytes: existing.original_bytes, p_content_sha256: existing.content_sha256,
            p_content_type: existing.content_type,
            p_source_tags: null,
            ...(at.source === 'photo' ? tagArgs(row) : {}),
          },
        })
      }
      const members = membersOf({ display: existing.display_path, original: existing.original_path, derivatives: existing.derivatives ?? {} })
      for (const c of g.others) if (!members.has(c.path)) refusals.push({ reason: 'not_a_member', path: c.path, keyBase: kb, where: where(c.at) })
      return
    }

    // ── No asset yet: work out the facts, reading and decoding the files ──
    let display: string
    let derivatives: Derivs
    let original: string | null = null
    let width: number | null = null
    let height: number | null = null
    const unprefixed = g.parsed.prefixTenant === null
    const route = g.parsed.route

    if (rows.length > 0) {
      const first = rows[0]!.row
      for (const { row } of rows.slice(1)) {
        if (row.storage_path !== first.storage_path || !sameDerivs(row.derivatives, first.derivatives)
            || row.width !== first.width || row.height !== first.height || row.original_path !== first.original_path) {
          throw new Refused('conflicting_rows', row.storage_path)
        }
      }
      display = first.storage_path
      const d = derivsOf(first.derivatives)
      if (!d || !isLadderOf(kb, d)) throw new Refused('bad_derivatives', display, JSON.stringify(first.derivatives))
      derivatives = { ...d }
      const flat = display === flatFileOf(kb)
      if (!flat && !Object.values(derivatives).includes(display)) throw new Refused('display_not_a_file_of_its_era', display)
      if ((first.width === null) !== (first.height === null) || (first.width !== null && (first.width <= 0 || first.height! <= 0))) {
        throw new Refused('bad_dimensions', display, `${first.width}×${first.height}`)
      }
      // A row keeps the dimensions it has (the asset and its row agree).
      width = first.width
      height = first.height
      if (first.original_path !== null) {
        if (flat) throw new Refused('flat_has_original', first.original_path)
        if (route === 'covers') throw new Refused('cover_has_original', first.original_path)
        if (!ORIGINAL_EXTENSIONS.some((ext) => first.original_path === `${kb}/original.${ext}`)) throw new Refused('bad_original', first.original_path)
        original = first.original_path
      }
      await inspectDisplayFile(deps.storage, display, maxDisplay)
      counts.filesDecoded++
      for (const p of Object.values(derivatives)) {
        if (p === display) continue
        await inspectDisplayFile(deps.storage, p, maxDisplay)
        counts.filesDecoded++
      }
      if (!original && !flat && route !== 'covers') original = await discoverOriginal(deps.storage, kb)
    } else {
      // Only covers and documents name this upload: find its files among the
      // known siblings — the flat file (unprefixed eras), the four sizes, and
      // (folder eras, not covers) the five original names. Nothing else.
      const flatPath = flatFileOf(kb)
      const canBeFlat = unprefixed && route !== 'site-images'
      const flat = canBeFlat && (g.others.some((c) => c.path === flatPath) || (await present(deps.storage, flatPath)))
      derivatives = {}
      for (const size of LADDER) {
        const key = `${kb}/${size}.webp`
        if (await present(deps.storage, key)) derivatives[size] = key
      }
      const top = largest(derivatives)
      if (flat) display = flatPath
      else if (top) display = top
      else throw new Refused('missing_object', g.others[0]?.path ?? kb, 'no flat file and no display size was found')
      for (const p of new Set([display, ...Object.values(derivatives)])) {
        await inspectDisplayFile(deps.storage, p, maxDisplay)
        counts.filesDecoded++
      }
      if (!flat && route !== 'covers') original = await discoverOriginal(deps.storage, kb)
    }

    // ── The original: read, decoded, hashed — in the dry run too ──
    let facts: Record<string, unknown> = { p_original_bytes: null, p_content_sha256: null, p_content_type: null }
    let capture: Record<string, unknown> = { ...EMPTY_CAPTURE }
    if (original) {
      const o = await readOriginal(deps.storage, original, maxOriginal)
      counts.originalsRead++
      facts = { p_original_bytes: o.p_original_bytes, p_content_sha256: o.p_content_sha256, p_content_type: o.p_content_type }
      capture = captureArgs(o.capture)
      // An upload with no row takes its original's UPRIGHT size, measured.
      // With no original and no row the size stays unknown: a resized
      // display file's size is not the photograph's.
      if (rows.length === 0) {
        width = o.width
        height = o.height
      }
    }

    // ── Which claims this asset will answer ──
    const members = membersOf({ display, original, derivatives })
    for (const c of g.others) if (!members.has(c.path)) refusals.push({ reason: 'not_a_member', path: c.path, keyBase: kb, where: where(c.at) })
    const binding: { at: Locator; path: string } | undefined =
      rows[0] ? { at: rows[0].at, path: rows[0].row.storage_path }
      : (() => {
          const c = g.others.find((o) => members.has(o.path))
          return c ? { at: c.at, path: c.path } : undefined
        })()
    if (!binding) return

    counts.assetsPlanned++
    const fileArgs = {
      p_original_path: original, p_display_path: display, p_derivatives: derivatives,
      p_width: width, p_height: height, ...facts,
    }
    const make = (at: Locator, path: string, mode: Write['mode'], row?: PhotoRow | SiteImageRow): Write => {
      const args: Record<string, unknown> = { ...common, ...locator(at), ...capture, ...fileArgs, p_source_path: path, p_source_tags: null }
      if (at.source === 'photo') {
        // Date and place are the ROW's, read by the database at the write.
        args.p_taken_at = null
        Object.assign(args, tagArgs(row!))
      }
      return { id: writeId(at, kb), keyBase: kb, at, sourcePath: path, mode, args }
    }
    writes.push(make(binding.at, binding.path, 'create', rows[0]?.row))
    if (rows[0]) counts.rowsToLink++
    for (const r of rows.slice(1)) {
      counts.rowsToLink++
      writes.push(make(r.at, r.row.storage_path, 'reuse', r.row))
    }
  }
}

// ── Applying a plan ─────────────────────────────────────────────────────────

export type WriteStatus = 'created' | 'reused' | 'already_linked' | 'stale' | 'gone' | 'failed'

export type TenantReport = {
  tenant: string
  apply: boolean
  passes: number
  counts: Plan['counts']
  refusals: Refusal[]
  writes: Record<WriteStatus, number>
  linked: number
  failures: { id: string; message: string }[]
  planned: { create: number; reuse: number }
}

/** Re-read-and-replan rounds before a source that keeps changing is reported. */
export const MAX_PASSES = 3

export type BackfillDeps = {
  rpc: BackfillRpc
  storage: BackfillStorage
  /** Unprefixed journal keys an operator reviewed, by site. */
  provenance: (tenantId: string) => ReadonlySet<string>
  progress?: (line: string) => void
  maxOriginalBytes?: number
  maxDisplayBytes?: number
}

/** A read the run cannot do without: a returned error throws. */
async function read(rpc: BackfillRpc, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await rpc.rpc(fn, args)
  if (r.error) throw new Error(`${fn}: ${r.error.message}`)
  return typeof r.data === 'string' ? JSON.parse(r.data) : r.data
}

export async function readInventory(rpc: BackfillRpc, tenantId: string): Promise<Inventory> {
  return validateInventory(tenantId, await read(rpc, 'read_photo_backfill_inventory', { p_tenant: tenantId }))
}

/**
 * One site: plan, and with `apply` write. Writes go one at a time, each its
 * own transaction. A RETURNED error is that item's failure and the run goes on;
 * a THROWN one (connection, process) ends the run — see the file header.
 *
 * `stale` and `gone` are PROVISIONAL. The planner binds an upload's asset to
 * ONE source (its first row, else its first cover or document slot); if that
 * source changed (`stale`) or vanished (`gone`), the upload may still be named
 * by another source — a story, a page — that needs the asset. So either answer
 * makes the site be re-read and re-planned from a FRESH inventory:
 *
 *   · the write is in the fresh plan again (same source, locator and key —
 *     e.g. the same row reappeared) → it is asked again;
 *   · it is NOT in the fresh plan → that exact binding is absent from the
 *     database's current state, which settles it: a stale attempt is dropped,
 *     a gone one stays counted as `gone`; any surviving source of the same
 *     upload is a write of the fresh plan in its own right, and is made.
 *
 * Bounded by MAX_PASSES. Whatever is still stale or gone after the last pass —
 * never confirmed by a fresh read — is reported as an explicit failure and the
 * site is NOT clean. Never settled by assumption, never looped on.
 */
export async function backfillTenant(tenantId: string, apply: boolean, deps: BackfillDeps): Promise<TenantReport> {
  const progress = deps.progress ?? (() => {})
  const outcomes = new Map<string, WriteStatus>()
  const failures = new Map<string, string>()
  /** `gone` answers a fresh plan has confirmed. Only these count as settled. */
  const settledGone = new Set<string>()
  let plan: Plan | null = null
  let passes = 0
  let planned = { create: 0, reuse: 0 }

  while (passes < (apply ? MAX_PASSES : 1)) {
    passes++
    const inv = await readInventory(deps.rpc, tenantId)
    plan = await planTenant(inv, {
      storage: deps.storage,
      provenance: deps.provenance(tenantId),
      claims: async (keys) => (await read(deps.rpc, 'read_photo_backfill_claims', { p_tenant: tenantId, p_key_bases: keys })) as Record<string, boolean>,
      maxOriginalBytes: deps.maxOriginalBytes,
      maxDisplayBytes: deps.maxDisplayBytes,
    })
    if (passes === 1) {
      planned = {
        create: plan.writes.filter((w) => w.mode === 'create').length,
        reuse: plan.writes.filter((w) => w.mode === 'reuse').length,
      }
    }
    if (!apply) break

    // A provisional answer the FRESH plan no longer contains is settled by it:
    // a stale attempt (the path moved, or another runner linked the row) is
    // dropped; a gone one is confirmed absent. One the fresh plan contains
    // again is unsettled and asked again below. Genuine failures are kept.
    const current = new Set(plan.writes.map((w) => w.id))
    for (const [id, s] of outcomes) {
      if (s === 'stale' && !current.has(id)) outcomes.delete(id)
      else if (s === 'gone') {
        if (current.has(id)) settledGone.delete(id)
        else settledGone.add(id)
      }
    }

    let provisional = 0
    for (const w of plan.writes) {
      const before = outcomes.get(w.id)
      // Only a provisional answer (stale, or gone and back in the fresh plan)
      // is worth asking again; a refusal is the database's final word on that
      // source, and is reported, not repeated.
      if (before !== undefined && before !== 'stale' && before !== 'gone') continue
      // A throw here propagates: the run ends, and a rerun resumes.
      const reply = await deps.rpc.rpc('register_legacy_photo_asset', w.args)
      let status: WriteStatus
      if (reply.error) {
        status = 'failed'
        failures.set(w.id, reply.error.message)
      } else {
        status = (reply.data as { status: WriteStatus }).status
        failures.delete(w.id)
      }
      outcomes.set(w.id, status)
      if (status === 'stale' || status === 'gone') {
        settledGone.delete(w.id)
        provisional++
      }
      progress(`${status.padEnd(14)} ${w.keyBase}  (${where(w.at)})`)
    }
    if (provisional === 0) break
  }

  // Exhausted: anything still provisional was never confirmed by a fresh read.
  for (const [id, s] of outcomes) {
    if (s === 'stale' || (s === 'gone' && !settledGone.has(id))) {
      failures.set(id, `unsettled after ${passes} pass(es): the source answered "${s}" and no fresh read confirmed it`)
    }
  }

  const writes: Record<WriteStatus, number> = { created: 0, reused: 0, already_linked: 0, stale: 0, gone: 0, failed: 0 }
  for (const s of outcomes.values()) writes[s]++
  const linked = [...outcomes.entries()].filter(([id, s]) => (s === 'created' || s === 'reused') && /^(photo|site_image):/.test(id)).length
  return {
    tenant: tenantId,
    apply,
    passes,
    counts: plan!.counts,
    refusals: plan!.refusals,
    writes,
    linked,
    failures: [...failures.entries()].map(([id, message]) => ({ id, message })),
    planned,
  }
}

/**
 * Whether a site's report is clean: nothing refused, malformed, failed, left
 * stale, or gone without a fresh read confirming it (those are in `failures`).
 */
export const isClean = (r: TenantReport) =>
  r.refusals.length === 0 && r.counts.malformed === 0 && r.writes.failed === 0 && r.writes.stale === 0 &&
  r.failures.length === 0
