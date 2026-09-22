import { getSiteSettings, type SiteSettings } from '@/lib/site'
import { resolveMenu, sanitizeMenu } from '@/lib/menu'
import { sanitizeCustomPages } from '@/lib/sections/pages'
import { photoUrl } from '@/lib/images'
import HeaderNav from '@/components/HeaderNav'
import { fontHref } from '@/lib/fonts'
import { navFontVars } from '@/lib/chrome'

/**
 * Server wrapper so every page picks up the site's own name and logo without
 * each one having to fetch settings itself.
 */
export default async function SiteHeader({
  overHero = false,
  settings: given,
}: {
  overHero?: boolean
  /**
   * The settings to draw with. PageBody passes its own, which in the editor's
   * preview are the draft's; everywhere else the live settings are read here.
   */
  settings?: SiteSettings
}) {
  const settings = given ?? (await getSiteSettings())

  // The menu built in the editor (lib/menu.ts), or the one every site had
  // before it could be edited.
  const links = resolveMenu(
    sanitizeMenu(settings.menu),
    settings,
    sanitizeCustomPages(settings.custom_pages)
  )

  const navFont = settings.header_nav_font || 'Oswald'

  return (
    <>
      {/* The menu's typeface, which the root layout does not load unless it
          happens to be one of the site's own. React puts it in <head>. */}
      <link rel="stylesheet" href={fontHref(navFont)} precedence="default" />
      <HeaderNav
      overHero={overHero}
      siteTitle={settings.site_title}
      logoUrl={settings.logo_header_path ? photoUrl(settings.logo_header_path) : null}
      logoHeight={settings.logo_header_height ?? 34}
      align={settings.header_align || 'split'}
      links={links}
      navStyle={{
        // The same function the editor repaints with (lib/chrome.ts).
        ...(navFontVars(navFont) as React.CSSProperties),
        ['--nav-scale' as string]: String(settings.header_nav_scale ?? 1),
        ['--nav-scale-mobile' as string]: String(settings.header_nav_scale_mobile ?? 1),
        ['--logo-h' as string]: `${settings.logo_header_height ?? 34}px`,
        ['--logo-h-mobile' as string]: `${settings.logo_header_height_mobile ?? 26}px`,
      }}
    />
    </>
  )
}
