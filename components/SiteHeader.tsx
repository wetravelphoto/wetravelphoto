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
      navStyle={{
        ['--nav-font' as string]: nav.stack,
        ['--nav-weight' as string]: nav.weight,
        ['--nav-case' as string]: nav.uppercase ? 'uppercase' : 'none',
        ['--nav-track' as string]: nav.tracking,
        ['--nav-scale' as string]: String(settings.header_nav_scale ?? 1),
      }}
    />
  )
}
