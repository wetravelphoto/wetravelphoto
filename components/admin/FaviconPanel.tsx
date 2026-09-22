'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { removeFavicon, uploadFavicon } from '@/app/actions/branding'
import { photoUrl } from '@/lib/images'

/**
 * Settings → Site icon.
 *
 * The small picture on the browser tab. One file, uploaded and live — there
 * is no draft and nothing to publish, because it never appears on the page.
 *
 * The preview is drawn twice on purpose: once at 16px, the size a tab really
 * shows, and once large enough to see what was uploaded. A mark that looks
 * fine at 180px and turns to mud at 16 is the usual mistake, and seeing both
 * side by side is the fastest way to notice it.
 */
export default function FaviconPanel({ path }: { path: string | null }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  // The saved icon, or the one just chosen — so the preview updates before
  // the page has finished refreshing.
  const [current, setCurrent] = useState(path)

  const choose = (file: File | null) => {
    if (!file) return
    setMessage(null)
    const data = new FormData()
    data.set('file', file)
    startTransition(async () => {
      try {
        const r = await uploadFavicon(data)
        if (!r.ok) return setMessage({ ok: false, text: r.message })
        setCurrent(r.path)
        setMessage({ ok: true, text: 'Site icon saved. Browsers may take a refresh or two to show it.' })
        router.refresh()
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not upload that file.' })
      } finally {
        if (input.current) input.current.value = ''
      }
    })
  }

  const clear = () => {
    if (!confirm('Remove the site icon? Tabs will show the browser’s blank page mark again.')) return
    setMessage(null)
    startTransition(async () => {
      try {
        const r = await removeFavicon()
        if (!r.ok) return setMessage({ ok: false, text: r.message })
        setCurrent(null)
        setMessage({ ok: true, text: r.message })
        router.refresh()
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' })
      }
    })
  }

  const src = current ? photoUrl(current) : null

  return (
    <div>
      <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
        The small picture browsers show on the tab, in bookmarks and when someone saves your site
        to a phone&apos;s home screen. A square PNG or SVG of 512 × 512 works everywhere. Keep it
        simple — it is often seen at the size of a full stop.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
            padding: '0.6rem 0.8rem',
            border: '0.5px solid rgba(0,0,0,0.14)',
            borderRadius: 4,
            background: '#fff',
            minHeight: 78,
          }}
        >
          {src ? (
            <>
              {/* Plain <img>: the file sits on R2 under a name nobody can
                  predict, and an icon is far too small to be worth the image
                  pipeline. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="Site icon, actual size on a tab" width={16} height={16} style={{ display: 'block' }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="Site icon" width={48} height={48} style={{ display: 'block' }} />
            </>
          ) : (
            <span className="admin-meta" style={{ margin: 0 }}>
              No icon yet
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="admin-btn"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            {pending ? 'Working…' : current ? 'Replace icon' : 'Upload an icon'}
          </button>
          {current && (
            <button type="button" className="admin-btn admin-btn-ghost" disabled={pending} onClick={clear}>
              Remove
            </button>
          )}
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/svg+xml,image/webp,image/x-icon,.ico"
        hidden
        onChange={(e) => choose(e.target.files?.[0] ?? null)}
      />

      {message && (
        <p className="admin-meta" style={{ margin: '0.7rem 0 0', color: message.ok ? undefined : '#b3261e' }}>
          {message.text}
        </p>
      )}
    </div>
  )
}
