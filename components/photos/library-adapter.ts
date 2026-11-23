import { imageSrc } from '@/lib/images'
import {
  forgetSiteImage,
  listLibraryItems,
  listLibrarySources,
  registerSiteImage,
  resolveLibraryItems,
  type LibraryReply,
} from '@/app/actions/images'
import { registerJournalImage } from '@/app/actions/blog'
import type { LibraryItem, LibrarySource } from '@/lib/photos/library'
import type { PickerAdapter, PickerCurrent, PickerItem, PickerSource } from '@/lib/photos/picker-state'

/**
 * THE EDITOR'S LIBRARY, AS THE PICKER'S ADAPTER
 * ═════════════════════════════════════════════
 *
 * One adapter for every editor picker — a section's photograph, a page's
 * share image, a story's images and featured image, a gallery's chosen cover
 * — over the server actions in app/actions/images.ts. The picker
 * (components/photos/AssetPicker.tsx) imports no action; the wrapper hands it
 * one of these, made for what its slot may do.
 *
 * ── Uploads ─────────────────────────────────────────────────────────────────
 * The P2 path unchanged: sign (`/api/upload-url`), PUT straight to R2,
 * register (the route's server action), and only then is the photograph a
 * choice. What this adds is a RETRY that reuses what already happened. Each
 * file the picker hands over has a stable `uploadId`; this adapter keeps, per
 * id, the signed key and whether the file reached storage:
 *
 *   · the signing request failed or timed out   → sign again
 *   · the PUT failed                            → PUT again to the SAME key,
 *                                                  while its link is still good
 *   · the link expired before the PUT finished  → sign again: a NEW key (the
 *                                                  route mints the key; it is
 *                                                  never asked to re-sign an old
 *                                                  one — see the limitation below)
 *   · registration's answer was lost            → register the SAME key again:
 *                                                  the database function reuses
 *                                                  the asset it committed for
 *                                                  that base
 *   · registration refused                      → the server may have cleaned
 *                                                  up the original, so the next
 *                                                  attempt PUTs it again first
 *
 * Nothing stronger is claimed. A re-signed attempt can leave the earlier
 * key's object behind unregistered (no sweeper before P6), and two
 * different files are two photographs even when their bytes match.
 *
 * Uploading never adds a photograph to a gallery: the site route files it in
 * Uploads, the journal route keeps it with the story.
 *
 * ── Galleries ───────────────────────────────────────────────────────────────
 * The server lists galleries a page at a time. The adapter reads at most
 * SOURCE_PAGES_MAX pages; if a site has more galleries than that, the rail
 * says so on "All photographs" — every photograph is still there — rather
 * than presenting a partial list as the whole.
 *
 * ── Taking a photograph out of Uploads ──────────────────────────────────────
 * `removeFromSource` (only where the caller asks for it, `manageUploads`) is
 * the existing "remove from Uploads" action: it drops the Uploads entry and
 * nothing else — the photograph stays in All photographs and on every page
 * that uses it; no file is deleted. The picker's contract
 * (`PickerAdapter.removeFromSource`, lib/photos/picker-state.ts) decides
 * where the control is offered; the server decides whether it is allowed.
 */

export type UploadRoute = 'site' | 'journal'

type RegisterReply = { ok: true; item: LibraryItem | null } | { ok: false; message: string }

/** Every way the adapter reaches the outside, replaceable in a test. */
export type LibraryIo = {
  listSources(opts: { albumIds: string[] | null; cursor: string | null }): Promise<LibraryReply<{ sources: LibrarySource[]; nextCursor: string | null }>>
  forgetUpload(assetId: string): Promise<{ ok: boolean; message: string }>
  listItems(query: unknown): Promise<LibraryReply<{ items: LibraryItem[]; nextCursor: string | null }>>
  resolve(refs: unknown): Promise<LibraryReply<Array<LibraryItem | null>>>
  sign(route: UploadRoute, contentType: string, signal: AbortSignal): Promise<{ url: string; key: string; base: string }>
  put(url: string, file: File, signal: AbortSignal, onProgress: (fraction: number | null) => void): Promise<void>
  register(route: UploadRoute, key: string, base: string, filename: string): Promise<RegisterReply>
  now(): number
}

