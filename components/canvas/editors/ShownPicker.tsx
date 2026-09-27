'use client'

import { DEVICES, DEVICE_LABEL, type Device } from '@/lib/sections/devices'
import { sizesFor, type Shown } from '@/lib/sections/shown'

/**
 * WHICH SIZES THIS PIECE OF TEXT APPEARS ON
 * ═════════════════════════════════════════
 *
 * One row per size: its icon, its name, and a switch.
 *
 * ── Why switches and not three named answers ────────────────────────────────
 *
 * It was "Everywhere / Desktop only / Phone only", which is the same
 * information and the wrong shape. The question is per size — is it on here? —
 * and three sentences make you translate your answer into whichever of them
 * matches. With a switch each you just say it, and with a third size later the
 * list grows by a row rather than the sentences multiplying.
 *
 * ── There is no "nowhere" ───────────────────────────────────────────────────
 *
 * Turning off the last size is refused: the switch simply will not go. Text
 * that should never appear is text that should be deleted, and an editor that
 * lets you hide something everywhere hands you a site with invisible content
 * in it and no way to notice.
 *
 * ── Not governed by the switcher at the top ─────────────────────────────────
 *
 * Every other control in the panel edits the size the editor is pointed at.
 * This one is ABOUT the sizes, so it shows all of them at once — which is also
 * why it is the one tab of Customize that carries no size badge.
 */

function DeviceIcon({ device }: { device: Device }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {device === 'desktop' ? (
        <>
          <rect x="2.5" y="3.5" width="19" height="13" rx="1.6" />
          <path d="M9 20.5h6M12 16.5v4" />
        </>
      ) : (
        <>
          <rect x="7" y="2" width="10" height="20" rx="2.2" />
          <path d="M11 19h2" />
        </>
      )}
    </svg>
  )
}

export default function ShownPicker({
  value,
  label,
  onChange,
}: {
  value: Shown
  /** Only for the screen reader: the field above already says it on screen. */
  label: string
  onChange: (next: Shown) => void
}) {
  const on = sizesFor(value)
  const isOn = (device: Device) => on.includes(device)

  /** The answer that means "these sizes", in the three words it is stored as. */
  const toggle = (device: Device) => {
    const next = isOn(device) ? on.filter((d) => d !== device) : [...on, device]
    // The last one cannot be turned off. Nothing happens rather than something
    // wrong happening.
    if (next.length === 0) return
    onChange(next.length === DEVICES.length ? 'all' : (next[0] as Shown))
  }

  return (
    <div className="shown-pop" role="group" aria-label={`Where ${label} appears`}>
      {DEVICES.map((device) => {
        const active = isOn(device)
        const last = active && on.length === 1
        return (
          <button
            key={device}
            type="button"
            className="shown-row"
            role="switch"
            aria-checked={active}
            aria-label={`Show on ${DEVICE_LABEL[device].toLowerCase()}`}
            disabled={last}
            title={last ? 'It has to appear somewhere' : undefined}
            onClick={() => toggle(device)}
          >
            <DeviceIcon device={device} />
            <span className="shown-row-name">{DEVICE_LABEL[device]}</span>
            <span className="shown-switch" data-on={active || undefined} aria-hidden>
              <span className="shown-knob" />
            </span>
          </button>
        )
      })}
      <p className="shown-note">
        Off means taken out of the page, not made invisible — nothing reads it
        out and nothing finds it in a search.
      </p>
    </div>
  )
}
