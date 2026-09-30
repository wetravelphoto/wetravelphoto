import { randomUUID } from 'crypto'
import { tenantKey } from '@/lib/storage-keys'

/**
 * THE KEY OF A NEW UPLOAD
 * ═══════════════════════
 *
 * One upload is one key base; its original (when kept) is
 * `<base>/original.<ext>` and its sizes are `<base>/<size>.webp`. These are
 * the four shapes the routes mint today, and exactly the shapes the P2
 * database wrappers accept — `.mk/ingest.ts` holds the two together. Legacy
 * shapes (pre-prefix keys, extensionless bases from the old backfill) are P4's
 * business, not this file's.
 */

export type IngestRoute = 'gallery' | 'site' | 'journal' | 'cover'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The folder each route's uploads live in, under the site's own prefix. */
export function routePrefix(route: IngestRoute, tenantId: string, albumId?: string): string {
  switch (route) {
    case 'gallery':
      return `${tenantKey(tenantId, `photos/${albumId}`)}/`
    case 'site':
      return `${tenantKey(tenantId, 'site-images')}/`
    case 'journal':
      return `${tenantKey(tenantId, 'journal')}/`
    case 'cover':
      return `${tenantKey(tenantId, `covers/${albumId}`)}/`
  }
}

/** Whether `keyBase` is exactly a base this route mints for this site (and album). */
export function isRouteKeyBase(
  route: IngestRoute,
  tenantId: string,
  keyBase: string,
  albumId?: string
): boolean {
  if ((route === 'gallery' || route === 'cover') && !albumId) return false
  const prefix = routePrefix(route, tenantId, albumId)
  return keyBase.startsWith(prefix) && UUID.test(keyBase.slice(prefix.length))
}

/** A fresh key base for a custom cover — the one route that mints its own. */
export function newCoverKeyBase(tenantId: string, albumId: string): string {
  return `${routePrefix('cover', tenantId, albumId)}${randomUUID()}`
}

const ORIGINAL_EXTENSIONS = ['jpg', 'png', 'webp', 'tif', 'avif'] as const

/** Whether `key` is this base's original, as `/api/upload-url` names it. */
export function isOriginalOf(keyBase: string, key: string): boolean {
  const head = `${keyBase}/original.`
  return key.startsWith(head) && (ORIGINAL_EXTENSIONS as readonly string[]).includes(key.slice(head.length))
}
