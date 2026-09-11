'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { uploadLogo, clearLogo } from '@/app/actions/branding'

export default function LogoUploader({
  slot,
  label,
  hint,
  currentUrl,
  builtInUrl,
  previewTone = 'light',
}: {
  slot: 'header' | 'footer' | 'bird'
  label: string
  hint?: string
  currentUrl: string | null
  builtInUrl: string
  previewTone?: 'light' | 'dark'
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function handleFile(file: File | undefined) {
    if (!file) return

    setBusy(true)
    setMessage(null)

    const data = new FormData()
    data.append('slot', slot)
    data.append('file', file)

    const result = await uploadLogo(data)

    setBusy(false)
    setMessage(result.message)
    if (result.ok) router.refresh()
  }

  async function revert() {
    setBusy(true)
    const result = await clearLogo(slot)
    setBusy(false)
    setMessage(result.message)
    router.refresh()
  }

  const shown = currentUrl || builtInUrl

  return (
    <div className="logo-slot">
      <p className="logo-slot-label">{label}</p>

      <div className="logo-preview" data-tone={previewTone}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shown} alt="" style={{ filter: !currentUrl && previewTone === 'dark' ? 'brightness(0) invert(1)' : undefined }} />
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="admin-btn admin-btn-sm admin-btn-ghost"
        >
          {busy ? 'Uploading…' : currentUrl ? 'Replace' : 'Upload'}
        </button>

        {currentUrl && (
          <button type="button" onClick={revert} disabled={busy} className="admin-btn admin-btn-sm admin-btn-danger">
            Revert
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/svg+xml,image/png,image/webp,image/jpeg"
        hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {hint && (
        <p className="admin-meta" style={{ margin: '0.45rem 0 0', lineHeight: 1.5 }}>
          {hint}
        </p>
      )}

      {message && (
        <p className="admin-meta" style={{ marginTop: '0.4rem', color: 'var(--admin-accent)' }}>
          {message}
        </p>
      )}

    </div>
  )
}