/** Pages of galleries read for one rail (SOURCE_PAGE each on the server). */
export const SOURCE_PAGES_MAX = 5
/** Said on "All photographs" when a site has more galleries than the rail lists. */
export const MORE_GALLERIES_NOTE = 'Includes galleries not listed here'

/** A PUT link is good for ten minutes (the route's `expiresIn`); stop trusting it a minute early. */
export const SIGNED_URL_TRUST_MS = 9 * 60 * 1000
/** How long a signing request may take before it is treated as failed. */
export const SIGN_TIMEOUT_MS = 30 * 1000

class StatusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const abortError = () => new DOMException('The picker was closed.', 'AbortError')

function withTimeout(signal: AbortSignal, ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const forward = () => controller.abort()
  signal.addEventListener('abort', forward, { once: true })
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', forward)
    },
  }
}

export const browserIo: LibraryIo = {
  listSources: (opts) => listLibrarySources(opts),
  forgetUpload: (assetId) => forgetSiteImage(assetId),
  listItems: (query) => listLibraryItems(query),
  resolve: (refs) => resolveLibraryItems(refs),
  async sign(route, contentType, signal) {
    const t = withTimeout(signal, SIGN_TIMEOUT_MS)
    try {
      const res = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: route, contentType }),
        signal: t.signal,
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not start the upload.')
      if (typeof body.url !== 'string' || typeof body.key !== 'string' || typeof body.base !== 'string') {
        throw new Error('Could not start the upload.')
      }
      return { url: body.url, key: body.key, base: body.base }
    } catch (e) {
      if (signal.aborted) throw abortError()
      if (t.signal.aborted) throw new Error('Starting the upload took too long. Try again.')
      throw e
    } finally {
      t.done()
    }
  },
  put(url, file, signal, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', url)
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.upload.onprogress = (e) => onProgress(e.lengthComputable && e.total > 0 ? e.loaded / e.total : null)
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(
              new StatusError(
                xhr.status === 403 ? 'The upload link expired. Try again.' : `Storage would not take the file (${xhr.status}).`,
                xhr.status
              )
            )
      xhr.onerror = () => reject(new Error('The connection dropped during the upload. Try again.'))
      xhr.onabort = () => reject(abortError())
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
      xhr.send(file)
    })
  },
  async register(route, key, base, filename) {
    if (route === 'site') {
      const r = await registerSiteImage(key, base, filename)
      return r.ok ? { ok: true, item: r.item } : r
    }
    const r = await registerJournalImage(key, base)
    return r.ok ? { ok: true, item: r.item } : r
  },
  now: () => Date.now(),
}

/** The server's item → the picker's. Only the display URL is made here. */
export function toPickerItem(item: LibraryItem, publicUrl: string): PickerItem {
  const common = {
    path: item.path,
    displayUrl: imageSrc(publicUrl, item.thumbPath),
    width: item.width,
    height: item.height,
    orientation: item.orientation,
    title: item.title,
    canonicalAlt: item.canonicalAlt,
    caption: item.caption,
    origin: item.origin,
    originLabel: item.originLabel,
    uploadedAt: item.uploadedAt,
    membership: item.membership,
    readiness: item.readiness,
    unavailableReason: item.unavailableReason,
    camera: item.readiness === 'ready' && item.camera ? { shutter: item.camera.shutter, aperture: item.camera.aperture, iso: item.camera.iso } : null,
  }
  return item.kind === 'asset' && item.assetId ? { ...common, kind: 'asset', assetId: item.assetId } : { ...common, kind: 'sample' }
}

function unwrap<T>(reply: LibraryReply<T>, signal: AbortSignal): T {
  if (signal.aborted) throw abortError()
  if (!reply.ok) throw new Error(reply.message)
  return reply.value
}

type UploadSession = {
  signed: { url: string; key: string; base: string; at: number } | null
  /** The file is in storage under `signed.key`. */
  stored: boolean
  registered: PickerItem | null
}

export type LibraryAdapterOptions = {
  publicUrl: string
  /** Which P2 route an upload registers through; none, and the picker offers no upload. */
  upload?: UploadRoute | null
  /** Membership mode: only these galleries are offered. */
  albumIds?: string[] | null
  /** Offer taking a photograph out of Uploads (`removeFromSource`). */
  manageUploads?: boolean
  io?: Partial<LibraryIo>
}

export type LibraryAdapter = PickerAdapter & { sessions: Map<string, UploadSession> }

