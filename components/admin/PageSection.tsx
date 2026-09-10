'use client'

import { useState } from 'react'

/** Collapsible section so a page reads as a page, not one long form. */
export default function PageSection({
  index,
  title,
  summary,
  children,
  defaultOpen = true,
}: {
  index: number
  title: string
  summary?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="page-section" data-open={open}>
      <button type="button" className="page-section-head" onClick={() => setOpen((o) => !o)}>
        <span className="page-section-index">{String(index).padStart(2, '0')}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="page-section-title">{title}</span>
          {summary && <span className="page-section-summary">{summary}</span>}
        </span>
        <span className="page-section-chevron">{open ? '−' : '+'}</span>
      </button>

      {/* Kept mounted so collapsed fields still submit with the form */}
      <div className="page-section-body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}
