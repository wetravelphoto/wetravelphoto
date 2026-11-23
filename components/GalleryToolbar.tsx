'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Icon from '@/components/SocialIcons'

export type ToolbarAction = 'download' | 'favorite' | 'slideshow'

/**
 * How Share behaves. A public album offers the social networks as well as the
 * link; a client's private link is only ever copied — with one line saying
 * what that means — and never handed to a social network.
 */
export type ShareMode = { kind: 'public' } | { kind: 'private'; url: string }

/**
 * The bar between the cover and the grid: the gallery's name, a slideshow,
 * whatever the page adds (downloads, favourites), and a clearly labelled
 * Share button.
 */
export default function GalleryToolbar({
  galleryTitle,
  siteTitle,
  actions = [],
  onSlideshow,
  onDownloadAll,
  downloading = false,
  share = { kind: 'public' },
  children,
}: {
  galleryTitle: string
  siteTitle: string
  actions?: ToolbarAction[]
  onSlideshow?: () => void
  onDownloadAll?: () => void
  downloading?: boolean
  share?: ShareMode
  /** Extra controls (the client page's download and favourites buttons). */
  children?: ReactNode
}) {
  return (
    <div className="gallery-toolbar">
      <div className="gallery-toolbar-title">
        <p className="gallery-toolbar-name">{galleryTitle}</p>
        <p className="gallery-toolbar-site">{siteTitle}</p>
      </div>

      <div className="gallery-toolbar-actions">
        {actions.includes('slideshow') && onSlideshow && (
          <button type="button" onClick={onSlideshow} className="toolbar-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" strokeLinejoin="round" />
            </svg>
            Slideshow
          </button>
        )}

        {actions.includes('download') && onDownloadAll && (
          <button type="button" onClick={onDownloadAll} disabled={downloading} className="toolbar-btn">
            <DownloadGlyph />
            {downloading ? 'Preparing…' : 'Download all'}
          </button>
        )}

        {children}

        <ShareButton title={galleryTitle} mode={share} />
      </div>
    </div>
  )
}

export function DownloadGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 3.5v12M7.5 11l4.5 4.5 4.5-4.5M4.5 19.5h15" />
    </svg>
  )
}

function ShareButton({ title, mode }: { title: string; mode: ShareMode }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const url = () => (mode.kind === 'private' ? mode.url : window.location.href.split('#')[0]!)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url())
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      // Clipboard refused (an insecure context): select-and-copy is the fallback.
      window.prompt('Copy this link', url())
    }
  }

  function social(kind: 'facebook' | 'x' | 'pinterest') {
    const u = encodeURIComponent(url())
    const text = encodeURIComponent(title)
    const targets = {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
      x: `https://twitter.com/intent/tweet?url=${u}&text=${text}`,
      pinterest: `https://pinterest.com/pin/create/button/?url=${u}&description=${text}`,
    }
    window.open(targets[kind], '_blank', 'noopener,width=600,height=560')
  }

  return (
    <div className="share-wrap" ref={wrap}>
      <button
        type="button"
        className="toolbar-btn share-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 15.5V3.5M7.5 8 12 3.5 16.5 8M5 12.5v6.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-6.5" />
        </svg>
        Share
      </button>

      {open && (
        <div className="share-pop" role="dialog" aria-label="Share this gallery">
          {mode.kind === 'private' ? (
            <>
              <button type="button" className="share-copy" onClick={copy}>
                <Icon name="link" size={18} />
                {copied ? 'Link copied' : 'Copy private link'}
              </button>
              <p className="share-note">Anyone with this link can view this gallery.</p>
            </>
          ) : (
            <>
              <button type="button" className="share-copy" onClick={copy}>
                <Icon name="link" size={18} />
                {copied ? 'Link copied' : 'Copy link'}
              </button>
              <div className="share-social">
                <button type="button" onClick={() => social('facebook')} aria-label="Share on Facebook">
                  <Icon name="facebook" size={20} />
                </button>
                <button type="button" onClick={() => social('x')} aria-label="Share on X">
                  <Icon name="x" size={20} />
                </button>
                <button type="button" onClick={() => social('pinterest')} aria-label="Share on Pinterest">
                  <Icon name="pinterest" size={20} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
