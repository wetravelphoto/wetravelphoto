'use client'

import { useRef, useState, type ReactNode } from 'react'
import GalleryCover from '@/components/covers/GalleryCover'
import CoverRenderer, { type CoverSettings } from '@/components/CoverRenderer'
import { COVER_STYLES, type CoverStyleKey } from '@/lib/covers/registry'
import type { CoverModel } from '@/lib/covers/model'

/** A registry style, or a legacy preset drawn by the old renderer exactly as before. */
export type FirstCover =
  | { kind: 'style'; styleKey: CoverStyleKey; model: CoverModel }
  | { kind: 'legacy'; settings: CoverSettings }

/**
 * COVER FIRST
 * ═══════════
 *
 * An album opens on its cover, full screen; "View gallery" carries the visitor
 * down into the photographs with a smooth transition. The gallery is already
 * on the page beneath (server-rendered), so the cover costs no second request
 * and scrolling past it works without the button too. Every privacy type uses
 * this — a public album, an unlisted or password one past its gate, and a
 * client's private link.
 */
export default function CoverFirst({ cover, children }: { cover: FirstCover; children: ReactNode }) {
  const galleryRef = useRef<HTMLDivElement>(null)
  const [entered, setEntered] = useState(false)

  function enter() {
    setEntered(true)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    galleryRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    // Focus moves with the view, so a keyboard or screen-reader visitor lands in the gallery too.
    galleryRef.current?.focus({ preventScroll: true })
  }

  return (
    <>
      {cover.kind === 'style' ? (
        <GalleryCover style={COVER_STYLES[cover.styleKey]} model={cover.model} onEnter={enter} priority />
      ) : (
        <CoverRenderer
          settings={{ ...cover.settings, showButton: true, buttonText: cover.settings.buttonText || 'View gallery' }}
          height="100svh"
          priority
          sizes="100vw"
          onButtonClick={enter}
        />
      )}
      <div
        ref={galleryRef}
        id="gallery"
        tabIndex={-1}
        className="cover-first-gallery"
        data-entered={entered ? '' : undefined}
      >
        {children}
      </div>
    </>
  )
}
