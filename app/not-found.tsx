import Link from 'next/link'

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <p className="eyebrow" style={{ margin: '0 0 1rem' }}>
        Error 404
      </p>
      <h1 className="display" style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)', margin: '0 0 1rem', lineHeight: 1 }}>
        Off the map
      </h1>
      <p style={{ color: 'var(--ink-soft)', maxWidth: '38ch', lineHeight: 1.7, margin: '0 0 2rem' }}>
        This page doesn&apos;t exist, or the album you&apos;re looking for is private.
      </p>
      <Link href="/" className="underline-link" style={{ fontSize: '0.85rem', letterSpacing: '0.06em' }}>
        Back to all trips
      </Link>
    </main>
  )
}
