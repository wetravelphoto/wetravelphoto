import { redirect } from 'next/navigation'

/**
 * The homepage is edited in the canvas now.
 *
 * This used to be the section list — drag to reorder, click to open a form —
 * and it wrote straight to the live page. The canvas does all of that on the
 * page itself, through the draft, so nothing changes in public until Publish.
 * Two editors writing the same page by different routes (one drafted, one not)
 * is exactly how an unpublished edit gets silently overwritten, so the old one
 * goes rather than lingering beside the new.
 *
 * A redirect rather than a 404: the link is in bookmarks and browser history.
 */
export default function HomeSectionsMoved() {
  redirect('/edit/home')
}
