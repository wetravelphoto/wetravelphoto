/**
 * THE PHOTO PICKER'S STATE — pure, no I/O
 * ═══════════════════════════════════════
 *
 * Everything `components/photos/AssetPicker.tsx` remembers while it is open,
 * as one reducer, so the rules that matter can be tested without a browser:
 * the order of a set, text that survives a change of source, replies that
 * arrive after the photographer has moved on, an upload retried twice, a
 * current photograph that cannot be found.
 *
 * This is a DISPLAY AND SELECTION adapter, not a database shape. The
 * foundation's readers map their own rows onto `PickerItem`; nothing here is
 * read from or written to the database, and nothing here authorises anything.
 * A caller's restrictions (membership only, these albums only) shape what the
 * screen offers; the server still decides what may be saved.
 *
 * Identity, kept apart on purpose:
 *   · an ASSET is the canonical photograph (`assetId`);
 *   · a MEMBERSHIP is that photograph's row in one gallery (`photoId`,
 *     `albumId`) — never reinterpreted as an asset id;
 *   · a SAMPLE is a built-in photograph with no asset at all, identified by
 *     its path.
 *
 * Blank, for a placement description, is P5's ONE blank rule — the
 * foundation's `isNonBlankText` (lib/photos/image.ts, the database's own set:
 * every Unicode space and line break plus the zero-width marks). Words made
 * only of those are no description, exactly as the renderer and the editor's
 * own store treat them, so the picker never hands back text the page would
 * then ignore. Captions keep their plain trim.
 */

import { isNonBlankText } from '@/lib/photos/image'

export const ALT_MAX = 300
export const CAPTION_MAX = 500

/** What the signed-upload route accepts (app/api/upload-url/route.ts). */
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif'] as const
export const UPLOAD_ACCEPT = UPLOAD_TYPES.join(',')
/** The cap the editor's picker has always applied before signing. */
export const UPLOAD_MAX_BYTES = 60 * 1024 * 1024

export type PickerOrientation = 'landscape' | 'portrait' | 'square'
export type OrientationFilter = 'any' | PickerOrientation
export type PickerSort = 'recent' | 'oldest'
export type PickerMode = 'single' | 'multiple'

/**
 * `asset`: one choice per canonical photograph (sections, stories, share
 * images). `membership`: one choice per gallery row (a chosen gallery cover,
 * the shop), and a photograph in no gallery cannot be chosen.
 */
export type PickerIdentity = 'asset' | 'membership'

export type PickerSourceKind = 'all' | 'uploads' | 'document' | 'album' | 'samples'

export type PickerSource = {
  /** The adapter's own id; passed back to `listItems` unchanged. */
  id: string
  kind: PickerSourceKind
  label: string
  /** A second line in the rail — a gallery's date, say. */
  detail?: string | null
  coverUrl?: string | null
  /** Only when the adapter actually knows it. `null` shows no number. */
  count: number | null
}

export type PickerMembership = {
  photoId: string
  albumId: string
  albumLabel: string | null
}

type ItemCommon = {
  /** The stored path a caller writes into its source field. */
  path: string
  /** A URL safe to put in an `<img>`: a display derivative, never an original. */
  displayUrl: string
  /** Trustworthy display dimensions, or null when not known. */
  width: number | null
  height: number | null
  /** A discovery hint only; the tile's shape comes from width and height. */
  orientation: PickerOrientation | null
  title: string | null
  /** The photograph's own description. Shown, never edited here. */
  canonicalAlt: string | null
  /** A gallery caption, offered as the starting caption where the slot has one. */
  caption: string | null
  origin: 'gallery' | 'upload' | 'document'
  /** Plain words for where it lives: "In Old Delhi", "Used in a story". */
  originLabel: string | null
  uploadedAt: string | null
  membership: PickerMembership | null
  readiness: 'ready' | 'unavailable'
  unavailableReason?: string | null
  /** Shutter, aperture and ISO as the photograph's record holds them; absent when unknown. */
  camera?: PickerCamera | null
}

export type PickerCamera = { shutter: string | null; aperture: number | null; iso: number | null }

/**
 * The camera settings worth a glance, as label and text, in the order a
 * photographer says them: "1/250 s", "f/5.6", "ISO 400". Each value is checked
 * again; a malformed or missing one is left out rather than shown wrong, and
 * nothing is shown when none is known.
 */
export function cameraFacts(camera: PickerCamera | null | undefined): Array<{ label: string; text: string }> {
  if (!camera || typeof camera !== 'object') return []
  const out: Array<{ label: string; text: string }> = []
  const { shutter, aperture, iso } = camera
  if (typeof shutter === 'string') {
    const frac = /^1\/([1-9][0-9]{0,5})$/.exec(shutter)
    const secs = /^([0-9]{1,4}(?:\.[0-9])?)s$/.exec(shutter)
    if (frac) out.push({ label: 'Shutter', text: `1/${frac[1]} s` })
    else if (secs && Number(secs[1]) > 0) out.push({ label: 'Shutter', text: `${Number(secs[1])} s` })
  }
  if (typeof aperture === 'number' && Number.isFinite(aperture) && aperture >= 0.5 && aperture <= 99.9) {
    out.push({ label: 'Aperture', text: `f/${Math.round(aperture * 10) / 10}` })
  }
  if (typeof iso === 'number' && Number.isInteger(iso) && iso >= 1 && iso <= 1_000_000) {
    out.push({ label: 'ISO', text: `ISO ${iso}` })
  }
  return out
}

