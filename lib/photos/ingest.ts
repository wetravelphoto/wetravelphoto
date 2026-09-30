import { createHash } from 'crypto'
import sharp, { type Metadata } from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'

import { processExistingOriginal } from '@/lib/derivatives'
import { readCapture, type Capture } from '@/lib/photos/exif'
import { isOriginalOf, isRouteKeyBase, type IngestRoute } from '@/lib/photos/key-base'
import { r2Storage, recording, type PhotoStorage } from '@/lib/photos/storage'

/**
 * ONE WAY IN FOR A PHOTOGRAPH
 * ═══════════════════════════
 *
 * P2 (claude/photo-assets-design.md §9, claude/photo-migration-plan.md P2).
 * The four upload routes — a gallery photograph, a photograph uploaded from
 * the editor's picker, a journal image, a custom gallery cover — all end here,
 * and every photograph that comes through becomes exactly one row in
 * `photo_assets`, written in the same database transaction as the route's own
 * row.
 *
 *   1. The key is checked BEFORE anything is read: it must be exactly a base
 *      this route mints for this site. A built-in sample (`/samples/…`) or
 *      another site's upload never gets as far as a read.
 *   2. The source bytes: read back from storage (A–C), or the form's own
 *      bytes (D, which never uploads an original).
 *   3. What the server measures from those bytes — the SHA-256, the byte
 *      count, the format — rather than anything the browser claimed.
 *   4. The normalised capture metadata (lib/photos/exif.ts); latitude and
 *      longitude for a gallery upload only.
 *   5. The display ladder, through a storage that records every key written.
 *   6. The route's database function, through the photographer's own client.
 *
 * ── When it fails ────────────────────────────────────────────────────────────
 *
 * A successful upload INCLUDES a successful registration. When anything after
 * the key check fails, the attempt is cleaned up — but only after asking the
 * database whether a committed asset already owns this key. If one does (the
 * function committed and its reply was lost, or a concurrent retry won),
 * nothing is deleted: those objects belong to a real photograph. Otherwise the
 * objects THIS attempt created are deleted, best-effort — the sizes it wrote
 * and, for a signed upload, its original — and anything that could not be
 * deleted is logged with the site, the route and every key left behind. There
 * is no sweeper in P2.
 */

export type IngestInput =
  | { route: 'gallery'; tenantId: string; albumId: string; keyBase: string; sourceKey: string }
  | { route: 'site'; tenantId: string; keyBase: string; sourceKey: string; filename?: string | null }
  | { route: 'journal'; tenantId: string; keyBase: string; sourceKey: string }
  | {
      route: 'cover'
      tenantId: string
      albumId: string
      keyBase: string
      bytes: Buffer
      filename?: string | null
    }

export type IngestResult = {
  assetId: string
  displayPath: string
  /** Route A: the gallery membership row. */
  photoId?: string
  /** Route B: the Uploads row. */
  siteImageId?: string
}

export type IngestFailure = 'ownership' | 'unreadable' | 'processing' | 'registration'

export class IngestError extends Error {
  readonly reason: IngestFailure
  constructor(reason: IngestFailure, message: string) {
    super(message)
    this.name = 'IngestError'
    this.reason = reason
  }
}

type DbError = { message: string; code?: string } | null

/**
 * The two things ingestion asks of the database. `fromSupabase` builds them
 * from the photographer's own client; `.mk/ingest.ts` builds them over a real
 * Postgres, as the real roles.
 */
export type IngestDb = {
  /** Calls one of the four register_* functions. */
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>
  /**
   * Whether a committed asset exists for this upload, or null when the
   * database could not be asked. Read through the caller's own SELECT.
   */
  assetExists(tenantId: string, keyBase: string): Promise<boolean | null>
}

export function fromSupabase(client: SupabaseClient): IngestDb {
  return {
    rpc: (fn, args) => client.rpc(fn, args),
    async assetExists(tenantId, keyBase) {
      try {
        const { data, error } = await client
          .from('photo_assets')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('key_base', keyBase)
          .maybeSingle()
        if (error) return null
        return data !== null
      } catch {
        return null
      }
    },
  }
}

