import type { BlockImage } from '@/lib/blocks'
import { isNonBlankText } from '@/lib/photos/image'
import type { PickerResult } from '@/lib/photos/picker-state'

/**
 * A picker's result → a story's BlockImages, in the order chosen, each with
 * its own words. Pure, so `.mk/picker-editor.ts` holds it without a browser.
 *
 * `captions` / `describe` say what the slot STORES: a description or caption
 * is copied only where the caller keeps it, and only the one written for that
 * photograph — never one description for the whole set, and never a gallery
 * caption standing in for a description. Blank is P5's one blank rule
 * (`isNonBlankText`): invisible-only words are stored as none, never as text
 * the story page would then ignore.
 */
const words = (v: string | null) => (isNonBlankText(v) ? v.trim() : null)

export function blockImagesFrom(result: PickerResult, opts: { captions: boolean; describe: boolean }): BlockImage[] {
  return result.choices.map((c) => {
    const image: BlockImage = { path: c.path }
    if (c.assetId) image.assetId = c.assetId
    if (opts.captions) image.caption = words(c.caption)
    if (opts.describe) image.alt = words(c.alt)
    return image
  })
}
