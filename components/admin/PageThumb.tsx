'use client'

import { useCallback, useState } from 'react'

/**
 * A MINIATURE OF A REAL PAGE
 * ══════════════════════════
 *
 * `/preview/<key>?thumb=1` — the same route the editor previews through, the
 * same components the live site renders — in an iframe scaled down to fit
 * whatever box it is given.
 *
 * ── Why the scale is measured ───────────────────────────────────────────────
 *
 * The page is rendered at a desktop width and shrunk, so the miniature has the
 * page's real proportions rather than its phone layout. The factor is the
 * box's width over that desktop width, and the box is a grid cell whose width
 * is not known until the grid is laid out.
 *
 * It looks like a job for a container query — `scale(calc(100cqw / 1280))` —
 * and it is not: `scale()` takes a NUMBER, that expression is a LENGTH, and
 * CSS cannot divide one length by another. The whole transform is then invalid
 * and the iframe draws at full size, showing the top-left corner of the page.
 * Which is exactly what it did.
 *
 * ── Why it is one component ─────────────────────────────────────────────────
 *
 * The page cards and the overview's site card both show one. When the second
 * one was written by copying the markup, it got the class that scales the
 * iframe and not the code that sets the number — so it scaled to zero and drew
 * a blank rectangle. Two copies of a mechanism are one copy and one bug.
 */

/** The width the page is rendered at before it is shrunk. */
export const SHOT_WIDTH = 1280
export const SHOT_HEIGHT = 800

export default function PageThumb({
  page,
  /** 16/10 for a page card, 16/9 for the overview's wider window. */
  ratio = '16 / 10',
  className,
}: {
  page: string
  ratio?: string
  className?: string
}) {
  const [shot, setShot] = useState<'waiting' | 'ready' | 'failed'>('waiting')

  const frame = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const fit = () => el.style.setProperty('--pc-scale', String(el.clientWidth / SHOT_WIDTH))
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  return (
    <div
      className={className ? `pc-frame ${className}` : 'pc-frame'}
      ref={frame}
      style={{ aspectRatio: ratio }}
    >
      {shot !== 'ready' && (
        <div className="pc-skeleton" aria-hidden>
          {shot === 'failed' && <span className="pc-skeleton-note">Preview unavailable</span>}
        </div>
      )}

      <iframe
        className="pc-iframe"
        src={`/preview/${page}?thumb=1`}
        title=""
        aria-hidden="true"
        tabIndex={-1}
        loading="lazy"
        width={SHOT_WIDTH}
        height={SHOT_HEIGHT}
        data-ready={shot === 'ready' || undefined}
        onLoad={() => setShot('ready')}
        onError={() => setShot('failed')}
      />
    </div>
  )
}
