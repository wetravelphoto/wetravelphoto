import { currentEditor } from '@/lib/auth'

/**
 * YOU ARE IN SOMEBODY ELSE'S SITE
 * ═══════════════════════════════
 *
 * A platform admin on another photographer's address now edits THAT
 * photographer's site (lib/auth.ts). That is the right behaviour and it is
 * also the dangerous one: every screen looks exactly like your own admin, and
 * the only thing saying otherwise is the address bar, which nobody reads.
 *
 * So this is loud on purpose, and it names the address rather than the site's
 * name — the address is the thing that decided, so the address is the thing to
 * show. No query: the host is already known, and a banner that needs a
 * database read is a banner that can fail to appear.
 *
 * Fixed to the bottom rather than the top: the canvas has its own toolbar up
 * there, and a bar that covers the editor's controls would be removed within a
 * day. Bottom centre is unmissable and in the way of nothing.
 *
 * Renders nothing at all for a photographer on their own site, which is
 * everybody, almost always.
 */
export default async function SupportingBanner() {
  const editor = await currentEditor()
  if (!editor?.supporting) return null

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '1rem',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        maxWidth: 'calc(100vw - 2rem)',
        padding: '0.6rem 0.95rem',
        borderRadius: 999,
        border: '1px solid rgba(163, 50, 36, 0.5)',
        background: '#a33224',
        color: '#fdf6f4',
        boxShadow: '0 6px 24px rgba(26, 23, 21, 0.28)',
        fontFamily: 'var(--admin-font, system-ui, sans-serif)',
        fontSize: '0.8rem',
        lineHeight: 1.35,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#fdf6f4',
          flex: '0 0 auto',
        }}
      />
      <span style={{ minWidth: 0 }}>
        You are editing <strong style={{ fontWeight: 600 }}>{editor.supporting.host}</strong> — not
        your own site. Anything you save lands on theirs.
      </span>
    </div>
  )
}