export type PickerAssetItem = ItemCommon & { kind: 'asset'; assetId: string }
export type PickerSampleItem = ItemCommon & { kind: 'sample' }
export type PickerItem = PickerAssetItem | PickerSampleItem

/** A selection the caller already has, as stored. */
export type PickerCurrent = {
  assetId?: string | null
  photoId?: string | null
  path?: string | null
  /** The stored placement description, if any. */
  alt?: string | null
  caption?: string | null
}

export type PickerSlot = {
  /** "For Home · Hero · Photograph". */
  label: string
  /**
   * Declared by the registry / the caller. There is no user toggle.
   * `content`: the photograph carries meaning where it is placed.
   * `decorative`: it sits behind words and is announced as nothing; no
   * description is used there at all.
   */
  role: 'content' | 'decorative'
  /**
   * Content slots only: whether this placement can STORE a description of
   * its own. That is a fact about where the caller saves, not about the
   * photograph's meaning — a featured image or a share image is content even
   * though its field keeps a path and nothing else. `false` shows the
   * photograph's own description, read-only, offers no box, and returns no
   * placement description. Default `true`. Ignored for a decorative slot.
   */
  editableAlt?: boolean
  /** Show a caption box per photograph (Story image blocks). */
  caption?: boolean
  /**
   * A slot that follows another when it has no choice of its own — the hero's
   * phone photograph following desktop. `current` empty means "following".
   */
  inherited?: { ref: PickerCurrent; label: string } | null
}

export type PickerUploadCapability = {
  /** Which source an upload lands in. Never a gallery. */
  destination: 'uploads' | 'document'
  /** One line under the Upload button. */
  note: string
  /** The longer line in the footer. */
  route?: string
}

export type PickerCapabilities = {
  identity?: PickerIdentity
  /** Membership mode only: memberships outside these albums are not offered. */
  albumIds?: readonly string[] | null
  upload?: PickerUploadCapability | null
}

export type PickerChoice = {
  kind: 'asset' | 'sample'
  assetId: string | null
  path: string
  /** Membership mode only; null otherwise. */
  membership: PickerMembership | null
  /**
   * Trimmed placement description; null when blank (`isNonBlankText`), and
   * always in a decorative slot or one that cannot store a description.
   */
  alt: string | null
  /** Only for a slot with captions; trimmed, null when blank. */
  caption: string | null
  item: PickerItem
}

export type PickerResult = {
  choices: PickerChoice[]
  /**
   * True only when a following slot keeps exactly what it follows with no text
   * of its own: the caller should leave it following and write nothing.
   */
  keepsInherited: boolean
}

/**
 * The four doors the picker reads and writes through. The component imports
 * no server action and no client; the caller hands it one of these.
 *
 * Every method receives an AbortSignal. The picker also ignores any reply that
 * arrives after the photographer has moved on (another source, a closed
 * dialog), so an adapter that ignores the signal is still safe — only wasteful.
 */
