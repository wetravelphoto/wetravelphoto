import { createClient } from '@/lib/supabase/server'
import { requireEditor } from '@/lib/auth'
import { getSiteSettings } from '@/lib/site'
import { currentSite } from '@/lib/tenant'
import { PLATFORM } from '@/lib/platform'
import { draftStatus } from '@/lib/drafts/store'
import { startHere } from '@/lib/start-here'
import { audience, recentContent, windowOf } from '@/lib/admin/overview'
import Overview from '@/components/admin/Overview'

export const dynamic = 'force-dynamic'

/**
 * THE FIRST SCREEN.
 *
 * Everything on it is read from this site. Nothing is estimated, and where a
 * question cannot be answered honestly the answer says so rather than
 * defaulting to a plausible zero — see lib/admin/overview.ts.
 */
export default async function AdminDashboard({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const days = windowOf((await searchParams)?.days)

  const [guide, settings, site, draft, seen, recent, unread] = await Promise.all([
    startHere(tenantId),
    getSiteSettings(),
    currentSite(),
    draftStatus(),
    audience(tenantId, days),
    recentContent(tenantId),
    supabase
      .from('contact_messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_read', false),
  ])

  const host = site?.primaryHost ?? null

  /*
   * ── THE THREE THINGS THAT MAKE A SITE A BUSINESS ──────────────────────────
   *
   * Each one is a fact about this site, not a suggestion. "Custom domain" is
   * done when the address the site is served at is not a subdomain the
   * platform handed out — that is what having your own domain MEANS, and it
   * is answerable without a domains table existing.
   */
  const ownDomain = !!host && !host.endsWith(`.${PLATFORM.domain}`)

  const essentials = [
    {
      id: 'published',
      label: 'Website published',
      detail: host ? `Your site is live at ${host}.` : 'No address is attached to this site yet.',
      done: !!host,
      href: '/admin/pages',
      cta: 'Publish',
    },
    {
      id: 'domain',
      label: 'Custom domain',
      detail: ownDomain ? `Connected — ${host}.` : 'Connect your own domain.',
      done: ownDomain,
      // No domains screen exists in this build; Settings is where the
      // address is shown, and it says so there.
      href: '/admin/settings',
      cta: 'Connect',
    },
    {
      id: 'instagram',
      label: 'Instagram feed',
      detail: settings.instagram_token
        ? `Connected${settings.instagram_handle ? ` — ${settings.instagram_handle}` : ''}.`
        : 'Show your latest photos on your site.',
      done: !!settings.instagram_token,
      href: '/admin/settings',
      cta: 'Connect',
    },
  ]

  /** What to call them. Their own name if the site has one, else the account. */
  const firstName = (settings.owner_name || '').trim().split(/\s+/)[0] || 'there'

  return (
    <Overview
      firstName={firstName}
      siteName={settings.site_title || 'Your site'}
      host={host}
      hasDraft={draft.hasDraft}
      audience={seen}
      steps={guide.steps}
      stepsDone={guide.done}
      showSteps={guide.show}
      recent={recent}
      unread={unread.count ?? 0}
      essentials={essentials}
    />
  )
}
