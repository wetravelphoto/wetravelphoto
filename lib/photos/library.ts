import type { SizeKey } from '@/lib/image-sizes'
import { isSamplePhoto } from '@/lib/images'
import { parseLegacyKey } from '@/lib/photos/legacy-key'
import { assetRef, isNonBlankText, type RenderAsset, type RefOutcome, type UnavailableReason } from '@/lib/photos/image'
import type { AssetProof } from '@/lib/photos/editor-proof'

/**
 * THE PHOTOGRAPHER'S LIBRARY, AS THE EDITOR'S PICKER READS IT
 * ═══════════════════════════════════════════════════════════
 *
 * P5. What `app/actions/images.ts` answers the picker with: one page of a
 * source at a time, and the photographs a slot already holds. Server-side
 * only; the database is handed in (`LibraryDb`) so `.mk/picker-editor.ts` can
 * run every query against a fake that applies ONLY the filters this file
 * writes — the way a platform admin, whom row-level security lets see every
 * site, would be answered — and `.mk/picker-editor-db.ts` against a real
 * Postgres as an ordinary photographer and as a platform admin.
 *
 * ── Two reads, two questions ────────────────────────────────────────────────
 * WHICH photographs: the photographer's own client, through P1's
 * authenticated SELECT, every query naming `tenant_id = <requireEditor()'s
 * site>`, platform admin or not. Every row is checked again for its site.
 *
 * WHAT each one may be shown as: `LibraryDb.prove` — read_photo_render_assets
 * for exactly the asset ids the first read returned (lib/photos/editor-proof.ts).
 * Its answer is the ONLY source of a photograph's files, trusted dimensions and
 * canonical description here, so the picker and the public page cannot
 * disagree about any of them. It is also the only thing that can tell a
 * legacy key naming ANOTHER site's album (refused, `malformed`) from one whose
 * album was deleted (fine): row-level security hides another site's private
 * album from an ordinary photographer, so "not visible" proves neither.
 *
 * ── What leaves ─────────────────────────────────────────────────────────────
 * `LibraryItem`, built field by field, never a row: the display file, a
 * thumbnail size, trusted dimensions or none, the canonical description
 * (shown, never edited), a gallery caption and membership, and three camera
 * settings — shutter, aperture, ISO — read from P2's normalised columns on
 * this site's own row and checked again (`readCamera`). No original, no
 * hash, no raw EXIF, no camera make, model or serial, no GPS, no file name,
 * no key base, no database row. A
 * photograph the proof does not vouch for is not offered; one it calls
 * unavailable is described as such and carries no file of its own.
 *
 * ── Bounds ──────────────────────────────────────────────────────────────────
 * One page is at most PAGE_SIZE photographs, found by scanning at most
 * SCAN_BATCHES × BATCH rows (one proof per batch); the cursor is opaque, bound
 * to its source and order, and parsed strictly. A resolve is at most
 * RESOLVE_MAX references. Sources come SOURCE_PAGE galleries at a time. A
 * read or proof failure is an error, never an empty page.
 *
 * ── Gallery covers in the rail ──────────────────────────────────────────────
 * Each gallery on a page of sources may carry a cover thumbnail: the gallery's
 * custom cover, else its chosen cover photograph, else its first photograph —
 * the public cover rule (lib/album-covers.ts). Every one is resolved through
 * resolveRefs (this site's rows, then the canonical proof), RESOLVE_MAX at a
 * time, and only a READY photograph's display-size thumbnail is shown — never
 * an original, never another site's file. "First photograph" is read with ONE
 * bounded query per page (COVER_SCAN_PER_GALLERY rows a gallery, at most
 * COVER_SCAN_MAX): a gallery whose first photograph is not certainly among
 * them shows no cover rather than a wrong one. A cover that cannot be read or
 * proved is simply absent (null) — the rail still lists the gallery. Counts
 * stay unknown (null): no bounded exact count exists.
 */

export const PAGE_SIZE = 48
const BATCH = 48
const SCAN_BATCHES = 4
export const RESOLVE_MAX = 60
/** Galleries per page of sources, and the most a caller may name at once. */
export const SOURCE_PAGE = 200
/** Rows the first-photograph scan reads per gallery needing one, and in all. */
export const COVER_SCAN_PER_GALLERY = 2
export const COVER_SCAN_MAX = 400
const CAPTION_SHOWN_MAX = 500
const PATH_MAX = 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** A timestamp exactly as PostgREST writes one. Anything else is not a cursor. */
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

// ── The database, as this file uses it ──────────────────────────────────────

export type DbReply = { data: unknown; error: { message: string } | null }

/** The PostgREST builder methods used here, and nothing else. */
export interface LibraryQuery extends PromiseLike<DbReply> {
  select(columns: string): LibraryQuery
  eq(column: string, value: unknown): LibraryQuery
  in(column: string, values: readonly unknown[]): LibraryQuery
  is(column: string, value: null): LibraryQuery
  not(column: string, operator: string, value: unknown): LibraryQuery
  filter(column: string, operator: string, value: unknown): LibraryQuery
  or(filters: string): LibraryQuery
  order(column: string, options: { ascending: boolean }): LibraryQuery
  limit(count: number): LibraryQuery
}