export type PickerAdapter = {
  listSources(signal: AbortSignal): Promise<PickerSource[]>
  /**
   * One page. `nextCursor: null` means there is no more. No total is asked for.
   * A page may be EMPTY and still carry a cursor — a bounded scan that found
   * nothing matching yet — so only a null cursor ever means "none".
   */
  listItems(
    query: { source: string; orientation: OrientationFilter; sort: PickerSort; cursor: string | null },
    signal: AbortSignal
  ): Promise<{ items: PickerItem[]; nextCursor: string | null }>
  /** Positional: one answer per ref, `null` when it cannot be found. Rejects on a read failure. */
  resolveCurrent(refs: PickerCurrent[], signal: AbortSignal): Promise<Array<PickerItem | null>>
  /**
   * Upload one file and register it. Resolve only once the photograph is
   * registered and selectable; reject with a message a photographer can read.
   * `uploadId` is the same for every attempt at the same file.
   */
  upload?(
    file: File,
    ctx: {
      uploadId: string
      attempt: number
      signal: AbortSignal
      onProgress(fraction: number | null): void
      onProcessing(): void
    }
  ): Promise<PickerItem>
  /**
   * Take one photograph out of one source — today only Uploads. The picker
   * offers it only for a photograph listed in the Uploads source on screen
   * whose origin is `upload`. It is not a deletion: the photograph, its
   * files, its place in All photographs and every page using it stay. Resolve
   * once done; reject with a message a photographer can read. The server
   * decides independently whether it is allowed.
   */
  removeFromSource?(item: PickerItem, source: { id: string; kind: PickerSourceKind | null }, signal: AbortSignal): Promise<void>
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/** The key a selection is held under, or null when this item cannot be chosen under `identity`. */
export function itemKey(item: PickerItem, identity: PickerIdentity): string | null {
  if (identity === 'membership') return item.membership ? `photo:${item.membership.photoId}` : null
  return item.kind === 'asset' ? `asset:${item.assetId}` : `sample:${item.path}`
}

/** A key for showing the item at all — the selection key when there is one. */
export function displayKey(item: PickerItem, identity: PickerIdentity): string {
  return itemKey(item, identity) ?? (item.kind === 'asset' ? `view:asset:${item.assetId}` : `view:sample:${item.path}`)
}

/** Why this item cannot be chosen here, or null. */
export function pickBlock(
  item: PickerItem,
  identity: PickerIdentity,
  albumIds: readonly string[] | null | undefined
): string | null {
  if (item.readiness === 'unavailable') return item.unavailableReason || 'The file for this photograph can’t be found.'
  if (identity === 'membership') {
    if (!item.membership) return 'Only a photograph in a gallery can be used here.'
    if (albumIds && !albumIds.includes(item.membership.albumId)) return 'Only a photograph in this gallery can be used here.'
  }
  return null
}

/** Does an uploaded item belong in this source's listing? Uploads never join a gallery. */
export function sourceAccepts(kind: PickerSourceKind | null, item: PickerItem): boolean {
  if (kind === 'all') return true
  if (kind === 'uploads') return item.origin === 'upload'
  if (kind === 'document') return item.origin === 'document'
  return false
}

export function checkUploadFile(file: { name: string; type: string; size: number }): string | null {
  const name = file.name || 'That file'
  if (file.size <= 0) return `${name} is empty.`
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return `${name} is not a kind of photograph this can read. Use JPEG, PNG, WebP, TIFF or AVIF — a phone’s HEIC has to be exported first.`
  }
  if (file.size > UPLOAD_MAX_BYTES) return `${name} is over 60 MB. Export it a little smaller and try again.`
  return null
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type SelEntry = {
  key: string
  /** resolving: the current selection is being looked up; missing: it could not be found; error: the lookup failed. */
  status: 'resolving' | 'ready' | 'missing' | 'error'
}

export type UploadJob = {
  /** Stable across retries: one entry per file, however many attempts. */
  id: string
  name: string
  attempt: number
  status: 'queued' | 'uploading' | 'processing' | 'failed'
  progress: number | null
  error: string | null
  autoSelect: boolean
}

export type ViewSource = { id: string; kind: PickerSourceKind | null; label: string }

/** A take-out-of-a-source request for one photograph, by display key. */
export type Removal = {
  req: number
  sourceId: string
  status: 'pending' | 'error'
  error: string | null
}

export type PickerState = {
  mode: PickerMode
  identity: PickerIdentity
  albumIds: readonly string[] | null
  role: 'content' | 'decorative'
  /** A content slot that stores its own description. Never true for a decorative slot. */
  editableAlt: boolean
  captions: boolean
  upload: PickerUploadCapability | null
  currentCount: number
  hasInherited: boolean

  sources: { req: number; status: 'loading' | 'ready' | 'error'; list: PickerSource[] }
  view: {
    req: number
    source: ViewSource
    orientation: OrientationFilter
    sort: PickerSort
    status: 'loading' | 'ready' | 'error'
    keys: string[]
    cursor: string | null
    more: 'idle' | 'loading' | 'error'
  }
  /** Every item seen this session, by display key. Selection survives a change of view because of this. */
  known: Record<string, PickerItem>
  /** Display keys registered by uploads this session, newest first. */
  uploaded: string[]
  selection: SelEntry[]
  /** Placement text per selection key, kept even while a photograph is not selected. */
  text: Record<string, { alt: string; caption: string }>
  focus: string | null
  resolve: { req: number; status: 'idle' | 'loading' | 'ready' | 'error' }
  currentKeys: string[]
  inheritedKey: string | null
  uploads: UploadJob[]
  /** Take-out requests in flight or failed, by display key. */
  removals: Record<string, Removal>
  /** Display keys taken out of a source this session, by source id: never listed there again. */
  removed: Record<string, string[]>
  /** A source change the reducer asks the component to make (after an upload). */
  switchTo: string | null
  notice: { text: string; bad?: boolean } | null
}

export type PickerInit = {
  mode: PickerMode
  slot: PickerSlot
  capabilities?: PickerCapabilities
  current?: readonly PickerCurrent[]
  initialSource?: ViewSource
}

export const ALL_SOURCE: ViewSource = { id: 'all', kind: 'all', label: 'All photographs' }

const refKey = (i: number) => `ref:${i}`
const INHERITED_REF = 'ref:inherited'

export function initPicker(init: PickerInit): PickerState {
  const current = (init.current ?? []).filter((c) => c && (c.assetId || c.photoId || c.path))
  const list = init.mode === 'single' ? current.slice(0, 1) : current
  const inherited = init.slot.inherited ?? null
  const text: PickerState['text'] = {}
  const selection: SelEntry[] = list.map((c, i) => {
    text[refKey(i)] = { alt: c.alt ?? '', caption: c.caption ?? '' }
    return { key: refKey(i), status: 'resolving' as const }
  })
  // Following: show what the slot actually displays, with no text of its own.
  if (!selection.length && inherited && init.mode === 'single') {
    selection.push({ key: INHERITED_REF, status: 'resolving' })
  }
  const needsResolve = list.length > 0 || !!inherited
  return {
    mode: init.mode,
    identity: init.capabilities?.identity ?? 'asset',
    albumIds: init.capabilities?.albumIds ?? null,
    role: init.slot.role,
    editableAlt: init.slot.role === 'content' && init.slot.editableAlt !== false,
    captions: !!init.slot.caption,
    upload: init.capabilities?.upload ?? null,
    currentCount: list.length,
    hasInherited: !!inherited && init.mode === 'single',
    sources: { req: 0, status: 'loading', list: [] },
    view: {
      req: 0,
      source: init.initialSource ?? ALL_SOURCE,
      orientation: 'any',
      sort: 'recent',
      status: 'loading',
      keys: [],
      cursor: null,
      more: 'idle',
    },
    known: {},
    uploaded: [],
    selection,
    text,
    focus: selection[0]?.key ?? null,
    resolve: { req: 0, status: needsResolve ? 'loading' : 'idle' },
    currentKeys: [],
    inheritedKey: null,
    uploads: [],
    removals: {},
    removed: {},
    switchTo: null,
    notice: null,
  }
}

/** The refs to send to `resolveCurrent`, in order: the current selection, then what the slot follows. */
export function refsToResolve(init: PickerInit): PickerCurrent[] {
  const current = (init.current ?? []).filter((c) => c && (c.assetId || c.photoId || c.path))
  const list = init.mode === 'single' ? current.slice(0, 1) : current
  const inherited = init.mode === 'single' ? init.slot.inherited?.ref ?? null : null
  return inherited ? [...list, inherited] : list
}

export type PickerAction =
  | { type: 'sourcesRequested'; req: number }
  | { type: 'sourcesLoaded'; req: number; list: PickerSource[] }
  | { type: 'sourcesFailed'; req: number }
  | { type: 'viewRequested'; req: number; source?: ViewSource; orientation?: OrientationFilter; sort?: PickerSort }
  | { type: 'pageLoaded'; req: number; items: PickerItem[]; cursor: string | null }
  | { type: 'pageFailed'; req: number }
  | { type: 'moreRequested'; req: number }
  | { type: 'resolveRequested'; req: number }
  | { type: 'resolved'; req: number; items: ReadonlyArray<PickerItem | null> }
  | { type: 'resolveFailed'; req: number }
  | { type: 'pick'; key: string }
  | { type: 'remove'; key: string }
  | { type: 'focus'; key: string }
  | { type: 'setText'; key: string; field: 'alt' | 'caption'; value: string }
  | { type: 'uploadsQueued'; jobs: ReadonlyArray<{ id: string; name: string }>; autoSelect: boolean }
  | { type: 'uploadStarted'; id: string; attempt: number }
  | { type: 'uploadProgress'; id: string; attempt: number; progress: number | null }
  | { type: 'uploadProcessing'; id: string; attempt: number }
  | { type: 'uploadSucceeded'; id: string; attempt: number; item: PickerItem }
  | { type: 'uploadFailed'; id: string; attempt: number; message: string }
  | { type: 'uploadRetry'; id: string }
  | { type: 'uploadDismiss'; id: string }
  | { type: 'removeRequested'; key: string; req: number }
  | { type: 'removeSucceeded'; key: string; req: number }
  | { type: 'removeFailed'; key: string; req: number; message: string }
  | { type: 'removeDismissed'; key: string }
  | { type: 'switchHandled' }
  | { type: 'notice'; text: string | null; bad?: boolean }

function remember(known: PickerState['known'], items: readonly PickerItem[], identity: PickerIdentity, keep: readonly string[]) {
  const next = { ...known }
  const keys: string[] = []
  for (const item of items) {
    const k = displayKey(item, identity)
    // An upload's own record is the freshest; a page fetched before it
    // registered must not replace it.
    if (!keep.includes(k)) next[k] = item
    keys.push(k)
  }
  return { known: next, keys }
}

const uniq = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) === i)

