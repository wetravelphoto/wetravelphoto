import { PLATFORM } from '@/lib/platform'

/**
 * AN ADDRESS WITH NO SITE BEHIND IT
 * ═════════════════════════════════
 *
 * Shown when the Host header matches no row in `tenant_domains`. It happens
 * for one good reason and one bad one, and both want the same page:
 *
 *  · a photographer has pointed their domain at us before their site exists —
 *    the DNS is faster than the paperwork, and always will be;
 *  · somebody has pointed a domain at us who should not have.
 *
 * The alternative — falling back to whichever site happens to be first in the
 * table — is how a stranger ends up looking at a photographer's homepage on
 * an address that has nothing to do with them.
 *
 * Deliberately self-contained: no settings, no palette, no fonts from the
 * database. There is no site here to take a design from, and asking for one
 * would mean wearing somebody else's.
 */
export default function NoSiteHere({ host }: { host: string | null }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.9rem',
        padding: '2rem 1.5rem',
        textAlign: 'center',
        background: '#faf9f6',
        color: '#14100e',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: '0.68rem',
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: '#8a857e',
        }}
      >
        {PLATFORM.name}
      </p>

      <h1 style={{ margin: 0, fontSize: 'clamp(1.4rem, 4vw, 2rem)', fontWeight: 400 }}>
        There is no site at this address yet
      </h1>

      <p style={{ margin: 0, maxWidth: '42ch', fontSize: '0.95rem', lineHeight: 1.65, color: '#4a4642' }}>
        {host ? (
          <>
            <strong style={{ fontWeight: 500 }}>{host}</strong> points here, but nothing has been
            connected to it. If it is yours, it usually means the address was set up a little ahead
            of the site.
          </>
        ) : (
          <>This address could not be read. Try again in a moment.</>
        )}
      </p>
    </main>
  )
}
