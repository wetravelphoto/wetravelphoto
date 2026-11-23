import { SIZES, type SizeKey } from '@/lib/image-sizes'
import { isSamplePhoto } from '@/lib/images'
import { parseLegacyKey, type ParsedKey } from '@/lib/photos/legacy-key'
import { BASE_DEVICE, deviceKey, type Device } from '@/lib/sections/devices'
import type { SectionSettings } from '@/lib/sections/registry'

/**
 * WHAT A PHOTOGRAPH ON A PAGE RESOLVES TO
 * ═══════════════════════════════════════
 *
 * P5 (claude/photo-migration-plan.md; gate P5-20261006-public-asset-read-01).
 * Pure: no database, no clock, no environment. Four separate things, never
 * folded into one another:
 *
 *   ASSET       the canonical photograph — `RenderAsset`, exactly what
 *               read_photo_render_assets may say about it and nothing more
 *   MEMBERSHIP  a photograph's place in a gallery (`photos` row): its own id,
 *               album, caption. A gallery photo id is NEVER an asset id.
 *   PLACEMENT   where a source document put a photograph: the stored path,
 *               the IDENTITY the picker stored beside it (absent, an asset,
 *               or malformed), the source's own alt text, the slot's role
 *   SAMPLE      a built-in /samples/… photograph: same-origin, never an asset
 *
 * ── The rule for an old page ────────────────────────────────────────────────
 * A placement whose identity is ABSENT — no asset sibling at all, or an empty
 * one — resolves to `legacy` and carries only its stored path: the caller
 * renders it exactly as it does today, so every page written before P5 is
 * byte-for-byte what it was. That is the ONLY way a section reaches its raw
 * path. A stored path alone is never looked up for a section.
 *
 * ── The rule for a placement that claims an identity ────────────────────────
 * Once a placement names an asset, the pair (asset, path) is what it says it
 * shows, and only a verified answer for exactly that pair is rendered. Every
 * other answer — missing, mismatch, ambiguous, invalid, unavailable, not read,
 * error, an `ok` for a different asset or a file that is not its own — is
 * `unavailable`: nothing is drawn. Never the stored path, which might be
 * another asset's file, another site's file, or simply not what the identity
 * says. A malformed identity (a non-empty sibling that is not a lower-case
 * uuid) is not absence; it is `unavailable` too, and so is a sample path
 * carrying any identity — a sample is never an asset, so the pair contradicts
 * itself.
 *
 * ── The rule for a relational path ──────────────────────────────────────────
 * A custom gallery cover or a story's featured image stores a PATH and no
 * identity, written by its own authorised route (resolveRelational). A lookup
 * that learns nothing (missing, invalid, not read, error) leaves the path to
 * render as it did before P5 — no identity was claimed, so none was refused.
 * A lookup that learns something is WRONG with that file (ambiguous, any
 * unavailable reason, an answer not bound to the path) draws nothing.
 *
 * ── Alt text ────────────────────────────────────────────────────────────────
 * decorative slot → "" · the placement's own non-blank text · the asset's
 * canonical text · otherwise "" and `altMissing`. Blank means only the
 * characters in ALT_BLANK_CHARS — the one rule P5 shares with the database
 * (read_photo_render_assets and the section-alt block of sync_photo_usages):
 * every Unicode space and line break plus the zero-width marks, so a lone
 * no-break space is unset, never decorative. Nothing here writes a canonical
 * description.
 */

// ── Limits shared with the database ─────────────────────────────────────────

/** read_photo_render_assets' own ceiling: references in one call. */
export const RENDER_MAX_REFS = 200
/** Its byte ceiling for the serialised reference list. */
export const RENDER_MAX_BYTES = 262144
/** Its ceiling for one path. */
export const RENDER_MAX_PATH = 1024
/**
 * The longest canonical description it returns; longer is returned as none.
 * In CHARACTERS as PostgreSQL counts them (char_length: Unicode code points),
 * never JavaScript's UTF-16 `length` — see exceedsChars.
 */
