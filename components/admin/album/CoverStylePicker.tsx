'use client'

import { memo } from 'react'
import GalleryCover from '@/components/covers/GalleryCover'
import DevicePreview, { DEVICES } from '@/components/admin/album/DevicePreview'
import {
  COVER_STYLES,
  COVER_STYLE_KEYS,
  suitsOrientation,
  type CoverOrientation,
  type CoverStyleKey,
} from '@/lib/covers/registry'
import { resolveCoverModel, type CoverInput } from '@/lib/covers/model'

/**
 * The fourteen styles, each drawn by its real component with the album's own
 * cover photograph and title — a thumbnail is the cover, scaled, not a
 * diagram. A style drawn for the other orientation is marked, and still
 * selectable.
 */
export default function CoverStylePicker({
  value,
  input,
  orientation,
  onPick,
}: {
  /** The selected style's semantic key — resolved from the stored `v2:<key>` by coverStyle(); null for an earlier layout. */
  value: CoverStyleKey | null
  /** The album's content (title, photograph, …); each style supplies its own defaults for the rest. */
  input: CoverInput
  orientation: CoverOrientation | null
  onPick: (key: CoverStyleKey) => void
}) {
  return (
    <div className="cover-style-grid">
      {COVER_STYLE_KEYS.map((key) => (
        <Thumb key={key} styleKey={key} active={value === key} input={input} orientation={orientation} onPick={onPick} />
      ))}
    </div>
  )
}

const Thumb = memo(function Thumb({
  styleKey,
  active,
  input,
  orientation,
  onPick,
}: {
  styleKey: CoverStyleKey
  active: boolean
  input: CoverInput
  orientation: CoverOrientation | null
  onPick: (key: CoverStyleKey) => void
}) {
  const style = COVER_STYLES[styleKey]
  // The style's own face and colours: a thumbnail shows the style as designed.
  const model = resolveCoverModel(style, { ...input, font: null, titleColor: null, background: null, titleScale: 1 })
  const fits = suitsOrientation(style, orientation)
  return (
    <button type="button" className="cover-style-swatch" data-active={active} onClick={() => onPick(styleKey)} aria-pressed={active}>
      <span className="cover-style-thumb" aria-hidden="true">
        <DevicePreview width={DEVICES.desktop.width}>
          <GalleryCover style={style} model={model} height={`${DEVICES.desktop.height}px`} />
        </DevicePreview>
      </span>
      <span className="cover-style-name">
        {style.number} · {style.label}
      </span>
      {!fits && <span className="cover-style-note">Drawn for {style.suits[0]} photos</span>}
    </button>
  )
})