export type LibraryTable = 'photo_assets' | 'photos' | 'site_images' | 'albums'

export type LibraryDb = {
  /** The photographer's own client. */
  from(table: LibraryTable): LibraryQuery
  /** read_photo_render_assets for this site, server-side (lib/photos/editor-proof.ts). */
  prove: AssetProof
}

export class LibraryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibraryError'
  }
}

const READ_FAILED = 'Your photographs could not be read just now. Try again in a moment.'
const CHECK_FAILED = 'Your photographs could not be checked just now. Try again in a moment.'

async function rows(q: PromiseLike<DbReply>): Promise<Record<string, unknown>[]> {
  let reply: DbReply
  try {
    reply = await q
  } catch {
    throw new LibraryError(READ_FAILED)
  }
  if (reply.error || !Array.isArray(reply.data)) throw new LibraryError(READ_FAILED)
  return reply.data.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object' && !Array.isArray(r))
}

// ── What leaves ─────────────────────────────────────────────────────────────

export type LibraryOrientation = 'landscape' | 'portrait' | 'square'

export type LibraryMembership = { photoId: string; albumId: string; albumLabel: string | null }

/** Three camera settings in their normalised stored form; null when the row has none of them. */
export type LibraryCamera = { shutter: string | null; aperture: number | null; iso: number | null }

/** One photograph as the editor's picker may know it. Plain JSON. */
export type LibraryItem = {
  kind: 'asset' | 'sample'
  assetId: string | null
  /** The stored path a caller writes: the asset's display file, or a gallery row's own path. */
  path: string
  /** A display size for the thumbnail — never an original. Unused when unavailable. */
  thumbPath: string
  width: number | null
  height: number | null
  orientation: LibraryOrientation | null
  canonicalAlt: string | null
  caption: string | null
  title: string | null
  origin: 'gallery' | 'upload' | 'document'
  originLabel: string | null
  uploadedAt: string | null
  membership: LibraryMembership | null
  readiness: 'ready' | 'unavailable'
  unavailableReason: string | null
  /** Ready assets only; never for a sample or an unavailable photograph. */
  camera: LibraryCamera | null
}

export const LIBRARY_ITEM_KEYS = [
  'assetId', 'camera', 'canonicalAlt', 'caption', 'height', 'kind', 'membership', 'orientation', 'origin',
  'originLabel', 'path', 'readiness', 'thumbPath', 'title', 'unavailableReason', 'uploadedAt', 'width',
] as const

export type LibrarySource = {
  id: string
  kind: 'all' | 'uploads' | 'document' | 'album'
  label: string
  detail: string | null
  /** A gallery's cover as a display-size file of a proved, ready photograph of this site; null when unknown. */
  coverPath: string | null
  count: null
}

// ── Reading one asset row: only enough to ask about it ──────────────────────

/**
 * The columns read through the photographer's client: enough to know which
 * row this is, which route minted it and which files it CLAIMS (for finding a
 * path's owner). Dimensions, description and lifecycle are not read here at
 * all — the proof answers those. The three camera settings are: they are
 * facts of this site's own row that the proof does not carry, and they are
 * shown only for a photograph the proof calls ready.
 */
export const ASSET_COLUMNS = 'id,tenant_id,key_base,display_path,derivatives,created_at,iso,aperture,shutter'

type Route = 'photos' | 'covers' | 'journal' | 'site-images'

/** A row of this site, before the proof. Nothing here is shown. */
type Claimed = {
  id: string
  displayPath: string
  /** The files the row claims — used only to find which row a path belongs to. */
  claims: Set<string>
  route: Route
  uploadedAt: string | null
  camera: LibraryCamera | null
}

/** A row of this site, after the proof. */
type Proven =
  | { id: string; status: 'ok'; route: Route; uploadedAt: string | null; camera: LibraryCamera | null; asset: RenderAsset; files: Set<string> }
  | { id: string; status: 'unavailable'; route: Route; uploadedAt: string | null; camera: LibraryCamera | null; reason: UnavailableReason }

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
/** One blank rule, P5's (lib/photos/image.ts): invisible-only text is no text. */
const text = (v: unknown): string | null => (isNonBlankText(v) ? v.trim() : null)
const clip = (v: string, max: number) => (v.length > max ? `${v.slice(0, max - 1)}…` : v)

const REASONS: Record<UnavailableReason, string> = {
  deleted: 'This photograph has been deleted.',
  archived: 'This photograph is archived.',
  pending: 'This photograph is still being processed.',
  failed: 'This photograph could not be processed.',
  malformed: 'This photograph’s files can’t be used here.',
}

/** One `photo_assets` row → what it claims, or null when it is not this site's row at all. */
export function readClaim(row: Record<string, unknown>, tenantId: string): Claimed | null {
  const id = str(row.id)
  if (!id || !UUID.test(id) || row.tenant_id !== tenantId) return null
  const keyBase = str(row.key_base)
  const parsed = parseLegacyKey(keyBase)
  if (!keyBase || !parsed.ok || parsed.shape !== 'base' || parsed.keyBase !== keyBase) return null
  const display = str(row.display_path)
  if (!display) return null
  const claims = new Set<string>([display])
  const raw = row.derivatives
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const v of Object.values(raw as Record<string, unknown>)) if (typeof v === 'string') claims.add(v)
  }
  const created = str(row.created_at)
  return {
    id,
    displayPath: display,
    claims,
    route: parsed.route,
    uploadedAt: created && STAMP.test(created) ? created : null,
    camera: readCamera(row),
  }
}

