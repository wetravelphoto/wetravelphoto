/**
 * THE PLATFORM, AS DISTINCT FROM ANY ONE SITE
 * ═══════════════════════════════════════════
 *
 * Lens Grid is the product: the admin, the editor, the sign-in screen, and —
 * eventually — the marketing site at lensgrid.co where photographers sign up
 * and where the super-admin lives.
 *
 * Each photographer's public site is theirs and carries THEIR name, from
 * site_settings.site_title. WeTravelPhoto is one of those sites, not the
 * platform. The rule that follows:
 *
 *   · Anything a VISITOR to a photographer's site sees uses the site's own
 *     name. Never this.
 *   · Anything the PHOTOGRAPHER sees while working — admin chrome, the canvas,
 *     sign-in, emails from the platform — uses this.
 *
 * One constant, so the name is a one-line change and nothing hard-codes it.
 */
export const PLATFORM = {
  name: 'Lens Grid',
  domain: 'lensgrid.co',
} as const
