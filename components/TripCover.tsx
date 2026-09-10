'use client'

import CoverRenderer, { type CoverSettings } from '@/components/CoverRenderer'

/** Wraps the cover so the button can scroll down to the gallery. */
export default function TripCover({ settings }: { settings: CoverSettings }) {
  return (
    <div className="fade-up">
      <CoverRenderer
        settings={settings}
        height="min(80vh, 700px)"
        onButtonClick={() => {
          document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' })
        }}
      />
    </div>
  )
}