/** The normalised form P2 writes and the database checks (upsert_photo_asset). */
const SHUTTER = /^(1\/[1-9][0-9]{0,5}|[0-9]{1,4}(\.[0-9])?s)$/

/**
 * Shutter, aperture and ISO from one `photo_assets` row, each checked again
 * against the rule the database already enforces; a value that fails is
 * absent, never repaired or guessed. Nothing else of the capture is read.
 */
export function readCamera(row: Record<string, unknown>): LibraryCamera | null {
  const s = row.shutter
  const shutter = typeof s === 'string' && SHUTTER.test(s) && parseFloat(s.replace(/^1\//, '')) > 0 ? s : null
  // numeric(4,1): PostgREST sends a number; a numeric string is accepted in the same shape.
  const a = typeof row.aperture === 'string' && /^\d{1,2}(\.\d)?$/.test(row.aperture) ? Number(row.aperture) : row.aperture
  const aperture = typeof a === 'number' && Number.isFinite(a) && a >= 0.5 && a <= 99.9 && Math.round(a * 10) / 10 === a ? a : null
  const i = row.iso
  const iso = typeof i === 'number' && Number.isInteger(i) && i >= 1 && i <= 1_000_000 ? i : null
  return shutter === null && aperture === null && iso === null ? null : { shutter, aperture, iso }
}

const filesOf = (a: RenderAsset) => new Set<string>([a.displayPath, ...Object.values(a.derivatives)])

/**
 * Asks the canonical reader about these rows — one reference per row, its id
 * and its display file — and keeps what it answers:
 *
 *   ok                         shown, with the reader's files, size and text
 *   unavailable (any reason)   described as unavailable, no file of its own;
 *                              `malformed` includes a key naming another
 *                              site's album, whether or not RLS lets this
 *                              photographer see that album
 *   missing · mismatch · …     not shown (the row changed under the read)
 *   not read · error           the whole request is an error
 */
async function prove(db: LibraryDb, tenantId: string, claims: Claimed[]): Promise<Map<string, Proven>> {
  const out = new Map<string, Proven>()
  if (!claims.length) return out
  let answers: RefOutcome[]
  try {
    answers = await db.prove(tenantId, claims.map((c) => assetRef(c.id, c.displayPath)))
  } catch {
    throw new LibraryError(CHECK_FAILED)
  }
  if (!Array.isArray(answers) || answers.length !== claims.length) throw new LibraryError(CHECK_FAILED)
  claims.forEach((c, i) => {
    const a = answers[i]!
    const base = { id: c.id, route: c.route, uploadedAt: c.uploadedAt, camera: c.camera }
    switch (a.outcome) {
      case 'ok':
        if (a.asset.id !== c.id) throw new LibraryError(CHECK_FAILED)
        out.set(c.id, { ...base, status: 'ok', asset: a.asset, files: filesOf(a.asset) })
        return
      case 'unavailable':
        out.set(c.id, { ...base, status: 'unavailable', reason: a.reason })
        return
      case 'not_read':
      case 'error':
        throw new LibraryError(CHECK_FAILED)
      default:
        return
    }
  })
  return out
}

function orientationOf(d: RenderAsset['dimensions']): LibraryOrientation | null {
  if (!d) return null
  return d.width > d.height ? 'landscape' : d.width < d.height ? 'portrait' : 'square'
}

type Origin = { origin: LibraryItem['origin']; label: string | null }

/**
 * Where a photograph came from, by the route that minted it — its upload
 * HISTORY. Never a claim about where it is now: only a current `site_images`
 * row of this site may say "In Uploads" (`originsFor`, the Uploads scan, a
 * registration that has just written one); a photograph taken out of Uploads
 * was still uploaded here.
 */
const routeOrigin = (route: Route): Origin =>
  route === 'site-images'
    ? { origin: 'upload', label: 'Uploaded here' }
    : route === 'photos'
      ? { origin: 'gallery', label: null }
      : { origin: 'document', label: route === 'covers' ? 'A gallery cover' : 'Used in a story' }

/** The DTO, field by field. Nothing from a row or a reply is copied wholesale. */
export function itemFromProven(
  p: Proven,
  extra: { path?: string; membership?: LibraryMembership | null; caption?: string | null; origin?: Origin } = {}
): LibraryItem {
  const origin = extra.origin ?? routeOrigin(p.route)
  const caption = text(extra.caption)
  const common = {
    kind: 'asset' as const,
    assetId: p.id,
    caption: caption === null ? null : clip(caption, CAPTION_SHOWN_MAX),
    title: null,
    origin: origin.origin,
    originLabel: origin.label,
    uploadedAt: p.uploadedAt,
    membership: extra.membership ?? null,
  }
  if (p.status === 'unavailable') {
    // Only what the caller already holds: no file of this photograph's own.
    const path = extra.path ?? ''
    return {
      ...common,
      path,
      thumbPath: path,
      width: null,
      height: null,
      orientation: null,
      canonicalAlt: null,
      readiness: 'unavailable',
      unavailableReason: REASONS[p.reason],
      camera: null,
    }
  }
  const a = p.asset
  const size = (k: SizeKey) => a.derivatives[k]
  return {
    ...common,
    path: extra.path ?? a.displayPath,
    thumbPath: size('800') ?? size('400') ?? size('1600') ?? a.displayPath,
    width: a.dimensions?.width ?? null,
    height: a.dimensions?.height ?? null,
    orientation: orientationOf(a.dimensions),
    canonicalAlt: a.alt,
    readiness: 'ready',
    unavailableReason: null,
    camera: p.camera ? { ...p.camera } : null,
  }
}

/** A built-in sample: no asset, no library record, its path is its identity. */
export function sampleItem(path: string, membership: LibraryMembership | null, caption: string | null): LibraryItem {
  const t = text(caption)
  return {
    kind: 'sample',
    assetId: null,
    path,
    thumbPath: path,
    width: null,
    height: null,
    orientation: null,
    canonicalAlt: null,
    caption: t === null ? null : clip(t, CAPTION_SHOWN_MAX),
    title: null,
    origin: membership ? 'gallery' : 'document',
    originLabel: 'Built-in sample',
    uploadedAt: null,
    membership,
    readiness: 'ready',
    unavailableReason: null,
    camera: null,
  }
}

// ── Lookups shared by listing and resolving ─────────────────────────────────

async function claimsById(db: LibraryDb, tenantId: string, ids: string[]): Promise<Claimed[]> {
  if (!ids.length) return []
  const found = await rows(db.from('photo_assets').select(ASSET_COLUMNS).eq('tenant_id', tenantId).in('id', ids))
  return found.map((r) => readClaim(r, tenantId)).filter((c): c is Claimed => c !== null)
}

async function provenById(db: LibraryDb, tenantId: string, ids: string[]): Promise<Map<string, Proven>> {
  return prove(db, tenantId, await claimsById(db, tenantId, ids))
}

async function albumTitles(db: LibraryDb, tenantId: string, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (!ids.length) return out
  const found = await rows(db.from('albums').select('id,tenant_id,title').eq('tenant_id', tenantId).in('id', ids))
  for (const r of found) {
    if (r.tenant_id !== tenantId || typeof r.id !== 'string') continue
    out.set(r.id, text(r.title) ?? 'Untitled gallery')
  }
  return out
}

const PHOTO_COLUMNS = 'id,tenant_id,album_id,storage_path,caption,asset_id,created_at'

/**
 * A gallery row → its item, or null. Its stored path must be one of its
 * asset's own files, as the proof lists them; a sample row has no asset and
 * must be a sample path. A row whose asset is unavailable is described so.
 */
function itemFromPhoto(
  photo: Record<string, unknown>,
  tenantId: string,
  assets: Map<string, Proven>,
  titles: Map<string, string | null>
): LibraryItem | null {
  const id = str(photo.id)
  const albumId = str(photo.album_id)
  const path = str(photo.storage_path)
  if (!id || !UUID.test(id) || !albumId || !UUID.test(albumId) || !path || photo.tenant_id !== tenantId) return null
  if (!titles.has(albumId)) return null
  const membership: LibraryMembership = { photoId: id, albumId, albumLabel: titles.get(albumId) ?? null }
  const assetId = str(photo.asset_id)
  if (!assetId) return isSamplePhoto(path) ? sampleItem(path, membership, str(photo.caption)) : null
  const p = assets.get(assetId)
  if (!p) return null
  if (p.status === 'ok' && !p.files.has(path)) return null
  return itemFromProven(p, {
    path,
    membership,
    caption: str(photo.caption),
    origin: { origin: 'gallery', label: membership.albumLabel ? `In ${membership.albumLabel}` : null },
  })
}

// ── Sources ─────────────────────────────────────────────────────────────────

export type SourcesQuery = { albumIds?: readonly string[] | null; cursor?: string | null }

/**
 * The library first, then this site's galleries, newest first, SOURCE_PAGE
 * at a time — `nextCursor` says there are more, so a caller never mistakes
 * one page for the whole list. In membership mode (a chosen gallery cover)
 * only the named galleries are offered — a caller's restriction, re-checked
 * against this site — and there is never a second page.
 */
export async function listSources(
  db: LibraryDb,
  tenantId: string,
  opts: SourcesQuery = {}
): Promise<{ sources: LibrarySource[]; nextCursor: string | null }> {
  const only = opts.albumIds ?? null
  const rawCursor = opts.cursor ?? null
  if (only && (!Array.isArray(only) || only.length > SOURCE_PAGE || only.some((x) => typeof x !== 'string' || !UUID.test(x)))) {
    throw new LibraryError('Those galleries could not be read.')
  }
  if (rawCursor !== null && (only || typeof rawCursor !== 'string')) throw new LibraryError('That list of galleries could not be found. Start again.')
  const cursor = rawCursor ? decodeCursor(rawCursor, SOURCES_CURSOR, 'recent') : null

  let q = db.from('albums').select('id,tenant_id,title,trip_start_date,created_at,cover_photo_id,cover_custom_path').eq('tenant_id', tenantId)
  if (only) q = q.in('id', [...only])
  const found = await rows(after(q, cursor, 'recent').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(SOURCE_PAGE + 1))
  const page = found.slice(0, SOURCE_PAGE)
  const last = page[page.length - 1]
  const more = !only && found.length > SOURCE_PAGE && !!last && typeof last.id === 'string' && UUID.test(last.id) && typeof last.created_at === 'string' && STAMP.test(last.created_at)

  const mine = page.filter((a) => a.tenant_id === tenantId && typeof a.id === 'string' && UUID.test(a.id))
  const covers = await galleryCovers(db, tenantId, mine)
  const galleries: LibrarySource[] = mine.map((a) => ({
    id: `album:${a.id as string}`,
    kind: 'album' as const,
    label: text(a.title) ?? 'Untitled gallery',
    detail: typeof a.trip_start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.trip_start_date) ? a.trip_start_date : null,
    coverPath: covers.get(a.id as string) ?? null,
    count: null,
  }))
  const nextCursor = more ? encodeCursor({ s: SOURCES_CURSOR, o: 'recent', c: last!.created_at as string, i: last!.id as string }) : null
  if (only || cursor) return { sources: galleries, nextCursor }
  return {
    sources: [
      { id: 'all', kind: 'all', label: 'All photographs', detail: null, coverPath: null, count: null },
      { id: 'uploads', kind: 'uploads', label: 'Uploads', detail: null, coverPath: null, count: null },
      { id: 'document', kind: 'document', label: 'Pages & stories', detail: null, coverPath: null, count: null },
      ...galleries,
    ],
    nextCursor,
  }
}

/**
 * Each gallery's cover thumbnail (see "Gallery covers in the rail" above), by
 * gallery id. The galleries are already checked to be this site's. Never
 * throws: a cover that cannot be read or proved is left out.
 */
async function galleryCovers(db: LibraryDb, tenantId: string, albums: Record<string, unknown>[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    const custom = new Map<string, string>()
    const chosen = new Map<string, string>()
    const first = new Set<string>()
    for (const a of albums) {
      const id = a.id as string
      const path = str(a.cover_custom_path)
      const photo = str(a.cover_photo_id)
      if (path && path.length <= PATH_MAX) custom.set(id, path)
      else if (photo && UUID.test(photo)) chosen.set(id, photo)
      else first.add(id)
    }

    // One bounded read, in the public fallback's order. A gallery that
    // appears is certain of its first photograph (the order is global); one
    // that does not appear within the bound shows no cover.
    if (first.size) {
      const scanned = await rows(
        db
          .from('photos')
          .select('id,tenant_id,album_id')
          .eq('tenant_id', tenantId)
          .in('album_id', [...first])
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true })
          .limit(Math.min(COVER_SCAN_MAX, first.size * COVER_SCAN_PER_GALLERY))
      )
      for (const p of scanned) {
        const album = str(p.album_id)
        const id = str(p.id)
        if (p.tenant_id !== tenantId || !album || !first.has(album) || chosen.has(album) || !id || !UUID.test(id)) continue
        chosen.set(album, id)
      }
    }

    // A gallery row counts only as a cover of ITS OWN gallery, as the public
    // resolver requires (lib/album-covers.ts `coverSources`): a chosen row of
    // another gallery of this site shows no cover, never that row. A custom
    // cover is a file of its own and has no gallery to belong to.
    const asks = [
      ...[...custom].map(([album, path]) => ({ album, member: false, ref: { assetId: null, photoId: null, path } })),
      ...[...chosen].map(([album, photoId]) => ({ album, member: true, ref: { assetId: null, photoId, path: null } })),
    ]
    for (let i = 0; i < asks.length; i += RESOLVE_MAX) {
      const slice = asks.slice(i, i + RESOLVE_MAX)
      let found: Array<LibraryItem | null>
      try {
        found = await resolveRefs(db, tenantId, slice.map((x) => x.ref))
      } catch {
        continue
      }
      slice.forEach((x, k) => {
        const item = found[k]
        if (x.member && item?.membership?.albumId !== x.album) return
        if (item && item.readiness === 'ready' && item.thumbPath) out.set(x.album, item.thumbPath)
      })
    }
  } catch {
    // A cover is decoration: the galleries are listed whatever happens here.
  }
  return out
}

