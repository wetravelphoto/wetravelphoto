import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDraftPage } from '@/lib/drafts/store'
import { cssVariables, fontsToLoad, resolveTokens } from '@/lib/styles/tokens'
import { fontHref } from '@/lib/fonts'
import PageBody from '@/components/PageBody'
import PreviewBridge from '@/components/preview/PreviewBridge'
import { isPage } from '@/lib/sections/pages'
import '@/app/home.css'
import '@/app/home-polish.css'
import '@/app/hero.css'
import '@/app/instagram.css'
import '@/app/contact-footer.css'
import '@/app/preview/preview.css'

/**
 * THE CANVAS'S IFRAME
 * ═══════════════════
 *
 * The site as it would look if the draft were published, drawn by the same
 * components the live page uses, with each section tagged so it can be
 * clicked.
 *
 * WHY THIS IS A ROUTE AND NOT DRAFT MODE. Next's draftMode() would let the
 * editor preview the real URL, which sounds better until you notice it reads a
 * cookie: reading one in the homepage's data path opts that route out of the
 * cache for everybody, and the homepage — which queries every public album and
 * attaches a cover to each — is the one page on this site that most needs to
 * stay cached. A separate route keeps `revalidate = 60` on app/page.tsx and
 * costs one shared component to stay honest.
 *
 * WHY IT IS NOT UNDER /admin. It would inherit the admin sidebar layout, and
 * a preview with a sidebar in it is not a preview. It is gated instead by the
 * middleware matcher AND by the check below — the matcher is the gate, but a
 * page that reveals unpublished work should not be the one component in the
 * system that trusts someone else to have done the checking.
 */

export const dynamic = 'force-dynamic'

/** Belt to robots.txt's braces. Unpublished work is never indexable. */
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export default async function PreviewPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params
  if (!isPage(page)) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/admin/login')

  const { sections, settings, isDraft } = await loadDraftPage(page)

  // The root layout has already written the LIVE tokens onto <html>. Custom
  // properties cascade, so re-declaring them on this wrapper is enough to show
  // the draft's colours and type without the public layout knowing anything
  // about drafts.
  const tokens = resolveTokens(settings.global_styles, settings.global_styles_version)
  const vars = cssVariables(tokens) as React.CSSProperties

  return (
    <div className="pv-root" style={vars} data-draft={isDraft ? 'true' : 'false'}>
      {/* A draft may have chosen a typeface the root layout did not load.
          React hoists these into <head>. */}
      {fontsToLoad(tokens).map((name) => (
        <link key={name} rel="stylesheet" href={fontHref(name)} />
      ))}

      <PreviewBridge page={page} />

      <PageBody sections={sections} settings={settings} selectable page={page} />
    </div>
  )
}
