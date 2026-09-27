'use client'

/**
 * WHICH SIZE THE WHOLE EDITOR IS POINTED AT
 * ═════════════════════════════════════════
 *
 * One control, in two dresses. At the top of the editor it wears its labels,
 * because that is where somebody meets it for the first time and an unlabelled
 * icon is a guess. Inside a section's panel it is icons only, because by then
 * it is a reminder rather than an introduction — and because the panel is
 * 320px wide and three words would crowd out the settings.
 *
 * Both write the same state. The one in the panel exists because the one at
 * the top is easy to miss while you are looking down at a control, and finding
 * out afterwards that you styled the wrong size is the kind of mistake that
 * costs ten minutes and some trust.
 *
 * ── It is not only the preview's width ──────────────────────────────────────
 *
 * Picking a size narrows the preview AND decides what every control below it
 * edits. A switcher that quietly redirected the whole panel would be the most
 * surprising thing in the editor, so the wide one says "Editing desktop" beside
 * itself and the narrow one says it in each button's tooltip.
 */

export type PreviewDevice = 'desktop' | 'tablet' | 'phone'

const ORDER: PreviewDevice[] = ['desktop', 'tablet', 'phone']

const NAME: Record<PreviewDevice, string> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  phone: 'Mobile',
}

/**
 * Outlines rather than filled shapes, at one stroke weight, so the three read
 * as one set. The monitor's stand is what keeps Desktop from being a large
 * Tablet at 19px — the distinction a landscape tablet icon loses.
 */
function Icon({ device }: { device: PreviewDevice }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {device === 'desktop' && (
        <>
          <rect x="2.5" y="3.5" width="19" height="13" rx="1.6" />
          <path d="M9 20.5h6M12 16.5v4" />
        </>
      )}
      {device === 'tablet' && (
        <>
          <rect x="5" y="2" width="14" height="20" rx="2.2" />
          <path d="M11 19h2" />
        </>
      )}
      {device === 'phone' && (
        <>
          <rect x="7" y="2" width="10" height="20" rx="2.2" />
          <path d="M11 19h2" />
        </>
      )}
    </svg>
  )
}

export default function DeviceSwitcher({
  value,
  onChange,
  /** `full` names each size; `compact` is icons only. */
  size = 'full',
}: {
  value: PreviewDevice
  onChange: (next: PreviewDevice) => void
  size?: 'full' | 'compact'
}) {
  return (
    <div className="cv-devices" data-size={size} role="group" aria-label="Size to look at and edit">
      {ORDER.map((device) => (
        <button
          key={device}
          type="button"
          className="cv-device"
          data-on={value === device}
          aria-pressed={value === device}
          onClick={() => onChange(device)}
          title={
            device === 'tablet'
              ? 'Tablet — shown at tablet width, edited with the desktop values'
              : `Edit the ${NAME[device].toLowerCase()} version`
          }
        >
          <Icon device={device} />
          {size === 'full' ? (
            <span className="cv-device-name">{NAME[device]}</span>
          ) : (
            <span className="cv-sr">{NAME[device]}</span>
          )}
        </button>
      ))}
    </div>
  )
}
