import {
  clampFocal,
  clampTitleScale,
  clampZoom,
  hexColor,
  titleFont,
  type CoverStyle,
  type CoverTitleFont,
} from '@/lib/covers/registry'

/**
 * WHAT A COVER COMPONENT IS GIVEN
 * ═══════════════════════════════
 *
 * One pure function, `resolveCoverModel`, turns an album's stored cover values
 * into the props every cover component takes. The public gallery, the client
 * link and the editor's live preview all call it — the editor with its unsaved
 * state, the pages with the row — so the preview is the page by construction:
 * same resolver, same component.
 *
 * Images arrive as views (a URL, a srcset, alt text, the photograph's own
 * size), never as rows or storage paths.
 */

export type CoverImage = {
  readonly src: string
  readonly srcSet?: string
  readonly alt: string
  readonly width: number | null
  readonly height: number | null
}

export type CoverModel = {
  readonly title: string
  readonly eyebrow: string | null
  readonly dateLabel: string | null
  readonly buttonText: string
  /** The photographer's name, as the site calls itself. */
  readonly siteTitle: string
  readonly font: CoverTitleFont
  readonly titleScale: number
  readonly titleColor: string
  readonly background: string
  readonly photo: CoverImage | null
  readonly secondPhoto: CoverImage | null
  /** Small views of the album's own photographs, for a style that draws them behind the cover. */
  readonly backdrop: readonly string[]
  readonly focalX: number
  readonly focalY: number
  readonly zoom: number
}

/** The album's cover values as stored (or as the editor holds them unsaved). */
export type CoverInput = {
  albumTitle: string
  titleText?: string | null
  subtitle?: string | null
  showDate?: boolean | null
  dateLabel?: string | null
  buttonText?: string | null
  font?: string | null
  titleScale?: number | string | null
  titleColor?: string | null
  background?: string | null
  focalX?: number | string | null
  focalY?: number | string | null
  zoom?: number | string | null
  siteTitle: string
  photo: CoverImage | null
  secondPhoto?: CoverImage | null
  backdrop?: readonly string[]
}

const BACKDROP_MAX = 10

export function resolveCoverModel(style: CoverStyle, input: CoverInput): CoverModel {
  const uses = (c: CoverStyle['controls'][number]) => style.controls.includes(c)
  const title = (input.titleText ?? '').trim() || input.albumTitle.trim() || 'Gallery'
  const eyebrow = uses('eyebrow') ? (input.subtitle ?? '').trim() || null : null
  const dateLabel = input.showDate === true && input.dateLabel ? input.dateLabel : null
  const buttonText = (input.buttonText ?? '').trim().slice(0, 40) || 'View gallery'
  return {
    title,
    eyebrow,
    dateLabel,
    buttonText,
    siteTitle: input.siteTitle,
    font: titleFont(input.font) ?? titleFont(style.defaults.font)!,
    titleScale: clampTitleScale(input.titleScale ?? 1),
    titleColor: hexColor(input.titleColor) ?? style.defaults.titleColor,
    background: hexColor(input.background) ?? style.defaults.background,
    photo: input.photo,
    secondPhoto: style.photos === 2 ? (input.secondPhoto ?? null) : null,
    backdrop: style.usesAlbumBackdrop ? (input.backdrop ?? []).slice(0, BACKDROP_MAX) : [],
    focalX: clampFocal(input.focalX),
    focalY: clampFocal(input.focalY),
    zoom: clampZoom(input.zoom),
  }
}

/**
 * The second photograph of a two-photograph style: the one chosen, else the
 * album's next portrait after the cover, else its next photograph at all.
 * `photos` in display order; ids are the album's own `photos` rows.
 */
export function secondPhotoFor<T extends { id: string; width: number | null; height: number | null }>(
  photos: readonly T[],
  coverId: string | null,
  chosenId: string | null
): T | null {
  if (chosenId) {
    const chosen = photos.find((p) => p.id === chosenId && p.id !== coverId)
    if (chosen) return chosen
  }
  // The photographs after the cover first, then the ones before it.
  const at = coverId ? photos.findIndex((p) => p.id === coverId) : -1
  const order = at >= 0 ? [...photos.slice(at + 1), ...photos.slice(0, at)] : [...photos]
  const candidates = order.filter((p) => p.id !== coverId)
  return candidates.find((p) => !!p.width && !!p.height && p.height > p.width) ?? candidates[0] ?? null
}