export const RENDER_MAX_ALT = 1000
/** The largest edge it trusts. */
export const RENDER_MAX_SIDE = 65535
/**
 * The largest reply believed. Every path that leaves the database is a file of
 * a grammar key (printable ASCII, ≤ 130 characters), and a description is at
 * most RENDER_MAX_ALT characters of at most 6 serialised bytes each (`\u0001`),
 * so one asset is at most ~7 KB; 200 of them stay well under this
 * (.mk/render-read.ts builds the worst case). Anything larger is refused whole.
 */
export const RENDER_MAX_REPLY_BYTES = 2 * 1024 * 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The characters a description may consist of and still be blank, as they
 * appear inside the database's bracket expression (c_text / c_alt_text in the
 * candidate migration — .mk/render-read.ts asserts the text is identical):
 * ASCII whitespace, NEL, no-break space, ogham space, Mongolian vowel
 * separator, U+2000–U+200D (the spaces and zero-width marks), line and
 * paragraph separators, narrow no-break space, medium mathematical space,
 * word joiner, ideographic space, BOM.
 */
export const ALT_BLANK_CHARS = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u180e\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff'
const NOT_BLANK = new RegExp(`[^${ALT_BLANK_CHARS}]`)

/** True when `v` is a string with at least one character outside the blank set. */
export const isNonBlankText = (v: unknown): v is string => typeof v === 'string' && NOT_BLANK.test(v)

/**
 * Whether `s` holds more than `max` characters as PostgreSQL's char_length
 * counts them — Unicode code points, so an emoji is one character, not the two
 * UTF-16 code units `length` reports. Bounded: settled by `length` alone when
 * that can decide (every code point is one or two units), otherwise it stops
 * counting at `max + 1`.
 */
export function exceedsChars(s: string, max: number): boolean {
  if (s.length <= max) return false
  if (s.length > 2 * max) return true
  let n = 0
  for (let i = 0; i < s.length; i += s.codePointAt(i)! > 0xffff ? 2 : 1) if (++n > max) return true
  return false
}

// ── The answer, as the database gives it ────────────────────────────────────

export const UNAVAILABLE_REASONS = ['deleted', 'archived', 'pending', 'failed', 'malformed'] as const
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]

/** A photograph as a renderer may know it. Every field validated on arrival. */
export type RenderAsset = {
  readonly id: string
  /** The asset's display file — the largest size, or the flat era's JPEG. */
  readonly displayPath: string
  /** Only the four rungs, each exactly `<key base>/<size>.webp`. */
  readonly derivatives: Readonly<Partial<Record<SizeKey, string>>>
  /** Upright pixel size, ONLY when the database could trust it; else null. */
  readonly dimensions: { readonly width: number; readonly height: number } | null
  /** The canonical description, or null. Never blank. */
  readonly alt: string | null
}

export type RefOutcome =
  | { readonly outcome: 'ok'; readonly asset: RenderAsset }
  | { readonly outcome: 'missing' | 'mismatch' | 'ambiguous' | 'invalid' }
  | { readonly outcome: 'unavailable'; readonly reason: UnavailableReason }
  /** Not asked: the request's budget was spent, or the read failed. Never a "missing". */
  | { readonly outcome: 'not_read' | 'error' }

// ── What is asked ───────────────────────────────────────────────────────────

/**
 * One reference. Built only by the two constructors below, so a section can
 * never send a bare path by accident.
 */
export type RenderRef = { readonly assetId: string; readonly path: string | null } | { readonly assetId: null; readonly path: string }

/** A placement's persisted identity, bound to the path it was stored with. */
export const assetRef = (assetId: string, path: string | null): RenderRef => ({ assetId, path })

/**
 * A path alone — ONLY for a relational surface that stores a path and has its
 * own authorisation (a custom gallery cover, a story's featured image). Never
 * for section settings: an old section keeps rendering from its path.
 */
export const relationalPathRef = (path: string): RenderRef => ({ assetId: null, path })

/** The stable key a reference is deduplicated and memoised by (a uuid holds no `|`). */
export const refKey = (r: RenderRef) => `${r.assetId ?? ''}|${r.path ?? ''}`

