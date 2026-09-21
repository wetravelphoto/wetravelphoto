import { redirect } from 'next/navigation'

/**
 * "Stories & type" — the old all-in-one homepage form — lives in the canvas.
 *
 * Every setting it had has a home there: hero stories, their titles and crops
 * in the hero's panel; the standing photograph's crop beside it; each section's
 * typography under that section; the global type in Style mode; the accent
 * mark below the hero is a section of its own, with its picture, position and
 * size.
 */
export default function HomeDetailsMoved() {
  redirect('/edit/home')
}
