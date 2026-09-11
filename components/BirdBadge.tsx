import { getSiteSettings } from '@/lib/site'
import { photoUrl } from '@/lib/images'

/* eslint-disable @next/next/no-img-element */

/** A small brand mark in the light band below the hero. */
export default async function BirdBadge() {
  const settings = await getSiteSettings()
  if (settings.show_bird === false) return null

  const src = settings.logo_bird_path
    ? photoUrl(settings.logo_bird_path)
    : '/logos/we-travel-photo-bird.svg'

  return (
    <div className="bird-mark" aria-hidden="true">
      <img src={src} alt="" style={{ width: settings.logo_bird_size ?? 64 }} />
    </div>
  )
}
