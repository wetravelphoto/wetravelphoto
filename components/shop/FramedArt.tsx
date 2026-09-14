import { artRatio, frameRatio } from '@/lib/frame'

/**
 * A framed, matted print.
 *
 * Height comes from the wall (a CSS variable), so every piece shares one
 * height and one moulding thickness. Only the width varies, driven by the
 * photograph's own proportions — see lib/frame.ts and app/frame.css.
 */
export default function FramedArt({
  imageUrl,
  srcSet,
  alt,
  width,
  height,
  sizes = '(max-width: 620px) 45vw, 340px',
  eager = false,
}: {
  imageUrl: string
  srcSet?: string
  alt: string
  width: number | null
  height: number | null
  sizes?: string
  /** The one piece a visitor came to see; everything else waits until it's near. */
  eager?: boolean
}) {
  const art = artRatio(width, height)
  const frame = frameRatio(width, height)

  // The window is cut to the photograph. Whichever way the art is more
  // extreme than the frame allows is the side that runs out first, and the
  // rest of the opening becomes mat.
  const fills: React.CSSProperties = art >= frame ? { width: '100%' } : { height: '100%' }

  return (
    <div className="framed" style={{ '--ratio': String(frame) } as React.CSSProperties}>
      <div className="framed-window" style={{ aspectRatio: String(art), ...fills }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          srcSet={srcSet}
          sizes={sizes}
          alt={alt}
          decoding="async"
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
        />
      </div>
    </div>
  )
}