export function libraryAdapter(opts: LibraryAdapterOptions): LibraryAdapter {
  const io: LibraryIo = { ...browserIo, ...opts.io }
  const sessions = new Map<string, UploadSession>()
  const route = opts.upload ?? null
  const albumIds = opts.albumIds ?? null

  const adapter: LibraryAdapter = {
    sessions,

    async listSources(signal) {
      const list: LibrarySource[] = []
      let cursor: string | null = null
      for (let page = 0; page < SOURCE_PAGES_MAX; page++) {
        const got: { sources: LibrarySource[]; nextCursor: string | null } = unwrap(await io.listSources({ albumIds, cursor }), signal)
        list.push(...got.sources)
        cursor = got.nextCursor
        if (!cursor) break
      }
      return list.map(
        (s): PickerSource => ({
          id: s.id,
          kind: s.kind,
          label: s.label,
          // More galleries than the rail lists: say so where every photograph still is.
          detail: cursor && s.kind === 'all' ? MORE_GALLERIES_NOTE : s.detail,
          // A proved, ready photograph's display-size file, or nothing; never invented.
          coverUrl: typeof s.coverPath === 'string' && s.coverPath !== '' ? imageSrc(opts.publicUrl, s.coverPath) : null,
          // No bounded exact count exists, so none is shown.
          count: null,
        })
      )
    },

    async listItems(query, signal) {
      const page = unwrap(
        await io.listItems({ source: query.source, orientation: query.orientation, sort: query.sort, cursor: query.cursor }),
        signal
      )
      return { items: page.items.map((i) => toPickerItem(i, opts.publicUrl)), nextCursor: page.nextCursor }
    },

    async resolveCurrent(refs: PickerCurrent[], signal) {
      // Only the identity travels: the placement's own text stays in the picker.
      const sent = refs.map((r) => ({ assetId: r.assetId ?? null, photoId: r.photoId ?? null, path: r.path ?? null }))
      const found = unwrap(await io.resolve(sent), signal)
      if (found.length !== refs.length) throw new Error('The current photographs could not be checked.')
      return found.map((i) => (i ? toPickerItem(i, opts.publicUrl) : null))
    },
  }

  if (opts.manageUploads) {
    adapter.removeFromSource = async (item, source, signal) => {
      if (source.kind !== 'uploads' || item.kind !== 'asset' || item.origin !== 'upload') {
        throw new Error('Only a photograph in Uploads can be taken out of it.')
      }
      const reply = await io.forgetUpload(item.assetId)
      if (signal.aborted) throw abortError()
      if (!reply.ok) throw new Error(reply.message)
    }
  }

  if (route) {
    adapter.upload = async (file, ctx) => {
      let s = sessions.get(ctx.uploadId)
      if (!s) {
        s = { signed: null, stored: false, registered: null }
        sessions.set(ctx.uploadId, s)
      }
      if (s.registered) return s.registered

      const stale = !!s.signed && io.now() - s.signed.at > SIGNED_URL_TRUST_MS
      if (!s.signed || (stale && !s.stored)) {
        s.signed = { ...(await io.sign(route, file.type, ctx.signal)), at: io.now() }
        s.stored = false
      }

      if (!s.stored) {
        ctx.onProgress(0)
        try {
          await io.put(s.signed.url, file, ctx.signal, ctx.onProgress)
        } catch (e) {
          // An expired or refused link is not worth a second PUT: sign afresh.
          const status = (e as { status?: unknown }).status
          if (status === 403 || status === 400) s.signed = null
          throw e
        }
        s.stored = true
      }

      ctx.onProcessing()
      let reply: RegisterReply
      try {
        reply = await io.register(route, s.signed.key, s.signed.base, file.name)
      } catch {
        // The answer was lost, not necessarily the registration: the next
        // attempt registers the same key again.
        if (ctx.signal.aborted) throw abortError()
        throw new Error('The photograph reached storage but the server did not answer. Try again.')
      }
      if (!reply.ok) {
        // A refusal may have cleaned up the original: put it back first next time.
        s.stored = false
        throw new Error(reply.message)
      }
      if (!reply.item) throw new Error('The photograph was saved but could not be shown yet. Try again.')
      s.registered = toPickerItem(reply.item, opts.publicUrl)
      return s.registered
    }
  }

  return adapter
}
