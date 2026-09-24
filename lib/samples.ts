import SAMPLES from '@/lib/samples.json'

/**
 * THE PHOTOGRAPHS A NEW SITE ARRIVES WITH
 *
 * Six of Gonzalo's pictures, processed into the same WebP ladder as a real
 * upload and living in `public/samples/`. They are the PLATFORM's, not any
 * tenant's: served from this origin, one copy for everybody, rather than the
 * same six photographs paid for once per customer. `isSamplePhoto()` in
 * lib/images.ts is what keeps their paths resolving locally.
 *
 * This file holds the plain values. The seeding and removal live in
 * `app/actions/sites.ts`, which is a `'use server'` module and may therefore
 * only export async functions — which is why the slug is here and not there.
 */

export type Sample = {
  slug: string
  title: string
  caption: string
  width: number
  height: number
  storage_path: string
  derivatives: Record<string, string>
}

/** The gallery every new site starts with. Matched by slug when removing it. */
export const SAMPLE_ALBUM_SLUG = 'sample-gallery'

export const SAMPLE_ALBUM_TITLE = 'Sample gallery'

export const SAMPLE_PHOTOS = SAMPLES as Sample[]
