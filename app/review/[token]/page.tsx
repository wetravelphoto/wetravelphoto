import type { Metadata } from 'next'
import Link from 'next/link'
import { openShare } from '@/lib/drafts/review'
import { getSiteSettings } from '@/lib/site'
import { composeDraftPage } from '@/lib/drafts/store'
import { findPage, sanitizeCustomPages, sitePages } from '@/lib/sections/pages'
import { cssVariables, fontsToLoad, resolveTokens } from '@/lib/styles/tokens'
import { fontHref } from '@/lib/fonts'
import PageBody from '@/components/PageBody'
import ReviewBar from '@/components/review/ReviewBar'
import '@/app/home.css'
import '@/app/home-polish.css'
import '@/app/hero.css'
import '@/app/instagram.css'
import '@/app/contact-footer.css'
import '@/app/review/review.css'

/**
 * A REVIEW LINK: the unpublished draft, for someone without an account.
 *
 * See lib/drafts/review.ts for what makes this safe. This page only reads:
 * the draft is drawn through the same PageBody as the live site and the
 * editor's preview, over the live settings, with nothing selectable. A bar at
 * the bottom says what this is and moves between pages, and clicks on the
 * site's own links stay inside the review.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Preview of unpublished changes',
  // Never indexed, and the token never travels in a Referer header.
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const [{ token }, { page: asked }] = await Promise.all([params, searchParams])
  const share = await openShare(token)

  if (share.status !== 'ok') {
    return (
      <main className="review-empty">
        <h1>{share.status === 'published' ? 'Nothing to preview right now' : 'This preview link has expired'}</h1>
        <p>
          {share.status === 'published'
            ? 'There are no unpublished changes at the moment: they have been published, or new ones have not been started. This link will show the next changes while it is valid.'
            : 'It may have been switched off, or its time ran out. Ask for a new link.'}
        </p>
        <Link href="/">Go to the website</Link>
      </main>
    )
  }

  const { draft } = share
  // The pages as the draft has them, so a new page can be reviewed before it
  // is published. An unknown page shows the homepage.
  const custom = draft.custom_pages ?? sanitizeCustomPages((await getSiteSettings()).custom_pages)
  const page = asked && findPage(asked, custom) ? asked : 'home'

  const { sections, settings } = await composeDraftPage(draft, page)
  const tokens = resolveTokens(settings.global_styles, settings.global_styles_version)
  const vars = cssVariables(tokens) as React.CSSProperties
  const pages = sitePages(custom)

  return (
    <div style={vars}>
      {fontsToLoad(tokens).map((name) => (
        <link key={name} rel="stylesheet" href={fontHref(name)} />
      ))}

      <PageBody sections={sections} settings={settings} page={page} />

      <ReviewBar
        token={token}
        current={page}
        pages={pages.map((p) => ({ key: p.key, label: p.label, path: p.path }))}
        siteTitle={settings.site_title}
      />
    </div>
  )
}
