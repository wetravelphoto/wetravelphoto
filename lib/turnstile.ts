/**
 * Cloudflare Turnstile: a free, usually invisible check that a form was sent
 * by a person. One key pair for the whole platform (like the email service),
 * so photographers set nothing up.
 *
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY   shown to the browser (not secret)
 *   TURNSTILE_SECRET_KEY             server-only
 *
 * Without them the check is skipped and the honeypot field still catches the
 * simplest bots. With them, a form without a valid token is refused.
 */
export function turnstileEnabled(): boolean {
  return !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !!process.env.TURNSTILE_SECRET_KEY
}

export async function verifyTurnstile(token: string | null, ip?: string | null): Promise<boolean> {
  if (!turnstileEnabled()) return true
  if (!token) return false

  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token })
    if (ip) body.set('remoteip', ip)

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(8_000),
    })
    const result = (await response.json()) as { success?: boolean }
    return result.success === true
  } catch {
    // Cloudflare unreachable: let the message through rather than lose it.
    // The honeypot has already run, and every message is stored for review.
    return true
  }
}
