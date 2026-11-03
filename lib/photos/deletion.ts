import { ownsKey } from '@/lib/storage-keys'
import { isSamplePhoto } from '@/lib/images'
import type { createClient } from '@/lib/supabase/server'

/**
 * WHAT REMOVING A PHOTOGRAPH OR A GALLERY LEAVES BEHIND — report only
 * ═══════════════════════════════════════════════════════════════════
 *
 * P6, the retention-first interim milestone (claude/photo-migration-plan.md,
 * P6; gate P6-20261020-deletion-safety-01). Removing a photograph from a
 * gallery, or a whole gallery, deletes MEMBERSHIP rows only. No storage object
 * is deleted by a request — not an original, a display size, a custom cover or
 * a video — and no asset's lifecycle is written. Physical cleanup needs its own
 * race-safe protocol and its own approval; until then every file is RETAINED.
 *
 * This module says, for the files a removal leaves behind, what is known about
 * them. It never says a file may be deleted: there is no such status, and
 * `cleanupAllowed` is the literal `false`.
 *
 *   referenced  another canonical source of THIS site names the file
 *   retained    complete evidence found no other reference; kept anyway by
 *               the interim policy (and frozen history was not read)
 *   unknown     the evidence is incomplete, or the path is not provably this
 *               site's (legacy, foreign, malformed), so other sites — which
 *               this read cannot see — may name it
 *
 * THE EVIDENCE is read fresh, as the photographer, from the canonical rows —
 * never from photo_usages, which a failed sync can leave stale (P3). Every
 * read names the site, is paged under a hard bound, and is checked against
 * PostgREST's exact count: an error, an over-limit table, a missing or
 * disagreeing count, a row of another site, a row that does not have its
 * column's shape (`SHAPES`), or the same row twice makes that source
 * INCOMPLETE. Evidence is complete only when every source in `SOURCES` was
 * read exactly once and whole. Incomplete evidence is never read as "no
 * references".
 *
 * The seven reads are separate requests, each paged: what they return is a
 * set of OBSERVATIONS, not an atomic snapshot. They decide whether a removal
 * may go ahead and what `kept` reports; they never authorise a purge.
 *
 * Matching walks every string value of a row (`namesFile`), whatever its key:
 * a hidden section, a phone twin, a background, a video poster or any key
 * added later is scanned. A structured value names a file only if it IS the
 * path (`photo.webp` is not named by `photo.webp.other`). Free text — rich
 * text, a URL, a srcset — names it where the path appears with nothing
 * path-like on either side; a '/' is allowed before it (a URL's base), so an
 * unprefixed legacy key can be over-matched inside a longer key there. A
 * percent-encoded path is not recognised.
 *
 * Not read (`NOT_READ`): frozen history (versions, undo steps, look history),
 * room scenes, Instagram, other sites. Catalogue entries and products name a
 * photograph by id, not by file, and go with its membership by cascade.
 *
 * ── WHY THE HISTORY SOURCES ARE DECLARED HERE AND READ SOMEWHERE ELSE ───────
 *
 * `HISTORY_SOURCES` and their shapes live in this file so that paging, shape
 * checking and path matching have ONE implementation — two copies of this
 * logic drifting apart is the failure class this project has paid for most.
 * They are NOT in `SOURCES`, so nothing about this report changes: `assess()`
 * still requires exactly the seven canonical sources and still reports
 * anything else as `unexpected_source`.
 *
 * They exist for `lib/photos/sweep.ts`, which has a different question to
 * answer. Blocking a gallery removal because a year-old version snapshot
 * names a file would be wrong — a removal is about membership. PURGING that
 * file is a different act: version history keeps the newest 60 publishes and
 * 50 undo steps, each a snapshot carrying section settings with image paths
 * in them, and restoring one makes it the draft. So a purge has to read
 * history or a later restore becomes a page with silent holes in it, and no
 * grace period can cover that because history is bounded by COUNT, not time.
 *
 * `cleanupAllowed` here is still the literal `false`. The sweeper owns its own
 * decision; it does not call `assess()` and cannot widen this one.
 */

export type DeletionDb = Awaited<ReturnType<typeof createClient>>

type PageAnswer = { data: unknown; error: { message: string } | null; count: number | null }
type PageQuery = (from: number, to: number) => PromiseLike<PageAnswer>
export type Row = Record<string, unknown>

/** Rows asked for per page — below PostgREST's usual max-rows, and checked against the count anyway. */
export const PAGE_ROWS = 500
/** The most rows one source may hold before the evidence is refused as over the limit. */
export const MAX_SOURCE_ROWS = 10_000

