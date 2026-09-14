'use client'

import { useState } from 'react'

export type FrameStyle = 'black' | 'oak' | 'white' | 'none'

const FRAMES: { id: FrameStyle; label: string; border: string; edge: string }[] = [
  { id: 'black', label: 'Black', border: 'linear-gradient(145deg,#2a2724,#100f0e)', edge: '#000' },
  { id: 'oak', label: 'Oak', border: 'linear-gradient(145deg,#d8b483,#a97f4f)', edge: '#8a6538' },
  { id: 'white', label: 'White', border: 'linear-gradient(145deg,#fff,#e3e0da)', edge: '#cfcac2' },
  { id: 'none', label: 'No frame', border: 'transparent', edge: 'transparent' },
]

/**
 * A straight-on framed view on a plain wall, rather than a photo of a room.
 *
 * A perspective room mockup needs per-room geometry and looks wrong the moment
 * the warp is slightly off, which reads as cheap on a print you're asking real
 * money for. This is honest instead: a real mat, a real frame profile, a soft
 * cast shadow, and — the part that actually sells — sizes drawn to scale
 * against each other, so 24 × 36 visibly dwarfs 12 × 18.
 */
export default function WallMockup({
  imageUrl,
  srcSet,
  alt,
  aspect,
  widthInches,
  heightInches,
}: {
  imageUrl: string
  srcSet?: string
  alt: string
  aspect: number
  widthInches: number
  heightInches: number
}) {
  const [frame, setFrame] = useState<FrameStyle>('black')

  const active = FRAMES.find((f) => f.id === frame) ?? FRAMES[0]

  // The largest offered print fills most of the wall; everything else is drawn
  // relative to it, so the scale comparison stays truthful.
  const scale = Math.min(1, Math.max(widthInches, heightInches) / 36)

  const frameWidth = frame === 'none' ? 0 : 2.2
  const matWidth = frame === 'none' ? 0 : 3.4

  return (
    <div className="wall">
      <div className="wall-surface">
        <figure
          className="wall-art"
          style={{
            width: `${58 * scale * (aspect >= 1 ? 1 : aspect)}%`,
            aspectRatio: String(aspect),
            padding: `${frameWidth}%`,
            background: active.border,
            boxShadow:
              frame === 'none'
                ? '0 18px 40px -18px rgba(0,0,0,0.45)'
                : `0 0 0 1px ${active.edge}, 0 22px 48px -20px rgba(0,0,0,0.55)`,
          }}
        >
          <div className="wall-mat" style={{ padding: `${matWidth}%` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} srcSet={srcSet} alt={alt} className="wall-image" />
          </div>
        </figure>

        <span className="wall-scale" aria-hidden>
          {widthInches} × {heightInches} in
        </span>
      </div>

      <div className="wall-frames" role="group" aria-label="Frame">
        {FRAMES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFrame(option.id)}
            data-active={frame === option.id}
            className="wall-frame-swatch"
            aria-label={option.label}
            title={option.label}
          >
            <span style={{ background: option.border === 'transparent' ? '#efece6' : option.border }} />
            {option.label}
          </button>
        ))}
      </div>

      <p className="wall-note">Shown to scale. Frames are for illustration and sold separately.</p>
    </div>
  )
}
