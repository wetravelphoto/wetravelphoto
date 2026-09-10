'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { uploadCustomCover, clearCustomCover, uploadCoverVideo, clearCoverVideo } from '@/app/actions/albums'
import { COVER_LAYOUTS } from '@/lib/cover-layouts'
import { COVER_FONTS, TITLE_COLORS, fontHref } from '@/lib/fonts'
import CoverRenderer, { type CoverSettings } from '@/components/CoverRenderer'

type Photo = { id: string; storage_path: string }

const OVERLAYS = [
  { value: 'none', label: 'None' },
  { value: 'darken', label: 'Darken' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'grain', label: 'Grain' },
  { value: 'darken_grain', label: 'Darken + grain' },
]

export default function CoverEditor(props: {
  albumId: string
  photos: Photo[]
  publicUrl: string
  albumTitle: string
  albumLocation: string | null
  albumDateLabel: string | null
  customCoverPath: string | null
  coverVideoPath: string | null
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
  const {
    albumId,
    photos,
    publicUrl,
    albumTitle,
    albumLocation,
    albumDateLabel,
    customCoverPath,
    coverVideoPath,
  } = props

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
    title: titleText || albumTitle,
    subtitle: subtitle || null,
    location: albumLocation,
    dateLabel: albumDateLabel,
    showLocation,
    showDate,
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
    showButton,
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

  return (
    <div className="cover-editor">
      <link rel="stylesheet" href={fontHref(font)} />

      {/* ---------------- CONTROLS ---------------- */}
      <div className="cover-editor-controls">
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
            {videoUrl ? 'Using a video cover' : usingCustom ? 'Custom uploaded image' : selectedPhoto ? 'Album photo' : 'No cover set'}
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
                <div style={{ pointerEvents: 'none' }}>
                  <CoverRenderer
                    settings={{ ...settings, layout: l.value, titleScale: Math.min(titleScale, 1), showButton: false }}
                    height="100%"
                  />
                </div>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="admin-panel" style={{ marginBottom: '1rem' }}>
          <h2 className="admin-h2">Text</h2>

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
              <input
                type="checkbox"
                name="cover_show_date"
                checked={showDate}
                onChange={(e) => setShowDate(e.target.checked)}
              />
              Show date
            </label>
          </div>

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
              Light layouts (Novel, Portfolio, Journal) always use dark text on their panel.
            </p>
          </div>
        </div>

        <div className="admin-panel" style={{ marginBottom: '1rem' }}>
          <h2 className="admin-h2">Button</h2>
          <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              name="cover_show_button"
              checked={showButton}
              onChange={(e) => setShowButton(e.target.checked)}
            />
            Show a &ldquo;view gallery&rdquo; button
          </label>
          {showButton && (
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
          )}
          {!showButton && <input type="hidden" name="cover_button_text" value={buttonText} />}
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

      {/* ---------------- STICKY PREVIEW ---------------- */}
      <div className="cover-editor-preview">
        <div className="cover-preview-sticky">
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

          <div
            style={{
              width: device === 'mobile' ? 260 : '100%',
              margin: device === 'mobile' ? '0 auto' : undefined,
              border: '0.5px solid var(--admin-line)',
              transition: 'width 0.25s ease',
              background: '#14100E',
            }}
          >
            {titleEnabled ? (
              <CoverRenderer settings={settings} height={device === 'mobile' ? '460px' : '340px'} />
            ) : (
              <CoverRenderer
                settings={{ ...settings, title: '', subtitle: null, showLocation: false, showDate: false, showButton: false }}
                height={device === 'mobile' ? '460px' : '340px'}
              />
            )}
          </div>

          <p className="admin-meta" style={{ margin: '0.6rem 0 0' }}>
            Scroll the controls — the preview stays put.
          </p>
        </div>
      </div>

      {/* Hidden inputs carrying state into the form */}
      <input type="hidden" name="cover_layout" value={layout} />
      <input type="hidden" name="cover_title_color" value={color} />
      <input type="hidden" name="cover_photo_id" value={usingCustom ? '' : (coverId ?? '')} />
      <input type="hidden" name="cover_focal_x" value={focalX} />
      <input type="hidden" name="cover_focal_y" value={focalY} />

      {/* ---------------- FOCAL POINT MODAL ---------------- */}
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
                <img
                  src={imageUrl}
                  alt=""
                  draggable={false}
                  style={{ width: '100%', display: 'block', pointerEvents: 'none' }}
                />
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

      {/* ---------------- COVER PICKER MODAL ---------------- */}
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
                  Short MP4 clip, plays muted on loop. Keep it under ~15 MB.
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
  )
}