export type IngestDeps = {
  db: IngestDb
  storage?: PhotoStorage
  log?: (message: string, detail: Record<string, unknown>) => void
}

const FUNCTION: Record<IngestRoute, string> = {
  gallery: 'register_gallery_photo',
  site: 'register_site_image',
  journal: 'register_journal_image',
  cover: 'register_album_cover',
}

/** What the file really is, from the pixels — never the browser's word. */
export function contentTypeOf(format: string | undefined, compression?: string): string | null {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'tiff':
      return 'image/tiff'
    case 'heif':
      // sharp reports AVIF as HEIF compressed with AV1.
      return compression === 'av1' ? 'image/avif' : 'image/heif'
    default:
      // Readable, but not one of the upload types (a cover can be anything
      // sharp can read). Recorded as unknown rather than guessed.
      return null
  }
}

/**
 * The five image types /api/upload-url accepts. The three signed-upload
 * routes (gallery, site, journal) must be EXACTLY one of these, as identified
 * from the bytes — HEIF is recognised but is not an upload type, and an
 * unrecognised format is not either.
 */
export const SIGNED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif'] as const

/**
 * Whether a route may register a file of this (server-detected) type. A custom
 * cover, which arrives in the form and could always be anything sharp decodes,
 * stays as permissive as it was before P2: HEIF, or unrecognised (NULL).
 */
export function acceptsContentType(route: IngestRoute, contentType: string | null): boolean {
  if (route === 'cover') return true
  return contentType !== null && (SIGNED_UPLOAD_TYPES as readonly string[]).includes(contentType)
}

/** A file name as a label: the last path segment, plain characters, ≤ 120. */
export function normalizeFilename(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null
  const base = name.split(/[\\/]/).pop() ?? ''
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120).trim()
  return clean === '' ? null : clean
}

function captureArgs(capture: Capture): Record<string, unknown> {
  return {
    p_taken_at: capture.taken_at,
    p_camera_make: capture.camera_make,
    p_camera_model: capture.camera_model,
    p_lens: capture.lens,
    p_iso: capture.iso,
    p_aperture: capture.aperture,
    p_shutter: capture.shutter,
    p_focal_length: capture.focal_length,
    p_keywords: capture.keywords,
    p_exif: capture.exif,
  }
}

/** The first row of a set-returning function, or the scalar a scalar one returns. */
function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : null
}

