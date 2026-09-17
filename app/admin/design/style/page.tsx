import { redirect } from 'next/navigation'

/**
 * Style moved into the canvas.
 *
 * This page used to be the only way to change the site's colours and type, and
 * it wrote straight to site_settings — so touching a colour changed the live
 * site immediately, with no draft and no way back. Once the canvas had a draft
 * layer that was no longer a missing feature, it was a trap: every other edit
 * waited for Publish and this one did not.
 *
 * Kept as a redirect rather than deleted because the link is in people's
 * history and in the Design page's older markup, and a 404 is a worse answer
 * than the right screen.
 */
export default function StylePageMoved() {
  redirect('/edit/home?mode=style')
}