export function pickerReducer(s: PickerState, a: PickerAction): PickerState {
  switch (a.type) {
    case 'sourcesRequested':
      return { ...s, sources: { ...s.sources, req: a.req, status: 'loading' } }
    case 'sourcesLoaded': {
      if (a.req !== s.sources.req) return s
      const match = a.list.find((x) => x.id === s.view.source.id)
      const source = match ? { id: match.id, kind: match.kind, label: match.label } : s.view.source
      return { ...s, sources: { req: a.req, status: 'ready', list: a.list }, view: { ...s.view, source } }
    }
    case 'sourcesFailed':
      return a.req !== s.sources.req ? s : { ...s, sources: { ...s.sources, status: 'error' } }

    case 'viewRequested': {
      const changingSource = !!a.source && a.source.id !== s.view.source.id
      return {
        ...s,
        notice: changingSource ? null : s.notice,
        view: {
          req: a.req,
          source: a.source ?? s.view.source,
          // A new source starts with every shape, as the prototype did.
          orientation: a.orientation ?? (changingSource ? 'any' : s.view.orientation),
          sort: a.sort ?? s.view.sort,
          status: 'loading',
          keys: [],
          cursor: null,
          more: 'idle',
        },
      }
    }
    case 'pageLoaded': {
      if (a.req !== s.view.req) return s
      const appending = s.view.status === 'ready'
      const { known, keys } = remember(s.known, a.items, s.identity, s.uploaded)
      // A page may still describe a photograph taken out this session as it was.
      for (const [id, out] of Object.entries(s.removed)) {
        for (const k of keys) if (out.includes(k) && known[k]) known[k] = takenOutOf(known[k], sourceLabel(s, id))
      }
      return {
        ...s,
        known,
        view: {
          ...s.view,
          status: 'ready',
          keys: appending ? uniq([...s.view.keys, ...keys]) : uniq(keys),
          cursor: a.cursor,
          more: 'idle',
        },
      }
    }
    case 'pageFailed': {
      if (a.req !== s.view.req) return s
      // A failed first page is a failed view; a failed later page keeps what loaded.
      if (s.view.status === 'ready') return { ...s, view: { ...s.view, more: 'error' } }
      return { ...s, view: { ...s.view, status: 'error' } }
    }
    case 'moreRequested':
      if (s.view.status !== 'ready' || !s.view.cursor) return s
      return { ...s, view: { ...s.view, req: a.req, more: 'loading' } }

    case 'resolveRequested':
      return {
        ...s,
        resolve: { req: a.req, status: 'loading' },
        selection: s.selection.map((e) => (e.status === 'error' ? { ...e, status: 'resolving' } : e)),
      }
    case 'resolved':
      return a.req !== s.resolve.req ? s : applyResolved(s, a.items)
    case 'resolveFailed':
      if (a.req !== s.resolve.req) return s
      return {
        ...s,
        resolve: { ...s.resolve, status: 'error' },
        selection: s.selection.map((e) => (e.status === 'resolving' ? { ...e, status: 'error' } : e)),
      }

    case 'pick': {
      const item = s.known[a.key]
      if (!item) return s
      const key = itemKey(item, s.identity)
      if (!key || pickBlock(item, s.identity, s.albumIds)) {
        // Unchoosable: it may still be inspected, which is how a missing file explains itself.
        return { ...s, focus: a.key }
      }
      if (s.mode === 'single') return { ...s, selection: [{ key, status: 'ready' }], focus: key, text: seedText(s, key, item) }
      const has = s.selection.some((e) => e.key === key)
      if (has) {
        const selection = s.selection.filter((e) => e.key !== key)
        return { ...s, selection, focus: s.focus === key ? selection[selection.length - 1]?.key ?? null : s.focus }
      }
      return { ...s, selection: [...s.selection, { key, status: 'ready' }], focus: key, text: seedText(s, key, item) }
    }
    case 'remove': {
      const i = s.selection.findIndex((e) => e.key === a.key)
      if (i < 0) return s
      const selection = s.selection.filter((e) => e.key !== a.key)
      const focus = s.focus === a.key ? selection[Math.min(i, selection.length - 1)]?.key ?? null : s.focus
      return { ...s, selection, focus }
    }
    case 'focus':
      return { ...s, focus: a.key }
    case 'setText': {
      const max = a.field === 'alt' ? ALT_MAX : CAPTION_MAX
      const prev = s.text[a.key] ?? { alt: '', caption: '' }
      return { ...s, text: { ...s.text, [a.key]: { ...prev, [a.field]: a.value.slice(0, max) } } }
    }

    case 'uploadsQueued':
      return {
        ...s,
        notice: null,
        uploads: [
          ...s.uploads,
          ...a.jobs
            .filter((j) => !s.uploads.some((u) => u.id === j.id))
            .map((j) => ({ id: j.id, name: j.name, attempt: 1, status: 'queued' as const, progress: null, error: null, autoSelect: a.autoSelect })),
        ],
      }
    case 'uploadStarted':
      return patchJob(s, a.id, a.attempt, (j) => (j.status === 'queued' ? { ...j, status: 'uploading', progress: 0 } : j))
    case 'uploadProgress':
      return patchJob(s, a.id, a.attempt, (j) => (j.status === 'uploading' ? { ...j, progress: a.progress } : j))
    case 'uploadProcessing':
      return patchJob(s, a.id, a.attempt, (j) => (j.status === 'uploading' ? { ...j, status: 'processing', progress: 100 } : j))
    case 'uploadFailed':
      return patchJob(s, a.id, a.attempt, (j) =>
        j.status === 'uploading' || j.status === 'processing' ? { ...j, status: 'failed', error: a.message } : j
      )
    case 'uploadRetry':
      // Only a failed upload can be retried, so pressing Try again twice queues it once.
      return {
        ...s,
        uploads: s.uploads.map((j) =>
          j.id === a.id && j.status === 'failed' ? { ...j, status: 'queued', attempt: j.attempt + 1, progress: null, error: null } : j
        ),
      }
    case 'uploadDismiss':
      return { ...s, uploads: s.uploads.filter((j) => !(j.id === a.id && j.status === 'failed')) }
    case 'uploadSucceeded':
      return applyUploaded(s, a.id, a.attempt, a.item)

    case 'removeRequested': {
      // Bound to the source on screen when it was asked for, and only where
      // the picker offers it; a second press while it is pending does nothing.
      if (!canRemoveFromSource(s, a.key)) return s
      return { ...s, notice: null, removals: { ...s.removals, [a.key]: { req: a.req, sourceId: s.view.source.id, status: 'pending', error: null } } }
    }
    case 'removeSucceeded': {
      const r = s.removals[a.key]
      if (!r || r.req !== a.req || r.status !== 'pending') return s
      const removals = { ...s.removals }
      delete removals[a.key]
      const item = s.known[a.key]
      const label = sourceLabel(s, r.sourceId)
      return {
        ...s,
        removals,
        // Its details must not go on saying "In Uploads".
        known: item ? { ...s.known, [a.key]: takenOutOf(item, label) } : s.known,
        // Out of THAT source's list only. The photograph, the selection, its
        // placement text and every other source are untouched: it still exists.
        removed: { ...s.removed, [r.sourceId]: uniq([...(s.removed[r.sourceId] ?? []), a.key]) },
        uploaded: s.uploaded.filter((k) => k !== a.key),
        sources: {
          ...s.sources,
          list: s.sources.list.map((x) => (x.id === r.sourceId && x.count != null && x.count > 0 ? { ...x, count: x.count - 1 } : x)),
        },
        notice: {
          text: `${item?.title || 'The photograph'} was taken out of ${label}. It is still in All photographs and wherever it is used; no file was deleted.`,
        },
      }
    }
    case 'removeFailed': {
      const r = s.removals[a.key]
      if (!r || r.req !== a.req || r.status !== 'pending') return s
      return { ...s, removals: { ...s.removals, [a.key]: { ...r, status: 'error', error: a.message } } }
    }
    case 'removeDismissed': {
      // Only a failed request can be put aside; one in flight still answers.
      if (s.removals[a.key]?.status !== 'error') return s
      const removals = { ...s.removals }
      delete removals[a.key]
      return { ...s, removals }
    }

    case 'switchHandled':
      return { ...s, switchTo: null }
    case 'notice':
      return { ...s, notice: a.text ? { text: a.text, bad: a.bad } : null }
  }
}

