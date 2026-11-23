'use client'

import { useState } from 'react'
import AssetPicker from '@/components/photos/AssetPicker'
import { libraryAdapter } from '@/components/photos/library-adapter'
import type { BlockImage } from '@/lib/blocks'
import type { PickerResult } from '@/lib/photos/picker-state'
import { blockImagesFrom } from '@/lib/photos/picker-choices'

/**
 * The admin's way into the one picker (components/photos/AssetPicker.tsx),
 * for a story's images and the other path-only image fields.
 *
 * Every photograph here is CONTENT unless the caller declares otherwise: a
 * story image, a featured image and a page photograph carry meaning where
 * they are placed. Only a caller that knows its slot sits behind words (a
 * registry field declared decorative) passes `role="decorative"`. Whether
 * the slot can STORE a description of its own is a separate fact,
 * `describe`: a featured image is content whose field keeps a path and
 * nothing else, so the picker shows the photograph's own description
 * read-only and offers no box whose words would be dropped.
 *
 * Uploads go through the journal route and stay with the story — never into
 * a gallery. A chosen image comes back as a BlockImage carrying its path, its
 * photograph's identity, and — where the slot keeps them — its own
 * description and caption, one per photograph and in the order chosen. A
 * gallery caption is only ever offered as a starting caption, never as the
 * description.
 */
export default function ImagePickerModal({
  publicUrl,
  multiple = false,
  current = [],
  role = 'content',
  captions = false,
  describe = false,
  title,
  slotLabel,
  confirmLabel,
  onClose,
  onSelect,
}: {
  publicUrl: string
  multiple?: boolean
  /** What the slot holds now, restored even when it is not on the first page. */
  current?: readonly BlockImage[]
  /**
   * Declared by the caller, never chosen by the photographer: `decorative`
   * only for a slot declared to sit behind words.
   */
  role?: 'content' | 'decorative'
  /** A caption box per photograph (story image blocks). */
  captions?: boolean
  /**
   * A description box per photograph — only where the caller STORES one
   * (story image blocks). Elsewhere no box is offered rather than one whose
   * words would be dropped.
   */
  describe?: boolean
  title?: string
  slotLabel?: string
  confirmLabel?: string
  onClose: () => void
  onSelect: (images: BlockImage[]) => void
}) {
  const [adapter] = useState(() => libraryAdapter({ publicUrl, upload: 'journal' }))

  const confirm = (result: PickerResult) => onSelect(blockImagesFrom(result, { captions, describe }))

  return (
    <AssetPicker
      adapter={adapter}
      mode={multiple ? 'multiple' : 'single'}
      slot={{ label: slotLabel ?? (multiple ? 'Story images' : 'Image'), role, editableAlt: describe, caption: captions }}
      current={current
        .filter((i) => i.path)
        .map((i) => ({ assetId: i.assetId ?? null, path: i.path, alt: i.alt ?? null, caption: i.caption ?? null }))}
      capabilities={{
        identity: 'asset',
        upload: {
          destination: 'document',
          note: 'Kept with this story — not added to a gallery.',
          route: 'Uploads go straight to your storage. Nothing is published until you publish.',
        },
      }}
      title={title ?? (multiple ? 'Choose images' : 'Choose an image')}
      confirmLabel={confirmLabel}
      onConfirm={confirm}
      onClose={onClose}
    />
  )
}
