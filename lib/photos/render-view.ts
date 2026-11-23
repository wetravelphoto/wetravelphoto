import { SIZES, type SizeKey } from '@/lib/image-sizes'
import { imageSrc, photoUrl } from '@/lib/images'
import { displayUrl, srcSetFor, srcSetFromPath, type Sizeable } from '@/lib/srcset'
import {
  placementRef,
  readIdentity,
  refKey,
  relationalRef,
  resolvePlacement,
  resolveRelational,
  sectionPlacement,
  srcSetOf,
  type AccessibilityRole,
  type Placement,
  type RefOutcome,
  type RenderRef,
  type ResolvedImage,
} from '@/lib/photos/image'
import { photoBundles, photoRole } from '@/lib/sections/image-bundle'
import { BASE_DEVICE, type Device } from '@/lib/sections/devices'
import type { SectionDef, SectionSettings } from '@/lib/sections/registry'
import type { Block, BlockImage } from '@/lib/blocks'

/**
 * FROM AN AUTHORISED ANSWER TO WHAT A RENDERER DRAWS
 * ═══════════════════════════════════════════════════
 *
 * P5, render integration. Pure: no database, no request, no grant. It never
 * decides WHO may see a photograph — lib/photos/public.ts does that, source by
 * source, before a single reference is collected — it only turns the answers
 * that request was given into the few values a renderer needs.
 *
 * Three ways a source names a photograph, three rules (lib/photos/image.ts):
 *
 *   PLACEMENT    a section setting or a story block: a path, and the identity
 *                the picker stored beside it. No identity → `legacy`, today's
 *                markup exactly. An identity → its verified asset, or nothing.
 *   MEMBERSHIP   a gallery photograph (`photos` row, its own id, its asset_id
 *                key). No asset_id → `legacy`. An asset_id → its verified asset,
 *                or nothing — exactly the placement rule. The P4 key binds
 *                (asset_id, tenant_id) to an asset, NOT the row's storage_path
 *                or derivatives to that asset's files, so a row may name asset
 *                A beside a file of B; a lookup that learned nothing (budget,
 *                outage, refused reply) therefore never draws the row's files.
 *   RELATIONAL   a path stored with no identity (custom cover, featured image,
 *                share image): image.ts's resolveRelational.
 *
 * ── What leaves this module ─────────────────────────────────────────────────
 * `ImageView` — a URL, an optional srcset, the alt text. Nothing else: no
 * asset id, no key base, no derivative map, no dimensions, no row. A client
 * component is handed only this.
 *
 * ── Widths ──────────────────────────────────────────────────────────────────
 * A srcset with `w` descriptors only from TRUSTED dimensions (assetCandidates).
 * Without them, no descriptor is invented: one file is chosen, the largest of
 * the asset's own sizes that does not exceed what the slot can use (`Fit`), so
 * a grid of thumbnails does not download its full-screen files.
 */

// ── Pictures ────────────────────────────────────────────────────────────────

/** One resolved photograph, server-side. `asset.files` are its own render files only. */
export type Picture =
  | { readonly kind: 'none' }
  /** Draw exactly what the surface drew before P5, from this stored path. */
  | { readonly kind: 'legacy'; readonly path: string }
  | { readonly kind: 'sample'; readonly path: string; readonly alt: string; readonly altMissing: boolean }
  | {
      readonly kind: 'asset'
      readonly display: string
      readonly files: Readonly<Partial<Record<SizeKey, string>>>
      /** Trusted srcset candidates, or null. */
      readonly candidates: ReadonlyArray<{ readonly path: string; readonly width: number }> | null
      /** The display file's trusted upright size, or null. Server-side only (`coverSizes`). */
      readonly width: number | null
      readonly height: number | null
      readonly alt: string
      readonly altMissing: boolean
    }

export const NO_PICTURE: Picture = Object.freeze({ kind: 'none' })

/** The answers one request was given, by reference. Only lib/photos/public.ts fills one. */
export type RenderOutcomes = ReadonlyMap<string, RefOutcome>

export const NO_OUTCOMES: RenderOutcomes = new Map()

export function outcomesOf(refs: readonly RenderRef[], outcomes: readonly RefOutcome[]): Map<string, RefOutcome> {
  const out = new Map<string, RefOutcome>()
  refs.forEach((r, i) => out.set(refKey(r), outcomes[i]!))
  return out
}

const outcomeFor = (outcomes: RenderOutcomes, ref: RenderRef | null) => (ref ? outcomes.get(refKey(ref)) : undefined)