function seedText(s: PickerState, key: string, item: PickerItem): PickerState['text'] {
  if (s.text[key] || !s.captions || !item.caption) return s.text
  return { ...s.text, [key]: { alt: '', caption: item.caption.slice(0, CAPTION_MAX) } }
}

function patchJob(s: PickerState, id: string, attempt: number, f: (j: UploadJob) => UploadJob): PickerState {
  // A reply from an earlier attempt, or for an entry already dismissed, changes nothing.
  const j = s.uploads.find((u) => u.id === id)
  if (!j || j.attempt !== attempt) return s
  const next = f(j)
  return next === j ? s : { ...s, uploads: s.uploads.map((u) => (u.id === id ? next : u)) }
}

function applyResolved(s: PickerState, items: ReadonlyArray<PickerItem | null>): PickerState {
  const known = { ...s.known }
  const text = { ...s.text }
  const resolvedKey = (item: PickerItem | null | undefined) => {
    if (!item) return null
    known[displayKey(item, s.identity)] = item
    return itemKey(item, s.identity)
  }

  const currentKeys: string[] = []
  let duplicates = 0
  const selection: SelEntry[] = []
  for (const e of s.selection) {
    if (e.key === INHERITED_REF) {
      const k = resolvedKey(items[s.currentCount])
      selection.push(k ? { key: k, status: 'ready' } : { key: e.key, status: 'missing' })
      continue
    }
    if (!e.key.startsWith('ref:')) {
      selection.push(e)
      continue
    }
    const i = Number(e.key.slice(4))
    const k = resolvedKey(items[i])
    if (!k) {
      selection.push({ key: e.key, status: 'missing' })
      continue
    }
    if (selection.some((x) => x.key === k)) {
      duplicates++
      continue
    }
    currentKeys.push(k)
    // The stored text travels with the photograph it belongs to.
    if (text[e.key]) text[k] = text[e.key]
    delete text[e.key]
    selection.push({ key: k, status: 'ready' })
  }
  // An inherited ref resolved even when the slot has its own choice: it is
  // only a badge then, and its text is never borrowed.
  const inheritedKey = s.hasInherited ? (items[s.currentCount] ? resolvedKey(items[s.currentCount]) : null) : null

  const focus = s.focus && s.focus.startsWith('ref:') ? selection[0]?.key ?? null : s.focus
  return {
    ...s,
    known,
    text,
    selection,
    currentKeys,
    inheritedKey,
    focus,
    resolve: { ...s.resolve, status: 'ready' },
    notice:
      duplicates > 0
        ? { text: `The same photograph appeared ${duplicates + 1} times in this set; it is kept once.`, bad: false }
        : s.notice,
  }
}

