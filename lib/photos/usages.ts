import { createAdminClient } from '@/lib/supabase/admin'
import { extract } from '@/lib/photos/extract'

/**
 * syncUsages — THE ONE WRITER OF photo_usages
 * ═══════════════════════════════════════════
 *
 * P3 (claude/photo-migration-plan.md; the database half is
 * db/migrations/2026-09-30_photo_usages_sync.sql). `photo_usages` is a derived
 * index of where each photograph is placed: drop every row, run
 * `rebuildUsages` over a site, and it comes back identical.
 *
 * ── How a parent is projected ───────────────────────────────────────────────
 *
 *   1. `read_photo_usage_source` returns the SAVED source — never the caller's
 *      object — as the canonical text of one jsonb value;
 *   2. `extract()` (lib/photos/extract.ts) lists the document references in it;
 *   3. `sync_photo_usages` takes the parent's lock, rebuilds the source, and
 *      writes only if it still equals that text. If a newer save landed in
 *      between, it writes NOTHING and answers `stale`, and this reads again —
 *      a few times, no sleeping. An older snapshot can never overwrite the
 *      projection of a newer document.
 *
 * ── Who writes ──────────────────────────────────────────────────────────────
 *
 * The documents themselves are still written by the photographer's own
 * client, exactly as before. Only this projection uses the service role
 * (`createAdminClient()`), because only `service_role` may execute the sync
 * functions — no signed-in account can submit, clear or fabricate a usage.
 *
 * ── Failure ─────────────────────────────────────────────────────────────────
 *
 * The save has already succeeded when this runs, and it stays succeeded: no
 * rollback, no error for the photographer. A failed or non-converging sync is
 * logged with its site, scope and parent; `rebuildUsages` is the repair. There
 * is no job kind for it. None of these functions throws.
 */

export type UsageParent = 'live_page' | 'draft' | 'album' | 'post' | 'catalog_item'

type RpcResult = { data: unknown; error: { message: string } | null }

/** What syncUsages asks of the database. `createAdminClient()` is one. */
export type UsageRpc = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>
}

export type UsageDeps = {
  rpc?: UsageRpc
  log?: Pick<Console, 'warn' | 'error'>
}

/** Reads-and-syncs before giving up on a parent that keeps changing. */
export const MAX_ATTEMPTS = 3

export type SyncOutcome =
  | { ok: true; written: number; unresolved: number; malformed: number; attempts: number }
  | { ok: false; reason: 'stale' | 'error'; attempts: number; message?: string }

type SyncReply = {
  stale: boolean
  written: number
  unresolved: unknown[]
  unresolved_count: number
}

const scopeOf = (parent: UsageParent) => (parent === 'draft' ? 'draft' : 'live')

function client(deps: UsageDeps): UsageRpc {
  return deps.rpc ?? (createAdminClient() as unknown as UsageRpc)
}

/**
 * Projects one parent's usages from its saved state. `key` is the page key
 * (live_page), the album, story or the catalogue entry's PHOTOGRAPH id, and
 * null for the draft (the whole site's draft is one document).
 */
export async function syncUsages(
  tenantId: string,
  parent: UsageParent,
  key: string | null,
  deps: UsageDeps = {}
): Promise<SyncOutcome> {
  const log = deps.log ?? console
  const where = { tenant: tenantId, scope: scopeOf(parent), parent, key }
  let attempts = 0
  try {
    const db = client(deps)
    while (attempts < MAX_ATTEMPTS) {
      attempts++
      const args = { p_tenant: tenantId, p_parent: parent, p_key: key }
      const read = await db.rpc('read_photo_usage_source', args)
      if (read.error || typeof read.data !== 'string') {
        const message = read.error?.message ?? 'no source came back'
        log.error('[usages] could not read the source', { ...where, error: message })
        return { ok: false, reason: 'error', attempts, message }
      }

      const { refs, malformed } = extract(JSON.parse(read.data))
      const sync = await db.rpc('sync_photo_usages', {
        ...args,
        p_source_snapshot: read.data,
        p_refs: refs,
      })
      if (sync.error) {
        log.error('[usages] sync failed', { ...where, error: sync.error.message })
        return { ok: false, reason: 'error', attempts, message: sync.error.message }
      }

      const reply = sync.data as SyncReply
      if (reply.stale) continue

      if (reply.unresolved_count > 0 || malformed > 0) {
        log.warn('[usages] unresolved references skipped', {
          ...where,
          unresolved: reply.unresolved_count,
          malformed,
          sample: reply.unresolved.slice(0, 5),
        })
      }
      return { ok: true, written: reply.written, unresolved: reply.unresolved_count, malformed, attempts }
    }
    log.error('[usages] the source kept changing; left for rebuildUsages', { ...where, attempts })
    return { ok: false, reason: 'stale', attempts }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log.error('[usages] sync failed', { ...where, error: message })
    return { ok: false, reason: 'error', attempts, message }
  }
}

