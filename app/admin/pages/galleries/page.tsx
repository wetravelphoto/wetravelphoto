import { redirect } from 'next/navigation'

/**
 * The Galleries page is edited in the canvas now, as a list of sections.
 *
 * Its old form here wrote straight to site_settings, so a change went live on
 * save while every canvas edit waited for Publish — two editors for one page,
 * on two different rules. Its menu label is in Settings → Menu.
 *
 * A redirect rather than a 404: the link is in bookmarks and browser history.
 */
export default function GalleriesFormMoved() {
  redirect('/edit/galleries')
}
