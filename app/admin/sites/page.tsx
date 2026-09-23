import { redirect } from 'next/navigation'
import { currentEditor } from '@/lib/auth'
import { createAdminClientOrNull } from '@/lib/supabase/admin'
import { PLATFORM } from '@/lib/platform'
import NewSiteForm from '@/components/admin/NewSiteForm'

/**
 * EVERY SITE ON THE PLATFORM — for the platform admin only.
 *
 * Not a dashboard. A list and a form: which sites exist, what address each
 * answers to, and a way to make another. That is the whole of what inviting
 * three friends needs, and calling it less than it is keeps it from growing
 * into something that has to be maintained.
 *
 * Read with the service-role client on purpose: this is the one screen whose
 * entire job is to see across sites, and row-level security exists to stop
 * exactly that. The gate is `platformAdmin` above it, checked here and again
 * inside the action, because a page is a view and an action is an endpoint.
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: `Sites · ${PLATFORM.name}`,
  robots: { index: false, follow: false },
}

type Row = {
  id: string
  name: string
  created_at: string
  hosts: { host: string; is_primary: boolean }[]
  people: number
}

export default async function SitesPage() {
  const editor = await currentEditor()
  if (!editor) redirect('/admin/login')
  if (!editor.platformAdmin) redirect('/admin')

  const db = createAdminClientOrNull()

  let sites: Row[] = []
  let unavailable = false

  if (!db) {
    unavailable = true
  } else {
    const [{ data: tenants }, { data: domains }, { data: profiles }] = await Promise.all([
      db.from('tenants').select('id, name, created_at').order('created_at', { ascending: true }),
      db.from('tenant_domains').select('tenant_id, host, is_primary'),
      db.from('profiles').select('tenant_id'),
    ])

    sites = (tenants ?? []).map((t) => ({
      id: t.id as string,
      name: (t.name as string) ?? 'Untitled',
      created_at: t.created_at as string,
      hosts: (domains ?? [])
        .filter((d) => d.tenant_id === t.id)
        .map((d) => ({ host: d.host as string, is_primary: d.is_primary === true }))
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
      people: (profiles ?? []).filter((p) => p.tenant_id === t.id).length,
    }))
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 className="admin-h1" style={{ marginBottom: '0.4rem' }}>
        Sites
      </h1>
      <p className="admin-meta" style={{ margin: '0 0 1.5rem', lineHeight: 1.6 }}>
        Every site on {PLATFORM.name}. Only you can see this page.
      </p>

      {unavailable && (
        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <p className="admin-meta" style={{ margin: 0, color: '#9a5b00', lineHeight: 1.6 }}>
            <code>SUPABASE_SERVICE_ROLE_KEY</code> is not set on this deployment, so the list of
            sites cannot be read and a new one cannot be made. Everything else works.
          </p>
        </div>
      )}

      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Make a site</h2>
        <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
          This makes the site, gives it its address, fills it with starter words so it is not a
          blank page, and emails an invitation. <strong>The DNS is separate</strong> — add the
          subdomain in Vercel and a grey-clouded CNAME in Cloudflare, or the address will not
          resolve.
        </p>
        <NewSiteForm platformDomain={PLATFORM.domain} />
      </div>

      <div className="admin-panel">
        <h2 className="admin-h2">
          {sites.length} site{sites.length === 1 ? '' : 's'}
        </h2>

        {sites.length === 0 ? (
          <p className="admin-meta" style={{ margin: 0 }}>
            Nothing here yet.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {sites.map((site) => (
              <li
                key={site.id}
                style={{
                  padding: '0.75rem 0',
                  borderTop: '0.5px solid var(--admin-line)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                <span>
                  <strong style={{ fontWeight: 500 }}>{site.name}</strong>
                  <span className="admin-meta" style={{ display: 'block', marginTop: '0.2rem' }}>
                    {site.hosts.length === 0 ? (
                      <em>no address yet — it will show &ldquo;no site here&rdquo;</em>
                    ) : (
                      site.hosts.map((h, i) => (
                        <span key={h.host}>
                          {i > 0 && ', '}
                          <a
                            href={`https://${h.host}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ borderBottom: '0.5px solid currentColor' }}
                          >
                            {h.host}
                          </a>
                          {h.is_primary && site.hosts.length > 1 ? ' (home)' : ''}
                        </span>
                      ))
                    )}
                  </span>
                </span>
                <span className="admin-meta" style={{ whiteSpace: 'nowrap' }}>
                  {site.people} {site.people === 1 ? 'person' : 'people'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