export type SourceName =
  | 'photos'
  | 'albums'
  | 'site_images'
  | 'blog_posts'
  | 'page_sections'
  | 'site_draft'
  | 'site_settings'
  | 'site_versions'
  | 'site_draft_steps'
  | 'site_template_history'

/**
 * Every source complete evidence needs, each exactly once.
 *
 * DELIBERATELY STILL SEVEN. The three history sources below are not here, so
 * `assess()` neither requires them nor accepts them — see the header.
 */
export const SOURCES: readonly SourceName[] = [
  'photos',
  'albums',
  'site_images',
  'blog_posts',
  'page_sections',
  'site_draft',
  'site_settings',
]

/**
 * Frozen history. Read by the sweeper only, which may not purge a file any of
 * these names. Listed in `NOT_READ` for this report, which does not read them.
 */
export const HISTORY_SOURCES: readonly SourceName[] = [
  'site_versions',
  'site_draft_steps',
  'site_template_history',
]

export type IncompleteReason =
  | 'error'
  | 'count_unknown'
  | 'over_limit'
  | 'count_mismatch'
  | 'malformed'
  | 'foreign_row'
  | 'duplicate_row'
  | 'invalid_limit'
  | 'absent'
  | 'duplicate_source'
  | 'unexpected_source'

export type SourceRead =
  | { source: SourceName; complete: true; rows: Row[] }
  | { source: SourceName; complete: false; reason: IncompleteReason }

export type Evidence = { tenantId: string; sources: SourceRead[] }

export const NOT_READ: readonly string[] = [
  'site_versions, site_draft_steps and site_template_history (frozen history)',
  'room_scenes and instagram_media',
  'other sites (an unprefixed legacy path may be named there)',
  'photo_usages (a projection, possibly stale; never evidence here)',
]

const isRecord = (v: unknown): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * The shape each selected column must have, from db/schema-2026-09.sql. Only
 * what is read here, and only as narrow as the column: a nullable column may be
 * null, a NOT NULL jsonb must be the kind its writers store. A missing column
 * is malformed. `key` is the row's identity, which must not repeat.
 */