/** What goes over the wire to read_photo_render_assets. */
export type WireRef = { asset_id?: string; path?: string }

export const toWire = (r: RenderRef): WireRef =>
  r.assetId !== null ? (r.path !== null ? { asset_id: r.assetId, path: r.path } : { asset_id: r.assetId }) : { path: r.path }

/**
 * A file a renderer may be given: a SIZE `<base>/<400|800|1600|2400>.webp` or
 * the flat era's `<base>.jpg`, under the closed P4 grammar (parseLegacyKey,
 * the TS twin of photo_backfill_key_base). Never a key base, an original, a
 * URL or a sample. Null for anything else.
 */
export function renderFile(path: unknown): ParsedKey | null {
  if (typeof path !== 'string' || path.length < 1 || path.length > RENDER_MAX_PATH) return null
  const p = parseLegacyKey(path)
  return p.ok && (p.shape === 'size' || p.shape === 'flat') ? p : null
}

/**
 * Whether a reference is worth asking about. One the database would answer
 * `invalid` is answered `invalid` here instead, without spending a call: an id
 * that is not a lower-case uuid, or a path that is not a render file.
 */
export function refIsWellFormed(r: RenderRef): boolean {
  if (r.assetId !== null && !UUID.test(r.assetId)) return false
  if (r.path !== null && renderFile(r.path) === null) return false
  return r.assetId !== null || r.path !== null
}

// ── Parsing the reply — nothing is believed that was not checked ───────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype

const sameKeys = (o: Record<string, unknown>, keys: readonly string[]) => {
  const k = Object.keys(o).sort()
  return k.length === keys.length && k.every((x, i) => x === keys[i])
}

const REPLY_KEYS = ['assets', 'results', 'v']
const ASSET_KEYS = ['alt_text', 'derivatives', 'display_path', 'height', 'id', 'width']
const SIZE_NAMES: readonly string[] = SIZES.map(String)

/**
 * Why a reply was refused — a FIXED vocabulary. A message never quotes the
 * reply (a key name, a value, a path): it is logged, and nothing the database
 * sent but should not have may travel further than this function.
 */
export type ReplyFault =
  | 'shape' | 'too_large' | 'answer_count' | 'asset_count'
  | 'asset_shape' | 'asset_id' | 'display_path' | 'derivatives' | 'foreign_key'
  | 'dimensions' | 'alt_text'
  | 'answer_shape' | 'answer_unknown' | 'answer_unbound' | 'answer_impossible' | 'asset_unasked'

/** Thrown for a reply that is not exactly the documented shape. */
export class RenderReplyError extends Error {
  constructor(readonly fault: ReplyFault) {
    super(`render reply refused: ${fault}`)
  }
}

function bad(fault: ReplyFault): never {
  throw new RenderReplyError(fault)
}

/** Every file of an asset a reference may bind to. */
const filesOf = (a: RenderAsset): ReadonlySet<string> => new Set([a.displayPath, ...Object.values(a.derivatives)])

function parseAsset(key: string, raw: unknown, tenantId: string): RenderAsset {
  if (!isRecord(raw) || !sameKeys(raw, ASSET_KEYS)) bad('asset_shape')
  const { id, display_path, derivatives, width, height, alt_text } = raw
  if (typeof id !== 'string' || !UUID.test(id) || id !== key) bad('asset_id')

  // The display file, under the closed grammar, and bound to this site.
  const display = renderFile(display_path)
  if (!display) bad('display_path')
  if (display.prefixTenant !== null && display.prefixTenant !== tenantId) bad('foreign_key')

  // The sizes: the four rungs, each exactly `<the display's key>/<size>.webp`.
  if (!isRecord(derivatives)) bad('derivatives')
  const sizes: Partial<Record<SizeKey, string>> = {}
  for (const [size, path] of Object.entries(derivatives)) {
    if (!SIZE_NAMES.includes(size) || typeof path !== 'string') bad('derivatives')
    if (path !== `${display.keyBase}/${size}.webp`) bad('derivatives')
    sizes[size as SizeKey] = path
  }
  // A size display file must be one of them; a flat display needs no sizes.
  if (display.shape === 'size' && !Object.values(sizes).includes(display_path as string)) bad('display_path')

  let dimensions: RenderAsset['dimensions'] = null
  if (width !== null || height !== null) {
    const inRange = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= RENDER_MAX_SIDE
    if (!inRange(width) || !inRange(height)) bad('dimensions')
    dimensions = { width: width as number, height: height as number }
  }
  if (alt_text !== null && (!isNonBlankText(alt_text) || exceedsChars(alt_text, RENDER_MAX_ALT))) bad('alt_text')

  return { id, displayPath: display_path as string, derivatives: sizes, dimensions, alt: alt_text }
}

