import type { Metadata } from 'next'
import { Oswald, Karla } from 'next/font/google'
import { getSiteSettings, siteUrl } from '@/lib/site'
import { cssVariables, fontsToLoad, resolveTokens } from '@/lib/styles/tokens'
import { fontHref } from '@/lib/fonts'
import './globals.css'
import './home.css'
import './contact-footer.css'
import './lightbox.css'

const display = Oswald({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-display',
})

const body = Karla({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-body',
})

/**
 * Each site's own name and line, from its settings — never a hard-coded one.
 * The description falls back to a neutral sentence rather than one written
 * for a particular photographer.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings()
  return {
    // Share images and canonical addresses are written as paths; this is what
    // they are resolved against.
    metadataBase: new URL(siteUrl()),
    title: settings.site_title,
    description: settings.tagline ?? `Photographs by ${settings.site_title}.`,
    openGraph: { siteName: settings.site_title, type: 'website' },
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSiteSettings()
  const tokens = resolveTokens(settings.global_styles, settings.global_styles_version)

  // Set as an INLINE STYLE rather than a <style> block. Inline custom
  // properties on the element beat any :root rule in a stylesheet whatever
  // order those stylesheets load in, so the panel's values always win and the
  // defaults in globals.css stay as the fallback. See lib/styles/tokens.ts.
  const vars = cssVariables(tokens) as React.CSSProperties

  // Oswald and Karla ride along with the build; anything else costs one
  // stylesheet, the same trade the gallery covers already make.
  const custom = fontsToLoad(tokens)

  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} style={vars}>
      <head>
        {/* Gallery covers pull their chosen typeface from Google at runtime.
            Opening those connections early saves a DNS + TLS round trip on
            the critical path. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {custom.map((name) => (
          <link key={name} rel="stylesheet" href={fontHref(name)} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  )
}
