import Link from 'next/link'
import {
  currentLook,
  listLooks,
  liveSections,
  lookHistory,
  manifestForVersion,
} from '@/lib/templates/store'
import { applyManifest, describeApply } from '@/lib/templates/manifest'
import DesignPanel, {
  type HistoryCard,
  type LookCard,
  type UpdateOffer,
} from '@/components/admin/DesignPanel'
import '@/app/admin/design.css'

export const dynamic = 'force-dynamic'

export default async function DesignPage() {
  const [{ looks, missing: looksMissing }, current] = await Promise.all([
    listLooks(),
    currentLook(),
  ])

  const missing = looksMissing || current.missing

  if (missing) {
    return (
      <div>
        <h1 className="admin-h1">Design</h1>
        <p className="admin-meta" style={{ marginTop: '0.6rem', maxWidth: '56ch', lineHeight: 1.7 }}>
          The look tables are not in the database yet. Run{' '}
          <code>db/migrations/2026-09-15_templates.sql</code> in Supabase, then{' '}
          <code>notify pgrst, &apos;reload schema&apos;</code>. Nothing on the live site depends on
          them — this page is the only thing waiting.
        </p>
      </div>
    )
  }

  // What taking the update would actually do, worked out against the real
  // page. Computed here rather than promised in the abstract, and read-only:
  // nothing is written until the button is pressed.
  let update: UpdateOffer | null = null

  if (current.updateAvailable && current.look) {
    const manifest =
      (await manifestForVersion(current.look.id, current.look.version)) ?? current.look.manifest
    const existing = await liveSections('home')

    update = {
      fromVersion: current.version,
      toVersion: current.look.version,
      changes: describeApply(applyManifest(manifest, 'home', existing)),
    }
  }

  const cards: LookCard[] = looks.map((look) => ({
    slug: look.slug,
    name: look.name,
    blurb: look.blurb,
    version: look.version,
    tier: look.tier,
    origin: look.origin,
    isCurrent: look.id === current.look?.id,
  }))

  const history: HistoryCard[] = (await lookHistory()).map((row) => ({
    id: row.id,
    action: row.action,
    name: row.template_name,
    version: row.version,
    createdAt: row.created_at,
    note: row.note,
  }))

  return (
    <div>
      <div className="page-editor-head">
        <div>
          <h1 className="admin-h1">Design</h1>
          <p className="admin-meta" style={{ margin: '0.35rem 0 0' }}>
            {current.look
              ? `Using ${current.look.name}, version ${current.version}.`
              : 'No look chosen yet.'}{' '}
            <Link href="/edit/home" style={{ borderBottom: '0.5px solid currentColor' }}>
              Sections
            </Link>{' '}
            control what is on each page.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href="/edit/home" className="admin-btn admin-btn-sm">
            Open the editor
          </Link>
          <Link href="/edit/home?mode=style" className="admin-btn admin-btn-ghost admin-btn-sm">
            Style
          </Link>
          <Link href="/" target="_blank" className="admin-btn admin-btn-ghost admin-btn-sm">
            View ↗
          </Link>
        </div>
      </div>

      <DesignPanel
        looks={cards}
        current={
          current.look
            ? { name: current.look.name, slug: current.look.slug, version: current.version }
            : null
        }
        update={update}
        history={history}
      />
    </div>
  )
}