// ── One page ────────────────────────────────────────────────────────────────

export type ListQuery = { source: string; orientation: 'any' | LibraryOrientation; sort: 'recent' | 'oldest'; cursor: string | null }

type Cursor = { s: string; o: 'recent' | 'oldest'; c: string; i: string }

/** The cursor "source" of the gallery list — not a source a page can be asked for. */
const SOURCES_CURSOR = 'sources'

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([1, c.s, c.o, c.c, c.i]), 'utf8').toString('base64url')
}

/** Strict: the source and order it was issued for, a PostgREST timestamp, a uuid. Anything else throws. */
export function decodeCursor(raw: string, source: string, sort: Cursor['o']): Cursor {
  const refuse = () => {
    throw new LibraryError('That page of photographs could not be found. Start from the top.')
  }
  if (raw.length > 400 || !/^[A-Za-z0-9_-]+$/.test(raw)) return refuse()
  let v: unknown
  try {
    v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return refuse()
  }
  if (!Array.isArray(v) || v.length !== 5 || v[0] !== 1) return refuse()
  const [, s, o, c, i] = v as unknown[]
  if (s !== source || o !== sort || typeof c !== 'string' || !STAMP.test(c) || typeof i !== 'string' || !UUID.test(i)) return refuse()
  return { s: source, o: sort, c, i }
}

