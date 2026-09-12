import { getSiteSettings } from '@/lib/site'
import { updateJournalPage } from '@/app/actions/site'
import SaveBar from '@/components/admin/SaveBar'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function JournalPageEditor() {
  const settings = await getSiteSettings()

  return (
    <div style={{ maxWidth: 660 }}>
      <form action={updateJournalPage} autoComplete="off">
        <SaveBar label="Save journal page" title="Journal" />

        <p className="admin-crumb" style={{ marginBottom: '1.25rem' }}>
          <Link href="/admin/pages">← Pages</Link>
        </p>

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Heading</h2>

          <label className="admin-field">
            Eyebrow
            <input
              type="text"
              name="journal_page_eyebrow"
              defaultValue={settings.journal_page_eyebrow ?? ''}
              placeholder="Field notes"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Page title
            <input
              type="text"
              name="journal_page_heading"
              defaultValue={settings.journal_page_heading ?? ''}
              placeholder="Journal"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Story title size — {Math.round((settings.journal_title_scale ?? 1) * 100)}%
            <input
              type="range"
              name="journal_title_scale"
              min="0.7"
              max="1.8"
              step="0.05"
              defaultValue={settings.journal_title_scale ?? 1}
              style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
            />
            <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
              Applies to every story title on the index.
            </span>
          </label>
        </div>

        <div className="admin-panel">
          <h2 className="admin-h2">What each card shows</h2>
          <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
            Applies to every story on the index. Each story&apos;s own excerpt and byline are set when you
            write it.
          </p>

          <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              name="journal_show_excerpt"
              defaultChecked={settings.journal_show_excerpt !== false}
            />
            Excerpt
          </label>

          <p className="admin-meta" style={{ margin: '-0.5rem 0 1rem', lineHeight: 1.55 }}>
            The homepage always shows excerpts — this only governs the journal index.
          </p>

          <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              name="journal_show_date"
              defaultChecked={settings.journal_show_date === true}
            />
            Publication date
          </label>

          <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              name="journal_show_byline"
              defaultChecked={settings.journal_show_byline === true}
            />
            Author or collaborator
          </label>
        </div>
      </form>
    </div>
  )
}
