'use client'

import type { CSSProperties, ReactNode } from 'react'
import { titleFontHref, type CoverStyle, type CoverStyleKey } from '@/lib/covers/registry'
import type { CoverImage, CoverModel } from '@/lib/covers/model'
import './covers.css'

/**
 * THE CLIENT-GALLERY COVERS
 * ═════════════════════════
 *
 * One React component per approved style (lib/covers/registry.ts), each ONE
 * responsive layout — there is no phone version. Every size inside is a
 * container unit (cqw / cqh) of the cover's own frame, so the cover is laid
 * out by the box it is drawn in rather than by the window: the public page
 * draws it at the screen's size, the editor draws the very same component in a
 * device-sized frame, and the two agree (components/covers/covers.css).
 *
 * The techniques of the responsive designs (09–14) are carried over to 01–08:
 * wrapping flex rows, `clamp()` type, fixed crops held between 4:5 and 2:1
 * (registry `slot`), and photograph widths capped by the frame's height so the
 * cover fits one screen. Phone full-bleed (08) relies on the focal point.
 *
 * Only the selected title face is loaded. Secondary lines use the title face
 * when it is a serif, otherwise a system serif — never a second web font.
 */

export type GalleryCoverProps = {
  style: CoverStyle
  model: CoverModel
  /** The frame's height: the screen on a page, a device's on the editor's preview. */
  height?: string
  /** "View gallery". Absent in a preview, where it is drawn as non-interactive content, not a button. */
  onEnter?: () => void
  priority?: boolean
}

export default function GalleryCover({ style, model, height = '100svh', onEnter, priority = false }: GalleryCoverProps) {
  const Style = STYLES[style.key]
  const vars = {
    '--cv-bg': model.background,
    '--cv-ink': model.titleColor,
    '--cv-font': model.font.stack,
    '--cv-weight': String(model.font.weight),
    '--cv-scale': String(model.titleScale),
    '--cv-serif': model.font.serif ? model.font.stack : "Georgia, 'Times New Roman', serif",
  } as CSSProperties

  return (
    <div className="cv-frame" style={{ height }} data-cover-style={style.key}>
      {/* React hoists and de-duplicates a stylesheet link with a precedence. */}
      <link rel="stylesheet" href={titleFontHref(model.font)} precedence="default" />
      <div className={`cv-root cv-${style.key}`} style={vars}>
        <Style m={model} enter={<Enter m={model} onEnter={onEnter} variant={BUTTONS[style.key]} />} priority={priority} />
      </div>
    </div>
  )
}

// ── Primitives ──────────────────────────────────────────────────────────────

type Parts = { m: CoverModel; enter: ReactNode; priority: boolean }

/**
 * A photograph in a fixed crop. The focal point is the CSS object-position,
 * as it has always been for covers, and zoom scales about that same point, so
 * the point the photographer chose stays where they put it at every size. The
 * reframe tool (components/admin/album/ReframeTool.tsx) draws its previews
 * with this component.
 */