/**
 * The database's reply → one outcome per reference sent, in order, for the
 * site the references were asked about. A reply that is not exactly the
 * documented shape is refused WHOLE (throws RenderReplyError): a renderer must
 * never half-believe a malformed answer. Beyond the shape it checks what the
 * answers CLAIM: every file is a render file of the grammar and of this site;
 * an `ok` is for the id asked and lists the path asked; a `mismatch` answers a
 * pair and an `ambiguous` a path alone; every returned asset was asked for.
 */
export function parseRenderReply(raw: unknown, sent: readonly RenderRef[], tenantId: string): RefOutcome[] {
  if (!isRecord(raw) || !sameKeys(raw, REPLY_KEYS)) bad('shape')
  if (raw.v !== 1 || !Array.isArray(raw.results) || !isRecord(raw.assets)) bad('shape')
  if (new TextEncoder().encode(JSON.stringify(raw)).length > RENDER_MAX_REPLY_BYTES) bad('too_large')
  if (raw.results.length !== sent.length) bad('answer_count')
  const entries = Object.entries(raw.assets)
  if (entries.length > sent.length) bad('asset_count')
  const assets = new Map<string, RenderAsset>()
  for (const [key, value] of entries) assets.set(key, parseAsset(key, value, tenantId))

  const used = new Set<string>()
  const out = raw.results.map((r, i): RefOutcome => {
    if (!isRecord(r)) bad('answer_shape')
    const ref = sent[i]!
    switch (r.outcome) {
      case 'ok': {
        if (!sameKeys(r, ['asset_id', 'outcome'])) bad('answer_shape')
        const asset = typeof r.asset_id === 'string' ? assets.get(r.asset_id) : undefined
        if (!asset) bad('answer_unbound')
        // Bound to what was asked: the same id, and a path that is one of its files.
        if (ref.assetId !== null && ref.assetId !== asset.id) bad('answer_unbound')
        if (ref.path !== null && !filesOf(asset).has(ref.path)) bad('answer_unbound')
        used.add(asset.id)
        return { outcome: 'ok', asset }
      }
      case 'unavailable':
        if (!sameKeys(r, ['outcome', 'reason'])) bad('answer_shape')
        if (!(UNAVAILABLE_REASONS as readonly unknown[]).includes(r.reason)) bad('answer_unknown')
        return { outcome: 'unavailable', reason: r.reason as UnavailableReason }
      case 'mismatch':
        if (!sameKeys(r, ['outcome'])) bad('answer_shape')
        if (ref.assetId === null || ref.path === null) bad('answer_impossible')
        return { outcome: 'mismatch' }
      case 'ambiguous':
        if (!sameKeys(r, ['outcome'])) bad('answer_shape')
        if (ref.assetId !== null) bad('answer_impossible')
        return { outcome: 'ambiguous' }
      case 'missing':
      case 'invalid':
        if (!sameKeys(r, ['outcome'])) bad('answer_shape')
        return { outcome: r.outcome }
      default:
        return bad('answer_unknown')
    }
  })
  if (used.size !== assets.size) bad('asset_unasked')
  return out
}

// ── Placement, membership, sample ───────────────────────────────────────────

export type AccessibilityRole = 'content' | 'decorative'

