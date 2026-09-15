'use client'

import { useState } from 'react'

export type ShareTarget = {
  /** Who or what this link is for. Empty for an album's single link. */
  label?: string
  url: string
}

/**
 * The link you actually send someone.
 *
 * Worth existing because the answer is different for each privacy setting and
 * none of it was written down anywhere: an unlisted album's link is just its
 * ordinary URL, a client-only album has one link per client rather than one of
 * its own, and a public album's link is the one thing people can already find.
 */
export default function ShareLinkPanel({
  heading,
  blurb,
  targets,
  warning,
}: {
  heading: string
  blurb: string
  targets: ShareTarget[]
  warning?: string
}) {
  return (
    <div className="admin-panel" style={{ marginBottom: '1.5rem', maxWidth: 600 }}>
      <h2 className="admin-h2">{heading}</h2>
      <p className="admin-meta" style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>
        {blurb}
      </p>

      {warning && (
        <p
          style={{
            margin: '0 0 1rem',
            padding: '0.6rem 0.75rem',
            fontSize: '0.8rem',
            lineHeight: 1.55,
            color: 'var(--admin-accent)',
            borderLeft: '2px solid var(--admin-accent)',
            background: 'var(--admin-bg)',
          }}
        >
          {warning}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {targets.map((target) => (
          <LinkRow key={target.url} target={target} />
        ))}
      </div>
    </div>
  )
}

function LinkRow({ target }: { target: ShareTarget }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(target.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // The clipboard API needs a secure context and permission, and refuses
      // often enough that a dead button would be worse than none. Selecting the
      // text lets Ctrl+C finish the job.
      const field = document.getElementById(fieldId(target.url)) as HTMLInputElement | null
      field?.select()
    }
  }

  return (
    <div>
      {target.label && (
        <p className="admin-meta" style={{ margin: '0 0 0.3rem' }}>
          {target.label}
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <input
          id={fieldId(target.url)}
          type="text"
          readOnly
          value={target.url}
          onFocus={(e) => e.currentTarget.select()}
          className="admin-input"
          style={{
            marginTop: 0,
            flex: 1,
            fontSize: '0.78rem',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
        <button
          type="button"
          onClick={copy}
          className="admin-btn admin-btn-sm admin-btn-ghost"
          style={{ whiteSpace: 'nowrap' }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          href={target.url}
          target="_blank"
          rel="noopener"
          className="admin-btn admin-btn-sm admin-btn-ghost"
          // .admin-btn sets no display, so an anchor stays inline and its text
          // rides the top of the stretched flex row while the button beside it
          // is centred. Fixed here rather than in admin.css, which every other
          // button in the admin also reads.
          style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
        >
          Open ↗
        </a>
      </div>
    </div>
  )
}

const fieldId = (url: string) => `share-${url.replace(/[^a-z0-9]/gi, '')}`
