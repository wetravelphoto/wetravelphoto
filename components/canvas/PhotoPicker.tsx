'use client'

import { useState } from 'react'
import AssetPicker from '@/components/photos/AssetPicker'
import { libraryAdapter } from '@/components/photos/library-adapter'
import type { PickerCurrent, PickerResult, PickerSlot } from '@/lib/photos/picker-state'

/**
 * THE EDITOR'S PHOTO PICKER
 * ═════════════════════════
 *
 * The canvas's way into the one picker (components/photos/AssetPicker.tsx):
 * the photographer's whole library, every gallery, and an upload that lands
 * in Uploads — never in a gallery — without leaving the page being built.
 *
 * **Files go straight to R2** with a short-lived signed URL and are registered
 * afterwards, where the key is checked against this site's own prefix
 * (components/photos/library-adapter.ts, app/actions/images.ts).
 *
 * **Choosing is not saving, and uploading is not publishing.** The caller
 * writes the result into the draft like any other setting, so the photograph
 * reaches the live site on Publish and a Discard leaves nothing but an unused
 * file.
 */
export default function PhotoPicker({
  publicUrl,
  title = 'Choose a photograph',
  slot,
  current,
  onConfirm,
  onClose,
}: {
  publicUrl: string
  title?: string
  slot: PickerSlot
  current?: readonly PickerCurrent[]
  onConfirm: (result: PickerResult) => void
  onClose: () => void
}) {
  // One adapter per opening: its upload retries are remembered for this dialog only.
  // The canvas picker is where Uploads was always managed, so it may take a
  // photograph out of Uploads (never out of the library, never a file).
  const [adapter] = useState(() => libraryAdapter({ publicUrl, upload: 'site', manageUploads: true }))
  return (
    <AssetPicker
      adapter={adapter}
      mode="single"
      slot={slot}
      current={current}
      capabilities={{
        identity: 'asset',
        upload: {
          destination: 'uploads',
          note: 'Added to Uploads — not to a gallery.',
          route: 'Uploads go straight to your storage, then join Uploads. Nothing is published until you publish.',
        },
      }}
      title={title}
      confirmLabel="Use this photograph"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}