/**
 * A resolution → a Picture. An `asset` must have come from an `ok` outcome for
 * the very asset named (resolvePlacement / resolveRelational guarantee it); its
 * file map is taken from that outcome, which the reply parser has already held
 * to `<key base>/<size>.webp` under this site.
 */
export function toPicture(r: ResolvedImage, outcome: RefOutcome | undefined): Picture {
  switch (r.kind) {
    case 'none':
    case 'unavailable':
      return NO_PICTURE
    case 'legacy':
      return { kind: 'legacy', path: r.path }
    case 'sample':
      return { kind: 'sample', path: r.path, alt: r.alt, altMissing: r.altMissing }
    case 'asset': {
      if (!outcome || outcome.outcome !== 'ok' || outcome.asset.id !== r.assetId) return NO_PICTURE
      return {
        kind: 'asset',
        display: r.path,
        files: { ...outcome.asset.derivatives },
        candidates: r.candidates,
        width: r.width,
        height: r.height,
        alt: r.alt,
        altMissing: r.altMissing,
      }
    }
  }
}

// ── Sections ────────────────────────────────────────────────────────────────

type SectionLike = { readonly visible: boolean; readonly def: Pick<SectionDef, 'fields'>; readonly settings: SectionSettings }

/**
 * Every reference the drawn sections of one page ask about: each photograph
 * slot on each size that names an identity. Hidden sections are not drawn and
 * ask nothing. A slot with no identity asks nothing — it renders its path.
 */
export function sectionRefs(sections: readonly SectionLike[]): RenderRef[] {
  const out: RenderRef[] = []
  for (const s of sections) {
    if (!s.visible) continue
    for (const { field, device } of photoBundles(s.def)) {
      const ref = placementRef(sectionPlacement(s.settings, field.key, photoRole(field), device) ?? EMPTY_PLACEMENT)
      if (ref) out.push(ref)
    }
  }
  return out
}

const EMPTY_PLACEMENT: Placement = { path: null, identity: { kind: 'absent' }, altOverride: null, role: 'content' }

/** One section photograph on one size, as this request may draw it. */
export function sectionPicture(
  outcomes: RenderOutcomes,
  settings: SectionSettings,
  field: string,
  role: AccessibilityRole,
  device: Device = BASE_DEVICE
): Picture {
  const p = sectionPlacement(settings, field, role, device)
  const o = p ? outcomeFor(outcomes, placementRef(p)) : undefined
  return toPicture(resolvePlacement(p, o), o)
}

// ── Story blocks ────────────────────────────────────────────────────────────

/** A story's image object: a placement whose role is always content. */
export type BlockImageLike = { readonly path?: unknown; readonly assetId?: unknown; readonly alt?: unknown }

export function blockPlacement(image: BlockImageLike): Placement | null {
  const path = typeof image.path === 'string' && image.path !== '' ? image.path : null
  const identity = readIdentity(image.assetId)
  if (path === null) return identity.kind === 'absent' ? null : { path: null, identity: { kind: 'malformed' }, altOverride: image.alt, role: 'content' }
  return { path, identity, altOverride: image.alt, role: 'content' }
}

export const blockRef = (image: BlockImageLike): RenderRef | null => {
  const p = blockPlacement(image)
  return p ? placementRef(p) : null
}

export function blockPicture(outcomes: RenderOutcomes, image: BlockImageLike): Picture {
  const p = blockPlacement(image)
  const o = p ? outcomeFor(outcomes, placementRef(p)) : undefined
  return toPicture(resolvePlacement(p, o), o)
}

// ── Gallery memberships ─────────────────────────────────────────────────────

/** The columns of a `photos` row a membership needs. */
export type MemberRow = Sizeable & { readonly asset_id?: unknown; readonly alt_text?: string | null }

/** The file a gallery photograph is displayed from — exactly `displayUrl`'s choice, as a key. */
export function memberPath(row: Sizeable): string {
  const set = row.derivatives
  return set?.['2400'] ?? set?.['1600'] ?? set?.['800'] ?? set?.['400'] ?? row.storage_path
}

function memberPlacement(row: MemberRow, role: AccessibilityRole): Placement {
  return { path: memberPath(row), identity: readIdentity(row.asset_id), altOverride: row.alt_text ?? null, role }
}

export const memberRef = (row: MemberRow): RenderRef | null => placementRef(memberPlacement(row, 'content'))

/**
 * A gallery photograph → what to draw. The row's own `alt_text` is the
 * placement's description. No asset_id → the row's files, exactly as before
 * P5 (a sample included). An asset_id → only a verified answer for exactly
 * (that asset, the row's display file); every other outcome — not read, error,
 * missing, mismatch, unavailable — draws nothing, never the row's files.
 */
