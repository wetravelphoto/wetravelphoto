import Link from 'next/link'
import type { StartHere as StartHereData } from '@/lib/start-here'

/**
 * The first thing a photographer sees, while there is still something to say.
 *
 * Deliberate choices, each arguable:
 *
 *   · **"Nothing here is permanent"** sits under the heading. The fear on a
 *     blank site is not *what do I click* — it is *what if I do it wrong*.
 *   · **Done steps stay**, struck through, rather than vanishing. A list that
 *     shortens as you work tells you how much is left; a list that fills in
 *     tells you how far you have come, which is the more useful feeling when
 *     you are staring at an empty site.
 *   · **The progress bar counts real steps.** It is not decoration.
 */
export default function StartHere({ data }: { data: StartHereData }) {
  if (!data.show) return null

  const pct = Math.round((data.done / data.total) * 100)

  return (
    <section
      className="admin-panel"
      style={{ padding: 0, borderRadius: 14, overflow: 'hidden', marginBottom: '1.5rem' }}
    >
      <div
        style={{
          padding: '1.15rem 1.35rem 0.95rem',
          borderBottom: '0.5px solid var(--admin-line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '1.25rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <p
            style={{
              margin: '0 0 0.3rem',
              fontSize: '0.62rem',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--admin-mute)',
            }}
          >
            Start here
          </p>
          <h2 className="admin-h2" style={{ margin: '0 0 0.25rem' }}>
            {data.total - data.done} thing{data.total - data.done === 1 ? '' : 's'} and your site is
            yours
          </h2>
          <p className="admin-meta" style={{ margin: 0 }}>
            Nothing here is permanent. Everything can be changed later.
          </p>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div
            className="admin-meta"
            style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
          >
            {data.done} of {data.total} done
          </div>
          <div
            style={{
              height: 3,
              width: 132,
              marginTop: '0.5rem',
              background: 'rgba(26, 23, 21, 0.08)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: 'var(--admin-accent)',
                borderRadius: 2,
              }}
            />
          </div>
        </div>
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: '0.35rem' }}>
        {data.steps.map((step) => (
          <li key={step.id}>
            <Link
              href={step.href}
              className="start-step"
              data-done={step.done ? 'true' : undefined}
            >
              <span className="start-tick" aria-hidden>
                {step.done ? '✓' : ''}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="start-title">{step.title}</span>
                <span className="start-detail">{step.detail}</span>
              </span>
              {!step.done && <span className="start-go">{step.cta} →</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
