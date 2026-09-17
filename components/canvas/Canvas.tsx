'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { sectionDef, type SectionSettings } from '@/lib/sections/registry'
import {
  addDraftSection,
  discard,
  publish,
  removeDraftSection,
  reorderDraft,
  setDraftVisible,
} from '@/app/actions/canvas'
import SectionRail from '@/components/canvas/SectionRail'
import Inspector from '@/components/canvas/Inspector'
import AddSectionModal from '@/components/canvas/AddSectionModal'

export type CanvasSection = {
  id: string
  type: string
  label: string
  blurb: string
  permanent: boolean
  visible: boolean
  settings: SectionSettings
}

type Device = 'desktop' | 'tablet' | 'phone'

const WIDTHS: Record<Device, number | null> = { desktop: null, tablet: 820, phone: 390 }

/**
 * The shell. Holds the selection, owns the iframe, and is the only thing that
 * talks to the preview.
 *
 * THE REFRESH LOOP. Every edit follows the same path: call the action, then
 * tell the iframe to re-render, then refresh this component's own data. The
 * iframe re-runs the real server components rather than being patched from
 * here, so what appears on screen is what the renderer actually produces from
 * what is actually in the draft. A few hundred milliseconds slower than
 * optimistic patching, and it cannot lie.
 */