function applyUploaded(s: PickerState, id: string, attempt: number, item: PickerItem): PickerState {
  const job = s.uploads.find((u) => u.id === id)
  if (!job || job.attempt !== attempt || (job.status !== 'uploading' && job.status !== 'processing')) return s
  const dk = displayKey(item, s.identity)
  const key = itemKey(item, s.identity)
  const pickable = !!key && !pickBlock(item, s.identity, s.albumIds)

  let selection = s.selection
  let focus = s.focus
  if (pickable && job.autoSelect) {
    if (s.mode === 'single') selection = [{ key: key!, status: 'ready' }]
    else if (!selection.some((e) => e.key === key)) selection = [...selection, { key: key!, status: 'ready' }]
    focus = key
  }

  // Where it now lives. If that is not what is on screen — a gallery, say —
  // ask for the source it did land in, and say it was not added to the gallery.
  let switchTo: string | null = s.switchTo
  let notice = s.notice
  const shownHere = sourceAccepts(s.view.source.kind, item)
  if (!shownHere) {
    const dest = s.upload?.destination ?? (item.origin === 'document' ? 'document' : 'uploads')
    const target = s.sources.list.find((x) => x.kind === dest) ?? s.sources.list.find((x) => x.kind === 'all')
    if (target) switchTo = target.id
    const from = s.view.source.kind === 'album' ? s.view.source.label : null
    const home = dest === 'document' ? 'kept with this page or story' : 'added to Uploads'
    notice = { text: `${job.name} was ${home}${from ? `, not to ${from}` : ''}. Nothing is published until you publish.` }
  }

  return {
    ...s,
    known: { ...s.known, [dk]: item },
    uploaded: [dk, ...s.uploaded.filter((k) => k !== dk)],
    uploads: s.uploads.filter((u) => u.id !== id),
    selection,
    focus,
    switchTo,
    notice,
  }
}

