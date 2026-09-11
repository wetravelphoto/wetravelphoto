'use client'

import { useState } from 'react'
import Icon from '@/components/SocialIcons'

export type ToolbarAction = 'download' | 'favorite' | 'slideshow'

/**
 * The bar between the cover and the grid. Public galleries get sharing and a
 * slideshow; private ones also get downloads and favourites.
 */
export default function GalleryToolbar({
  galleryTitle,
  siteTitle,
  actions = [],
  onSlideshow,
  onDownloadAll,
  downloading = false,
}: {
  galleryTitle: string
  siteTitle: string
  actions?: ToolbarAction[]
  onSlideshow?: () => void
  onDownloadAll?: () => void
  downloading?: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    const url = window.location.href

    if (navigator.share) {
      try {
        await navigator.share({ title: galleryTitle, url })
        return
      } catch {
        // Sheet dismissed — fall through to copying
      }
    }

    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function open(kind: 'facebook' | 'x' | 'pinterest') {
    const url = encodeURIComponent(window.location.href)
    const text = encodeURIComponent(galleryTitle)

    const targets = {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      x: `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
      pinterest: `https://pinterest.com/pin/create/button/?url=${url}&description=${text}`,
    }

    window.open(targets[kind], '_blank', 'noopener,width=600,height=560')
  }

  return (
    <div className="gallery-toolbar">
      <div className="gallery-toolbar-title">
        <p className="gallery-toolbar-name">{galleryTitle}</p>
        <p className="gallery-toolbar-site">{siteTitle}</p>
      </div>

      <div className="gallery-toolbar-actions">
        {actions.includes('slideshow') && onSlideshow && (
          <button type="button" onClick={onSlideshow} className="toolbar-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M8 5.5v13l11-6.5z" strokeLinejoin="round" />
            </svg>
            Slideshow
          </button>
        )}

        {actions.includes('download') && onDownloadAll && (
          <button type="button" onClick={onDownloadAll} disabled={downloading} className="toolbar-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M12 3.5v12M7.5 11l4.5 4.5 4.5-4.5M4.5 19.5h15" />
            </svg>
            {downloading ? 'Preparing…' : 'Download all'}
          </button>
        )}

        <span className="toolbar-divider" />

        <button type="button" onClick={copyLink} className="toolbar-icon" title={copied ? 'Copied' : 'Copy link'} aria-label="Copy link">
          <Icon name="link" size={21} />
        </button>
        <button type="button" onClick={() => open('facebook')} className="toolbar-icon" aria-label="Share on Facebook">
          <Icon name="facebook" size={21} />
        </button>
        <button type="button" onClick={() => open('x')} className="toolbar-icon" aria-label="Share on X">
          <Icon name="x" size={21} />
        </button>
        <button type="button" onClick={() => open('pinterest')} className="toolbar-icon" aria-label="Share on Pinterest">
          <Icon name="pinterest" size={21} />
        </button>
      </div>
    </div>
  )
}
