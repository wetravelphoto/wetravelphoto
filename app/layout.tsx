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
      <body>{children}</body>
    </html>
  )
}