// ── The parents, by name ─────────────────────────────────────────────────────

export const syncLivePage = (tenantId: string, pageKey: string, deps?: UsageDeps) =>
  syncUsages(tenantId, 'live_page', pageKey, deps)

export const syncDraft = (tenantId: string, deps?: UsageDeps) =>
  syncUsages(tenantId, 'draft', null, deps)

export const syncAlbum = (tenantId: string, albumId: string, deps?: UsageDeps) =>
  syncUsages(tenantId, 'album', albumId, deps)

export const syncPost = (tenantId: string, postId: string, deps?: UsageDeps) =>
  syncUsages(tenantId, 'post', postId, deps)

/** A catalogue entry, named by its photograph (catalog_items.photo_id is unique). */
export const syncCatalogItem = (tenantId: string, photoId: string, deps?: UsageDeps) =>
  syncUsages(tenantId, 'catalog_item', photoId, deps)

type Parents = { albums: string[]; posts: string[]; catalog_items: string[]; pages: string[] }

async function parentsOf(tenantId: string, deps: UsageDeps): Promise<Parents | null> {
  const log = deps.log ?? console
  try {
    const { data, error } = await client(deps).rpc('list_photo_usage_parents', { p_tenant: tenantId })
    if (error) throw new Error(error.message)
    return data as Parents
  } catch (e) {
    log.error('[usages] could not list the parents', { tenant: tenantId, error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/**
 * Every live page that could hold a usage — any page a source names, and any
 * page that still holds one. For a change that may touch many pages at once:
 * the share images, which live in one settings value for every page.
 */
export async function syncLivePages(tenantId: string, deps: UsageDeps = {}): Promise<void> {
  const parents = await parentsOf(tenantId, deps)
  for (const page of parents?.pages ?? []) await syncLivePage(tenantId, page, deps)
}

export type RebuildReport = { parents: number; failed: number; written: number; unresolved: number }

/**
 * THE REPAIR PATH, and the invariant's other half: every parent of the site,
 * all eight kinds — gallery rows from `photos.asset_id` included. Replacing
 * per parent, so it is safe to run on a live site at any time.
 */
export async function rebuildUsages(tenantId: string, deps: UsageDeps = {}): Promise<RebuildReport> {
  const report: RebuildReport = { parents: 0, failed: 0, written: 0, unresolved: 0 }
  const parents = await parentsOf(tenantId, deps)
  if (!parents) return { ...report, failed: 1 }

  const jobs: [UsageParent, string | null][] = [
    ...parents.albums.map((id): [UsageParent, string] => ['album', id]),
    ...parents.posts.map((id): [UsageParent, string] => ['post', id]),
    ...parents.catalog_items.map((id): [UsageParent, string] => ['catalog_item', id]),
    ...parents.pages.map((key): [UsageParent, string] => ['live_page', key]),
    ['draft', null],
  ]
  for (const [parent, key] of jobs) {
    const r = await syncUsages(tenantId, parent, key, deps)
    report.parents++
    if (r.ok) {
      report.written += r.written
      report.unresolved += r.unresolved
    } else {
      report.failed++
    }
  }
  return report
}

// ── For patchSiteSettings ────────────────────────────────────────────────────

/** The legacy site_settings columns that hold a page's photograph. */
export const LEGACY_IMAGE_COLUMNS: Record<string, 'home' | 'about'> = {
  hero_image_path: 'home',
  intro_image_path: 'home',
  contact_image_path: 'home',
  about_image_path: 'about',
}

/**
 * After a settings write: re-project the pages whose photographic sources it
 * could have changed — the legacy columns' page, and every page when the
 * share images (`page_seo`) were written.
 */
export async function syncAfterSettings(
  tenantId: string,
  written: Record<string, unknown>,
  deps: UsageDeps = {}
): Promise<void> {
  if ('page_seo' in written) {
    await syncLivePages(tenantId, deps)
    return
  }
  const pages = new Set<string>()
  for (const column of Object.keys(written)) {
    const page = LEGACY_IMAGE_COLUMNS[column]
    if (page) pages.add(page)
  }
  for (const page of pages) await syncLivePage(tenantId, page, deps)
}
