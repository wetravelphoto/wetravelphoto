import type { Metadata } from 'next'
import { Oswald, Karla } from 'next/font/google'
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

export const metadata: Metadata = {
  title: 'WeTravelPhoto',
  description: 'Travel photography and field notes from the road, the water, and the cold places.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <head>
        {/* Gallery covers pull their chosen typeface from Google at runtime.
            Opening those connections early saves a DNS + TLS round trip on
            the critical path. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body>{children}</body>
    </html>
  )
}
