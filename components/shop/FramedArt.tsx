import { frameMetrics } from '@/lib/frame'

/**
 * A framed, matted print hanging in its column.
 *
 * Its size comes from the column it sits in — the enclosing element declares
 * `container-type: inline-size` and everything here is a multiple of 100cqw.
 * Since every column on a wall is the same width, the moulding and mat come
 * out identical on every piece; only the frame's height and how it hangs
 * change with the photograph. See lib/frame.ts and app/frame.css.
 */
export default function FramedArt({
  imageUrl,
  srcSet,
  alt,
  width,
  height,
  sizes = '(max-width: 560px) 84vw, (max-width: 900px) 42vw, (max-width: 1200px) 28vw, 300px',
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
  const m = frameMetrics(width, height)

  // The window is cut to the photograph. Whichever way the art is more extreme
  // than the frame allows is the side that runs out first, and the rest of the
  // opening stays mat.
  const fills: React.CSSProperties =
    m.artRatio >= m.openingRatio ? { width: '100%' } : { height: '100%' }

  return (
    <div
      className="framed"
      style={
        {
          '--wf': String(m.widthFactor),
          '--hf': String(m.heightFactor),
        } as React.CSSProperties
      }
    >
      <div className="framed-window" style={{ aspectRatio: String(m.artRatio), ...fills }}>
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