/* ------------------------------------------------------------------ */
/* Reading the state                                                   */
/* ------------------------------------------------------------------ */

/** What the grid shows: this session's uploads that belong here, then the loaded pages. */
export function visibleKeys(s: PickerState): string[] {
  if (s.view.status !== 'ready') return []
  const up = s.uploaded.filter((k) => {
    const item = s.known[k]
    if (!item || !sourceAccepts(s.view.source.kind, item)) return false
    return s.view.orientation === 'any' || item.orientation === s.view.orientation
  })
  // Taken out of this source this session: a page fetched before that still lists it.
  const out = s.removed[s.view.source.id] ?? []
  return uniq([...up, ...s.view.keys]).filter((k) => !out.includes(k))
}

/**
 * Whether "Take out of Uploads" may be offered for this photograph: an
 * uploaded asset, listed in the Uploads source now on screen, with no request
 * for it already pending. The adapter must also offer `removeFromSource`.
 */
export function canRemoveFromSource(s: PickerState, key: string): boolean {
  const item = s.known[key]
  if (!item || item.kind !== 'asset' || item.origin !== 'upload') return false
  if (s.view.source.kind !== 'uploads' || s.view.status !== 'ready') return false
  if (s.removals[key]?.status === 'pending') return false
  return visibleKeys(s).includes(key)
}

/** A take-out confirmation left open: for one photograph, in the source it was opened in. */
export type TakeOutAsk = { key: string; sourceId: string }

export type TakeOutPrompt =
  | { show: 'none' }
  | { show: 'offer' | 'confirm' | 'pending' | 'error'; label: string; error: string | null }

/** A source's name: the one on screen, else the rail's, else Uploads (the only source take-out serves). */
function sourceLabel(s: PickerState, id: string): string {
  if (id === s.view.source.id) return s.view.source.label
  return s.sources.list.find((x) => x.id === id)?.label ?? 'Uploads'
}

/**
 * A photograph just taken out of a source. Its origin stays what it was (it
 * was uploaded); only the label that claims it is in that list now changes.
 */
function takenOutOf(item: PickerItem, label: string): PickerItem {
  return item.kind === 'asset' && item.origin === 'upload' ? { ...item, originLabel: `Taken out of ${label}` } : item
}

/**
 * What the "Take out of …" control shows for one photograph, and which source
 * it names. A request already made names the source it was made in, whatever
 * is on screen now: moving to All photographs while it is pending must not
 * make it read "Take it out of All photographs?". A failure is shown, and
 * offered again, only in its own source; a confirmation left open belongs to
 * the source it was opened in and is not shown in another.
 */
export function takeOutPrompt(s: PickerState, key: string, ask: TakeOutAsk | null): TakeOutPrompt {
  const r = s.removals[key]
  if (r?.status === 'pending') return { show: 'pending', label: sourceLabel(s, r.sourceId), error: null }
  if (!canRemoveFromSource(s, key)) return { show: 'none' }
  const here = s.view.source.id
  if (r?.status === 'error' && r.sourceId === here) return { show: 'error', label: sourceLabel(s, r.sourceId), error: r.error }
  const asking = ask?.key === key && ask.sourceId === here
  return { show: asking ? 'confirm' : 'offer', label: sourceLabel(s, here), error: null }
}

/**
 * The description this placement stores for one photograph: trimmed, or null
 * when it is blank by the ONE blank rule (`isNonBlankText`) — and always null
 * in a decorative slot or one that cannot store a description.
 */
export function placementAlt(s: PickerState, key: string): string | null {
  if (!s.editableAlt) return null
  const alt = s.text[key]?.alt
  return isNonBlankText(alt) ? alt.trim() : null
}

