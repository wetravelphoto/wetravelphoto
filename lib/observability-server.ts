import 'server-only'
import * as Sentry from '@sentry/nextjs'
import { watching } from '@/lib/observability'

/**
 * WHICH SITE THE ERROR CAME FROM
 * ══════════════════════════════
 *
 * Split out from `lib/observability.ts` because that file is imported by the
 * browser config too, and `server-only` there would fail the build. This half
 * never reaches a browser.
 *
 * Called once per request from `currentSite()` — the one function that already
 * knows the answer and that everything else goes through. Without it an error
 * report says "the gallery page threw", which was adequate when there was one
 * site and is close to worthless with three.
 *
 * Tags, not context: tags are what a search box filters on, and the first
 * thing wanted is "show me everything on ana.lensgrid.co".
 *
 * `assumed` is worth tagging too. It marks a request whose site was GUESSED —
 * a laptop, a preview build, the host this deployment was configured for. An
 * error on a guessed tenant is a different animal from an error on a real
 * one, and being unable to tell them apart would make every local mistake
 * look like a live fault.
 */
export function markSite(site: { tenantId: string; host: string; assumed: boolean } | null) {
  if (!watching) return

  try {
    if (!site) {
      Sentry.setTag('site', 'unclaimed')
      return
    }
    Sentry.setTag('site', site.host)
    Sentry.setTag('tenant', site.tenantId)
    Sentry.setTag('site_assumed', site.assumed ? 'yes' : 'no')
  } catch {
    // Reporting must never be the thing that breaks a page. If the SDK is not
    // initialised — a runtime it was not loaded in, a half-built environment —
    // the request carries on untagged.
  }
}