/**
 * What a placement says about WHICH photograph it shows.
 *   absent     nothing was stored (or an empty string): a pre-P5 placement
 *   asset      a lower-case uuid
 *   malformed  something non-empty that is not one, or an identity with no
 *              photograph beside it — never mistaken for absence
 */
export type PlacementIdentity =
  | { readonly kind: 'absent' }
  | { readonly kind: 'asset'; readonly assetId: string }
  | { readonly kind: 'malformed' }

export const NO_IDENTITY: PlacementIdentity = { kind: 'absent' }

/** A stored identity value → what it says. */
export function readIdentity(value: unknown): PlacementIdentity {
  if (value === undefined || value === null || value === '') return NO_IDENTITY
  return typeof value === 'string' && UUID.test(value) ? { kind: 'asset', assetId: value } : { kind: 'malformed' }
}

export type Placement = {
  /** The stored path, as the source holds it; null when the slot has none. */
  readonly path: string | null
  readonly identity: PlacementIdentity
  /** The source's own alt text, as stored (any value; blank means unset). */
  readonly altOverride: unknown
  readonly role: AccessibilityRole
}

/** A gallery photograph's membership. Its id is a `photos` id, not an asset's. */
export type Membership = {
  readonly kind: 'gallery'
  readonly photoId: string
  readonly albumId: string
  readonly caption: string | null
}

/**
 * The editor's sibling keys for one image field on one device — frozen:
 * `deviceKey(base + '_asset', device)` and `deviceKey(base + '_alt', device)`.
 * `image_path` on a phone → `image_path_mobile`, `image_path_asset_mobile`,
 * `image_path_alt_mobile` (never `image_path_mobile_alt`). sync_photo_usages
 * maps a stored slot to its alt key by the same rule.
 */
export function imageKeys(field: string, device: Device = BASE_DEVICE) {
  return {
    path: deviceKey(field, device),
    asset: deviceKey(`${field}_asset`, device),
    alt: deviceKey(`${field}_alt`, device),
  }
}

const emptyPath = (v: unknown) => v === undefined || v === null || v === ''

/**
 * One section image field on one device → its placement, or null when the
 * slot holds nothing at all.
 *
 * A phone that FOLLOWS (path, identity both unset) shows the desktop
 * photograph, so it takes the desktop placement whole — path, identity and alt
 * together; a stray phone description with no phone photograph is ignored. A
 * phone with a photograph of its own takes only its own identity and alt: it
 * never borrows a desktop asset id or a description written for another image.
 *
 * An identity with no photograph beside it (a non-empty `_asset` sibling and
 * an empty or non-text path) is a contradiction, not absence: the placement is
 * returned with `path: null` and a MALFORMED identity, so it resolves to
 * `unavailable` and nothing is drawn.
 */
export function sectionPlacement(
  settings: SectionSettings,
  field: string,
  role: AccessibilityRole,
  device: Device = BASE_DEVICE
): Placement | null {
  const own = imageKeys(field, device)
  const value = settings[own.path]
  const identity = readIdentity(settings[own.asset])
  if (typeof value !== 'string' || value === '') {
    if (identity.kind !== 'absent') return { path: null, identity: { kind: 'malformed' }, altOverride: settings[own.alt], role }
    if (device !== BASE_DEVICE && emptyPath(value)) return sectionPlacement(settings, field, role, BASE_DEVICE)
    return null
  }
  return { path: value, identity, altOverride: settings[own.alt], role }
}

/** The reference a placement asks about, or null when it must not be looked up. */
export function placementRef(p: Placement): RenderRef | null {
  if (p.identity.kind !== 'asset') return null
  if (p.path !== null && isSamplePhoto(p.path)) return null
  return assetRef(p.identity.assetId, p.path)
}

// ── Resolution ──────────────────────────────────────────────────────────────

export type Candidate = { readonly path: string; readonly width: number }

