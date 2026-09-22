'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The bar across the bottom of a review link: says this is a preview, and
 * moves between the draft's pages.
 *
 * It also keeps the reviewer INSIDE the preview. The site's own menu and links
 * point at the live addresses (/about, /weddings); followed as they are, they
 * would quietly drop the reviewer onto the live site, looking at the old
 * version and not knowing it. So a click on a link to one of the site's pages
 * opens that page of the preview instead. Links anywhere else behave normally.
 */
export default function ReviewBar({
  token,
  current,
  pages,
  siteTitle,
}: {
  token: string
  current: string
  pages: { key: string; label: string; path: string }[]
  siteTitle: string
}) {
  const router = useRouter()
  const go = (key: string) => router.push(`/review/${encodeURIComponent(token)}?page=${encodeURIComponent(key)}`)

  useEffect(() => {
    const byPath = new Map(pages.map((p) => [p.path, p.key]))
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return
      const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!link || link.target === '_blank') return
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin) return
      const key = byPath.get(url.pathname.replace(/\/$/, '') || '/')
      if (!key) return
      event.preventDefault()
      router.push(`/review/${encodeURIComponent(token)}?page=${encodeURIComponent(key)}`)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [pages, router, token])

  return (
    <div className="review-bar" role="region" aria-label="Preview">
      <span className="review-bar-dot" aria-hidden="true" />
      <span className="review-bar-text">
        <strong>Preview</strong> of changes to {siteTitle} that are not live yet
      </span>
      <label className="review-bar-pages">
        <span className="review-sr">Page</span>
        <select value={current} onChange={(e) => go(e.target.value)}>
          {pages.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