/**
 * What the grid area shows. `empty` is a claim that nothing is there, so it is
 * made only once the source has said it has no more (`cursor` null). Nothing
 * shown yet with a cursor left is `searching`: the library has only been
 * looked through in part, and the photographer is offered to keep looking.
 * There is no automatic continuation — each further page is one press.
 */
export type GridPhase = 'loading' | 'error' | 'items' | 'searching' | 'empty'

export function gridPhase(s: PickerState): GridPhase {
  if (s.view.status !== 'ready') return s.view.status
  if (visibleKeys(s).length || s.uploads.length) return 'items'
  return s.view.cursor ? 'searching' : 'empty'
}

export function selectedIndex(s: PickerState, key: string): number {
  return s.selection.findIndex((e) => e.key === key)
}

export function itemFor(s: PickerState, key: string | null): PickerItem | null {
  return key ? s.known[key] ?? null : null
}

export type Badge = { text: string } | null

/** The restrained "current" marker on a tile. */
export function badgeFor(s: PickerState, key: string, inheritedLabel: string | null): Badge {
  const current = s.currentKeys.includes(key)
  const inherited = !!s.inheritedKey && s.inheritedKey === key && !!inheritedLabel
  const following = s.hasInherited && s.currentCount === 0
  if (inherited && following) return { text: `${inheritedLabel} · followed` }
  if (current && inherited) return { text: `Current · same as ${inheritedLabel!.toLowerCase()}` }
  if (current) return { text: 'Current' }
  if (inherited) return { text: inheritedLabel! }
  return null
}

/** True when confirming would change nothing for a following slot. */
export function keepsInherited(s: PickerState): boolean {
  if (!s.hasInherited || s.currentCount > 0 || s.selection.length !== 1) return false
  const key = s.selection[0].key
  if (key !== s.inheritedKey) return false
  return !(placementAlt(s, key) || s.text[key]?.caption.trim())
}

export function confirmBlock(s: PickerState): { text: string; bad?: boolean } | null {
  const multi = s.mode === 'multiple'
  if (!s.selection.length) return { text: multi ? 'Pick at least one photograph.' : 'Pick a photograph.' }
  if (s.selection.some((e) => e.status === 'resolving')) return { text: 'Checking the current photograph…' }
  if (s.selection.some((e) => e.status === 'error')) {
    return { text: 'The current photograph couldn’t be checked. Try again, or pick another.', bad: true }
  }
  if (s.selection.some((e) => e.status === 'missing')) {
    return multi
      ? { text: 'One photograph in the set can’t be found. Remove it to continue.', bad: true }
      : { text: 'The current photograph can’t be found. Pick another.', bad: true }
  }
  for (const e of s.selection) {
    const item = s.known[e.key]
    const why = item ? pickBlock(item, s.identity, s.albumIds) : 'not loaded'
    if (why) {
      return multi
        ? { text: 'One photograph in the set can’t be used here. Remove it to continue.', bad: true }
        : { text: why, bad: true }
    }
  }
  return null
}

export function buildResult(s: PickerState): PickerResult | null {
  if (confirmBlock(s)) return null
  const choices = s.selection.map((e): PickerChoice => {
    const item = s.known[e.key]
    const t = s.text[e.key] ?? { alt: '', caption: '' }
    const alt = placementAlt(s, e.key)
    const caption = s.captions ? t.caption.trim() || null : null
    return {
      kind: item.kind,
      assetId: item.kind === 'asset' ? item.assetId : null,
      path: item.path,
      membership: s.identity === 'membership' ? item.membership : null,
      alt,
      caption,
      item,
    }
  })
  return { choices, keepsInherited: keepsInherited(s) }
}

/* ------------------------------------------------------------------ */
/* Previews that did not load                                          */
/* ------------------------------------------------------------------ */

/**
 * A photograph's record can be fine while its display bytes are not reachable
 * — a network blip, a derivative that is late or gone. That is a fact about one
 * preview URL in this session, not about the photograph: it is kept apart from
 * `PickerState` on purpose, so it cannot change the selection, the placement
 * text, readiness or whether Use is allowed. The component keeps it in its own
 * reducer; nothing in `confirmBlock` or `buildResult` reads it.
 *
 * A failure is sticky until the photographer asks again. There is no automatic
 * retry, so a URL that always fails cannot loop; each "Retry preview" is one
 * new attempt, and an error from an attempt already superseded is ignored.
 */
export type PreviewState = Readonly<Record<string, { attempt: number; failed: boolean }>>

export type PreviewAction =
  | { type: 'previewFailed'; url: string; attempt: number }
  | { type: 'previewRetry'; url: string }

export const NO_PREVIEWS: PreviewState = {}

export function previewOf(p: PreviewState, url: string): { attempt: number; failed: boolean } {
  return p[url] ?? { attempt: 0, failed: false }
}

export function previewReducer(p: PreviewState, a: PreviewAction): PreviewState {
  const cur = previewOf(p, a.url)
  switch (a.type) {
    case 'previewFailed':
      if (a.attempt !== cur.attempt || cur.failed) return p
      return { ...p, [a.url]: { attempt: cur.attempt, failed: true } }
    case 'previewRetry':
      if (!cur.failed) return p
      return { ...p, [a.url]: { attempt: cur.attempt + 1, failed: false } }
  }
}
