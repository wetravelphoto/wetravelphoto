'use client'

import { getLayout } from '@/lib/cover-layouts'
import { getFont, fontHref } from '@/lib/fonts'

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")"

export type CoverSettings = {
  title: string
  subtitle?: string | null
  location?: string | null
  dateLabel?: string | null
  showLocation?: boolean
  showDate?: boolean
  layout: string | null
  font: string | null
  titleScale: number
  color: string | null
  focalX: number
  focalY: number
  overlayType: string | null
  overlayOpacity: number
  imageUrl: string | null
  imageSrcSet?: string
  videoUrl?: string | null
  showButton?: boolean
  buttonText?: string | null
}

/**
 * Renders a complete album cover. Type sizes use container query units
 * (cqw) so the same component looks right at any width — full page,
 * desktop preview, or phone preview — with no separate mobile styles.
 */
export default function CoverRenderer({
  settings,
  height = '78vh',
  onButtonClick,
}: {
  settings: CoverSettings
  height?: string
  onButtonClick?: () => void
}) {
  const layout = getLayout(settings.layout)
  const font = getFont(settings.font)
  const scale = settings.titleScale ?? 1

  const onLight = !!layout.lightText
  const textColor = onLight ? '#14100E' : settings.color || '#FAF9F6'
  const softColor = onLight ? 'rgba(20,16,14,0.6)' : `${settings.color || '#FAF9F6'}`

  const titleStyle: React.CSSProperties = {
    fontFamily: font.stack,
    fontWeight: font.weight,
    textTransform: font.uppercase ? 'uppercase' : 'none',
    letterSpacing: font.tracking,
    fontSize: `clamp(1.1rem, ${(5.2 * scale).toFixed(2)}cqw, ${(7 * scale).toFixed(1)}rem)`,
    lineHeight: 1.03,
    color: textColor,
    margin: 0,
    textAlign: layout.align,
    textShadow: onLight ? 'none' : '0 1px 20px rgba(0,0,0,0.32)',
  }

  const metaStyle: React.CSSProperties = {
    fontFamily: font.stack,
    fontWeight: font.weight,
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    fontSize: `clamp(0.55rem, ${(1.15 * Math.max(scale, 0.7)).toFixed(2)}cqw, 0.95rem)`,
    color: softColor,
    opacity: onLight ? 1 : 0.85,
    margin: 0,
    textAlign: layout.align,
  }

  const subtitleStyle: React.CSSProperties = {
    fontFamily: font.stack,
    fontWeight: font.weight,
    fontSize: `clamp(0.7rem, ${(1.7 * Math.max(scale, 0.7)).toFixed(2)}cqw, 1.35rem)`,
    letterSpacing: '0.02em',
    color: softColor,
    opacity: onLight ? 1 : 0.9,
    margin: 0,
    textAlign: layout.align,
    lineHeight: 1.45,
  }

  const metaLine = [
    settings.showLocation && settings.location ? settings.location : null,
    settings.showDate && settings.dateLabel ? settings.dateLabel : null,
  ]
    .filter(Boolean)
    .join('  ·  ')

  const buttonEl = settings.showButton ? (
    <button
      type="button"
      onClick={onButtonClick}
      style={{
        fontFamily: font.stack,
        fontWeight: font.weight,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        fontSize: `clamp(0.6rem, ${1.1}cqw, 0.8rem)`,
        padding: '0.75em 1.8em',
        background: onLight ? '#14100E' : 'transparent',
        color: onLight ? '#FAF9F6' : textColor,
        border: onLight ? 'none' : `1px solid ${textColor}`,
        cursor: 'pointer',
        marginTop: '1.4em',
      }}
    >
      {settings.buttonText || 'View gallery'}
    </button>
  ) : null

  const alignItems =
    layout.align === 'center' ? 'center' : layout.align === 'right' ? 'flex-end' : 'flex-start'

  let textBlock = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems, gap: '0.55em' }}>
      {metaLine && <p style={metaStyle}>{metaLine}</p>}
      <h1 style={titleStyle}>{settings.title}</h1>
      {settings.subtitle && <p style={subtitleStyle}>{settings.subtitle}</p>}
      {buttonEl}
    </div>
  )

  // Decorations
  if (layout.decoration === 'rules') {
    textBlock = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems, gap: '0.9em', width: '100%', maxWidth: '34ch' }}>
        <div style={{ height: 1, width: '100%', background: textColor, opacity: 0.8 }} />
        {textBlock}
        <div style={{ height: 1, width: '100%', background: textColor, opacity: 0.8 }} />
      </div>
    )
  } else if (layout.decoration === 'frame') {
    textBlock = (
      <div style={{ border: `1px solid ${textColor}`, padding: '1.6em 2.2em' }}>{textBlock}</div>
    )
  } else if (layout.decoration === 'plate') {
    textBlock = (
      <div style={{ background: 'rgba(12,10,9,0.5)', backdropFilter: 'blur(3px)', padding: '1.5em 2.2em' }}>
        {textBlock}
      </div>
    )
  } else if (layout.decoration === 'left-bar') {
    textBlock = (
      <div style={{ display: 'flex', gap: '1em', alignItems: 'stretch' }}>
        <div style={{ width: 2, background: textColor, flexShrink: 0 }} />
        <div>{textBlock}</div>
      </div>
    )
  } else if (layout.decoration === 'underline') {
    textBlock = (
      <div>
        {textBlock}
        <div style={{ height: 2, background: textColor, marginTop: '0.8em', width: '3.5em' }} />
      </div>
    )
  }

  const overlays = (
    <>
      {(settings.overlayType === 'darken' || settings.overlayType === 'darken_grain') && (
        <div style={abs({ background: `rgba(12,10,9,${settings.overlayOpacity})` })} />
      )}
      {settings.overlayType === 'gradient' && (
        <div
          style={abs({
            background: `linear-gradient(to top, rgba(12,10,9,${Math.min(settings.overlayOpacity * 1.8, 0.95)}) 0%, rgba(12,10,9,0) 65%)`,
          })}
        />
      )}
      {(settings.overlayType === 'grain' || settings.overlayType === 'darken_grain') && (
        <div style={abs({ backgroundImage: GRAIN, opacity: settings.overlayOpacity, mixBlendMode: 'overlay' })} />
      )}
    </>
  )

  const media = settings.videoUrl ? (
    <video
      src={settings.videoUrl}
      autoPlay
      muted
      loop
      playsInline
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition: `${settings.focalX * 100}% ${settings.focalY * 100}%`,
        display: 'block',
      }}
    />
  ) : settings.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={settings.imageUrl}
      srcSet={settings.imageSrcSet}
      sizes="100vw"
      alt=""
      fetchPriority="high"
      decoding="async"
      draggable={false}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition: `${settings.focalX * 100}% ${settings.focalY * 100}%`,
        display: 'block',
      }}
    />
  ) : (
    <div style={{ width: '100%', height: '100%', background: '#d8d4cd' }} />
  )

  const shell: React.CSSProperties = {
    containerType: 'inline-size',
    position: 'relative',
    width: '100%',
    height,
    overflow: 'hidden',
    background: onLight ? '#FAF9F6' : '#14100E',
  }

  const fontLink = <link rel="stylesheet" href={fontHref(font.name)} />

  // ---- SPLIT: photo one side, text panel the other
  if (layout.kind === 'split') {
    const photoFirst = layout.photoSide === 'left'
    return (
      <div style={shell}>
        {fontLink}
        <div style={{ display: 'flex', height: '100%', flexDirection: photoFirst ? 'row' : 'row-reverse' }}>
          <div style={{ flex: '1 1 52%', position: 'relative', overflow: 'hidden' }}>
            {media}
            {overlays}
          </div>
          <div
            style={{
              flex: '1 1 48%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems,
              padding: '8% 7%',
              background: '#FAF9F6',
            }}
          >
            {textBlock}
          </div>
        </div>
      </div>
    )
  }

  // ---- CARD: photo floats on a light page, text above it
  if (layout.kind === 'card') {
    return (
      <div style={{ ...shell, background: '#FAF9F6' }}>
        {fontLink}
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4%',
            padding: '5% 6%',
          }}
        >
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>{textBlock}</div>
          <div
            style={{
              position: 'relative',
              width: layout.cardAspect === '4 / 5' ? '46%' : '82%',
              aspectRatio: layout.cardAspect ?? '16 / 9',
              overflow: 'hidden',
              minHeight: 0,
              flex: '0 1 auto',
            }}
          >
            {media}
            {overlays}
          </div>
        </div>
      </div>
    )
  }

  // ---- BANNER: photo on top, text below on light background
  if (layout.kind === 'banner') {
    return (
      <div style={{ ...shell, background: '#FAF9F6' }}>
        {fontLink}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: '1 1 72%', position: 'relative', overflow: 'hidden' }}>
            {media}
            {overlays}
          </div>
          <div
            style={{
              flex: '0 0 auto',
              padding: '3% 6%',
              display: 'flex',
              flexDirection: 'column',
              alignItems,
              justifyContent: 'center',
            }}
          >
            {textBlock}
          </div>
        </div>
      </div>
    )
  }

  // ---- INSET: photo fills, thin margin border inside
  if (layout.kind === 'inset') {
    return (
      <div style={shell}>
        {fontLink}
        {media}
        {overlays}
        <div style={abs({ margin: '3.5%', border: '1px solid rgba(250,249,246,0.55)' })} />
        <div style={{ ...anchorStyle('center'), position: 'absolute', inset: 0 }}>{textBlock}</div>
      </div>
    )
  }

  // ---- FULLBLEED (default)
  const isBannerBar = layout.decoration === 'banner-bar'

  return (
    <div style={shell}>
      {fontLink}
      {media}
      {overlays}
      {!settings.overlayType || settings.overlayType === 'none' ? (
        <div
          style={abs({
            background: 'linear-gradient(to top, rgba(20,16,14,0.45) 0%, rgba(20,16,14,0) 55%)',
          })}
        />
      ) : null}

      {isBannerBar ? (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <div style={{ background: 'rgba(12,10,9,0.6)', padding: '3.5% 6%' }}>{textBlock}</div>
        </div>
      ) : (
        <div style={{ ...anchorStyle(layout.anchor ?? 'bottom-left'), position: 'absolute', inset: 0 }}>
          {textBlock}
        </div>
      )}
    </div>
  )
}

function abs(extra: React.CSSProperties): React.CSSProperties {
  return { position: 'absolute', inset: 0, pointerEvents: 'none', ...extra }
}

function anchorStyle(anchor: string): React.CSSProperties {
  const base: React.CSSProperties = { display: 'flex', padding: '6%' }

  switch (anchor) {
    case 'center':
      return { ...base, alignItems: 'center', justifyContent: 'center' }
    case 'top-center':
      return { ...base, alignItems: 'flex-start', justifyContent: 'center' }
    case 'top-left':
      return { ...base, alignItems: 'flex-start', justifyContent: 'flex-start' }
    case 'bottom-center':
      return { ...base, alignItems: 'flex-end', justifyContent: 'center' }
    case 'bottom-right':
      return { ...base, alignItems: 'flex-end', justifyContent: 'flex-end' }
    default:
      return { ...base, alignItems: 'flex-end', justifyContent: 'flex-start' }
  }
}