export async function ingestPhoto(input: IngestInput, deps: IngestDeps): Promise<IngestResult> {
  const { route, tenantId, keyBase } = input
  const albumId = 'albumId' in input ? input.albumId : undefined
  const sourceKey = 'sourceKey' in input ? input.sourceKey : null
  const log = deps.log ?? ((message, detail) => console.error(`[ingest] ${message}`, detail))

  // ── 1. The key, before anything is read ──────────────────────────────────
  if (!isRouteKeyBase(route, tenantId, keyBase, albumId)) {
    throw new IngestError('ownership', 'That upload does not belong to this site.')
  }
  if (sourceKey !== null && !isOriginalOf(keyBase, sourceKey)) {
    throw new IngestError('ownership', 'That upload does not belong to this site.')
  }

  const storage = recording(deps.storage ?? r2Storage)

  const fail = async (reason: IngestFailure, message: string): Promise<never> => {
    const created = [...storage.written, ...(sourceKey ? [sourceKey] : [])]
    const committed = await deps.db.assetExists(tenantId, keyBase).catch(() => null)
    if (committed === true) {
      // A real photograph owns these objects. Leave every one of them.
    } else if (committed === null) {
      log('could not tell whether the upload was registered, so nothing was cleaned up', {
        tenantId, route, keyBase, left: created,
      })
    } else if (created.length > 0) {
      const left = await storage.remove(created)
      if (left.length > 0) {
        log('cleanup after a failed upload could not delete every object', {
          tenantId, route, keyBase, left,
        })
      }
    }
    throw new IngestError(reason, message)
  }

  // ── 2. The source bytes ──────────────────────────────────────────────────
  let bytes: Buffer | null
  if (input.route === 'cover') {
    bytes = input.bytes.byteLength > 0 ? input.bytes : null
  } else {
    try {
      bytes = await storage.read(input.sourceKey)
    } catch {
      bytes = null
    }
  }
  // Through the same checked cleanup as every other failure: the original the
  // browser uploaded for this attempt may exist but be empty, or the read may
  // have failed on the way — and a committed asset may already own this key
  // (a retry of an upload that did register).
  if (!bytes) return fail('unreadable', 'The upload could not be read back.')

  // ── 3. What the server measures ──────────────────────────────────────────
  const contentSha256 = createHash('sha256').update(bytes).digest('hex')
  const originalBytes = bytes.byteLength

  let format: Metadata
  try {
    format = await sharp(bytes, { failOn: 'none' }).metadata()
  } catch {
    return fail('processing', 'That file could not be read as a photograph.')
  }
  if (!(format.width && format.width > 0 && format.height && format.height > 0)) {
    return fail('processing', 'That file could not be read as a photograph.')
  }

  // The database enforces the same rule per route (acceptsContentType); this
  // fails before anything is written.
  const contentType = contentTypeOf(format.format, format.compression)
  if (!acceptsContentType(route, contentType)) {
    return fail('processing', 'That file is not a supported image type.')
  }

  // ── 4. The normalised capture ─────────────────────────────────────────────
  const capture = await readCapture(bytes, { gps: route === 'gallery' })

  // ── 5. The ladder ─────────────────────────────────────────────────────────
  let processed: Awaited<ReturnType<typeof processExistingOriginal>>
  try {
    processed = await processExistingOriginal(bytes, keyBase, sourceKey ?? keyBase, storage)
  } catch {
    return fail('processing', 'The display sizes could not be made.')
  }
  if (!(processed.width > 0 && processed.height > 0)) {
    return fail('processing', 'That file could not be read as a photograph.')
  }

  // ── 6. The route's database function ─────────────────────────────────────
  const facts: Record<string, unknown> = {
    p_tenant: tenantId,
    p_key_base: keyBase,
    p_display_path: processed.displayPath,
    p_derivatives: processed.derivatives,
    p_width: processed.width,
    p_height: processed.height,
    p_original_bytes: originalBytes,
    p_content_sha256: contentSha256,
    p_content_type: contentType,
    ...captureArgs(capture),
  }
  if (input.route !== 'cover') facts.p_original_path = input.sourceKey
  if (input.route === 'gallery' || input.route === 'cover') facts.p_album = input.albumId
  if (input.route === 'site' || input.route === 'cover') facts.p_filename = normalizeFilename(input.filename)
  if (input.route === 'gallery') {
    facts.p_latitude = capture.latitude
    facts.p_longitude = capture.longitude
  }

  let data: unknown
  try {
    const result = await deps.db.rpc(FUNCTION[route], facts)
    if (result.error) return fail('registration', result.error.message || 'The photograph could not be recorded.')
    data = result.data
  } catch (e) {
    return fail('registration', e instanceof Error ? e.message : 'The photograph could not be recorded.')
  }

  if (route === 'gallery' || route === 'site') {
    const row = firstRow(data)
    const assetId = typeof row?.asset_id === 'string' ? row.asset_id : null
    const relation = route === 'gallery' ? row?.photo_id : row?.site_image_id
    if (!assetId || typeof relation !== 'string') {
      return fail('registration', 'The photograph could not be recorded.')
    }
    return route === 'gallery'
      ? { assetId, displayPath: processed.displayPath, photoId: relation }
      : { assetId, displayPath: processed.displayPath, siteImageId: relation }
  }

  if (typeof data !== 'string') return fail('registration', 'The photograph could not be recorded.')
  return { assetId: data, displayPath: processed.displayPath }
}
