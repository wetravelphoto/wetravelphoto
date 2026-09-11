/** Small line icons used in the contact row and footer. */

const paths: Record<string, React.ReactNode> = {
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="3.8" />
      <circle cx="16.8" cy="7.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  facebook: (
    <path d="M13.6 21v-7.6h2.5l.4-2.9h-2.9V8.6c0-.85.24-1.43 1.45-1.43H16.6V4.6a20 20 0 0 0-2.26-.12c-2.24 0-3.77 1.37-3.77 3.88v2.16H8v2.9h2.57V21" />
  ),
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10.2 9.4v5.2l4.6-2.6z" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6.2 8.5-6.2" />
    </>
  ),
  link: (
    <>
      <path d="M9 13a4 4 0 0 0 5.66 0l3-3A4 4 0 0 0 12 4.34l-1.5 1.5" />
      <path d="M15 11a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 12 19.66l1.5-1.5" />
    </>
  ),
  x: (
    <>
      <path d="M4.5 4.5 19 19.5" />
      <path d="M19.5 4.5 4.5 19.5" opacity="0.35" />
    </>
  ),
  pinterest: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10.4 19c-.4-1.5.1-3.3.5-4.7.2-.9.7-2.6.7-2.6s-.3-.6-.3-1.4c0-1.3.8-2.3 1.7-2.3.8 0 1.2.6 1.2 1.4 0 .8-.5 2.1-.8 3.3-.2.9.5 1.7 1.4 1.7 1.7 0 2.9-2.2 2.9-4.7 0-2-1.3-3.4-3.7-3.4-2.7 0-4.4 2-4.4 4.2 0 .8.2 1.3.6 1.8" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6.5-6.1 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 14.9 12 21 12 21Z" />
      <circle cx="12" cy="10.5" r="2.4" />
    </>
  ),
}

export default function Icon({ name, size = 17 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.15"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
