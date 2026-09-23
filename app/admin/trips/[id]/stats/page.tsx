import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { requireEditor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function AlbumStatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { data: album } = await supabase
    .from('albums')
    .select('title')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .single()

  const since = new Date()
  since.setDate(since.getDate() - 29)

  const { data: views } = await supabase
    .from('page_views')
    .select('visitor_hash, viewed_at')
    .eq('album_id', id)
    .gte('viewed_at', since.toISOString())

  const { data: photos } = await supabase
    .from('photos')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('album_id', id)
  const photoIds = photos?.map((p) => p.id) ?? []

  const { data: downloads } = photoIds.length
    ? await supabase.from('downloads').select('photo_id, downloaded_at').in('photo_id', photoIds)
    : { data: [] }

  const { data: favorites } = await supabase.from('favorites').select('photo_id').eq('album_id', id)

  // Bucket views by day
  const byDay = new Map<string, { views: number; visitors: Set<string> }>()
  for (let i = 0; i < 30; i++) {
    const d = new Date(since)
    d.setDate(since.getDate() + i)
    byDay.set(d.toISOString().slice(0, 10), { views: 0, visitors: new Set() })
  }

  views?.forEach((v) => {
    const key = v.viewed_at.slice(0, 10)
    const bucket = byDay.get(key)
    if (bucket) {
      bucket.views += 1
      bucket.visitors.add(v.visitor_hash)
    }
  })

  const days = Array.from(byDay.entries())
  const maxViews = Math.max(1, ...days.map(([, d]) => d.views))
  const totalViews = views?.length ?? 0
  const uniqueVisitors = new Set(views?.map((v) => v.visitor_hash)).size

  return (
    <div style={{ maxWidth: 780 }}>
      <p className="admin-crumb">
        <Link href="/admin">Albums</Link> / <Link href={`/admin/trips/${id}`}>{album?.title}</Link> / Stats
      </p>
      <h1 className="admin-h1" style={{ marginBottom: '1.5rem' }}>
        Album stats
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <Stat label="Views (30 days)" value={totalViews} />
        <Stat label="Unique visitors" value={uniqueVisitors} />
        <Stat label="Downloads" value={downloads?.length ?? 0} />
        <Stat label="Favorites" value={favorites?.length ?? 0} />
      </div>

      <div className="admin-panel">
        <h2 className="admin-h2">Views — last 30 days</h2>

        {totalViews === 0 ? (
          <p className="admin-meta" style={{ margin: 0 }}>
            No views recorded yet. Views start counting once someone opens the public album page.
          </p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 140, marginTop: '1rem' }}>
            {days.map(([day, data]) => (
              <div
                key={day}
                title={`${day} — ${data.views} view${data.views === 1 ? '' : 's'}, ${data.visitors.size} visitor${data.visitors.size === 1 ? '' : 's'}`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
              >
                <div
                  style={{
                    height: `${(data.views / maxViews) * 100}%`,
                    minHeight: data.views > 0 ? 2 : 0,
                    background: 'var(--admin-accent)',
                    opacity: data.views > 0 ? 1 : 0,
                  }}
                />
                <div style={{ height: 1, background: 'var(--admin-line)' }} />
              </div>
            ))}
          </div>
        )}

        {totalViews > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
            <span className="admin-meta">{days[0][0]}</span>
            <span className="admin-meta">{days[days.length - 1][0]}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-panel" style={{ padding: '1rem' }}>
      <p
        style={{
          fontFamily: 'var(--font-display), sans-serif',
          fontSize: '1.8rem',
          margin: 0,
          lineHeight: 1,
          color: 'var(--admin-ink)',
        }}
      >
        {value}
      </p>
      <p className="admin-meta" style={{ margin: '0.35rem 0 0' }}>
        {label}
      </p>
    </div>
  )
}
