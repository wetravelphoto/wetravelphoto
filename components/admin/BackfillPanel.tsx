'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { backfillDerivatives } from '@/app/actions/backfill'

/**
 * Regenerates display sizes for photographs uploaded before the size ladder
 * existed. Runs in small batches so a long library doesn't time out.
 */
export default function BackfillPanel({ initialRemaining }: { initialRemaining: number }) {
  const [remaining, setRemaining] = useState(initialRemaining)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const router = useRouter()

  async function runBatch(continuous: boolean) {
    setRunning(true)
    setMessage(null)

    let left = remaining

    do {
      const result = await backfillDerivatives(10)
      setMessage(result.message)
      left = result.remaining
      setRemaining(left)

      if (!result.ok) break
      if (result.done === 0) break
    } while (continuous && left > 0)

    setRunning(false)
    router.refresh()
  }

  if (initialRemaining === 0 && remaining === 0) {
    return (
      <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
        Every photograph has its display sizes. New uploads are processed automatically.
      </p>
    )
  }

  return (
    <div>
      <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
        {remaining} photograph{remaining === 1 ? '' : 's'} uploaded before the size ladder existed.
        Processing them cuts page weight considerably. They stay capped at their stored resolution —
        there is no higher-resolution original to recover.
      </p>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={running}
          onClick={() => runBatch(false)}
          className="admin-btn admin-btn-sm admin-btn-ghost"
        >
          {running ? 'Working…' : 'Process 10'}
        </button>

        <button
          type="button"
          disabled={running}
          onClick={() => runBatch(true)}
          className="admin-btn admin-btn-sm"
        >
          {running ? 'Working…' : 'Process all'}
        </button>
      </div>

      {message && (
        <p className="admin-meta" style={{ marginTop: '0.6rem', color: 'var(--admin-accent)' }}>
          {message}
        </p>
      )}
    </div>
  )
}
