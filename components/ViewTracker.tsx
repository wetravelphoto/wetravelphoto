'use client'

import { useEffect, useRef } from 'react'

/** Fires one view record per page load, after the content has rendered. */
export default function ViewTracker({ albumId, postId }: { albumId?: string; postId?: string }) {
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true

    fetch('/api/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumId, postId }),
    }).catch(() => {
      // Analytics should never break the page
    })
  }, [albumId, postId])

  return null
}
