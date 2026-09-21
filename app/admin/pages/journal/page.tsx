import { getSiteSettings } from '@/lib/site'
import { updateJournalPage } from '@/app/actions/site'
import SaveBar from '@/components/admin/SaveBar'
import Toggle from '@/components/admin/Toggle'
import RangeField from '@/components/admin/RangeField'
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

          <RangeField
            name="journal_title_scale"
            label="Story title size"
            defaultValue={settings.journal_title_scale ?? 1}
            min={0.7}
            max={1.8}
            step={0.05}
            unit="percent"
            note="Applies to every story title on the index."
          />
        </div>

        <div className="admin-panel">
          <h2 className="admin-h2">What each card shows</h2>
          <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
            Applies to every story on the index. Each story&apos;s own excerpt and byline are set when you
            write it.
          </p>

          <Toggle
            name="journal_show_excerpt"
            label="Excerpt"
            defaultChecked={settings.journal_show_excerpt !== false}
            note="The homepage always shows excerpts — this governs the journal index only."
          />

          <Toggle
            name="journal_show_date"
            label="Publication date"
            defaultChecked={settings.journal_show_date === true}
          />

          <Toggle
            name="journal_show_byline"
            label="Author or collaborator"
            defaultChecked={settings.journal_show_byline === true}
          />
        </div>
      </form>
    </div>
  )
}
