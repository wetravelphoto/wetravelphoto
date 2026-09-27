'use client'

import { useEffect, useRef, useState } from 'react'
import { BASE_DEVICE, type Device } from '@/lib/sections/devices'

/**
 * ONE BUTTON UNDER EACH PIECE OF TEXT
 * ═══════════════════════════════════
 *
 * Typography, Position and Visibility used to be three rows. Three rows under
 * every text box means a panel with six boxes in it carries eighteen controls
 * before a word is written, and the rows are all the same shape, so the eye
 * has to read each one to find the one it wants.
 *
 * They are one button now, and the three become tabs behind it. The cost is a
 * click; what it buys is a panel you can see the shape of.
 *
 * ── Tabs, not a menu ────────────────────────────────────────────────────────
 *
 * A menu hides which sections exist until it is open and gives no sense of
 * where you are once you are in one. Three fixed tabs, always all visible,
 * answer both — and the one you are on is the one you left, because switching
 * back and forth between a size and its typography is the actual work.
 *
 * ── It says which size it is editing ────────────────────────────────────────
 *
 * Everything in here except Visibility applies to the size the editor is
 * pointed at, which is the switcher at the top and also the preview's width.
 * A panel full of numbers with nothing saying which size they belong to is how
 * somebody spends ten minutes styling the wrong one.
 */

export type Tab = 'type' | 'place' | 'shown'

const TABS: { id: Tab; label: string }[] = [
  { id: 'type', label: 'Typography' },
  { id: 'place', label: 'Position' },
  { id: 'shown', label: 'Visibility' },
]

function TabIcon({ id }: { id: Tab }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* A serif A: type, without a letter that changes with the typeface. */}
      {id === 'type' && <path d="M4 20 12 4l8 16M7.5 14h9" />}
      {/* A frame with a mark in one corner: where something sits. */}
      {id === 'place' && (
        <>
          <rect x="3" y="4.5" width="18" height="15" rx="1.6" />
          <circle cx="8" cy="15" r="1.9" fill="currentColor" stroke="none" />
        </>
      )}
      {/* Half filled: on here, off there. */}
      {id === 'shown' && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  )
}

/**
 * The trigger, plus whichever tab is open.
 *
 * Each tab's contents are passed in rather than built here: this owns the
 * shape of the thing, and the three panels are each somebody else's job.
 */
export default function Customize({
  label,
  device,
  deviceName,
  /** What is set, in a few words, for the closed button to show. */
  summary,
  /** True when nothing has been changed — the button draws quieter. */
  quiet,
  /** Absent for text that has nowhere to be placed; its tab is then not drawn. */
  place,
  type,
  shown,
}: {
  label: string
  device: Device
  deviceName: string
  summary: string
  quiet: boolean
  place?: React.ReactNode
  type: React.ReactNode
  shown: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('type')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const tabs = TABS.filter((t) => t.id !== 'place' || place !== undefined)
  // A tab that is not drawn must not be the one showing, which happens when a
  // button loses its link and its Position tab with it while it is open.
  const current = tabs.some((t) => t.id === tab) ? tab : 'type'

  return (
    // Kept off the settings form's own change handler: without this, dragging
    // a slider in here would queue a save of every other field in the panel on
    // every frame of the drag.
    <div className="ed-row-wrap" ref={box} onChange={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="ed-row"
        aria-expanded={open}
        aria-label={`Customize ${label}: ${summary}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ed-row-icon" aria-hidden>
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="17" r="2" />
          </svg>
        </span>
        <span className="ed-row-name">Customize</span>
        <span className="ed-row-value" data-quiet={quiet || undefined}>
          {summary}
        </span>
        <span className="ed-row-caret" aria-hidden>
          ›
        </span>
      </button>

      {open && (
        <div className="ed-row-pop">
          <div className="cz-pop">
            <div className="cz-head">
              <p className="cz-title">
                {label}
                {device !== BASE_DEVICE && <span className="cz-device">{deviceName}</span>}
              </p>
            </div>

            <div className="cz-tabs" role="tablist" aria-label={`Customize ${label}`}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  className="cz-tab"
                  data-on={current === t.id}
                  aria-selected={current === t.id}
                  onClick={() => setTab(t.id)}
                >
                  <TabIcon id={t.id} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            <div className="cz-body" role="tabpanel">
              {current === 'type' && type}
              {current === 'place' && place}
              {current === 'shown' && shown}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