type Kind = 'uuid' | 'int' | 'text' | 'text?' | 'object' | 'object?' | 'array' | 'json' | 'paths'
const SHAPES: Record<SourceName, { key: string; columns: Record<string, Kind> }> = {
  photos: {
    key: 'id',
    columns: { id: 'uuid', tenant_id: 'uuid', album_id: 'uuid', storage_path: 'text', original_path: 'text?', derivatives: 'paths' },
  },
  albums: { key: 'id', columns: { id: 'uuid', tenant_id: 'uuid', cover_custom_path: 'text?', cover_video_path: 'text?' } },
  site_images: {
    key: 'id',
    columns: { id: 'uuid', tenant_id: 'uuid', storage_path: 'text', original_path: 'text?', derivatives: 'paths' },
  },
  // `content` is the legacy rich-text column (NOT NULL jsonb); any non-null JSON is scanned.
  blog_posts: { key: 'id', columns: { id: 'uuid', tenant_id: 'uuid', featured_custom_path: 'text?', blocks: 'array', content: 'json' } },
  page_sections: { key: 'id', columns: { id: 'uuid', tenant_id: 'uuid', settings: 'object' } },
  site_draft: {
    key: 'tenant_id',
    columns: { tenant_id: 'uuid', pages: 'object', page_seo: 'object?', chrome: 'object?', global_styles: 'object?' },
  },
  // ── Frozen history. Each keeps whole snapshots; every string in them is
  // scanned, so the snapshot column is checked only for being the kind of
  // JSON its writers store.
  site_versions: { key: 'id', columns: { id: 'uuid', tenant_id: 'uuid', snapshot: 'object' } },
  // `id` is a bigserial here, not a uuid.
  site_draft_steps: { key: 'id', columns: { id: 'int', tenant_id: 'uuid', snapshot: 'object' } },
  site_template_history: {
    key: 'id',
    columns: { id: 'uuid', tenant_id: 'uuid', sections_before: 'array', styles_before: 'object' },
  },
  site_settings: {
    key: 'id',
    columns: {
      id: 'int',
      tenant_id: 'uuid',
      hero_image_path: 'text?',
      intro_image_path: 'text?',
      contact_image_path: 'text?',
      about_image_path: 'text?',
      logo_header_path: 'text?',
      logo_footer_path: 'text?',
      logo_bird_path: 'text?',
      favicon_path: 'text?',
      shop_wall_texture: 'text?',
      shop_frames: 'object',
      page_seo: 'object',
      global_styles: 'object',
    },
  },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fits(kind: Kind, v: unknown): boolean {
  switch (kind) {
    case 'uuid': return typeof v === 'string' && UUID.test(v)
    case 'int': return Number.isSafeInteger(v)
    case 'text': return typeof v === 'string'
    case 'text?': return v === null || typeof v === 'string'
    case 'object': return isRecord(v)
    case 'object?': return v === null || isRecord(v)
    case 'array': return Array.isArray(v)
    case 'json': return v !== null && v !== undefined
    // A derivatives map: size → file.
    case 'paths': return isRecord(v) && Object.values(v).every((p) => p === null || typeof p === 'string')
  }
}

const shaped = (source: SourceName, row: Row) =>
  Object.entries(SHAPES[source].columns).every(([col, kind]) => fits(kind, row[col]))

/** The select list, from the same declaration the rows are checked against. */
export const columnsOf = (source: SourceName) => Object.keys(SHAPES[source].columns).join(', ')

const validLimit = (n: number) => Number.isSafeInteger(n) && n > 0

/**
 * Every row of one source, or the reason it could not be read whole. Bounded:
 * at most MAX_SOURCE_ROWS rows, in pages of `pageRows`, so at most
 * MAX_SOURCE_ROWS / pageRows + 1 requests. A server that returns shorter
 * pages is followed page by page within that request budget; past it the
 * source is refused as over the limit, never returned partial. A limit that
 * is not a positive integer is refused, not normalised.
 */
export async function readSource(
  source: SourceName,
  tenantId: string,
  page: PageQuery,
  limits: { pageRows?: number; maxRows?: number } = {}
): Promise<SourceRead> {
  const pageRows = limits.pageRows ?? PAGE_ROWS
  const maxRows = limits.maxRows ?? MAX_SOURCE_ROWS
  const incomplete = (reason: IncompleteReason): SourceRead => ({ source, complete: false, reason })
  if (!validLimit(pageRows) || !validLimit(maxRows)) return incomplete('invalid_limit')
  const rows: Row[] = []
  const seen = new Set<string>()
  const key = SHAPES[source].key
  let total: number | null = null

  for (let pages = 0; pages <= Math.ceil(maxRows / pageRows); pages++) {
    let answer: PageAnswer
    try {
      answer = await page(rows.length, rows.length + pageRows - 1)
    } catch {
      return incomplete('error')
    }
    if (answer.error) return incomplete('error')
    if (typeof answer.count !== 'number' || !Number.isInteger(answer.count) || answer.count < 0) return incomplete('count_unknown')
    if (answer.count > maxRows) return incomplete('over_limit')
    if (total !== null && answer.count !== total) return incomplete('count_mismatch')
    total = answer.count
    if (!Array.isArray(answer.data)) return incomplete('malformed')
    for (const row of answer.data) {
      if (!isRecord(row)) return incomplete('malformed')
      // The query names the site; a row of another one means it did not.
      if (row.tenant_id !== tenantId) return incomplete('foreign_row')
      if (!shaped(source, row)) return incomplete('malformed')
      // Overlapping pages can reach the count while missing a row.
      const identity = String(row[key])
      if (seen.has(identity)) return incomplete('duplicate_row')
      seen.add(identity)
      rows.push(row)
    }
    if (rows.length > total) return incomplete('count_mismatch')
    if (rows.length === total) return { source, complete: true, rows }
    if (answer.data.length === 0) return incomplete('count_mismatch')
  }
  return incomplete('over_limit')
}

/**
 * Fresh evidence for one site: every canonical source that can name a
 * gallery's files. Each read is the photographer's own (RLS applies) AND names
 * the site, because a platform admin passes every policy.
 */
export async function readEvidence(db: DeletionDb, tenantId: string): Promise<Evidence> {
  const sources = await Promise.all([
    readSource('photos', tenantId, (lo, hi) =>
      db.from('photos')
        .select(columnsOf('photos'), { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('id')
        .range(lo, hi)),
    readSource('albums', tenantId, (lo, hi) =>
      db.from('albums')
        .select(columnsOf('albums'), { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('id')
        .range(lo, hi)),
    readSource('site_images', tenantId, (lo, hi) =>
      db.from('site_images')
        .select(columnsOf('site_images'), { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('id')
        .range(lo, hi)),
    readSource('blog_posts', tenantId, (lo, hi) =>
      db.from('blog_posts')
        .select(columnsOf('blog_posts'), { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('id')
        .range(lo, hi)),
    readSource('page_sections', tenantId, (lo, hi) =>
      db.from('page_sections')
        .select(columnsOf('page_sections'), { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('id')
        .range(lo, hi)),
    readSource('site_draft', tenantId, (lo, hi) =>
      db.from('site_draft')
        .select(columnsOf('site_draft'), { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('tenant_id')
        .range(lo, hi)),
    readSource('site_settings', tenantId, (lo, hi) =>
      db.from('site_settings')
        .select(columnsOf('site_settings'), { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('id')
        .range(lo, hi)),
  ])
  return { tenantId, sources }
}

// ── Candidates: the files a removal leaves behind ──────────────────────────

export type CandidateRole = 'display' | 'original' | 'derivative' | 'cover_custom' | 'cover_video'
export type Candidate = { path: string; role: CandidateRole }

/** What is being removed — its own rows are not "elsewhere". */
export type Removal = { kind: 'album'; albumId: string } | { kind: 'photo'; photoId: string }

type CandidateRead =
  | { ok: true; candidates: Candidate[]; found: boolean }
  | { ok: false; source: SourceName; reason: IncompleteReason }

const usablePath = (v: unknown) => typeof v === 'string' && v !== ''

function photoFiles(row: Row): Candidate[] | null {
  const out: Candidate[] = []
  const add = (value: unknown, role: CandidateRole): boolean => {
    if (value === null || value === undefined || value === '') return true
    if (typeof value !== 'string') return false
    if (!isSamplePhoto(value)) out.push({ path: value, role }) // the platform's file, never the bucket's
    return true
  }
  const derivatives = row.derivatives ?? {}
  if (!isRecord(derivatives)) return null
  if (!add(row.storage_path, 'display') || !add(row.original_path, 'original')) return null
  for (const value of Object.values(derivatives)) if (!add(value, 'derivative')) return null
  return out
}

/** The one complete read of a source, or why there is not exactly one. */
function only(evidence: Evidence, name: SourceName): { ok: true; rows: Row[] } | { ok: false; reason: IncompleteReason } {
  const reads = evidence.sources.filter((s) => s.source === name)
  if (reads.length === 0) return { ok: false, reason: 'absent' }
  if (reads.length > 1) return { ok: false, reason: 'duplicate_source' }
  const read = reads[0]!
  return read.complete ? { ok: true, rows: read.rows } : { ok: false, reason: read.reason }
}

/** The files the removed rows name, from the same fresh evidence. */
export function candidatesFor(evidence: Evidence, removal: Removal): CandidateRead {
  const photos = only(evidence, 'photos')
  const albums = only(evidence, 'albums')
  if (!photos.ok) return { ok: false, source: 'photos', reason: photos.reason }
  if (removal.kind === 'album' && !albums.ok) return { ok: false, source: 'albums', reason: albums.reason }

  const out: Candidate[] = []
  let found = false
  const mine = photos.rows.filter((r) => (removal.kind === 'album' ? r.album_id === removal.albumId : r.id === removal.photoId))
  for (const row of mine) {
    const files = photoFiles(row)
    if (!files) return { ok: false, source: 'photos', reason: 'malformed' }
    out.push(...files)
  }
  if (removal.kind === 'photo') found = mine.length === 1
  if (removal.kind === 'album' && albums.ok) {
    const album = albums.rows.find((r) => r.id === removal.albumId)
    found = !!album
    if (album) {
      for (const [col, role] of [['cover_custom_path', 'cover_custom'], ['cover_video_path', 'cover_video']] as const) {
        const value = album[col]
        if (value === null || value === undefined || value === '') continue
        if (typeof value !== 'string') return { ok: false, source: 'albums', reason: 'malformed' }
        if (!isSamplePhoto(value)) out.push({ path: value, role })
      }
    }
  }
  const byPath = new Map<string, Candidate>()
  for (const c of out) if (usablePath(c.path) && !byPath.has(c.path)) byPath.set(c.path, c)
  return { ok: true, found, candidates: [...byPath.values()] }
}

// ── The assessment ─────────────────────────────────────────────────────────

export type CandidateStatus = 'referenced' | 'retained' | 'unknown'

export type CandidateReport = Candidate & {
  status: CandidateStatus
  /** Which sources (and rows) name it, e.g. `page_sections:<id>`. */
  referencedBy: string[]
  /** Physical cleanup is not something this report can grant. */
  cleanup: 'blocked'
  why?: 'evidence_incomplete' | 'not_provably_this_sites'
}

export type Assessment = {
  tenantId: string
  complete: boolean
  incomplete: Array<{ source: SourceName; reason: IncompleteReason }>
  candidates: CandidateReport[]
  counts: Record<CandidateStatus, number>
  cleanupAllowed: false
  notRead: readonly string[]
}

/** Every string value of a row that can name a file: all but its identity, at any depth. */
export function stringLeaves(row: Row): string[] {
  const out: string[] = []
  const stack: unknown[] = Object.entries(row)
    .filter(([k]) => k !== 'id' && k !== 'tenant_id' && k !== 'album_id')
    .map(([, v]) => v)
  while (stack.length) {
    const v = stack.pop()
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) stack.push(...v)
    else if (isRecord(v)) stack.push(...Object.values(v))
  }
  return out
}

/** Free text — markup, a URL, a srcset — rather than one stored path. */
const FREE_TEXT = /[\s<>"'?#]|:\/\//
const PATH_BEFORE = /[A-Za-z0-9_.-]/
const PATH_AFTER = /[A-Za-z0-9_./-]/

/**
 * Does this stored string name exactly this file? A structured value must BE
 * the path (a leading '/' allowed); free text must contain it with nothing
 * path-like either side. See the header for what that does not recognise.
 */
export function namesFile(leaf: string, path: string): boolean {
  if (path === '') return false
  if (leaf === path || leaf === `/${path}`) return true
  if (!FREE_TEXT.test(leaf)) return false
  for (let i = leaf.indexOf(path); i >= 0; i = leaf.indexOf(path, i + 1)) {
    const before = i > 0 ? leaf[i - 1]! : ''
    const after = leaf[i + path.length] ?? ''
    if (!(before && PATH_BEFORE.test(before)) && !(after && PATH_AFTER.test(after))) return true
  }
  return false
}

/**
 * Pure. For each candidate: who else names it, and what that means — never
 * that it may be deleted. Complete only if every source in SOURCES was read
 * exactly once and whole; an absent, repeated or unexpected source is
 * reported as incomplete.
 */
export function assess(evidence: Evidence, candidates: readonly Candidate[], removal: Removal): Assessment {
  const incomplete: Array<{ source: SourceName; reason: IncompleteReason }> = []
  for (const name of SOURCES) {
    const read = only(evidence, name)
    if (!read.ok) incomplete.push({ source: name, reason: read.reason })
  }
  for (const s of evidence.sources) {
    if (!SOURCES.includes(s.source)) incomplete.push({ source: s.source, reason: 'unexpected_source' })
  }
  const complete = incomplete.length === 0

  const self = (source: SourceName, row: Row) =>
    (source === 'photos' && (removal.kind === 'album' ? row.album_id === removal.albumId : row.id === removal.photoId)) ||
    (source === 'albums' && removal.kind === 'album' && row.id === removal.albumId)

  const texts: Array<{ where: string; leaves: string[] }> = []
  for (const s of evidence.sources) {
    if (!s.complete) continue
    for (const row of s.rows) {
      if (self(s.source, row)) continue
      texts.push({ where: `${s.source}:${String(row.id ?? row.tenant_id)}`, leaves: stringLeaves(row) })
    }
  }

  const reports: CandidateReport[] = candidates.map((c) => {
    const referencedBy = texts.filter((t) => t.leaves.some((l) => namesFile(l, c.path))).map((t) => t.where)
    if (referencedBy.length > 0) return { ...c, status: 'referenced', referencedBy, cleanup: 'blocked' }
    if (!complete) return { ...c, status: 'unknown', referencedBy, cleanup: 'blocked', why: 'evidence_incomplete' }
    if (!ownsKey(evidence.tenantId, c.path)) return { ...c, status: 'unknown', referencedBy, cleanup: 'blocked', why: 'not_provably_this_sites' }
    return { ...c, status: 'retained', referencedBy, cleanup: 'blocked' }
  })

  const counts: Record<CandidateStatus, number> = { referenced: 0, retained: 0, unknown: 0 }
  for (const r of reports) counts[r.status]++
  return { tenantId: evidence.tenantId, complete, incomplete, candidates: reports, counts, cleanupAllowed: false, notRead: NOT_READ }
}

/**
 * Read fresh evidence and assess one removal. Report only: it writes nothing,
 * and is what `deleteAlbum` consults BEFORE it removes anything.
 */
export async function assessRemoval(
  db: DeletionDb,
  tenantId: string,
  removal: Removal
): Promise<{ found: boolean | null; assessment: Assessment }> {
  const evidence = await readEvidence(db, tenantId)
  const read = candidatesFor(evidence, removal)
  if (!read.ok) {
    // The removed rows themselves could not be read whole: nothing is known.
    const sources = evidence.sources.map((s): SourceRead =>
      s.source === read.source ? { source: s.source, complete: false, reason: read.reason } : s)
    return { found: null, assessment: assess({ tenantId, sources }, [], removal) }
  }
  return { found: read.found, assessment: assess(evidence, read.candidates, removal) }
}