export function memberPicture(outcomes: RenderOutcomes, row: MemberRow, role: AccessibilityRole): Picture {
  const p = memberPlacement(row, role)
  if (p.identity.kind === 'absent') return { kind: 'legacy', path: row.storage_path }
  const o = outcomeFor(outcomes, placementRef(p))
  return toPicture(resolvePlacement(p, o), o)
}

// ── Relational paths ────────────────────────────────────────────────────────

export const relationalPictureRef = (path: string | null | undefined): RenderRef | null =>
  relationalRef({ path: path ?? null, altOverride: null, role: 'content' })

export function relationalPicture(
  outcomes: RenderOutcomes,
  path: string | null | undefined,
  role: AccessibilityRole,
  altOverride: unknown = null
): Picture {
  const p = { path: path ?? null, altOverride, role }
  const o = outcomeFor(outcomes, relationalRef(p))
  return toPicture(resolveRelational(p, o), o)
}

// ── Drawing ─────────────────────────────────────────────────────────────────

/** What a renderer, server or client, is given for one image. */
export type ImageView = {
  readonly src: string
  readonly srcSet?: string
  readonly alt: string
}

/** How large a slot can ever draw a photograph — caps the one file chosen when no width is trusted. */
export type Fit = 'full' | 'grid' | 'thumb'
const CAP: Record<Fit, number> = { full: 2400, grid: 1600, thumb: 800 }

/** The asset's own file for a slot: the largest size within the cap, else the display file. */
export function fileFor(p: Extract<Picture, { kind: 'asset' }>, fit: Fit): string {
  let best: string | null = null
  for (const size of SIZES) {
    const f = p.files[`${size}` as SizeKey]
    if (f && size <= CAP[fit]) best = f
  }
  return best ?? p.display
}

/**
 * A Picture → the markup values, or null to draw nothing. `legacy` is handed
 * to the caller's own pre-P5 rule, so an old page keeps its exact output.
 */
export function pictureView(p: Picture, fit: Fit, legacy: (path: string) => ImageView): ImageView | null {
  switch (p.kind) {
    case 'none':
      return null
    case 'legacy':
      return legacy(p.path)
    case 'sample':
      return { src: photoUrl(p.path), alt: p.alt }
    case 'asset':
      return p.candidates
        ? { src: photoUrl(p.display), srcSet: srcSetOf(p.candidates, photoUrl), alt: p.alt }
        : { src: photoUrl(fileFor(p, fit)), alt: p.alt }
  }
}

/**
 * The `sizes` of a photograph that COVERS the viewport (the hero): as wide as
 * the screen, or wider when the screen is taller than the photograph — a
 * landscape photograph covering a portrait phone is drawn at the screen's
 * height times its own aspect. Only with a trusted srcset and size; otherwise
 * undefined, and no `sizes` is written (the browser's default, 100vw).
 */
export function coverSizes(p: Picture): string | undefined {
  if (p.kind !== 'asset' || !p.candidates || !p.width || !p.height) return undefined
  return `max(100vw, ${Math.ceil((100 * p.width) / p.height)}vh)`
}

/** True when an asset-aware content image has no description to give. For the editor only. */
export const altMissing = (p: Picture) => (p.kind === 'asset' || p.kind === 'sample') && p.altMissing

/**
 * In the editor's preview only: marks a content photograph that has no
 * description, for the canvas to point at (the picker carries the approved
 * warning text). The public page never carries it.
 */
export const altFlag = (editable: boolean, p: Picture): Record<string, string> =>
  editable && altMissing(p) ? { 'data-alt-missing': '' } : {}

/** A gallery photograph's pre-P5 markup values. */
export const legacyMemberView = (row: Sizeable & { readonly alt_text?: string | null; readonly caption?: string | null }): ImageView => ({
  src: displayUrl(row),
  srcSet: srcSetFor(row),
  alt: row.alt_text ?? row.caption ?? '',
})

// ── Per-surface views — what each client component is handed ───────────────

/**
 * A gallery photograph for the browser. Its `photos` id (favourites, downloads,
 * prints) and the row's own layout dimensions, as before — and three image
 * views. No path, no asset id, no derivative map, no row.
 */
export type GalleryPhotoView = {
  readonly id: string
  readonly caption: string | null
  readonly is_for_sale: boolean
  readonly width: number | null
  readonly height: number | null
  /** In the grid. */
  readonly view: ImageView
  /** Full size: the lightbox and a hero-first photograph. */
  readonly full: ImageView
  /** The slideshow's one file. */
  readonly slide: ImageView
}

