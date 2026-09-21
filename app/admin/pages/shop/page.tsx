import { redirect } from 'next/navigation'

/**
 * The Shop page is edited in the canvas now, as a list of sections.
 *
 * Its old form here mixed two different things: the page (its title lines,
 * how many prints across, the captions) and the shop (whether it is open, what
 * is for sale, shipping, each print's own page, the wall and the closing quote
 * that both pages share). The page moved to the canvas; the shop moved to
 * /admin/shop/settings, under Selling.
 *
 * A redirect rather than a 404: the link is in bookmarks and browser history.
 */
export default function ShopFormMoved() {
  redirect('/edit/shop')
}
