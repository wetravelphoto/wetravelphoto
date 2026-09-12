'use client'

/** Desktop / mobile / expand controls shared by the preview panels. */
export default function DeviceSwitch({
  device,
  onDevice,
  onExpand,
}: {
  device: 'desktop' | 'mobile'
  onDevice: (next: 'desktop' | 'mobile') => void
  onExpand?: () => void
}) {
  return (
    <div className="device-switch">
      <button
        type="button"
        onClick={() => onDevice('desktop')}
        data-active={device === 'desktop'}
        title="Desktop"
        aria-label="Desktop preview"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="2.5" y="4" width="19" height="13" rx="1.5" />
          <path d="M9 20.5h6M12 17v3.5" strokeLinecap="round" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => onDevice('mobile')}
        data-active={device === 'mobile'}
        title="Mobile"
        aria-label="Mobile preview"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="7" y="2.5" width="10" height="19" rx="2" />
          <path d="M11 18.5h2" strokeLinecap="round" />
        </svg>
      </button>

      {onExpand && (
        <button type="button" onClick={onExpand} title="Open wide" aria-label="Open wide preview">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15" />
          </svg>
        </button>
      )}
    </div>
  )
}
