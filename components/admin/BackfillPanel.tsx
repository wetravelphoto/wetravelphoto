'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { backfillDerivatives } from '@/app/actions/backfill'
import type { QueueCounts } from '@/lib/jobs/queue'

/**
 * Regenerates display sizes for photographs uploaded before the size ladder
 * existed.
 *
 * ── What changed, and why the button reads differently ──────────────────────
 *
 * This used to hold a `do…while` loop: press "Process all" and the BROWSER
 * drove the whole library, one batch of ten at a time, for as long as the tab
 * stayed open. The loop is gone. Pressing the button queues every remaining
 * photograph as its own job and spends one request working through them; the
 * rest keep their place in the queue whatever happens to this tab, and the
 * nightly run finishes them if nobody comes back.
 *
 * So the second button went too. "Process 10" and "Process all" were two
 * speeds of the same client-side loop, and there is no loop to have two speeds
 * of — there is one queue, and the only question is how much time to spend on
 * it now.
 *
 * The failed count is new, and is the point of the whole exercise: a
 * photograph that cannot be processed used to be indistinguishable from one
 * not yet reached. It now stops after five tries and says so.
 */
export default function BackfillPanel({
  initialRemaining,
  initialQueue,
}: {
  initialRemaining: number
  initialQueue: QueueCounts
}) {
  const [remaining, setRemaining] = useState(initialRemaining)
  const [queue, setQueue] = useState<QueueCounts>(initialQueue)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const router = useRouter()

  async function run() {
    setRunning(true)
    setMessage(null)

    const result = await backfillDerivatives()

    setMessage(result.message)
    setRemaining(result.remaining)
    setQueue(result.queue)
    setRunning(false)
    router.refresh()
  }

  if (remaining === 0 && queue.failed === 0) {
    return (
      <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
        Every photograph has its display sizes. New uploads are processed automatically.
      </p>
    )
  }

  return (
    <div>
      {remaining > 0 && (
        <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
          {remaining} photograph{remaining === 1 ? '' : 's'} uploaded before the size ladder existed.
          Processing them cuts page weight considerably. They stay capped at their stored resolution —
          there is no higher-resolution original to recover.
        </p>
      )}

      {queue.failed > 0 && (
        <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
          {queue.failed} photograph{queue.failed === 1 ? '' : 's'} could not be processed after
          several tries — usually a file that is not readable as an image. The rest are unaffected.
        </p>
      )}

      {remaining > 0 && (
        <button
          type="button"
          disabled={running}
          onClick={run}
          className="admin-btn admin-btn-sm"
        >
          {running ? 'Working…' : 'Process photographs'}
        </button>
      )}

      {message && (
        <p className="admin-meta" style={{ marginTop: '0.6rem', color: 'var(--admin-accent)' }}>
          {message}
        </p>
      )}
    </div>
  )
}
