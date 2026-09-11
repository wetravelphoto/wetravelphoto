'use client'

import { useState, useRef } from 'react'
import SaveBar from '@/components/admin/SaveBar'
import { useRouter } from 'next/navigation'
import { uploadCustomCover, clearCustomCover, uploadCoverVideo, clearCoverVideo } from '@/app/actions/albums'
import { COVER_LAYOUTS } from '@/lib/cover-layouts'
import { COVER_FONTS, TITLE_COLORS, fontHref } from '@/lib/fonts'
import CoverRenderer, { type CoverSettings } from '@/components/CoverRenderer'
import LayoutThumb from '@/components/admin/LayoutThumb'
import TagInput from '@/components/admin/TagInput'

type Photo = { id: string; storage_path: string; taken_at?: string | null }

const OVERLAYS = [
  { value: 'none', label: 'None' },
  { value: 'darken', label: 'Darken' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'grain', label: 'Grain' },
  { value: 'darken_grain', label: 'Darken + grain' },
]

const TABS = ['Cover', 'Text', 'Grid', 'Info'] as const
type Tab = (typeof TABS)[number]

export default function AlbumSettingsEditor(props: {
  albumId: string
  photos: Photo[]
  publicUrl: string
  albumTitle: string
  albumSlug: string
  albumLocation: string | null
  albumDescription: string | null
  albumDateLabel: string | null
  customCoverPath: string | null
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
}) {
  const { albumId, photos, publicUrl, albumTitle, albumLocation, albumDateLabel, customCoverPath, coverVideoPath } = props

  const [tab, setTab] = useState<Tab>('Cover')
  const [coverId, setCoverId] = useState<string | null>(props.initialCoverId ?? photos[0]?.id ?? null)
  const [focalX, setFocalX] = useState(props.initialFocalX)
  const [focalY, setFocalY] = useState(props.initialFocalY)
  const [overlayType, setOverlayType] = useState(props.initialOverlayType || 'none')
  const [opacity, setOpacity] = useState(props.initialOverlayOpacity ?? 0.35)
  const [titleEnabled, setTitleEnabled] = useState(props.initialTitleEnabled)
  const [titleText, setTitleText] = useState(props.initialTitleText)
  const [subtitle, setSubtitle] = useState(props.initialSubtitle)
  const [layout, setLayout] = useState(props.initialLayout || 'anchor')
  const [font, setFont] = useState(props.initialFont || 'Oswald')
  const [titleScale, setTitleScale] = useState(props.initialScale ?? 1)
  const [color, setColor] = useState(props.initialColor || '#FAF9F6')
  const [showLocation, setShowLocation] = useState(props.initialShowLocation)
  const [showDate, setShowDate] = useState(props.initialShowDate)
  const [showButton, setShowButton] = useState(props.initialShowButton)
  const [buttonText, setButtonText] = useState(props.initialButtonText || 'View gallery')
  const [galleryLayout, setGalleryLayout] = useState(props.layoutStyle || 'masonry')
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

  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [focalOpen, setFocalOpen] = useState(false)
  const [uploading, setUploading] = useState<'image' | 'video' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const selectedPhoto = photos.find((p) => p.id === coverId)
  const usingCustom = !!customCoverPath
  const imageUrl = usingCustom
    ? `${publicUrl}/${customCoverPath}`
    : selectedPhoto
      ? `${publicUrl}/${selectedPhoto.storage_path}`
      : null
  const videoUrl = coverVideoPath ? `${publicUrl}/${coverVideoPath}` : null

  const settings: CoverSettings = {
    title: titleEnabled ? titleText || albumTitle : '',
    subtitle: titleEnabled ? subtitle || null : null,
    location: location || null,
    dateLabel: formatPreviewDate(tripDate, dateFormat) ?? albumDateLabel,
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
    imageUrl,
    videoUrl,
    showButton: titleEnabled && showButton,
    buttonText,
  }

  async function handleCustomUpload(files: FileList | null) {
    if (!files?.length) return
    setUploading('image')
    const fd = new FormData()
    fd.append('file', files[0])
    await uploadCustomCover(albumId, fd)
    setUploading(null)
    setPickerOpen(false)
    router.refresh()
  }

  async function handleVideoUpload(files: FileList | null) {
    if (!files?.length) return
    setUploading('video')
    const fd = new FormData()
    fd.append('file', files[0])
    await uploadCoverVideo(albumId, fd)
    setUploading(null)
    setPickerOpen(false)
    router.refresh()
  }

  async function handleUseAlbumPhoto(photoId: string) {
    if (usingCustom) await clearCustomCover(albumId)
    setCoverId(photoId)
    setPickerOpen(false)
    router.refresh()
  }

  // Mirror the album's sort choice so the preview reflects it
  const sortedPhotos = [...photos].sort((a, b) => {
    if (sortOrder === 'manual') return 0
    const at = a.taken_at ? new Date(a.taken_at).getTime() : 0
    const bt = b.taken_at ? new Date(b.taken_at).getTime() : 0
    return sortOrder === 'date_desc' ? bt - at : at - bt
  })

  const previewPhotos = sortedPhotos.slice(0, 6)

  return (
    <>
    <SaveBar label="Save settings" title={props.albumTitle || 'Gallery settings'} />

    <div className="settings-layout">
      <link rel="stylesheet" href={fontHref(font)} />

      {/* ================= CONTROLS ================= */}
      <div className="settings-controls">
        <div className="settings-tabs">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} data-active={tab === t}>
              {t}
            </button>
          ))}
        </div>

        {/* ---------- COVER ---------- */}
        <div hidden={tab !== 'Cover'}>
          <div className="admin-panel" style={{ marginBottom: '1rem' }}>
            <h2 className="admin-h2">Cover media</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setPickerOpen(true)} className="admin-btn admin-btn-ghost admin-btn-sm">
                Change cover
              </button>
              <button type="button" onClick={() => setFocalOpen(true)} className="admin-btn admin-btn-ghost admin-btn-sm">
                Set focal point
              </button>
            </div>
            <p className="admin-meta" style={{ margin: '0.6rem 0 0' }}>
              {videoUrl ? 'Video cover' : usingCustom ? 'Custom uploaded image' : selectedPhoto ? 'Album photo' : 'No cover set'}
            </p>
          </div>

          <div className="admin-panel" style={{ marginBottom: '1rem' }}>
            <h2 className="admin-h2">Layout</h2>
            <div className="cover-layout-grid">
              {COVER_LAYOUTS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setLayout(l.value)}
                  className="cover-layout-swatch"
                  data-active={layout === l.value}
                  title={l.label}
                >
                  <div className="cover-layout-thumb">
                    <LayoutThumb value={l.value} imageUrl={imageUrl} />
                  </div>
                  <span>{l.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="admin-panel">
            <h2 className="admin-h2">Overlay</h2>
            <label className="admin-field">
              Style
              <select
                name="cover_overlay_type"
                value={overlayType}
                onChange={(e) => setOverlayType(e.target.value)}
                className="admin-select"
              >
                {OVERLAYS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {overlayType !== 'none' ? (
              <label className="admin-field">
                Strength — {Math.round(opacity * 100)}%
                <input
                  type="range"
                  name="cover_overlay_opacity"
                  min="0"
                  max="0.9"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => setOpacity(parseFloat(e.target.value))}
                  style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
                />
              </label>
            ) : (
              <input type="hidden" name="cover_overlay_opacity" value={opacity} />
            )}
          </div>
        </div>

        {/* ---------- TEXT ---------- */}
        <div hidden={tab !== 'Text'}>
          <div className="admin-panel" style={{ marginBottom: '1rem' }}>
            <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                name="cover_title_enabled"
                checked={titleEnabled}
                onChange={(e) => setTitleEnabled(e.target.checked)}
              />
              Show text over cover
            </label>

            <label className="admin-field">
              Title
              <input
                type="text"
                name="cover_title_text"
                value={titleText}
                onChange={(e) => setTitleText(e.target.value)}
                placeholder={albumTitle}
                className="admin-input"
                autoComplete="off"
              />
            </label>

            <label className="admin-field">
              Subtitle
              <input
                type="text"
                name="cover_subtitle"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="e.g. Seven days above the Arctic Circle"
                className="admin-input"
                autoComplete="off"
              />
            </label>

            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                <input
                  type="checkbox"
                  name="cover_show_location"
                  checked={showLocation}
                  onChange={(e) => setShowLocation(e.target.checked)}
                />
                Show location
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                <input type="checkbox" name="cover_show_date" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} />
                Show date
              </label>
            </div>
          </div>

          <div className="admin-panel" style={{ marginBottom: '1rem' }}>
            <h2 className="admin-h2">Typography</h2>
            <label className="admin-field">
              Font
              <select name="cover_font" value={font} onChange={(e) => setFont(e.target.value)} className="admin-select">
                {COVER_FONTS.map((f) => (
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
                name="cover_title_scale"
                min="0.5"
                max="2.2"
                step="0.05"
                value={titleScale}
                onChange={(e) => setTitleScale(parseFloat(e.target.value))}
                style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
              />
            </label>

            <div className="admin-field">
              Text colour
              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {TITLE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={c}
                    style={{
                      width: 26,
                      height: 26,
                      background: c,
                      border: color === c ? '2px solid var(--admin-accent)' : '0.5px solid var(--admin-line)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  style={{ width: 34, height: 26, padding: 0, border: '0.5px solid var(--admin-line)', background: 'none' }}
                />
              </div>
              <p className="admin-meta" style={{ margin: '0.4rem 0 0' }}>
                Light layouts (Novel, Portfolio, Journal) use dark text on their panel.
              </p>
            </div>
          </div>

          <div className="admin-panel">
            <h2 className="admin-h2">Button</h2>
            <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                name="cover_show_button"
                checked={showButton}
                onChange={(e) => setShowButton(e.target.checked)}
              />
              Show a scroll-to-gallery button
            </label>
            {showButton ? (
              <label className="admin-field">
                Button text
                <input
                  type="text"
                  name="cover_button_text"
                  value={buttonText}
                  onChange={(e) => setButtonText(e.target.value)}
                  className="admin-input"
                  autoComplete="off"
                />
              </label>
            ) : (
              <input type="hidden" name="cover_button_text" value={buttonText} />
            )}
          </div>
        </div>

        {/* ---------- GRID ---------- */}
        <div hidden={tab !== 'Grid'}>
          <div className="admin-panel" style={{ marginBottom: '1rem' }}>
            <h2 className="admin-h2">Gallery layout</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
              {[
                { value: 'masonry', label: 'Masonry' },
                { value: 'grid', label: 'Justified' },
                { value: 'single_column', label: 'Single column' },
                { value: 'square', label: 'Square (crops)' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setGalleryLayout(opt.value)}
                  className="cover-layout-swatch"
                  data-active={galleryLayout === opt.value}
                >
                  <div className="cover-layout-thumb" style={{ padding: 8, background: '#F4F2ED' }}>
                    <GridDiagram kind={opt.value} />
                  </div>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
            <input type="hidden" name="layout_style" value={galleryLayout} />

            <label
              className="admin-field"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', marginBottom: 0 }}
            >
              <input
                type="checkbox"
                name="gallery_hero"
                checked={galleryHero}
                onChange={(e) => setGalleryHero(e.target.checked)}
              />
              Show the first photo full width
            </label>
          </div>

          <div className="admin-panel">
            <h2 className="admin-h2">Photo order</h2>
            <label className="admin-field">
              Sort
              <select
                name="sort_order"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="admin-select"
              >
                <option value="manual">Manual (drag order in the album)</option>
                <option value="date_asc">Date, oldest first</option>
                <option value="date_desc">Date, newest first</option>
              </select>
            </label>
          </div>
        </div>

        {/* ---------- INFO ---------- */}
        <div hidden={tab !== 'Info'}>
          <div className="admin-panel" style={{ marginBottom: '1rem' }}>
            <h2 className="admin-h2">Album details</h2>

            <label className="admin-field">
              Title
              <input type="text" name="title" defaultValue={albumTitle} className="admin-input" autoComplete="off" />
            </label>

            <label className="admin-field">
              URL slug
              <input
                type="text"
                name="slug"
                defaultValue={props.albumSlug}
                className="admin-input"
                placeholder="lofoten-norway"
                autoComplete="off"
              />
              <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
                /trips/{props.albumSlug}
              </span>
            </label>

            <label className="admin-field">
              Trip date
              <input
                type="date"
                name="trip_start_date"
                value={tripDate}
                onChange={(e) => setTripDate(e.target.value)}
                className="admin-input"
              />
            </label>

            <label className="admin-field">
              Date display
              <select
                name="cover_date_format"
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
                className="admin-select"
              >
                <option value="full">Full date — March 14, 2026</option>
                <option value="month_year">Month and year — March 2026</option>
                <option value="year">Year only — 2026</option>
              </select>
              <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
                Used by the &ldquo;show date&rdquo; option on the cover.
              </span>
            </label>

            <div className="admin-field">
              Album tags
              <div style={{ marginTop: '0.4rem' }}>
                <TagInput
                  name="tags"
                  initialTags={props.initialTags}
                  suggestions={props.tagSuggestions}
                  onChange={setTags}
                />
              </div>
            </div>

            <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                name="show_tags"
                checked={showTags}
                onChange={(e) => setShowTags(e.target.checked)}
              />
              Show tags on the public album page
            </label>
            <p className="admin-meta" style={{ margin: '-0.5rem 0 1rem' }}>
              Tags are always saved for searching, whether or not they&apos;re shown.
            </p>

            <label className="admin-field">
              Location
              <input
                type="text"
                name="location"
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
                name="description"
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
              <select
                name="description_align"
                value={descAlign}
                onChange={(e) => setDescAlign(e.target.value)}
                className="admin-select"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>

            <label className="admin-field">
              Description size — {Math.round(descScale * 100)}%
              <input
                type="range"
                name="description_scale"
                min="0.8"
                max="1.8"
                step="0.05"
                value={descScale}
                onChange={(e) => setDescScale(parseFloat(e.target.value))}
                style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
              />
            </label>
          </div>

          <div className="admin-panel">
            <h2 className="admin-h2">Privacy</h2>
            <label className="admin-field">
              Who can see this album
              <select name="privacy_type" defaultValue={props.privacyType ?? 'public'} className="admin-select">
                <option value="public">Public — visible to everyone</option>
                <option value="unlisted">Unlisted — link only</option>
                <option value="password">Password protected</option>
                <option value="client_only">Client only</option>
              </select>
            </label>

            <label className="admin-field">
              Password
              <input
                type="password"
                name="password"
                placeholder="Only used for password-protected albums"
                className="admin-input"
                autoComplete="new-password"
              />
            </label>
          </div>
        </div>

        <div style={{ marginTop: '1.25rem' }}>
          <button type="submit" className="admin-btn">
            Save settings
          </button>
        </div>
      </div>

      {/* ================= FIXED PREVIEW ================= */}
      <div className="settings-preview">
        <div className="settings-preview-inner">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <span className="admin-meta">Live preview</span>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <button
                type="button"
                onClick={() => setDevice('desktop')}
                className="admin-btn admin-btn-sm admin-btn-ghost"
                data-active={device === 'desktop'}
              >
                Desktop
              </button>
              <button
                type="button"
                onClick={() => setDevice('mobile')}
                className="admin-btn admin-btn-sm admin-btn-ghost"
                data-active={device === 'mobile'}
              >
                Mobile
              </button>
            </div>
          </div>

          <div className="settings-preview-frame" data-device={device}>
            <CoverRenderer settings={settings} height={device === 'mobile' ? '380px' : '300px'} />

            {(description || previewPhotos.length > 0) && (
              <div style={{ background: '#FAF9F6', padding: 2 }}>
                {description && (
                  <p
                    style={{
                      margin: 0,
                      padding: '0.9rem 0.8rem',
                      fontSize: `${(0.72 * descScale).toFixed(2)}rem`,
                      lineHeight: 1.7,
                      color: '#4a4642',
                      textAlign: descAlign as 'left' | 'center' | 'right',
                    }}
                  >
                    {description}
                  </p>
                )}
                {showTags && tags.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 4,
                      flexWrap: 'wrap',
                      padding: '0 0.8rem 0.7rem',
                      justifyContent: descAlign === 'center' ? 'center' : descAlign === 'right' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {tags.map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: '0.55rem',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          border: '0.5px solid rgba(20,16,14,0.2)',
                          padding: '0.1rem 0.3rem',
                          color: '#8a857e',
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {previewPhotos.length > 0 && (
                  <GalleryPreview
                    photos={previewPhotos}
                    publicUrl={publicUrl}
                    kind={galleryLayout}
                    heroFirst={galleryHero}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden state carried into the form */}
      <input type="hidden" name="cover_layout" value={layout} />
      <input type="hidden" name="cover_title_color" value={color} />
      <input type="hidden" name="cover_photo_id" value={usingCustom ? '' : (coverId ?? '')} />
      <input type="hidden" name="cover_focal_x" value={focalX} />
      <input type="hidden" name="cover_focal_y" value={focalY} />

      {/* ---------- FOCAL MODAL ---------- */}
      {focalOpen && (
        <div className="cover-modal" onClick={() => setFocalOpen(false)}>
          <div className="admin-panel" style={{ maxWidth: 640, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <h2 className="admin-h2" style={{ margin: 0 }}>
                Focal point
              </h2>
              <button type="button" onClick={() => setFocalOpen(false)} className="admin-btn admin-btn-sm">
                Done
              </button>
            </div>
            <p className="admin-meta" style={{ margin: '0 0 0.75rem' }}>
              Click the part of the photo that should stay visible when the cover is cropped.
            </p>
            {imageUrl ? (
              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setFocalX(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)))
                  setFocalY(Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)))
                }}
                style={{ position: 'relative', cursor: 'crosshair', userSelect: 'none', lineHeight: 0 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="" draggable={false} style={{ width: '100%', display: 'block', pointerEvents: 'none' }} />
                <div
                  style={{
                    position: 'absolute',
                    left: `${focalX * 100}%`,
                    top: `${focalY * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: '2px solid #fff',
                    boxShadow: '0 0 0 1px rgba(0,0,0,0.7)',
                    pointerEvents: 'none',
                  }}
                />
              </div>
            ) : (
              <div className="admin-empty">Set a cover image first.</div>
            )}
          </div>
        </div>
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

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '0.75rem',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ border: '1px dashed var(--admin-line)', padding: '1rem', textAlign: 'center' }}>
                <p style={{ margin: '0 0 0.4rem', fontSize: '0.85rem' }}>
                  {uploading === 'image' ? 'Uploading…' : 'Custom image'}
                </p>
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
                <p style={{ margin: '0 0 0.4rem', fontSize: '0.85rem' }}>
                  {uploading === 'video' ? 'Uploading…' : 'Video cover'}
                </p>
                <p className="admin-meta" style={{ margin: '0 0 0.7rem' }}>
                  Short MP4, plays muted on loop. Under ~15 MB.
                </p>
                <button type="button" onClick={() => videoRef.current?.click()} disabled={!!uploading} className="admin-btn admin-btn-sm">
                  Choose video
                </button>
                <input
                  ref={videoRef}
                  type="file"
                  accept="video/mp4,video/webm"
                  hidden
                  onChange={(e) => handleVideoUpload(e.target.files)}
                />
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
              <>
                <p className="admin-meta" style={{ margin: '0 0 0.6rem' }}>
                  Or pick from this album
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.5rem' }}>
                  {photos.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => handleUseAlbumPhoto(photo.id)}
                      style={{
                        padding: 0,
                        border:
                          !usingCustom && coverId === photo.id
                            ? '2px solid var(--admin-accent)'
                            : '0.5px solid var(--admin-line)',
                        background: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`${publicUrl}/${photo.storage_path}`}
                        alt=""
                        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                      />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  )
}

/** Small diagram of each gallery layout option. */
function GridDiagram({ kind }: { kind: string }) {
  const cell = { background: '#8a9a95' }

  if (kind === 'single_column') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, height: '100%' }}>
        <div style={{ ...cell, flex: 1 }} />
        <div style={{ ...cell, flex: 1 }} />
      </div>
    )
  }

  if (kind === 'square') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: '1fr', gap: 3, height: '100%' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={cell} />
        ))}
      </div>
    )
  }

  if (kind === 'grid') {
    // justified: rows share a height, widths vary with each photo
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, height: '100%' }}>
        <div style={{ display: 'flex', gap: 3, flex: 1 }}>
          <div style={{ ...cell, flex: 1.6 }} />
          <div style={{ ...cell, flex: 1 }} />
          <div style={{ ...cell, flex: 1.2 }} />
        </div>
        <div style={{ display: 'flex', gap: 3, flex: 1 }}>
          <div style={{ ...cell, flex: 1 }} />
          <div style={{ ...cell, flex: 1.8 }} />
        </div>
      </div>
    )
  }

  // masonry
  return (
    <div style={{ display: 'flex', gap: 3, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
        <div style={{ ...cell, flex: 1.4 }} />
        <div style={{ ...cell, flex: 1 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
        <div style={{ ...cell, flex: 1 }} />
        <div style={{ ...cell, flex: 1.5 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
        <div style={{ ...cell, flex: 1.2 }} />
        <div style={{ ...cell, flex: 1 }} />
      </div>
    </div>
  )
}

/** Shows the first few photos the way the chosen gallery layout would. */
function GalleryPreview({
  photos: allPhotos,
  publicUrl,
  kind,
  heroFirst = false,
}: {
  photos: Photo[]
  publicUrl: string
  kind: string
  heroFirst?: boolean
}) {
  const heroPhoto = heroFirst ? allPhotos[0] : null
  const photos = heroFirst ? allPhotos.slice(1) : allPhotos

  const img = (p: Photo, style: React.CSSProperties) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={p.id} src={`${publicUrl}/${p.storage_path}`} alt="" style={{ display: 'block', ...style }} />
  )

  const hero = heroPhoto ? (
    <div style={{ marginBottom: 2 }}>{img(heroPhoto, { width: '100%', height: 'auto' })}</div>
  ) : null

  if (kind === 'single_column') {
    return (
      <>
        {hero}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {photos.slice(0, 2).map((p) => img(p, { width: '100%', height: 'auto' }))}
        </div>
      </>
    )
  }

  if (kind === 'square') {
    return (
      <>
        {hero}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
          {photos.map((p) => img(p, { width: '100%', aspectRatio: '1', objectFit: 'cover' }))}
        </div>
      </>
    )
  }

  if (kind === 'grid') {
    // Justified rows — equal height per row, natural widths
    const rows = [photos.slice(0, 3), photos.slice(3, 6)].filter((r) => r.length)
    return (
      <>
        {hero}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 2, height: 78 }}>
            {row.map((p) => (
              <div key={p.id} style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                {img(p, { width: '100%', height: '100%', objectFit: 'cover' })}
              </div>
            ))}
          </div>
        ))}
      </div>
      </>
    )
  }

  return (
    <>
      {hero}
    <div style={{ columns: 3, columnGap: 2 }}>
      {photos.map((p) => (
        <div key={p.id} style={{ breakInside: 'avoid', marginBottom: 2 }}>
          {img(p, { width: '100%', height: 'auto' })}
        </div>
      ))}
    </div>
    </>
  )
}

/** Mirrors lib/dates.ts so the preview updates without a round trip. */
function formatPreviewDate(value: string, format: string): string | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y) return null
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)

  if (format === 'year') return String(y)
  if (format === 'full') return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
