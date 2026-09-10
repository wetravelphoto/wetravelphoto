'use client'

import { useState } from 'react'

const paths = {
  link: (
    <>
      <path d="M9 13a4 4 0 0 0 5.66 0l3-3A4 4 0 0 0 12 4.34l-1.5 1.5" />
      <path d="M15 11a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 12 19.66l1.5-1.5" />
    </>
  ),
  facebook: <path d="M14 8.5h2.5V5.6h-2.2c-2.3 0-3.6 1.4-3.6 3.7V11H8.5v2.9h2.2V21h3v-7.1h2.3l.4-2.9h-2.7V9.6c0-.8.3-1.1 1.3-1.1Z" />,
  x: (
    <>
      <path d="M4.5 4.5 19 19.5" />
      <path d="M19.5 4.5 4.5 19.5" opacity="0.35" />
    </>
  ),
  pinterest: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10.4 19c-.4-1.5.1-3.3.5-4.7.2-.9.7-2.6.7-2.6s-.3-.6-.3-1.4c0-1.3.8-2.3 1.7-2.3.8 0 1.2.6 1.2 1.4 0 .8-.5 2.1-.8 3.3-.2.9.5 1.7 1.4 1.7 1.7 0 2.9-2.2 2.9-4.7 0-2-1.3-3.4-3.7-3.4-2.7 0-4.4 2-4.4 4.2 0 .8.2 1.3.6 1.8" />
    </>
  ),
}

function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

export default function ShareRail({ title }: { title: string }) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
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

  return (
    <aside className="share-rail" aria-label="Share this story">
      <span className="share-rail-label">{copied ? 'Copied' : 'Share'}</span>
      <button type="button" onClick={copyLink} title="Copy link" aria-label="Copy link">
        <Icon name="link" />
      </button>
      <button type="button" onClick={() => open('facebook')} title="Facebook" aria-label="Share on Facebook">
        <Icon name="facebook" />
      </button>
      <button type="button" onClick={() => open('x')} title="X" aria-label="Share on X">
        <Icon name="x" />
      </button>
      <button type="button" onClick={() => open('pinterest')} title="Pinterest" aria-label="Share on Pinterest">
        <Icon name="pinterest" />
      </button>
    </aside>
  )
}
