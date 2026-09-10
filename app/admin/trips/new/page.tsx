import { createAlbum } from '@/app/actions/albums'
import Link from 'next/link'

export default function NewAlbumPage() {
  return (
    <div style={{ maxWidth: 420 }}>
      <p className="admin-crumb">
        <Link href="/admin">← Albums</Link>
      </p>
      <h1 className="admin-h1" style={{ marginBottom: '1.5rem' }}>
        New album
      </h1>

      <div className="admin-panel">
        <form action={createAlbum}>
          <label className="admin-field">
            Album title
            <input
              type="text"
              name="title"
              placeholder="e.g. Lofoten, Norway"
              required
              className="admin-input"
              autoFocus
            />
          </label>
          <p className="admin-meta" style={{ margin: '0 0 1rem' }}>
            You can set the cover, privacy, and layout after it&apos;s created.
          </p>
          <button type="submit" className="admin-btn">
            Create album
          </button>
        </form>
      </div>
    </div>
  )
}
