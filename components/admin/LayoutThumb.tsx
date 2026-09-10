'use client'

import { getLayout } from '@/lib/cover-layouts'

/**
 * Schematic preview of a cover layout. Uses the album's real cover photo
 * so the thumbnails feel like the album, but the text is always generic
 * bars — real titles at this size are illegible and break the layouts.
 */
export default function LayoutThumb({ value, imageUrl }: { value: string; imageUrl: string | null }) {
  const l = getLayout(value)
  const onLight = !!l.lightText
  const ink = onLight ? '#14100E' : '#FFFFFF'

  const photo = (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#4a5a56' }}>
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
    </div>
  )

  const photoBox = (style?: React.CSSProperties) => (
    <div style={{ position: 'relative', overflow: 'hidden', background: '#4a5a56', ...style }}>
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
    </div>
  )

  const bars = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: alignFor(l.align) }}>
      <div style={{ height: 2, width: 18, background: ink, opacity: 0.6 }} />
      <div style={{ height: 5, width: 38, background: ink, opacity: 0.95 }} />
      <div style={{ height: 2, width: 26, background: ink, opacity: 0.6 }} />
    </div>
  )

  const shell: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: onLight ? '#F4F2ED' : '#2a2a28',
  }

  if (l.kind === 'split') {
    const photoFirst = l.photoSide === 'left'
    return (
      <div style={shell}>
        <div style={{ display: 'flex', height: '100%', flexDirection: photoFirst ? 'row' : 'row-reverse' }}>
          {photoBox({ flex: '1 1 52%' })}
          <div
            style={{
              flex: '1 1 48%',
              background: '#F4F2ED',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 5,
            }}
          >
            {bars}
          </div>
        </div>
      </div>
    )
  }

  if (l.kind === 'card') {
    return (
      <div style={shell}>
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: 5,
          }}
        >
          {bars}
          {photoBox({
            width: l.cardAspect === '4 / 5' ? '34%' : '66%',
            aspectRatio: l.cardAspect ?? '16 / 9',
          })}
        </div>
      </div>
    )
  }

  if (l.kind === 'banner') {
    return (
      <div style={shell}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {photoBox({ flex: '1 1 70%' })}
          <div style={{ flex: '0 0 auto', padding: 5, display: 'flex', justifyContent: alignFor(l.align) }}>{bars}</div>
        </div>
      </div>
    )
  }

  if (l.kind === 'inset') {
    return (
      <div style={shell}>
        {photo}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)' }} />
        <div style={{ position: 'absolute', inset: 5, border: `1px solid ${ink}`, opacity: 0.7 }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {bars}
        </div>
      </div>
    )
  }

  const anchorMap: Record<string, React.CSSProperties> = {
    'bottom-left': { alignItems: 'flex-end', justifyContent: 'flex-start' },
    'bottom-center': { alignItems: 'flex-end', justifyContent: 'center' },
    'bottom-right': { alignItems: 'flex-end', justifyContent: 'flex-end' },
    center: { alignItems: 'center', justifyContent: 'center' },
    'top-center': { alignItems: 'flex-start', justifyContent: 'center' },
    'top-left': { alignItems: 'flex-start', justifyContent: 'flex-start' },
  }

  let inner = bars

  if (l.decoration === 'rules') {
    inner = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
        <div style={{ height: 1, width: 44, background: ink }} />
        {bars}
        <div style={{ height: 1, width: 44, background: ink }} />
      </div>
    )
  } else if (l.decoration === 'plate') {
    inner = <div style={{ background: 'rgba(0,0,0,0.5)', padding: 5 }}>{bars}</div>
  } else if (l.decoration === 'left-bar') {
    inner = (
      <div style={{ display: 'flex', gap: 4 }}>
        <div style={{ width: 2, background: ink }} />
        {bars}
      </div>
    )
  } else if (l.decoration === 'banner-bar') {
    return (
      <div style={shell}>
        {photo}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', padding: 5 }}>
          {bars}
        </div>
      </div>
    )
  }

  return (
    <div style={shell}>
      {photo}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)' }} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          padding: 6,
          ...(anchorMap[l.anchor ?? 'bottom-left'] ?? anchorMap['bottom-left']),
        }}
      >
        {inner}
      </div>
    </div>
  )
}

function alignFor(align: string): React.CSSProperties['alignItems'] {
  return align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'
}
