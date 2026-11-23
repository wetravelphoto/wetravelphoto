import { formatTripDate } from '@/lib/dates'
import { coverStyle, type CoverStyleKey } from '@/lib/covers/registry'
import { resolveCoverModel, secondPhotoFor, type CoverImage, type CoverModel } from '@/lib/covers/model'
import type { GalleryPhotoView, ImageView } from '@/lib/photos/render-view'
import type { CoverSettings } from '@/components/CoverRenderer'

/**
 * An album row, past its gate, → the cover a page draws: the style's key and
 * its resolved model — or null when the album's `cover_preset` is a legacy
 * value, which keeps its current rendering (components/CoverRenderer.tsx).
 *
 * Takes only what the page has already resolved through its own gate (the
 * cover's view, the album's photograph views); reads nothing.
 */

/** The album columns a cover reads. */
export const COVER_COLUMNS = [
  'cover_preset', 'cover_title_enabled', 'cover_title_text', 'cover_subtitle', 'cover_show_date', 'cover_date_format',
  'cover_button_text', 'cover_font', 'cover_title_scale', 'cover_title_color', 'cover_background', 'cover_focal_x',
  'cover_focal_y', 'cover_zoom', 'cover_photo_id', 'cover_secondary_photo_id', 'cover_custom_path', 'trip_start_date',
  'created_at',
] as const

export type AlbumCover = { styleKey: CoverStyleKey; model: CoverModel }

/**
 * A legacy preset's settings for components/CoverRenderer.tsx — exactly what
 * /trips/<slug> has always passed it, factored out so the client link can draw
 * a legacy cover the same way.
 */
export function legacyCoverSettings(
  album: Record<string, unknown>,
  image: { src: string; srcSet?: string } | null,
  videoUrl: string | null = null
): CoverSettings {
  const showText = album.cover_title_enabled !== false
  return {
    title: showText ? String((album.cover_title_text as string) || album.title || '') : '',
    subtitle: showText ? ((album.cover_subtitle as string | null) ?? null) : null,
    location: (album.location as string | null) ?? null,
    dateLabel: formatTripDate(
      (album.trip_start_date as string | null) ?? (album.created_at as string | null) ?? null,
      (album.cover_date_format as string | null) ?? 'month_year'
    ),
    showLocation: showText && album.cover_show_location === true,
    showDate: showText && album.cover_show_date === true,
    layout: (album.cover_preset as string | null) ?? null,
    font: (album.cover_font as string | null) ?? null,
    titleScale: (album.cover_title_scale as number | null) ?? 1,
    color: (album.cover_title_color as string | null) ?? null,
    focalX: (album.cover_focal_x as number | null) ?? 0.5,
    focalY: (album.cover_focal_y as number | null) ?? 0.5,
    overlayType: (album.cover_overlay_type as string | null) ?? null,
    overlayOpacity: (album.cover_overlay_opacity as number | null) ?? 0.35,
    imageUrl: image?.src ?? null,
    imageSrcSet: image?.srcSet,
    videoUrl,
    showButton: showText && album.cover_show_button === true,
    buttonText: (album.cover_button_text as string | null) ?? null,
  }
}

export function albumCover(input: {
  album: Record<string, unknown>
  /** The cover photograph as the page resolved it, or null. */
  cover: ImageView | null
  /** The album's photographs in display order, as views. */
  photos: readonly GalleryPhotoView[]
  siteTitle: string
}): AlbumCover | null {
  const { album, photos } = input
  const style = coverStyle(album.cover_preset as string | null)
  if (!style) return null

  const coverId = typeof album.cover_photo_id === 'string' && !album.cover_custom_path ? album.cover_photo_id : null
  // The cover's own size, when it is one of the album's photographs (a custom
  // cover keeps none; it is then treated as landscape, the common case).
  // (The same choice coverSources made: the chosen photograph, else the first.)
  const member = album.cover_custom_path ? null : (photos.find((p) => p.id === coverId) ?? photos[0] ?? null)
  const photo: CoverImage | null = input.cover
    ? { ...input.cover, alt: '', width: member?.width ?? null, height: member?.height ?? null }
    : null

  const second = style.photos === 2
    ? secondPhotoFor(photos, member?.id ?? coverId, (album.cover_secondary_photo_id as string | null) ?? null)
    : null

  return {
    styleKey: style.key,
    model: resolveCoverModel(style, {
      albumTitle: String(album.title ?? ''),
      titleText: album.cover_title_text as string | null,
      subtitle: album.cover_subtitle as string | null,
      showDate: album.cover_show_date === true,
      dateLabel: formatTripDate(
        (album.trip_start_date as string | null) ?? (album.created_at as string | null) ?? null,
        (album.cover_date_format as string | null) ?? 'month_year'
      ),
      buttonText: album.cover_button_text as string | null,
      font: album.cover_font as string | null,
      titleScale: album.cover_title_scale as number | null,
      titleColor: album.cover_title_color as string | null,
      background: album.cover_background as string | null,
      focalX: album.cover_focal_x as number | null,
      focalY: album.cover_focal_y as number | null,
      zoom: album.cover_zoom as number | null,
      siteTitle: input.siteTitle,
      photo,
      secondPhoto: second ? { ...second.view, alt: '', width: second.width, height: second.height } : null,
      backdrop: photos.slice(0, 10).map((p) => p.view.src),
    }),
  }
}