/** Rows after the cursor, in (created_at, id) order. The values are validated, then quoted. */
function after(q: LibraryQuery, cursor: Cursor | null, sort: Cursor['o']): LibraryQuery {
  if (!cursor) return q
  const op = sort === 'recent' ? 'lt' : 'gt'
  return q.or(`created_at.${op}."${cursor.c}",and(created_at.eq."${cursor.c}",id.${op}.${cursor.i})`)
}

const ordered = (q: LibraryQuery, sort: Cursor['o']) =>
  q.order('created_at', { ascending: sort === 'oldest' }).order('id', { ascending: sort === 'oldest' }).limit(BATCH)

const SOURCES = /^(all|uploads|document|album:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/** Validates what the browser sent. Throws on anything outside the closed shape. */
export function readListQuery(raw: unknown): ListQuery {
  const q = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const source = q.source
  const orientation = q.orientation
  const sort = q.sort
  const cursor = q.cursor
  if (typeof source !== 'string' || !SOURCES.test(source)) throw new LibraryError('That source could not be read.')
  if (!['any', 'landscape', 'portrait', 'square'].includes(orientation as string)) throw new LibraryError('That filter could not be read.')
  if (sort !== 'recent' && sort !== 'oldest') throw new LibraryError('That order could not be read.')
  if (cursor !== null && typeof cursor !== 'string') throw new LibraryError('That page of photographs could not be found.')
  return { source, orientation: orientation as ListQuery['orientation'], sort, cursor }
}

/**
 * One page of a source. Scans in (created_at, id) order, keeps what passes
 * the shape filter, stops at a page or after SCAN_BATCHES batches, and hands
 * back a cursor after the last row it CONSIDERED — so a shape filter that
 * skips rows never skips them twice and never loops. A page may therefore be
 * empty and still have a cursor: nothing matched in that stretch, more to read.
 */
export async function listItems(db: LibraryDb, tenantId: string, query: ListQuery): Promise<{ items: LibraryItem[]; nextCursor: string | null }> {
  let cursor = query.cursor ? decodeCursor(query.cursor, query.source, query.sort) : null
  const items: LibraryItem[] = []
  const seen = new Set<string>()
  const albumId = query.source.startsWith('album:') ? query.source.slice(6) : null

  let titles = new Map<string, string | null>()
  if (albumId) {
    titles = await albumTitles(db, tenantId, [albumId])
    if (!titles.has(albumId)) throw new LibraryError('That gallery could not be found on this site.')
  }

  for (let batch = 0; batch < SCAN_BATCHES; batch++) {
    const page = await scan(db, tenantId, query, albumId, titles, cursor)
    let last: Cursor | null = null
    for (const [index, { item, created, id }] of page.rows.entries()) {
      last = { s: query.source, o: query.sort, c: created, i: id }
      if (!item) continue
      if (query.orientation !== 'any' && item.orientation !== query.orientation) continue
      // A gallery row is its own choice (a cover is a row); anything else is one per photograph.
      const key = item.membership ? `p:${item.membership.photoId}` : item.assetId ? `a:${item.assetId}` : `s:${item.path}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
      if (items.length >= PAGE_SIZE) {
        const more = index < page.rows.length - 1 || page.full
        return { items, nextCursor: more ? encodeCursor(last) : null }
      }
    }
    if (!page.full) return { items, nextCursor: null }
    cursor = last
  }
  return { items, nextCursor: cursor ? encodeCursor(cursor) : null }
}

type Scanned = { rows: Array<{ item: LibraryItem | null; created: string; id: string }>; full: boolean }

const ready = (item: LibraryItem | null) => (item && item.readiness === 'ready' ? item : null)

async function scan(
  db: LibraryDb,
  tenantId: string,
  query: ListQuery,
  albumId: string | null,
  titles: Map<string, string | null>,
  cursor: Cursor | null
): Promise<Scanned> {
  const keyed = (list: Record<string, unknown>[]) =>
    list.filter((r) => typeof r.id === 'string' && UUID.test(r.id) && typeof r.created_at === 'string' && STAMP.test(r.created_at))
  const assetIds = (list: Record<string, unknown>[]) => [...new Set(list.map((r) => str(r.asset_id)).filter((x): x is string => !!x && UUID.test(x)))]

  if (albumId) {
    const photos = keyed(
      await rows(ordered(after(db.from('photos').select(PHOTO_COLUMNS).eq('tenant_id', tenantId).eq('album_id', albumId), cursor, query.sort), query.sort))
    )
    const assets = await provenById(db, tenantId, assetIds(photos))
    return {
      rows: photos.map((p) => ({ item: ready(itemFromPhoto(p, tenantId, assets, titles)), created: p.created_at as string, id: p.id as string })),
      full: photos.length === BATCH,
    }
  }

  if (query.source === 'uploads') {
    const uploads = keyed(
      await rows(
        ordered(after(db.from('site_images').select('id,tenant_id,asset_id,created_at').eq('tenant_id', tenantId).not('asset_id', 'is', null), cursor, query.sort), query.sort)
      )
    )
    const assets = await provenById(db, tenantId, assetIds(uploads))
    return {
      rows: uploads.map((u) => {
        const p = u.tenant_id === tenantId ? assets.get(u.asset_id as string) : undefined
        const item = p ? ready(itemFromProven(p, { origin: { origin: 'upload', label: 'In Uploads' } })) : null
        return { item, created: u.created_at as string, id: u.id as string }
      }),
      full: uploads.length === BATCH,
    }
  }

  // The library itself: every usable asset of this site, once each.
  let q = db
    .from('photo_assets')
    .select(ASSET_COLUMNS)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .is('archived_at', null)
    .eq('state', 'derived')
  if (query.source === 'document') {
    // Story images and custom gallery covers: the routes that never make a
    // gallery row or an Uploads entry.
    q = q.filter('key_base', 'match', `^(t/${tenantId}/)?(journal|covers)/`)
  }
  const found = keyed(await rows(ordered(after(q, cursor, query.sort), query.sort)))
  const claims = found.map((r) => readClaim(r, tenantId)).filter((c): c is Claimed => c !== null)
  const assets = await prove(db, tenantId, claims)
  const origins = await originsFor(db, tenantId, [...assets.keys()])
  return {
    rows: found.map((row) => {
      const p = assets.get(row.id as string)
      return { item: p ? ready(itemFromProven(p, { origin: origins.get(p.id) })) : null, created: row.created_at as string, id: row.id as string }
    }),
    full: found.length === BATCH,
  }
}

/** Where each asset on a page lives: a gallery (named), Uploads, or neither. */
async function originsFor(db: LibraryDb, tenantId: string, ids: string[]): Promise<Map<string, Origin>> {
  const out = new Map<string, Origin>()
  if (!ids.length) return out
  const [photos, uploads] = await Promise.all([
    rows(db.from('photos').select('asset_id,album_id,tenant_id,created_at').eq('tenant_id', tenantId).in('asset_id', ids).order('created_at', { ascending: true })),
    rows(db.from('site_images').select('asset_id,tenant_id').eq('tenant_id', tenantId).in('asset_id', ids)),
  ])
  const firstAlbum = new Map<string, string>()
  for (const p of photos) {
    if (p.tenant_id === tenantId && typeof p.asset_id === 'string' && typeof p.album_id === 'string' && !firstAlbum.has(p.asset_id)) {
      firstAlbum.set(p.asset_id, p.album_id)
    }
  }
  const titles = await albumTitles(db, tenantId, [...new Set(firstAlbum.values())])
  for (const [asset, album] of firstAlbum) {
    const t = titles.get(album)
    out.set(asset, { origin: 'gallery', label: t ? `In ${t}` : null })
  }
  for (const u of uploads) {
    if (u.tenant_id === tenantId && typeof u.asset_id === 'string' && !out.has(u.asset_id)) {
      out.set(u.asset_id, { origin: 'upload', label: 'In Uploads' })
    }
  }
  return out
}

// ── What a slot already holds ───────────────────────────────────────────────

export type LibraryRef = { assetId: string | null; photoId: string | null; path: string | null }

function readRef(raw: unknown): LibraryRef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const assetId = r.assetId ?? null
  const photoId = r.photoId ?? null
  const path = r.path ?? null
  if (assetId !== null && (typeof assetId !== 'string' || !UUID.test(assetId))) return null
  if (photoId !== null && (typeof photoId !== 'string' || !UUID.test(photoId))) return null
  if (path !== null && (typeof path !== 'string' || path === '' || path.length > PATH_MAX)) return null
  if (assetId === null && photoId === null && path === null) return null
  return { assetId, photoId, path }
}

/** The key base a stored path alone could belong to, on this site, or null. */
function baseOfPath(path: string, tenantId: string): string | null {
  if (isSamplePhoto(path)) return null
  const parsed = parseLegacyKey(path)
  if (!parsed.ok || parsed.shape === 'base' || parsed.shape === 'original') return null
  if (parsed.prefixTenant !== null && parsed.prefixTenant !== tenantId) return null
  return parsed.keyBase
}

/**
 * The photographs a slot already holds, positionally — `null` for one that
 * cannot be found as this site's: no such row, another site's, an identity
 * and a path that name two different photographs, a path that is no file of
 * any one photograph, two candidates for one path. Never a fallback to the
 * raw path.
 *
 *   sample path          a built-in sample (with its gallery row, if named);
 *                        an asset id beside a sample is a contradiction
 *   photo id             that gallery row of this site; a path or asset id
 *                        given beside it must be the row's own
 *   asset id (+ path)    that asset of this site; the path one of its files
 *   path alone           the projection's identity rules — the key's folder
 *                        or the flat era's file — on this site only;
 *                        exactly one candidate, or none
 *
 * A row of this site that the proof says may not be shown (archived, deleted,
 * still processing, its files unusable — including a key naming another
 * site's album) comes back marked unavailable with the reason, carrying only
 * the path the caller sent.
 */
export async function resolveRefs(db: LibraryDb, tenantId: string, raw: unknown): Promise<Array<LibraryItem | null>> {
  if (!Array.isArray(raw) || raw.length > RESOLVE_MAX) throw new LibraryError('Too many photographs to look up at once.')
  const refs = raw.map(readRef)

  const photoIds = [...new Set(refs.flatMap((r) => (r?.photoId ? [r.photoId] : [])))]
  const photos = new Map<string, Record<string, unknown>>()
  if (photoIds.length) {
    for (const p of await rows(db.from('photos').select(PHOTO_COLUMNS).eq('tenant_id', tenantId).in('id', photoIds))) {
      if (p.tenant_id === tenantId && typeof p.id === 'string') photos.set(p.id, p)
    }
  }

  const ids = new Set<string>()
  for (const r of refs) if (r?.assetId) ids.add(r.assetId)
  for (const p of photos.values()) if (typeof p.asset_id === 'string' && UUID.test(p.asset_id)) ids.add(p.asset_id)

  // Path-only references: the key base each could belong to.
  const bases = new Map<number, string>()
  refs.forEach((r, i) => {
    if (!r || r.assetId || r.photoId || !r.path) return
    const base = baseOfPath(r.path, tenantId)
    if (base) bases.set(i, base)
  })
  const allBases = [...new Set(bases.values())]

  const [byIdClaims, byBaseRows] = await Promise.all([
    claimsById(db, tenantId, [...ids]),
    allBases.length
      ? rows(db.from('photo_assets').select(ASSET_COLUMNS).eq('tenant_id', tenantId).in('key_base', allBases))
      : Promise.resolve([] as Record<string, unknown>[]),
  ])
  const byBase = byBaseRows.map((r) => readClaim(r, tenantId)).filter((c): c is Claimed => c !== null)

  // One proof for every row this resolve could use.
  const claims = new Map<string, Claimed>()
  for (const c of [...byIdClaims, ...byBase]) claims.set(c.id, c)
  const proven = await prove(db, tenantId, [...claims.values()])

  const albumIds = [...new Set([...photos.values()].map((p) => str(p.album_id)).filter((x): x is string => !!x && UUID.test(x)))]
  const titles = await albumTitles(db, tenantId, albumIds)

  return refs.map((r, i): LibraryItem | null => {
    if (!r) return null

    if (r.photoId) {
      const p = photos.get(r.photoId)
      if (!p) return null
      if (r.path !== null && r.path !== p.storage_path) return null
      if (r.assetId !== null && r.assetId !== p.asset_id) return null
      return itemFromPhoto(p, tenantId, proven, titles)
    }

    if (r.path !== null && isSamplePhoto(r.path)) return r.assetId ? null : sampleItem(r.path, null, null)

    if (r.assetId) {
      const p = proven.get(r.assetId)
      if (!p) return null
      if (p.status === 'ok' && r.path !== null && !p.files.has(r.path)) return null
      return itemFromProven(p, r.path !== null ? { path: r.path } : {})
    }

    const base = bases.get(i)
    if (!base || r.path === null) return null
    const path = r.path
    // Which row CLAIMS this file; the proof then says whether it may be shown.
    const candidates = byBase.filter((c) => c.claims.has(path))
    if (candidates.length !== 1) return null
    const p = proven.get(candidates[0]!.id)
    if (!p) return null
    if (p.status === 'ok' && !p.files.has(path)) return null
    return itemFromProven(p, { path })
  })
}

/**
 * A write's (asset, path) pairs, checked through the SAME reader and proof the
 * picker uses: each must be one photograph of this site whose files include
 * the path. A pair already stored in this place may stay while its photograph
 * is unavailable (so editing a story's words never fails on an old image); a
 * pair being newly written must be usable. Throws a photographer's sentence.
 */
export async function checkWritePairs(
  db: LibraryDb,
  tenantId: string,
  pairs: ReadonlyArray<{ assetId: string; path: string }>,
  stored: ReadonlySet<string> = new Set()
): Promise<void> {
  for (let i = 0; i < pairs.length; i += RESOLVE_MAX) {
    const slice = pairs.slice(i, i + RESOLVE_MAX)
    const found = await resolveRefs(db, tenantId, slice.map((p) => ({ assetId: p.assetId, path: p.path })))
    slice.forEach((p, k) => {
      const item = found[k]
      if (!item) throw new LibraryError('That photograph is no longer in your library. Choose it again.')
      if (item.readiness !== 'ready' && !stored.has(pairKey(p))) {
        throw new LibraryError(item.unavailableReason ?? 'That photograph can’t be used here. Choose another.')
      }
    })
  }
}

export const pairKey = (p: { assetId: string; path: string }) => `${p.assetId}|${p.path}`

/** One registered upload, read back as the picker shows it. */
export async function uploadedItem(
  db: LibraryDb,
  tenantId: string,
  assetId: string,
  origin: 'upload' | 'document'
): Promise<LibraryItem | null> {
  const p = (await provenById(db, tenantId, [assetId])).get(assetId)
  if (!p) return null
  return itemFromProven(p, {
    origin: origin === 'upload' ? { origin: 'upload', label: 'In Uploads' } : { origin: 'document', label: 'Used in a story' },
  })
}