export default function Canvas({
  page,
  title,
  sections,
  legacy,
  missing,
  hasDraft,
  draftUpdatedAt,
  publicUrl,
}: {
  page: string
  title: string
  sections: CanvasSection[]
  legacy: boolean
  missing: boolean
  hasDraft: boolean
  draftUpdatedAt: string | null
  publicUrl: string
}) {
  const router = useRouter()
  const frame = useRef<HTMLIFrameElement>(null)
  const [pending, startTransition] = useTransition()

  const [selected, setSelected] = useState<string | null>(null)
  const [device, setDevice] = useState<Device>('desktop')
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  /**
   * A drag should move the row under the cursor now, not after a round trip —
   * but mirroring the whole `sections` array into state would duplicate every
   * section's SETTINGS as well, and then the inspector could be editing a copy
   * the server had already moved on from. So only the ORDER is held locally,
   * as a list of ids, and everything else is read straight from the server on
   * every render. The override is dropped as soon as an action completes.
   */
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)

  const order = dragOrder
    ? (dragOrder
        .map((id) => sections.find((s) => s.id === id))
        .filter((s): s is CanvasSection => s !== undefined))
    : sections

  const tell = useCallback((message: { type: string; id?: string }) => {
    frame.current?.contentWindow?.postMessage(
      { source: 'wtp-canvas', ...message },
      window.location.origin
    )
  }, [])

  /** Run an action, then re-render the preview and this rail. */
  const run = useCallback(
    (work: () => Promise<unknown>, after?: () => void) => {
      setError(null)
      startTransition(async () => {
        try {
          await work()
          setDragOrder(null)
          tell({ type: 'refresh' })
          router.refresh()
          after?.()
        } catch (e) {
          setDragOrder(null)
          setError(e instanceof Error ? e.message : 'Something went wrong.')
        }
      })
    },
    [router, tell]
  )

  // Clicks inside the preview.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { source?: string; type?: string; id?: string } | null
      if (!data || data.source !== 'wtp-preview') return

      if (data.type === 'select' && data.id) setSelected(data.id)
      if (data.type === 'clear') setSelected(null)
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Selecting in the rail scrolls the preview to it.
  const choose = (id: string | null) => {
    setSelected(id)
    tell({ type: 'select', id: id ?? undefined })
  }

  const current = order.find((s) => s.id === selected) ?? null
  const def = current ? sectionDef(current.type) : null

  const reorder = (next: CanvasSection[]) => {
    const ids = next.map((s) => s.id)
    setDragOrder(ids)
    run(() => reorderDraft(page, ids))
  }

  if (missing) {
    return (
      <div className="cv-missing">
        <h1>The editor needs one more migration</h1>
        <p>
          Run <code>db/migrations/2026-09-16_site_draft.sql</code> in Supabase, then{' '}
          <code>notify pgrst, &apos;reload schema&apos;</code>. Nothing on the live site depends on
          it — this screen is the only thing waiting.
        </p>
        <Link href="/admin/design" className="cv-btn">
          ← Back to Design
        </Link>
      </div>
    )
  }

  return (
    <div className="cv-shell" data-busy={pending}>
      <header className="cv-top">
        <div className="cv-top-left">
          <Link href="/admin/design" className="cv-back" aria-label="Back to admin">
            ←
          </Link>
          <span className="cv-title">{title}</span>
          {hasDraft && (
            <span className="cv-flag" title={draftUpdatedAt ?? undefined}>
              Unpublished changes
            </span>
          )}
          {legacy && !hasDraft && (
            <span className="cv-flag cv-flag-quiet">Not yet edited here</span>
          )}
        </div>

        <div className="cv-devices" role="group" aria-label="Preview width">
          {(['desktop', 'tablet', 'phone'] as Device[]).map((d) => (
            <button
              key={d}
              type="button"
              className="cv-device"
              data-on={device === d}
              onClick={() => setDevice(d)}
              aria-pressed={device === d}
            >
              {d === 'desktop' ? '🖥' : d === 'tablet' ? '▭' : '▯'}
              <span className="cv-sr">{d}</span>
            </button>
          ))}
        </div>

        <div className="cv-top-right">
          <a href={`/preview/${page}`} target="_blank" rel="noreferrer" className="cv-btn cv-btn-ghost">
            Open preview ↗
          </a>
          <button
            type="button"
            className="cv-btn cv-btn-ghost"
            disabled={!hasDraft || pending}
            onClick={() => {
              if (confirm('Throw away every unpublished change and go back to the live page?')) {
                run(() => discard(), () => {
                  setSelected(null)
                  setNote('Draft discarded. This is the live page again.')
                })
              }
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="cv-btn cv-btn-go"
            disabled={!hasDraft || pending}
            onClick={() =>
              run(
                () => publish(),
                () => setNote('Published. The live site now matches this.')
              )
            }
          >
            Publish
          </button>
        </div>
      </header>

      {(error || note) && (
        <div className={error ? 'cv-bar cv-bar-bad' : 'cv-bar'} role="status">
          {error ?? note}
          <button type="button" className="cv-bar-x" onClick={() => { setError(null); setNote(null) }}>
            ×
          </button>
        </div>
      )}

      <div className="cv-body">
        <SectionRail
          sections={order}
          selected={selected}
          onSelect={choose}
          onReorder={reorder}
          onToggle={(id, visible) => run(() => setDraftVisible(page, id, visible))}
          onRemove={(id, label) => {
            if (confirm(`Remove the ${label} section from this page?`)) {
              run(() => removeDraftSection(page, id), () => setSelected(null))
            }
          }}
          onAdd={() => setPicking(true)}
        />

        <main className="cv-stage">
          <div className="cv-frame-wrap" data-device={device}>
            <iframe
              ref={frame}
              className="cv-frame"
              src={`/preview/${page}`}
              title={`${title} preview`}
              style={WIDTHS[device] ? { width: WIDTHS[device]! } : undefined}
            />
          </div>
        </main>

        <Inspector
          page={page}
          section={current}
          def={def}
          publicUrl={publicUrl}
          onSaved={() => {
            tell({ type: 'refresh' })
            router.refresh()
          }}
          onClose={() => choose(null)}
        />
      </div>

      {picking && (
        <AddSectionModal
          used={new Set(order.map((s) => s.type))}
          onClose={() => setPicking(false)}
          onPick={(type) => {
            setPicking(false)
            run(async () => {
              const id = await addDraftSection(page, type, selected ?? undefined)
              setSelected(id)
            })
          }}
        />
      )}
    </div>
  )
}
