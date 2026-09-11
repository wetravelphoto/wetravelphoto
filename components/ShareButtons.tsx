'use client'

import { useState } from 'react'
import Icon from '@/components/SocialIcons'

/** Share row used on gallery pages. */
export default function ShareButtons({ title }: { title: string }) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    const url = window.location.href

    // Use the OS share sheet where it exists
    if (navigator.share) {
      try {
        await navigator.share({ title, url })
        return
      } catch {
        // Dismissed — fall through to copying
      }
    }

    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function open(kind: 'facebook' | 'x' | 'pinterest') {
    const url = encodeURIComponent(window.location.href)
    const text = encodeURIComponent(title)

    const targets = {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      x: `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
      pinterest: `https://pinterest.com/pin/create/button/?url=${url}&description=${text}`,
    }

    window.open(targets[kind], '_blank', 'noopener,width=600,height=560')
  }

  const btn: React.CSSProperties = {
    background: 'none',
    border: '0.5px solid var(--line)',
    cursor: 'pointer',
    color: 'var(--ink-soft)',
    padding: '0.45rem',
    lineHeight: 0,
    display: 'inline-flex',
    transition: 'color 0.15s ease, border-color 0.15s ease',
  }

  return (
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
      <span className="meta" style={{ marginRight: '0.3rem' }}>
        {copied ? 'Link copied' : 'Share'}
      </span>

      <button type="button" onClick={copyLink} style={btn} title="Copy link" aria-label="Copy link">
        <Icon name="link" size={17} />
      </button>
      <button type="button" onClick={() => open('facebook')} style={btn} title="Facebook" aria-label="Share on Facebook">
        <Icon name="facebook" size={17} />
      </button>
      <button type="button" onClick={() => open('x')} style={btn} title="X" aria-label="Share on X">
        <Icon name="x" size={17} />
      </button>
      <button type="button" onClick={() => open('pinterest')} style={btn} title="Pinterest" aria-label="Share on Pinterest">
        <Icon name="pinterest" size={17} />
      </button>
    </div>
  )
}
