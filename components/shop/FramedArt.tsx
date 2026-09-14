import { frameWidthPercent, ratioOf } from '@/lib/frame'

/**
 * A photograph mounted on a wall, framed and matted.
 *
 * The frame is drawn rather than photographed, so it fits any shape — the mat
 * and moulding are percentage padding, which CSS resolves against width on
 * every side, giving an even border exactly like a cut mat. The photograph's
 * own proportions then determine the frame's outer shape.
 *
 * Only the frame's width has to be worked out, and that's what keeps a tall
 * print from filling the wall: see lib/frame.ts.
 */
export default function FramedArt({
  imageUrl,
  srcSet,
  alt,
  width,
  height,
  sizes = '(max-width: 900px) 100vw, 55vw',
  compact = false,
}: {
  imageUrl: string
  srcSet?: string
  alt: string
  width: number | null
  height: number | null
  sizes?: string
  /** Grids use a shallower wall so the cards aren't mostly empty plaster. */
  compact?: boolean
}) {
  const ratio = ratioOf(width, height)

  return (
    <div className="wall" data-compact={compact}>
      <figure className="frame" style={{ width: `${frameWidthPercent(ratio)}%` }}>
        <div className="mat">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            srcSet={srcSet}
            sizes={sizes}
            alt={alt}
            width={width ?? undefined}
            height={height ?? undefined}
            decoding="async"
            loading={compact ? 'lazy' : undefined}
          />
        </div>
      </figure>
    </div>
  )
}