export type GalleryRow = MemberRow & {
  readonly id: string
  readonly caption: string | null
  readonly is_for_sale?: boolean | null
  readonly width: number | null
  readonly height: number | null
}

/** One gallery photograph → its view, or null when it must not be drawn. */
export function galleryPhotoView(outcomes: RenderOutcomes, row: GalleryRow, publicUrl: string): GalleryPhotoView | null {
  const base = {
    id: row.id,
    caption: row.caption ?? null,
    is_for_sale: row.is_for_sale === true,
    width: row.width ?? null,
    height: row.height ?? null,
  }
  const p = memberPicture(outcomes, row, 'content')
  if (p.kind === 'none') return null
  if (p.kind === 'legacy') {
    const v = legacyMemberView(row)
    return { ...base, view: v, full: v, slide: { src: imageSrc(publicUrl, row.storage_path), alt: row.caption ?? '' } }
  }
  const view = pictureView(p, 'grid', () => legacyMemberView(row))!
  const full = pictureView(p, 'full', () => legacyMemberView(row))!
  return { ...base, view, full, slide: { src: full.src, alt: full.alt } }
}

/** A cover as the card and cover components take it. */
export type CoverView = { readonly coverUrl: string | null; readonly coverSrcSet: string | undefined }

const NO_COVER: CoverView = { coverUrl: null, coverSrcSet: undefined }

/** A cover source, resolved. Covers are decorative: the title beside them says what they are. */
export function coverView(
  outcomes: RenderOutcomes,
  source: { kind: 'custom'; path: string } | { kind: 'member'; row: MemberRow } | { kind: 'none' } | undefined,
  fit: Fit,
  legacyMember: (row: MemberRow) => ImageView = legacyMemberView
): CoverView {
  if (!source || source.kind === 'none') return NO_COVER
  const picture =
    source.kind === 'custom'
      ? relationalPicture(outcomes, source.path, 'decorative')
      : memberPicture(outcomes, source.row, 'decorative')
  const view = pictureView(picture, fit, (path) => {
    if (source.kind === 'member') return legacyMember(source.row)
    // Custom covers have no derivatives column; the ladder comes from the path.
    const url = photoUrl(path)
    return { src: url, srcSet: srcSetFromPath(url), alt: '' }
  })
  return view ? { coverUrl: view.src, coverSrcSet: view.srcSet } : NO_COVER
}

/** A story's featured image on a card or in a sequence: decorative, its title beside it. */
export function featuredCardView(outcomes: RenderOutcomes, path: string | null | undefined, fit: Fit): ImageView | null {
  return pictureView(relationalPicture(outcomes, path, 'decorative'), fit, (p) => {
    const url = photoUrl(p)
    return { src: url, srcSet: srcSetFromPath(url), alt: '' }
  })
}

/** A story image for PostBody: its caption and its view. Nothing else crosses to the browser. */
export type PostImageView = { readonly caption: string | null; readonly view: ImageView | null }

/**
 * What PostBody draws an image from: a `view` already resolved by an
 * authorised server path (the public story page; the editor's StoryPreview
 * through its requireEditor-gated library read) — or, ONLY for a block that
 * names no photograph identity, the block's path, alt and caption exactly as
 * before P5. A block that names an identity and arrives without a view draws
 * nothing (PostBody's `postView`): a raw path beside a claimed identity is
 * never drawn.
 */
export type PostImage = {
  readonly path?: string
  readonly caption?: string | null
  readonly alt?: string | null
  /** The block's stored identity, when it arrives raw. Read only to refuse. */
  readonly assetId?: unknown
  readonly view?: ImageView | null
}

type WithPostImages<B> = B extends { image: BlockImage }
  ? Omit<B, 'image'> & { image: PostImage }
  : B extends { left: BlockImage; right: BlockImage }
    ? Omit<B, 'left' | 'right'> & { left: PostImage; right: PostImage }
    : B extends { images: BlockImage[] }
      ? Omit<B, 'images'> & { images: PostImage[] }
      : B

/** A story block as PostBody takes it. Every `Block` is one. */
export type PostBlock = WithPostImages<Block>

/** One story image object → what PostBody draws for it. */
export function postImageView(outcomes: RenderOutcomes, image: BlockImageLike & { readonly caption?: unknown }, publicUrl: string): PostImageView {
  const caption = typeof image.caption === 'string' ? image.caption : null
  const view = pictureView(blockPicture(outcomes, image), 'full', (path) => ({
    src: imageSrc(publicUrl, path),
    // The story's own pre-P5 rule, kept for a block with no identity.
    alt: (image.alt as string | null | undefined) ?? caption ?? '',
  }))
  return { caption, view }
}
