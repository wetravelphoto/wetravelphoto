'use client'

import Script from 'next/script'

/**
 * The Turnstile check, inside a form. Cloudflare's script finds the div,
 * runs its (usually invisible) check, and adds a hidden
 * `cf-turnstile-response` field to the form, which the server verifies
 * (lib/turnstile.ts). Renders nothing when no site key is configured.
 */
export default function Turnstile() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  if (!siteKey) return null

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" async defer />
      <div className="cf-turnstile" data-sitekey={siteKey} data-appearance="interaction-only" data-theme="light" />
    </>
  )
}
