import { getSiteSettings } from '@/lib/site'
import { photoUrl } from '@/lib/images'
import HeaderNav from '@/components/HeaderNav'
import { getFont } from '@/lib/fonts'

/**
 * Server wrapper so every page picks up the site's own name and logo without
 * each one having to fetch settings itself.
 */
export default async function SiteHeader({ overHero = false }: { overHero?: boolean }) {
  const settings = await getSiteSettings()

  const nav = getFont(settings.header_nav_font || 'Oswald')

  return (
    <HeaderNav
      overHero={overHero}
      siteTitle={settings.site_title}
      logoUrl={settings.logo_header_path ? photoUrl(settings.logo_header_path) : null}
      logoHeight={settings.logo_header_height ?? 34}
      align={settings.header_align || 'split'}
      showAbout={settings.show_about !== false}
      showShop={settings.show_shop === true}
      labels={{
        galleries: settings.nav_galleries_label || 'Galleries',
        journal: settings.nav_journal_label || 'Journal',
        about: settings.nav_about_label || 'About',
        contact: settings.nav_contact_label || 'Contact',
        shop: settings.nav_shop_label || 'Prints',
      }}
      navStyle={{
        ['--nav-font' as string]: nav.stack,
        ['--nav-weight' as string]: nav.weight,
        ['--nav-case' as string]: nav.uppercase ? 'uppercase' : 'none',
        ['--nav-track' as string]: nav.tracking,
        ['--nav-scale' as string]: String(settings.header_nav_scale ?? 1),
        ['--nav-scale-mobile' as string]: String(settings.header_nav_scale_mobile ?? 1),
        ['--logo-h' as string]: `${settings.logo_header_height ?? 34}px`,
        ['--logo-h-mobile' as string]: `${settings.logo_header_height_mobile ?? 26}px`,
      }}
    />
  )
}
