import Link from 'next/link'
import { loadPageSections } from '@/lib/sections/load'
import SectionList, { type SectionRow } from '@/components/admin/SectionList'
import '@/app/admin/sections.css'

export const dynamic = 'force-dynamic'

export default async function HomeSectionsPage() {
  const { sections, legacy } = await loadPageSections('home')

  const rows: SectionRow[] = sections.map((s) => ({
    id: s.id,
    type: s.type,
    visible: s.visible,
    settings: s.settings,
  }))

  return (
    <div>
      <p className="admin-crumb">
        <Link href="/admin/pages">← Pages</Link>
      </p>

      <div className="page-editor-head">
        <div>
          <h1 className="admin-h1">Homepage</h1>
          <p className="admin-meta" style={{ margin: '0.35rem 0 0' }}>
            Sections appear in this order on the live page. Drag to reorder.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link
            href="/admin/pages/home/details"
            className="admin-btn admin-btn-ghost admin-btn-sm"
          >
            Stories &amp; type
          </Link>
          <Link href="/" target="_blank" className="admin-btn admin-btn-ghost admin-btn-sm">
            View ↗
          </Link>
        </div>
      </div>

      <SectionList
        page="home"
        sections={rows}
        legacy={legacy}
        publicUrl={process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''}
      />
    </div>
  )
}
