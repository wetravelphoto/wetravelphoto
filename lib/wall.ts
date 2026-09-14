import type { CSSProperties } from 'react'
import type { SiteSettings } from '@/lib/site'

/** The plaster that ships with the site, used until someone picks another. */
export const DEFAULT_WALL_TEXTURE = '/textures/plaster.webp'

type WallSettings = Pick<SiteSettings, 'shop_wall_texture' | 'shop_title_font'>

/**
 * The two things a shop page hands to CSS: what the wall is made of and what
 * the headings are set in. Both are per-site, so they can't live in a
 * stylesheet.
 *
 * An explicitly blank texture means a plain wall — only an unset one falls
 * back to the shipped plaster.
 */
export function wallStyle(settings: WallSettings): CSSProperties {
  const texture =
    settings.shop_wall_texture === null || settings.shop_wall_texture === undefined
      ? DEFAULT_WALL_TEXTURE
      : settings.shop_wall_texture.trim()

  const font = settings.shop_title_font?.trim()

  return {
    '--wall-texture': texture ? `url('${texture}')` : 'none',
    '--font-shop-title': font ? `'${font}', Georgia, serif` : 'var(--font-display), Georgia, serif',
  } as CSSProperties
}

/**
 * The stylesheet URL for a chosen Google font, or null when none is set.
 * Italic is included because the closing quote is set in it.
 */
export function googleFontHref(family: string | null | undefined): string | null {
  const name = family?.trim()
  if (!name) return null

  // Only a font family belongs here — anything else is somebody trying to
  // point the page at a URL of their own.
  if (!/^[A-Za-z0-9 ]{1,48}$/.test(name)) return null

  return `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}:ital,wght@0,300;0,400;1,400&display=swap`
}

export type Feature = { icon: string | null; title: string; body: string | null }

type FeatureSettings = Pick<
  SiteSettings,
  | 'shop_feature1_icon' | 'shop_feature1_title' | 'shop_feature1_body'
  | 'shop_feature2_icon' | 'shop_feature2_title' | 'shop_feature2_body'
  | 'shop_feature3_icon' | 'shop_feature3_title' | 'shop_feature3_body'
>

/**
 * The reassurance blurbs on a product page, in order, skipping any without a
 * title. Three slots rather than a list because three is what the row holds —
 * a fourth would wrap and look like a mistake.
 */
export function features(settings: FeatureSettings): Feature[] {
  return [
    {
      icon: settings.shop_feature1_icon,
      title: settings.shop_feature1_title?.trim() ?? '',
      body: settings.shop_feature1_body,
    },
    {
      icon: settings.shop_feature2_icon,
      title: settings.shop_feature2_title?.trim() ?? '',
      body: settings.shop_feature2_body,
    },
    {
      icon: settings.shop_feature3_icon,
      title: settings.shop_feature3_title?.trim() ?? '',
      body: settings.shop_feature3_body,
    },
  ].filter((f) => f.title.length > 0)
}

/** One line per line typed, at most two — the band has room for two. */
export function footerLines(value: string | null | undefined): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
}