/** Why nothing is drawn. Every value is a refusal; none falls back to a path. */
export type UnavailableWhy =
  | 'missing' | 'mismatch' | 'ambiguous' | 'invalid' | 'not_read' | 'error' | 'unavailable'
  /** A non-empty identity that is not a uuid, or an identity with no photograph. */
  | 'malformed_identity'
  /** A sample path carrying an asset identity: a sample is never an asset. */
  | 'contradictory'
  /** An `ok` whose asset is not the one asked for, or does not list the stored path. */
  | 'unbound'

export type ResolvedImage =
  /** Nothing stored. */
  | { readonly kind: 'none' }
  /**
   * Render exactly as before P5 — the stored path, today's helpers. Only for a
   * placement with NO identity (`no_asset`), or a relational path whose lookup
   * learned nothing (`missing` | `invalid` | `not_read` | `error`).
   */
  | { readonly kind: 'legacy'; readonly path: string; readonly why: 'no_asset' | 'missing' | 'invalid' | 'not_read' | 'error' }
  /** A built-in sample: same-origin, through photoUrl, as today. */
  | { readonly kind: 'sample'; readonly path: string; readonly alt: string; readonly altMissing: boolean }
  /** Draw nothing. `reason` only for the database's own `unavailable`. */
  | { readonly kind: 'unavailable'; readonly why: UnavailableWhy; readonly reason?: UnavailableReason }
  | {
      readonly kind: 'asset'
      readonly assetId: string
      /** The asset's display file. */
      readonly path: string
      /** Real widths, ascending, ≥ 2 — or null: emit no srcset. */
      readonly candidates: readonly Candidate[] | null
      /** The display file's own upright size, or null: emit no width/height. */
      readonly width: number | null
      readonly height: number | null
      readonly alt: string
      readonly altMissing: boolean
    }

function altFor(role: AccessibilityRole, override: unknown, canonical: string | null) {
  if (role === 'decorative') return { alt: '', altMissing: false }
  const text = isNonBlankText(override) ? override : canonical
  return text === null ? { alt: '', altMissing: true } : { alt: text, altMissing: false }
}

/**
 * The pixel size of one rung of a photograph `width × height`: a size is a
 * LONG EDGE, the image resized inside it and never enlarged, each side at
 * least 1 — exactly what lib/derivatives.ts gets from sharp's
 * `resize(size, size, { fit: 'inside', withoutEnlargement: true })`
 * (.mk/render-read.ts measures real sharp output: a 2×4000 photograph's 400
 * is 1×400, not 0×400).
 */
export function rasterSize(size: number, width: number, height: number): { width: number; height: number } {
  const s = Math.min(1, size / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) }
}

/**
 * The srcset candidates an asset can honestly offer: only with trusted
 * dimensions, each rung's ACTUAL width (a portrait's 1600 is not 1600 wide; a
 * 300-pixel upload's 400 is 300; a thin portrait's 400 and 800 are both 1),
 * duplicate widths dropped (the smaller file kept), at least two or none.
 */
export function assetCandidates(asset: RenderAsset): Candidate[] | null {
  if (!asset.dimensions) return null
  const { width, height } = asset.dimensions
  const seen = new Set<number>()
  const out: Candidate[] = []
  for (const size of SIZES) {
    const path = asset.derivatives[`${size}` as SizeKey]
    if (!path) continue
    const w = rasterSize(size, width, height).width
    if (seen.has(w)) continue
    seen.add(w)
    out.push({ path, width: w })
  }
  out.sort((a, b) => a.width - b.width)
  return out.length >= 2 ? out : null
}

/** A srcset string from candidates, with the caller's URL rule (photoUrl / imageSrc). */
export const srcSetOf = (candidates: readonly Candidate[], url: (path: string) => string) =>
  candidates.map((c) => `${url(c.path)} ${c.width}w`).join(', ')

function displaySize(asset: RenderAsset): { width: number | null; height: number | null } {
  if (!asset.dimensions) return { width: null, height: null }
  const { width, height } = asset.dimensions
  const rung = (Object.entries(asset.derivatives) as [SizeKey, string][]).find(([, p]) => p === asset.displayPath)
  return rung ? rasterSize(Number(rung[0]), width, height) : { width, height }
}

