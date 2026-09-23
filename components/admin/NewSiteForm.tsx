'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createSite } from '@/app/actions/sites'

/**
 * The form that makes a site. One name, one address, one email.
 *
 * The address is shown as it will be read — `name.lensgrid.co` — rather than
 * as a field called "subdomain", because the person filling this in is
 * thinking about where their friend's site will live, not about DNS.
 */
export default function NewSiteForm({ platformDomain }: { platformDomain: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [label, setLabel] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const suggest = (name: string) =>
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)

  return (
    <form
      action={(formData) => {
        setResult(null)
        startTransition(async () => {
          const r = await createSite(formData)
          if (r.ok) {
            setResult({
              ok: true,
              text: `${r.host} is ready, and the invitation is on its way. Add the DNS record next — see claude/cloudflare-move.md.`,
            })
            setLabel('')
            router.refresh()
          } else {
            setResult({ ok: false, text: r.message })
          }
        })
      }}
      autoComplete="off"
    >
      <label className="admin-field">
        Whose site is it?
        <input
          type="text"
          name="name"
          required
          maxLength={80}
          placeholder="Ana Ruiz Photography"
          className="admin-input"
          onChange={(e) => {
            // Only while the address is untouched, so a typed one is never
            // overwritten by a later edit to the name.
            if (!label || label === suggest(label)) setLabel(suggest(e.target.value))
          }}
        />
        <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
          What the site is called. They can change it the moment they sign in.
        </span>
      </label>

      <label className="admin-field">
        Where does it live?
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="text"
            name="label"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value.toLowerCase())}
            pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
            maxLength={32}
            placeholder="ana"
            className="admin-input"
            style={{ maxWidth: 220 }}
          />
          <span className="admin-meta" style={{ whiteSpace: 'nowrap' }}>.{platformDomain}</span>
        </span>
        <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
          This becomes their address, and it is awkward to change once anyone has it.
        </span>
      </label>

      <label className="admin-field">
        Who gets the invitation?
        <input
          type="email"
          name="email"
          required
          placeholder="ana@example.com"
          className="admin-input"
        />
        <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
          They set their own password from the email. Nobody here ever sees it.
        </span>
      </label>

      <button type="submit" className="admin-btn" disabled={pending}>
        {pending ? 'Making the site…' : 'Make the site and invite them'}
      </button>

      {result && (
        <p
          className="admin-meta"
          style={{ margin: '0.8rem 0 0', lineHeight: 1.6, color: result.ok ? undefined : '#b3261e' }}
        >
          {result.text}
        </p>
      )}
    </form>
  )
}
