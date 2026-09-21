import { redirect } from 'next/navigation'

/**
 * "Stories & type" — the old all-in-one homepage form — lives in the canvas.
 *
 * Every setting it had has a home there: hero stories, their titles and crops
 * in the hero's panel; the standing photograph's crop beside it; each section's
 * typography under that section; the global type in Style mode. The accent mark
 * below the hero, which is a brand asset rather than page content, moved to
 * Settings beside the header and footer logos.
 */
export default function HomeDetailsMoved() {
  redirect('/edit/home')
}
