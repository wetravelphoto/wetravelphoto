import { redirect } from 'next/navigation'

/**
 * The Contact page is edited in the canvas now, as a list of sections.
 *
 * Its old form here wrote straight to site_settings, so a change went live on
 * save while every canvas edit waited for Publish — two editors for one page,
 * on two different rules. The menu label
 * moved to Settings → Menu with the rest of the site's navigation.
 *
 * A redirect rather than a 404: the link is in bookmarks and browser history.
 */
export default function ContactFormMoved() {
  redirect('/edit/contact')
}