export function CoverPhoto({
  image,
  focalX = 0.5,
  focalY = 0.5,
  zoom = 1,
  className = '',
  priority = false,
  sizes = '100vw',
}: {
  image: CoverImage | null
  focalX?: number
  focalY?: number
  zoom?: number
  className?: string
  priority?: boolean
  sizes?: string
}) {
  if (!image) return <div className={`cv-photo cv-photo-empty ${className}`} aria-hidden="true" />
  const pos = `${(focalX * 100).toFixed(2)}% ${(focalY * 100).toFixed(2)}%`
  return (
    <div className={`cv-photo ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        srcSet={image.srcSet}
        sizes={sizes}
        alt={image.alt}
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        style={{
          objectPosition: pos,
          transformOrigin: pos,
          transform: zoom > 1 ? `scale(${zoom.toFixed(3)})` : undefined,
        }}
      />
    </div>
  )
}

const Main = ({ m, className, priority, sizes }: { m: CoverModel; className?: string; priority: boolean; sizes?: string }) => (
  <CoverPhoto image={m.photo} focalX={m.focalX} focalY={m.focalY} zoom={m.zoom} className={className} priority={priority} sizes={sizes} />
)

type ButtonVariant = 'outline' | 'solid' | 'underline' | 'link' | 'arrow' | 'block' | 'glass'

/**
 * "View gallery". A real button only when it does something; in a preview
 * (no `onEnter`) the same look is drawn as plain, hidden content, because the
 * editor draws previews INSIDE its own buttons (the style swatches) and a
 * button inside a button is invalid HTML that breaks hydration.
 */
function Enter({ m, onEnter, variant }: { m: CoverModel; onEnter?: () => void; variant: ButtonVariant }) {
  const face = (
    <>
      <span>{m.buttonText}</span>
      {variant === 'arrow' && (
        <svg width="26" height="10" viewBox="0 0 26 10" fill="none" aria-hidden="true">
          <path d="M0 5h24M20 1l4 4-4 4" stroke="currentColor" strokeWidth="1" />
        </svg>
      )}
    </>
  )
  if (!onEnter) {
    return (
      <span className={`cv-enter cv-enter-${variant}`} data-preview="" aria-hidden="true">
        {face}
      </span>
    )
  }
  return (
    <button type="button" className={`cv-enter cv-enter-${variant}`} onClick={onEnter}>
      {face}
    </button>
  )
}

const Brand = ({ m, className = '' }: { m: CoverModel; className?: string }) =>
  m.siteTitle ? <span className={`cv-label ${className}`}>{m.siteTitle}</span> : null

const Title = ({ m, className = '', style }: { m: CoverModel; className?: string; style?: CSSProperties }) => (
  <h1 className={`cv-title ${className}`} style={style}>
    {m.title}
  </h1>
)

/** The last word on its own line, in italic where the face has one — the Chapter opening's title. */
function ChapterTitle({ m }: { m: CoverModel }) {
  const words = m.title.split(/\s+/)
  if (words.length < 2) return <Title m={m} />
  const last = words.pop()!
  return (
    <h1 className="cv-title">
      {words.join(' ')}
      <br />
      <span style={{ fontStyle: m.font.italic ? 'italic' : 'normal' }}>{last}</span>
    </h1>
  )
}

const Eyebrow = ({ m, className = '' }: { m: CoverModel; className?: string }) =>
  m.eyebrow ? <p className={`cv-eyebrow ${className}`}>{m.eyebrow}</p> : null

const DateLine = ({ m, className = '' }: { m: CoverModel; className?: string }) =>
  m.dateLabel ? <span className={`cv-date ${className}`}>{m.dateLabel}</span> : null

/** Eyebrow and date on one line, separated by a middle dot. */
function Meta({ m, className = '' }: { m: CoverModel; className?: string }) {
  const parts = [m.eyebrow, m.dateLabel].filter(Boolean)
  return parts.length ? <p className={`cv-label cv-meta ${className}`}>{parts.join(' · ')}</p> : null
}

// ── The fourteen styles ─────────────────────────────────────────────────────

/** 01 — the album's own photographs, blurred, behind a framed cover. */
function Lightbox({ m, enter, priority }: Parts) {
  const tiles = m.backdrop.length ? Array.from({ length: 10 }, (_, i) => m.backdrop[i % m.backdrop.length]!) : []
  return (
    <>
      {tiles.length > 0 && (
        <div className="cv-backdrop" aria-hidden="true">
          {tiles.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" loading="lazy" decoding="async" />
          ))}
        </div>
      )}
      <div className="cv-vignette" aria-hidden="true" />
      <div className="cv-top">
        <Brand m={m} />
      </div>
      <div className="cv-center">
        <Main m={m} priority={priority} sizes="(max-width: 720px) 100vw, 65vw" />
        <Title m={m} />
        <Meta m={m} />
        {enter}
      </div>
    </>
  )
}

/** 02 — a letterboxed frame, the title tracked wide beneath it. */
function Cinemascope({ m, enter, priority }: Parts) {
  return (
    <div className="cv-inner">
      <div className="cv-top cv-muted">
        <Brand m={m} />
        <DateLine m={m} className="cv-label" />
      </div>
      <Main m={m} priority={priority} />
      <Title m={m} />
      <div className="cv-rule" aria-hidden="true" />
      {enter}
    </div>
  )
}

/** 03 — a wide band of photograph, the title set very large beneath it. */
function PanoramaBand({ m, enter, priority }: Parts) {
  return (
    <div className="cv-inner">
      <div className="cv-top">
        <Brand m={m} />
        <Eyebrow m={m} className="cv-label cv-muted" />
      </div>
      <Main m={m} priority={priority} />
      <div className="cv-foot">
        <Title m={m} />
        <div className="cv-aside">
          <DateLine m={m} className="cv-serif-italic cv-muted" />
          {enter}
        </div>
      </div>
    </div>
  )
}

/** 04 — words on one side, a tall photograph on the other. */
function PortraitSplit({ m, enter, priority }: Parts) {
  return (
    <div className="cv-inner">
      <div className="cv-text">
        <Brand m={m} className="cv-accent" />
        <div className="cv-heading">
          <Eyebrow m={m} className="cv-serif-italic cv-muted" />
          <Title m={m} />
          <div className="cv-rule" aria-hidden="true" />
        </div>
        <div className="cv-foot">
          <DateLine m={m} className="cv-label cv-muted" />
          {enter}
        </div>
      </div>
      <Main m={m} priority={priority} sizes="(max-width: 720px) 100vw, 45vw" />
    </div>
  )
}

/** 05 — two portraits, staggered. */
function Diptych({ m, enter, priority }: Parts) {
  return (
    <div className="cv-inner">
      <div className="cv-text">
        <Brand m={m} className="cv-accent" />
        <div className="cv-heading">
          <Title m={m} />
          <DateLine m={m} className="cv-label cv-muted" />
          {enter}
        </div>
      </div>
      <div className="cv-pair">
        <Main m={m} priority={priority} sizes="(max-width: 720px) 50vw, 25vw" />
        {m.secondPhoto && <CoverPhoto image={m.secondPhoto} sizes="(max-width: 720px) 50vw, 25vw" />}
      </div>
    </div>
  )
}

/** 06 — a single print, matted and hung. */
function MuseumPrint({ m, enter, priority }: Parts) {
  return (
    <div className="cv-inner">
      <div className="cv-top">
        <Brand m={m} />
        <Eyebrow m={m} className="cv-label cv-muted" />
      </div>
      <div className="cv-mat">
        <Main m={m} priority={priority} sizes="(max-width: 720px) 80vw, 30vw" />
      </div>
      <div className="cv-foot">
        <Title m={m} style={{ fontStyle: m.font.italic ? 'italic' : 'normal' }} />
        <div className="cv-aside">
          <DateLine m={m} className="cv-label cv-muted" />
          {enter}
        </div>
      </div>
    </div>
  )
}

/** 07 — the opening of a chapter: a captioned photograph and a set title. */
function Chapter({ m, enter, priority }: Parts) {
  return (
    <div className="cv-inner">
      <Brand m={m} className="cv-brand" />
      <figure className="cv-figure">
        <Main m={m} priority={priority} sizes="(max-width: 720px) 100vw, 40vw" />
        {m.dateLabel && <figcaption className="cv-label cv-muted">{m.dateLabel}</figcaption>}
      </figure>
      <div className="cv-text">
        <div className="cv-heading">
          <Eyebrow m={m} className="cv-label cv-accent" />
          <ChapterTitle m={m} />
        </div>
        <div className="cv-foot">{enter}</div>
      </div>
    </div>
  )
}

/** 08 — the photograph is the screen. */
function FullBleed({ m, enter, priority }: Parts) {
  return (
    <>
      <Main m={m} priority={priority} />
      <div className="cv-shade-top" aria-hidden="true" />
      <div className="cv-shade" aria-hidden="true" />
      <Brand m={m} className="cv-brand" />
      <div className="cv-block">
        <Title m={m} />
        <Meta m={m} />
        {enter}
      </div>
    </>
  )
}

/** 09 — a 3:2 plate beside a set title. */
function Folio({ m, enter, priority }: Parts) {
  return (
    <div className="cv-inner">
      <Main m={m} priority={priority} sizes="(max-width: 900px) 100vw, 62vw" />
      <div className="cv-text">
        <Eyebrow m={m} className="cv-serif-italic" />
        <Title m={m} />
        <div className="cv-foot">
          <DateLine m={m} className="cv-serif" />
          {enter}
        </div>
      </div>
    </div>
  )
}

/** 10 — the title as large as the width allows, the photograph beneath. */
function Marquee({ m, enter, priority }: Parts) {
  // Sized to the title's length, so a long title still fits on its one line.
  const chars = Math.max(4, m.title.length)
  const size = `min(21cqw, ${(150 / chars).toFixed(2)}cqw)`
  return (
    <div className="cv-inner" style={{ ['--cv-marquee' as string]: size } as CSSProperties}>
      <Eyebrow m={m} className="cv-serif-italic" />
      <Title m={m} />
      <Main m={m} priority={priority} />
      <div className="cv-foot">
        <DateLine m={m} className="cv-strong" />
        {enter}
      </div>
    </div>
  )
}

/** 11 — a photograph and a colophon panel. */
function Colophon({ m, enter, priority }: Parts) {
  return (
    <div className="cv-inner">
      <Main m={m} priority={priority} sizes="(max-width: 900px) 100vw, 65vw" />
      <div className="cv-panel">
        <div className="cv-heading">
          <Eyebrow m={m} className="cv-serif-italic" />
          <Title m={m} />
          <div className="cv-rule" aria-hidden="true" />
          <DateLine m={m} className="cv-serif" />
        </div>
        {enter}
      </div>
    </div>
  )
}

/** 12 — the title over the photograph's quiet corner. */
function Overlay({ m, enter, priority }: Parts) {
  return (
    <div className="cv-inner">
      <div className="cv-stage">
        <Main m={m} priority={priority} />
        <div className="cv-shade" aria-hidden="true" />
        <div className="cv-copy">
          <Eyebrow m={m} className="cv-serif-italic" />
          <Title m={m} />
          <DateLine m={m} className="cv-serif" />
        </div>
      </div>
      <div className="cv-after">{enter}</div>
    </div>
  )
}

/** 13 — a centred plate, the title beneath. */
function Plate({ m, enter, priority }: Parts) {
  return (
    <div className="cv-inner">
      <Brand m={m} className="cv-soft" />
      <Main m={m} priority={priority} sizes="(max-width: 720px) 100vw, 60vw" />
      <div className="cv-heading">
        <Eyebrow m={m} className="cv-serif-italic cv-soft" />
        <Title m={m} />
        <DateLine m={m} className="cv-label cv-muted" />
      </div>
      {enter}
    </div>
  )
}

/** 14 — the title above the plate, as in a book's frontispiece. */
function Frontispiece({ m, enter, priority }: Parts) {
  return (
    <div className="cv-inner">
      <div className="cv-col">
        <div className="cv-heading">
          <Eyebrow m={m} className="cv-serif-italic" />
          <Title m={m} />
        </div>
        <Main m={m} priority={priority} sizes="(max-width: 720px) 100vw, 60vw" />
        <div className="cv-foot">
          <DateLine m={m} className="cv-serif" />
          {enter}
        </div>
      </div>
    </div>
  )
}

const STYLES: Record<CoverStyleKey, (p: Parts) => ReactNode> = {
  lightbox: Lightbox,
  cinemascope: Cinemascope,
  panorama_band: PanoramaBand,
  portrait_split: PortraitSplit,
  diptych: Diptych,
  museum_print: MuseumPrint,
  chapter: Chapter,
  full_bleed: FullBleed,
  folio: Folio,
  marquee: Marquee,
  colophon: Colophon,
  overlay: Overlay,
  plate: Plate,
  frontispiece: Frontispiece,
}

const BUTTONS: Record<CoverStyleKey, ButtonVariant> = {
  lightbox: 'outline',
  cinemascope: 'arrow',
  panorama_band: 'solid',
  portrait_split: 'solid',
  diptych: 'outline',
  museum_print: 'underline',
  chapter: 'solid',
  full_bleed: 'block',
  folio: 'link',
  marquee: 'link',
  colophon: 'link',
  overlay: 'glass',
  plate: 'underline',
  frontispiece: 'link',
}