function assetImage(asset: RenderAsset, role: AccessibilityRole, altOverride: unknown): ResolvedImage {
  return {
    kind: 'asset',
    assetId: asset.id,
    path: asset.displayPath,
    candidates: assetCandidates(asset),
    ...displaySize(asset),
    ...altFor(role, altOverride, asset.alt),
  }
}

function refused(outcome: RefOutcome | undefined): ResolvedImage {
  if (!outcome) return { kind: 'unavailable', why: 'not_read' }
  if (outcome.outcome === 'unavailable') return { kind: 'unavailable', why: 'unavailable', reason: outcome.reason }
  if (outcome.outcome === 'ok') return { kind: 'unavailable', why: 'unbound' }
  return { kind: 'unavailable', why: outcome.outcome }
}

/**
 * One placement and the outcome of its reference (if it had one) → what to
 * render. Only an ABSENT identity renders the stored path; a claimed identity
 * renders its verified asset or nothing (see the header).
 */
export function resolvePlacement(p: Placement | null, outcome: RefOutcome | undefined): ResolvedImage {
  if (p === null) return { kind: 'none' }
  const sample = p.path !== null && isSamplePhoto(p.path)
  switch (p.identity.kind) {
    case 'absent':
      if (p.path === null) return { kind: 'none' }
      if (sample) return { kind: 'sample', path: p.path, ...altFor(p.role, p.altOverride, null) }
      return { kind: 'legacy', path: p.path, why: 'no_asset' }
    case 'malformed':
      return { kind: 'unavailable', why: 'malformed_identity' }
    case 'asset': {
      if (sample) return { kind: 'unavailable', why: 'contradictory' }
      if (!outcome || outcome.outcome !== 'ok') return refused(outcome)
      // Bound HERE, to this placement — not only by the reply parser.
      const asset = outcome.asset
      if (asset.id !== p.identity.assetId) return { kind: 'unavailable', why: 'unbound' }
      if (p.path !== null && !filesOf(asset).has(p.path)) return { kind: 'unavailable', why: 'unbound' }
      return assetImage(asset, p.role, p.altOverride)
    }
  }
}

/** A relational surface's stored path (custom cover, featured image). */
export type RelationalPlacement = {
  readonly path: string | null
  readonly altOverride: unknown
  readonly role: AccessibilityRole
}

/**
 * The reference a relational path asks about — only a render file; a sample
 * or a path outside the grammar is never asked (it resolves as `sample` or
 * `legacy`/`invalid` below).
 */
export function relationalRef(p: RelationalPlacement): RenderRef | null {
  if (p.path === null || p.path === '' || isSamplePhoto(p.path) || renderFile(p.path) === null) return null
  return relationalPathRef(p.path)
}

/**
 * A relational path and its lookup → what to render. The output contract:
 *
 *   ok, the path one of the asset's files      → asset
 *   ok for anything else                       → unavailable (unbound)
 *   missing · invalid · not_read · error        → legacy, the stored path, as before P5
 *   ambiguous · unavailable(*) · mismatch       → unavailable
 *   a sample                                    → sample
 *
 * A path outside the grammar was never asked; it resolves `legacy`/`invalid`.
 */
export function resolveRelational(p: RelationalPlacement, outcome: RefOutcome | undefined): ResolvedImage {
  if (p.path === null || p.path === '') return { kind: 'none' }
  if (isSamplePhoto(p.path)) return { kind: 'sample', path: p.path, ...altFor(p.role, p.altOverride, null) }
  if (renderFile(p.path) === null) return { kind: 'legacy', path: p.path, why: 'invalid' }
  if (!outcome) return { kind: 'legacy', path: p.path, why: 'not_read' }
  switch (outcome.outcome) {
    case 'ok':
      return filesOf(outcome.asset).has(p.path) ? assetImage(outcome.asset, p.role, p.altOverride) : { kind: 'unavailable', why: 'unbound' }
    case 'missing':
    case 'invalid':
    case 'not_read':
    case 'error':
      return { kind: 'legacy', path: p.path, why: outcome.outcome }
    default:
      return refused(outcome)
  }
}
