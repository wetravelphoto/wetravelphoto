'use client'

import { useMemo, useRef, useState } from 'react'
import SaveBar from '@/components/admin/SaveBar'
import { useRouter } from 'next/navigation'
import { uploadCustomCover, clearCustomCover, uploadCoverVideo, clearCoverVideo } from '@/app/actions/albums'
import { COVER_LAYOUTS } from '@/lib/cover-layouts'
import { COVER_FONTS, TITLE_COLORS, fontHref } from '@/lib/fonts'
import CoverRenderer, { type CoverSettings } from '@/components/CoverRenderer'
import LayoutThumb from '@/components/admin/LayoutThumb'
import TagInput from '@/components/admin/TagInput'
import { imageSrc } from '@/lib/images'
import { displayUrl, srcSetFor, srcSetFromPath } from '@/lib/srcset'
import { formatTripDate } from '@/lib/dates'
import type { Derivatives } from '@/lib/image-sizes'
import AssetPicker from '@/components/photos/AssetPicker'
import { libraryAdapter } from '@/components/photos/library-adapter'
import GalleryCover from '@/components/covers/GalleryCover'
import PhotoLayout, { type LayoutPhoto } from '@/components/gallery/PhotoLayout'
import GalleryToolbar from '@/components/GalleryToolbar'
import DevicePreview, { DEVICES, type Device } from '@/components/admin/album/DevicePreview'
import ReframeTool from '@/components/admin/album/ReframeTool'
import CoverStylePicker from '@/components/admin/album/CoverStylePicker'
import LayoutPicker from '@/components/admin/album/LayoutPicker'
import SharingPanel, { type Privacy } from '@/components/admin/album/SharingPanel'
import {
  COVER_STYLES,
  COVER_TITLE_FONTS,
  TITLE_SCALE,
  clampTitleScale,
  coverPresetValue,
  coverStyle,
  hexColor,
  orientationOf,
  titleFont,
  type CoverStyleKey,
} from '@/lib/covers/registry'
import { resolveCoverModel, secondPhotoFor, type CoverImage, type CoverInput } from '@/lib/covers/model'
import { layoutStyleOf, type LayoutStyle } from '@/lib/gallery/layouts'
import type { SharedClient } from '@/lib/clients/share'
import '@/app/gallery.css'

type Photo = {
  id: string
  storage_path: string
  derivatives?: Derivatives | null
  taken_at?: string | null
  width?: number | null
  height?: number | null
}

const OVERLAYS = [
  { value: 'none', label: 'None' },
  { value: 'darken', label: 'Darken' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'grain', label: 'Grain' },
  { value: 'darken_grain', label: 'Darken + grain' },
]

/**
 * Cover — the old Cover and Text tabs, merged. Layout — the old Grid tab.
 * Details — the old Info tab without privacy. Sharing — privacy, links and
 * clients, which used to be panels around the form on every settings page.
 */
const TABS = ['Cover', 'Layout', 'Details', 'Sharing'] as const
type Tab = (typeof TABS)[number]

/** How many photographs the live preview draws: enough to see the layout, few enough to stay quick. */
const PREVIEW_PHOTOS = 24

export default function AlbumSettingsEditor(props: {
  albumId: string
  photos: Photo[]
  publicUrl: string
  siteTitle: string
  albumTitle: string
  albumSlug: string
  albumLocation: string | null
  albumDescription: string | null
  albumCreatedAt: string | null
  customCoverPath: string | null
  customCoverSize: { width: number | null; height: number | null } | null
  coverVideoPath: string | null
  privacyType: string
  layoutStyle: string
  sortOrder: string
  tripStartDate: string | null
  initialTags: string[]
  tagSuggestions: string[]
  initialDateFormat: string
  initialShowTags: boolean
  initialGalleryHero: boolean
  initialDescAlign: string
  initialDescScale: number
  initialCoverId: string | null
  initialFocalX: number
  initialFocalY: number
  initialZoom: number | null
  initialBackground: string | null
  initialSecondaryId: string | null
  initialOverlayType: string
  initialOverlayOpacity: number
  initialTitleEnabled: boolean
  initialTitleText: string
  initialSubtitle: string
  initialLayout: string
  initialFont: string
  initialScale: number
  initialColor: string
  initialShowLocation: boolean
  initialShowDate: boolean
  initialShowButton: boolean
  initialButtonText: string
  initialAllowDownloads: boolean
  /** Sharing */
  origin: string
  sharedClients: SharedClient[]
  contacts: { id: string; name: string; email: string }[]
  emailConfigured: boolean
}) {
  const { albumId, photos, publicUrl, albumTitle, customCoverPath, coverVideoPath } = props
  const initialStyle = coverStyle(props.initialLayout)

  const [tab, setTab] = useState<Tab>('Cover')
  const [coverId, setCoverId] = useState<string | null>(props.initialCoverId ?? photos[0]?.id ?? null)
  const [focalX, setFocalX] = useState(props.initialFocalX)
  const [focalY, setFocalY] = useState(props.initialFocalY)
  const [zoom, setZoom] = useState(props.initialZoom ?? 1)
  const [background, setBackground] = useState<string | null>(hexColor(props.initialBackground))
  const [secondaryId, setSecondaryId] = useState<string | null>(props.initialSecondaryId)
  const [overlayType, setOverlayType] = useState(props.initialOverlayType || 'none')
  const [opacity, setOpacity] = useState(props.initialOverlayOpacity ?? 0.35)
  const [titleEnabled, setTitleEnabled] = useState(props.initialTitleEnabled)
  const [titleText, setTitleText] = useState(props.initialTitleText)
  const [subtitle, setSubtitle] = useState(props.initialSubtitle)
  const [layout, setLayout] = useState(props.initialLayout || 'anchor')
  // A new-style cover with a legacy face stored shows (and saves) the style's own.
  const [font, setFont] = useState(
    initialStyle && !titleFont(props.initialFont) ? initialStyle.defaults.font : props.initialFont || 'Oswald'
  )
  const [titleScale, setTitleScale] = useState(props.initialScale ?? 1)
  const [color, setColor] = useState(props.initialColor || '#FAF9F6')
  const [showLocation, setShowLocation] = useState(props.initialShowLocation)
  const [showDate, setShowDate] = useState(props.initialShowDate)
  const [showButton, setShowButton] = useState(props.initialShowButton)
  const [buttonText, setButtonText] = useState(props.initialButtonText || 'View gallery')
  const [galleryLayout, setGalleryLayout] = useState<LayoutStyle>(layoutStyleOf(props.layoutStyle))
  const [dateFormat, setDateFormat] = useState(props.initialDateFormat || 'month_year')
  const [tripDate, setTripDate] = useState(props.tripStartDate ?? '')
  const [location, setLocation] = useState(props.albumLocation ?? '')
  const [description, setDescription] = useState(props.albumDescription ?? '')
  const [sortOrder, setSortOrder] = useState(props.sortOrder || 'manual')
  const [showTags, setShowTags] = useState(props.initialShowTags)
  const [galleryHero, setGalleryHero] = useState(props.initialGalleryHero)
  const [descAlign, setDescAlign] = useState(props.initialDescAlign || 'left')
  const [descScale, setDescScale] = useState(props.initialDescScale ?? 1)
  const [tags, setTags] = useState<string[]>(props.initialTags)
  const [allowDownloads, setAllowDownloads] = useState(props.initialAllowDownloads)
  const [privacy, setPrivacy] = useState<Privacy>((props.privacyType as Privacy) || 'public')

  const [device, setDevice] = useState<Device>('desktop')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [coverAdapter] = useState(() => libraryAdapter({ publicUrl: props.publicUrl, albumIds: [props.albumId] }))
  const [reframeOpen, setReframeOpen] = useState(false)
  const [uploading, setUploading] = useState<'image' | 'video' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const style = coverStyle(layout)
  // The earlier layout's type, as it was when a style replaced it (null when the album opened on a style).
  const legacyLook = useRef<{ font: string; color: string; titleScale: number } | null>(
    initialStyle ? null : { font: props.initialFont || 'Oswald', color: props.initialColor || '#FAF9F6', titleScale: props.initialScale ?? 1 }
  )
  const selectedPhoto = photos.find((p) => p.id === coverId)
  const usingCustom = !!customCoverPath
  const videoUrl = coverVideoPath ? imageSrc(publicUrl, coverVideoPath) : null

  // The cover photograph as a view, with its own size for orientation.
  const coverImage: CoverImage | null = useMemo(() => {
    if (customCoverPath) {
      const src = imageSrc(publicUrl, customCoverPath)
      return { src, srcSet: srcSetFromPath(src), alt: '', width: props.customCoverSize?.width ?? null, height: props.customCoverSize?.height ?? null }
    }
    if (!selectedPhoto) return null
    return {
      src: displayUrl(selectedPhoto),
      srcSet: srcSetFor(selectedPhoto),
      alt: '',
      width: selectedPhoto.width ?? null,
      height: selectedPhoto.height ?? null,
    }
  }, [customCoverPath, publicUrl, props.customCoverSize, selectedPhoto])

  const orientation = orientationOf(coverImage?.width, coverImage?.height)

  // Mirror the album's sort choice so the preview reflects it
  const sortedPhotos = useMemo(
    () =>
      [...photos].sort((a, b) => {
        if (sortOrder === 'manual') return 0
        const at = a.taken_at ? new Date(a.taken_at).getTime() : 0
        const bt = b.taken_at ? new Date(b.taken_at).getTime() : 0
        return sortOrder === 'date_desc' ? bt - at : at - bt
      }),
    [photos, sortOrder]
  )

  const layoutPhotos: LayoutPhoto[] = useMemo(
    () =>
      sortedPhotos.slice(0, PREVIEW_PHOTOS).map((p) => {
        const view = { src: displayUrl(p), srcSet: srcSetFor(p), alt: '' }
        return { id: p.id, width: p.width ?? null, height: p.height ?? null, caption: null, view, full: view }
      }),
    [sortedPhotos]
  )

  const dateLabel = formatTripDate(tripDate || props.albumCreatedAt || null, dateFormat)
  // The diptych's second photograph, by the rule the page uses (a custom cover is no member).
  const secondRow =
    style?.photos === 2
      ? secondPhotoFor(
          sortedPhotos.map((p) => ({ id: p.id, width: p.width ?? null, height: p.height ?? null })),
          usingCustom ? null : coverId,
          secondaryId
        )
      : null
  const secondPhoto = secondRow ? sortedPhotos.find((p) => p.id === secondRow.id) : undefined
  const second = secondPhoto
    ? { view: { src: displayUrl(secondPhoto), srcSet: srcSetFor(secondPhoto) }, width: secondPhoto.width ?? null, height: secondPhoto.height ?? null }
    : null

  // What every cover component is given — the same resolver the pages use.
  const coverInput: CoverInput = {
    albumTitle: albumTitle,
    titleText,
    subtitle,
    showDate,
    dateLabel,
    buttonText,
    font,
    titleScale,
    titleColor: color,
    background,
    focalX,
    focalY,
    zoom,
    siteTitle: props.siteTitle,
    photo: coverImage,
    secondPhoto: second ? { ...second.view, alt: '', width: second.width, height: second.height } : null,
    backdrop: layoutPhotos.slice(0, 10).map((p) => p.view.src),
  }
  const model = style ? resolveCoverModel(style, coverInput) : null

  const legacySettings: CoverSettings = {
    title: titleEnabled ? titleText || albumTitle : '',
    subtitle: titleEnabled ? subtitle || null : null,
    location: location || null,
    dateLabel,
    showLocation: titleEnabled && showLocation,
    showDate: titleEnabled && showDate,
    layout,
    font,
    titleScale,
    color,
    focalX,
    focalY,
    overlayType,
    overlayOpacity: opacity,
    imageUrl: coverImage?.src ?? null,
    imageSrcSet: coverImage?.srcSet,
    videoUrl,
    showButton: titleEnabled && showButton,
    buttonText,
  }

  function pickStyle(key: CoverStyleKey) {
    const value = coverPresetValue(key)
    if (value === layout) return
    // Leaving an earlier layout: remember its type, so going back in this
    // session restores it rather than keeping the new style's face.
    if (!style) legacyLook.current = { font, color, titleScale }
    // Each style has its own palette and face: switching takes the new
    // style's, and the photographer adjusts from there. Stored as `v2:<key>`
    // (lib/covers/registry.ts) — never the bare key, which for `plate` is the
    // legacy layout.
    const s = COVER_STYLES[key]
    setLayout(value)
    setFont(s.defaults.font)
    setColor(s.defaults.titleColor)
    setBackground(null)
    setTitleScale(clampTitleScale(titleScale))
  }

  function pickLegacy(value: string) {
    if (style) {
      const back = legacyLook.current
      if (back) {
        setFont(back.font)
        setColor(back.color)
        setTitleScale(back.titleScale)
      } else if (!COVER_FONTS.some((f) => f.name === font)) {
        // A style's face is not one of the earlier layouts' fonts.
        setFont('Oswald')
      }
    }
    setLayout(value)
  }

  async function handleCustomUpload(files: FileList | null) {
    if (!files?.length) return
    setUploading('image')
    // A failed upload throws; the `finally` keeps the buttons from staying
    // disabled until a reload. The error still surfaces as the rejected action.
    try {
      const fd = new FormData()
      fd.append('file', files[0])
      await uploadCustomCover(albumId, fd)
      setPickerOpen(false)
      router.refresh()
    } finally {
      setUploading(null)
    }
  }

  async function handleVideoUpload(files: FileList | null) {
    if (!files?.length) return
    setUploading('video')
    try {
      const fd = new FormData()
      fd.append('file', files[0])
      await uploadCoverVideo(albumId, fd)
      setPickerOpen(false)
      router.refresh()
    } finally {
      setUploading(null)
    }
  }

  async function handleUseAlbumPhoto(photoId: string) {
    if (usingCustom) await clearCustomCover(albumId)
    setCoverId(photoId)
    setPickerOpen(false)
    router.refresh()
  }

  const titleColors = style ? style.titleColors : TITLE_COLORS
  const d = DEVICES[device]

  return (
    <>
      <SaveBar label="Save settings" title={props.albumTitle || 'Gallery settings'} />

      <div className="settings-layout">
        {!style && <link rel="stylesheet" href={fontHref(font)} />}

        {/* ================= CONTROLS ================= */}
        <div className="settings-controls">
          <div className="settings-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} data-active={tab === t}>
                {t}
              </button>
            ))}
          </div>

          {/* ---------- COVER ---------- */}
          <div hidden={tab !== 'Cover'}>
            <div className="admin-panel" style={{ marginBottom: '1rem' }}>
              <h2 className="admin-h2">Cover photo</h2>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setPickerOpen(true)} className="admin-btn admin-btn-ghost admin-btn-sm">
                  Change cover
                </button>
                <button
                  type="button"
                  onClick={() => setReframeOpen(true)}
                  disabled={!coverImage}
                  className="admin-btn admin-btn-ghost admin-btn-sm"
                >
                  Reframe
                </button>
              </div>
              <p className="admin-meta" style={{ margin: '0.6rem 0 0' }}>
                {videoUrl ? 'Video cover' : usingCustom ? 'Custom uploaded image' : selectedPhoto ? 'Album photo' : 'No cover set'}
                {zoom > 1 ? ` · zoom ${Math.round(zoom * 100)}%` : ''}
              </p>
              {videoUrl && style && (
                <p className="admin-meta" style={{ margin: '0.35rem 0 0' }}>
                  Cover styles show the photograph; the video plays with the earlier layouts.
                </p>
              )}
            </div>

            <div className="admin-panel" style={{ marginBottom: '1rem' }}>
              <h2 className="admin-h2">Style</h2>
              {coverImage ? (
                <CoverStylePicker value={style?.key ?? null} input={coverInput} orientation={orientation} onPick={pickStyle} />
              ) : (
                <p className="admin-meta" style={{ margin: 0 }}>Choose a cover photo to see the styles with it.</p>
              )}

              <details style={{ marginTop: '1rem' }} open={!style}>
                <summary className="admin-meta" style={{ cursor: 'pointer' }}>Earlier layouts</summary>
                <div className="cover-layout-grid" style={{ marginTop: '0.75rem' }}>
                  {COVER_LAYOUTS.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      onClick={() => pickLegacy(l.value)}
                      className="cover-layout-swatch"
                      data-active={layout === l.value}
                      title={l.label}
                    >
                      <div className="cover-layout-thumb">
                        <LayoutThumb value={l.value} imageUrl={coverImage?.src ?? null} />
                      </div>
                      <span>{l.label}</span>
                    </button>
                  ))}
                </div>
              </details>
            </div>

            {style?.photos === 2 && (
              <div className="admin-panel" style={{ marginBottom: '1rem' }}>
                <h2 className="admin-h2">Second photo</h2>
                <p className="admin-meta" style={{ margin: '0 0 0.6rem' }}>
                  {secondaryId ? 'Chosen by you.' : 'The next portrait in the gallery, unless you choose one.'}
                </p>
                <div className="second-photo-grid">
                  <button type="button" className="second-photo-auto" data-active={!secondaryId} onClick={() => setSecondaryId(null)}>
                    Automatic
                  </button>
                  {layoutPhotos
                    .filter((p) => usingCustom || p.id !== coverId)
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        data-active={secondaryId === p.id}
                        onClick={() => setSecondaryId(p.id)}
                        aria-label="Use as the second photo"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.view.src} srcSet={p.view.srcSet} sizes="80px" alt="" loading="lazy" />
                      </button>
                    ))}
                </div>
              </div>
            )}

            <div className="admin-panel" style={{ marginBottom: '1rem' }}>
              <h2 className="admin-h2">Text</h2>
              {!style && (
                <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={titleEnabled} onChange={(e) => setTitleEnabled(e.target.checked)} />
                  Show text over cover
                </label>
              )}

              <label className="admin-field">
                Title
                <input
                  type="text"
                  value={titleText}
                  onChange={(e) => setTitleText(e.target.value)}
                  placeholder={albumTitle}
                  className="admin-input"
                  autoComplete="off"
                />
              </label>

              {(!style || style.controls.includes('eyebrow')) && (
                <label className="admin-field">
                  {style ? 'Eyebrow' : 'Subtitle'}
                  <input
                    type="text"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    placeholder={style ? 'e.g. A family session' : 'e.g. Seven days above the Arctic Circle'}
                    className="admin-input"
                    autoComplete="off"
                  />
                </label>
              )}

              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                  <input type="checkbox" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} />
                  Show date
                </label>
                {!style && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                    <input type="checkbox" checked={showLocation} onChange={(e) => setShowLocation(e.target.checked)} />
                    Show location
                  </label>
                )}
              </div>
              {showDate && (
                <label className="admin-field">
                  Date format
                  <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} className="admin-select">
                    <option value="full">Full date — March 14, 2026</option>
                    <option value="month_year">Month and year — March 2026</option>
                    <option value="year">Year only — 2026</option>
                  </select>
                  <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
                    From the photo shoot date in Details.
                  </span>
                </label>
              )}

              {style ? (
                <label className="admin-field" style={{ marginBottom: 0 }}>
                  Button text
                  <input
                    type="text"
                    value={buttonText}
                    maxLength={40}
                    onChange={(e) => setButtonText(e.target.value)}
                    className="admin-input"
                    autoComplete="off"
                  />
                </label>
              ) : (
                <>
                  <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input type="checkbox" checked={showButton} onChange={(e) => setShowButton(e.target.checked)} />
                    Show a scroll-to-gallery button
                  </label>
                  {showButton && (
                    <label className="admin-field" style={{ marginBottom: 0 }}>
                      Button text
                      <input type="text" value={buttonText} onChange={(e) => setButtonText(e.target.value)} className="admin-input" autoComplete="off" />
                    </label>
                  )}
                </>
              )}
            </div>

            <div className="admin-panel" style={{ marginBottom: '1rem' }}>
              <h2 className="admin-h2">Title type</h2>
              <label className="admin-field">
                Font
                <select value={font} onChange={(e) => setFont(e.target.value)} className="admin-select">
                  {style
                    ? COVER_TITLE_FONTS.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name}
                          {f.weight !== 400 ? ` (${f.weight})` : ''}
                        </option>
                      ))
                    : COVER_FONTS.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name} — {f.category}
                        </option>
                      ))}
                </select>
              </label>

              <label className="admin-field">
                Title size — {Math.round(titleScale * 100)}%
                <input
                  type="range"
                  min={style ? TITLE_SCALE.min : 0.5}
                  max={style ? TITLE_SCALE.max : 2.2}
                  step={0.05}
                  value={style ? clampTitleScale(titleScale) : titleScale}
                  onChange={(e) => setTitleScale(parseFloat(e.target.value))}
                  style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
                />
              </label>

              <ColorField label="Title color" value={color} swatches={titleColors} onChange={setColor} />
              {!style && (
                <p className="admin-meta" style={{ margin: '0.4rem 0 0' }}>
                  On the light layouts (Novel, Portfolio, Journal) a very light colour falls back to dark text.
                </p>
              )}

              {style && (
                <ColorField
                  label="Background color"
                  value={background ?? style.defaults.background}
                  swatches={style.backgrounds}
                  onChange={setBackground}
                />
              )}
            </div>

            {!style && (
              <div className="admin-panel">
                <h2 className="admin-h2">Overlay</h2>
                <label className="admin-field">
                  Style
                  <select value={overlayType} onChange={(e) => setOverlayType(e.target.value)} className="admin-select">
                    {OVERLAYS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {overlayType !== 'none' && (
                  <label className="admin-field">
                    Strength — {Math.round(opacity * 100)}%
                    <input
                      type="range"
                      min="0"
                      max="0.9"
                      step="0.05"
                      value={opacity}
                      onChange={(e) => setOpacity(parseFloat(e.target.value))}
                      style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
                    />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* ---------- LAYOUT ---------- */}
          <div hidden={tab !== 'Layout'}>
            <div className="admin-panel" style={{ marginBottom: '1rem' }}>
              <h2 className="admin-h2">Gallery layout</h2>
              <LayoutPicker value={galleryLayout} photos={layoutPhotos} onPick={setGalleryLayout} />
              <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', marginBottom: 0 }}>
                <input type="checkbox" checked={galleryHero} onChange={(e) => setGalleryHero(e.target.checked)} />
                Show the first photo full width
              </label>
            </div>

            <div className="admin-panel">
              <h2 className="admin-h2">Photo order</h2>
              <label className="admin-field">
                Sort
                <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="admin-select">
                  <option value="manual">Manual (drag order in the album)</option>
                  <option value="date_asc">Date, oldest first</option>
                  <option value="date_desc">Date, newest first</option>
                </select>
              </label>
            </div>
          </div>

          {/* ---------- DETAILS ---------- */}
          <div hidden={tab !== 'Details'}>
            <div className="admin-panel">
              <h2 className="admin-h2">Album details</h2>

              <label className="admin-field">
                Title
                <input type="text" name="title" defaultValue={albumTitle} className="admin-input" autoComplete="off" />
              </label>

              <label className="admin-field">
                URL slug
                <input type="text" name="slug" defaultValue={props.albumSlug} className="admin-input" placeholder="lofoten-norway" autoComplete="off" />
                <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
                  /trips/{props.albumSlug}
                </span>
              </label>

              <label className="admin-field">
                Photo shoot date
                <input type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} className="admin-input" />
              </label>

              <div className="admin-field">
                Album tags
                <div style={{ marginTop: '0.4rem' }}>
                  <TagInput name="tags" initialTags={props.initialTags} suggestions={props.tagSuggestions} onChange={setTags} />
                </div>
              </div>

              <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} />
                Show tags on the public album page
              </label>
              <p className="admin-meta" style={{ margin: '-0.5rem 0 1rem' }}>
                Tags are always saved for searching, whether or not they&apos;re shown.
              </p>

              <label className="admin-field">
                Location
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Baja California, Mexico"
                  className="admin-input"
                  autoComplete="off"
                  data-form-type="other"
                />
              </label>

              <label className="admin-field">
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="admin-input"
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  autoComplete="off"
                />
              </label>

              <label className="admin-field">
                Description alignment
                <select value={descAlign} onChange={(e) => setDescAlign(e.target.value)} className="admin-select">
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>

              <label className="admin-field">
                Description size — {Math.round(descScale * 100)}%
                <input
                  type="range"
                  min="0.8"
                  max="1.8"
                  step="0.05"
                  value={descScale}
                  onChange={(e) => setDescScale(parseFloat(e.target.value))}
                  style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
                />
              </label>
            </div>
          </div>

          {/* ---------- SHARING ---------- */}
          <div hidden={tab !== 'Sharing'}>
            <SharingPanel
              albumId={albumId}
              albumTitle={titleText || albumTitle}
              privacy={privacy}
              onPrivacy={setPrivacy}
              allowDownloads={allowDownloads}
              onAllowDownloads={setAllowDownloads}
              albumUrl={`${props.origin}/trips/${props.albumSlug}`}
              origin={props.origin}
              clients={props.sharedClients}
              contacts={props.contacts}
              emailConfigured={props.emailConfigured}
              photographerName={props.siteTitle}
              coverUrl={coverImage?.src ?? null}
            />
          </div>

          <div style={{ marginTop: '1.25rem' }}>
            <button type="submit" className="admin-btn">
              Save settings
            </button>
          </div>
        </div>

        {/* ================= LIVE PREVIEW =================
            The same components the page draws — GalleryCover (or the legacy
            CoverRenderer), the gallery toolbar and PhotoLayout — at the
            device's true width, scaled to fit. */}
        <div className="settings-preview">
          <div className="settings-preview-inner">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <span className="admin-meta">Live preview</span>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {(Object.keys(DEVICES) as Device[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDevice(k)}
                    className="admin-btn admin-btn-sm admin-btn-ghost"
                    data-active={device === k}
                  >
                    {DEVICES[k].label}
                  </button>
                ))}
              </div>
            </div>

            <DevicePreview width={d.width} maxWidth={device === 'mobile' ? 300 : undefined} className="album-preview-frame">
              <div style={{ background: 'var(--surface, #faf9f6)' }}>
                {style && model ? (
                  <GalleryCover style={style} model={model} height={`${d.height}px`} />
                ) : coverImage || videoUrl ? (
                  <CoverRenderer settings={legacySettings} height={`${Math.round(Math.min(0.8 * d.height, 700))}px`} />
                ) : null}

                <GalleryToolbar galleryTitle={titleText || albumTitle} siteTitle={props.siteTitle} actions={[]} />

                {(description || (showTags && tags.length > 0)) && (
                  <div style={{ padding: '1.25rem clamp(1.25rem, 4vw, 3rem) 0', textAlign: descAlign as 'left' | 'center' | 'right' }}>
                    {description && (
                      <p style={{ margin: 0, color: 'var(--ink-soft, #4a4642)', lineHeight: 1.8, fontSize: `${(1.0625 * descScale).toFixed(3)}rem` }}>
                        {description}
                      </p>
                    )}
                    {showTags && tags.length > 0 && (
                      <p className="meta" style={{ margin: '0.75rem 0 0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {tags.join(' · ')}
                      </p>
                    )}
                  </div>
                )}

                <div style={{ padding: '1.5rem clamp(1.25rem, 4vw, 3rem) 3rem' }}>
                  <PhotoLayout photos={layoutPhotos} layout={galleryLayout} heroFirst={galleryHero} assumedWidth={d.width - 96} />
                </div>
              </div>
            </DevicePreview>
            {photos.length > PREVIEW_PHOTOS && (
              <p className="admin-meta" style={{ margin: '0.5rem 0 0' }}>
                The preview shows the first {PREVIEW_PHOTOS} of {photos.length} photos.
              </p>
            )}
          </div>
        </div>

        {/* ---------- Everything the form saves, from state ----------
            One block, so a control that is not on screen (another tab, a
            style that does not use it) can never drop a value: the action
            reads unchecked boxes as "off" and missing text as empty. */}
        <input type="hidden" name="cover_layout" value={layout} />
        <input type="hidden" name="cover_photo_id" value={usingCustom ? '' : (coverId ?? '')} />
        <input type="hidden" name="cover_focal_x" value={focalX} />
        <input type="hidden" name="cover_focal_y" value={focalY} />
        <input type="hidden" name="cover_zoom" value={zoom > 1 ? zoom.toFixed(2) : ''} />
        <input type="hidden" name="cover_background" value={style ? (background ?? '') : ''} />
        <input type="hidden" name="cover_secondary_photo_id" value={secondaryId ?? ''} />
        <input type="hidden" name="cover_overlay_type" value={overlayType} />
        <input type="hidden" name="cover_overlay_opacity" value={opacity} />
        {titleEnabled && <input type="hidden" name="cover_title_enabled" value="on" />}
        <input type="hidden" name="cover_title_text" value={titleText} />
        <input type="hidden" name="cover_subtitle" value={subtitle} />
        <input type="hidden" name="cover_font" value={font} />
        <input type="hidden" name="cover_title_scale" value={style ? clampTitleScale(titleScale) : titleScale} />
        <input type="hidden" name="cover_title_color" value={color} />
        {showLocation && <input type="hidden" name="cover_show_location" value="on" />}
        {showDate && <input type="hidden" name="cover_show_date" value="on" />}
        {showButton && <input type="hidden" name="cover_show_button" value="on" />}
        <input type="hidden" name="cover_button_text" value={buttonText} />
        <input type="hidden" name="cover_date_format" value={dateFormat} />
        <input type="hidden" name="layout_style" value={galleryLayout} />
        {galleryHero && <input type="hidden" name="gallery_hero" value="on" />}
        <input type="hidden" name="sort_order" value={sortOrder} />
        <input type="hidden" name="trip_start_date" value={tripDate} />
        <input type="hidden" name="location" value={location} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="description_align" value={descAlign} />
        <input type="hidden" name="description_scale" value={descScale} />
        {showTags && <input type="hidden" name="show_tags" value="on" />}

        {/* ---------- REFRAME ---------- */}
        {reframeOpen && coverImage && (
          <ReframeTool
            image={coverImage}
            frame={style ? style.slot : { wide: 16 / 10, narrow: 390 / 844 }}
            initial={{ focalX, focalY, zoom }}
            onCancel={() => setReframeOpen(false)}
            onChangePhoto={() => {
              setReframeOpen(false)
              setPickerOpen(true)
            }}
            onDone={(v) => {
              setFocalX(v.focalX)
              setFocalY(v.focalY)
              setZoom(v.zoom)
              setReframeOpen(false)
            }}
          />
        )}

        {/* ---------- COVER PICKER MODAL ---------- */}
        {pickerOpen && (
          <div className="cover-modal" onClick={() => setPickerOpen(false)}>
            <div
              className="admin-panel"
              style={{ maxWidth: 760, width: '100%', maxHeight: '82vh', overflowY: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h2 className="admin-h2" style={{ margin: 0 }}>
                  Cover media
                </h2>
                <button type="button" onClick={() => setPickerOpen(false)} className="admin-btn admin-btn-ghost admin-btn-sm">
                  Close
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <div style={{ border: '1px dashed var(--admin-line)', padding: '1rem', textAlign: 'center' }}>
                  <p style={{ margin: '0 0 0.4rem', fontSize: '0.85rem' }}>{uploading === 'image' ? 'Uploading…' : 'Custom image'}</p>
                  <p className="admin-meta" style={{ margin: '0 0 0.7rem' }}>
                    Cover only — stays out of the gallery.
                  </p>
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={!!uploading} className="admin-btn admin-btn-sm">
                    Choose image
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => handleCustomUpload(e.target.files)} />
                  {usingCustom && (
                    <button
                      type="button"
                      onClick={async () => {
                        await clearCustomCover(albumId)
                        router.refresh()
                      }}
                      className="admin-btn admin-btn-sm admin-btn-danger"
                      style={{ marginTop: '0.5rem' }}
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div style={{ border: '1px dashed var(--admin-line)', padding: '1rem', textAlign: 'center' }}>
                  <p style={{ margin: '0 0 0.4rem', fontSize: '0.85rem' }}>{uploading === 'video' ? 'Uploading…' : 'Video cover'}</p>
                  <p className="admin-meta" style={{ margin: '0 0 0.7rem' }}>
                    Short MP4, plays muted on loop. Under ~15 MB.
                  </p>
                  <button type="button" onClick={() => videoRef.current?.click()} disabled={!!uploading} className="admin-btn admin-btn-sm">
                    Choose video
                  </button>
                  <input ref={videoRef} type="file" accept="video/mp4,video/webm" hidden onChange={(e) => handleVideoUpload(e.target.files)} />
                  {videoUrl && (
                    <button
                      type="button"
                      onClick={async () => {
                        await clearCoverVideo(albumId)
                        router.refresh()
                      }}
                      className="admin-btn admin-btn-sm admin-btn-danger"
                      style={{ marginTop: '0.5rem' }}
                    >
                      Remove video
                    </button>
                  )}
                </div>
              </div>

              {photos.length > 0 && (
                <div style={{ border: '1px dashed var(--admin-line)', padding: '1rem', textAlign: 'center' }}>
                  <p style={{ margin: '0 0 0.4rem', fontSize: '0.85rem' }}>A photograph from this gallery</p>
                  <p className="admin-meta" style={{ margin: '0 0 0.7rem' }}>
                    {!usingCustom && selectedPhoto ? 'One of this gallery’s photographs is the cover.' : 'Use one of this gallery’s own photographs.'}
                  </p>
                  <button type="button" onClick={() => setChoosing(true)} disabled={!!uploading} className="admin-btn admin-btn-sm">
                    Choose from this gallery
                  </button>
                </div>
              )}

              {choosing && (
                <AssetPicker
                  adapter={coverAdapter}
                  mode="single"
                  /*
                   * A chosen cover is one of THIS gallery's rows (cover_photo_id),
                   * so the picker offers memberships of this gallery only; a
                   * photograph in no gallery cannot be one. updateAlbumSettings
                   * still checks the row belongs to the album. The cover stores
                   * no description, so none is asked for.
                   */
                  slot={{ label: `Cover · ${albumTitle}`, role: 'decorative' }}
                  capabilities={{ identity: 'membership', albumIds: [albumId] }}
                  initialSource={{ id: `album:${albumId}`, kind: 'album', label: albumTitle }}
                  current={!usingCustom && selectedPhoto ? [{ photoId: selectedPhoto.id, path: selectedPhoto.storage_path }] : []}
                  title="Choose the cover"
                  confirmLabel="Use as cover"
                  onClose={() => setChoosing(false)}
                  onConfirm={(result) => {
                    setChoosing(false)
                    const photoId = result.choices[0]?.membership?.photoId
                    if (photoId && photos.some((p) => p.id === photoId)) void handleUseAlbumPhoto(photoId)
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

/** Swatches plus a custom colour. Only #RRGGBB is ever kept. */
function ColorField({
  label,
  value,
  swatches,
  onChange,
}: {
  label: string
  value: string
  swatches: readonly string[]
  onChange: (hex: string) => void
}) {
  const current = value.toUpperCase()
  return (
    <div className="admin-field">
      {label}
      <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c.toUpperCase())}
            aria-label={c}
            aria-pressed={current === c.toUpperCase()}
            style={{
              width: 26,
              height: 26,
              background: c,
              border: current === c.toUpperCase() ? '2px solid var(--admin-accent)' : '0.5px solid var(--admin-line)',
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
        <input
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value.toLowerCase() : '#000000'}
          onChange={(e) => {
            const hex = hexColor(e.target.value)
            if (hex) onChange(hex)
          }}
          aria-label={`${label}, custom`}
          style={{ width: 34, height: 26, padding: 0, border: '0.5px solid var(--admin-line)', background: 'none' }}
        />
      </div>
    </div>
  )
}
