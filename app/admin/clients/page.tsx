import { createClient } from '@/lib/supabase/server'
import { createContact, deleteContact } from '@/app/actions/clients'
import ConfirmButton from '@/components/admin/ConfirmButton'
import { requireEditor } from '@/lib/auth'

export default async function ClientsPage() {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  const { data: downloads } = await supabase.from('downloads').select('client_id')
  const { data: favorites } = await supabase.from('favorites').select('client_id')

  const downloadCounts = new Map<string, number>()
  downloads?.forEach((d) => {
    if (d.client_id) downloadCounts.set(d.client_id, (downloadCounts.get(d.client_id) ?? 0) + 1)
  })

  const favoriteCounts = new Map<string, number>()
  favorites?.forEach((f) => {
    if (f.client_id) favoriteCounts.set(f.client_id, (favoriteCounts.get(f.client_id) ?? 0) + 1)
  })

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 className="admin-h1" style={{ marginBottom: '1.5rem' }}>
        Clients
      </h1>

      <div className="admin-panel" style={{ marginBottom: '1.5rem' }}>
        <h2 className="admin-h2">Add a contact</h2>
        <form action={createContact} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            name="name"
            placeholder="Name"
            required
            className="admin-input"
            style={{ marginTop: 0, flex: '1 1 160px' }}
          />
          <input
            type="email"
            name="email"
            placeholder="Email"
            required
            className="admin-input"
            style={{ marginTop: 0, flex: '1 1 200px' }}
          />
          <button type="submit" className="admin-btn">
            Add
          </button>
        </form>
      </div>

      {clients && clients.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {clients.map((client) => (
            <div key={client.id} className="admin-panel">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: 1, minWidth: 160 }}>
                  <p style={{ margin: '0 0 0.2rem', fontSize: '0.95rem' }}>{client.name}</p>
                  <p className="admin-meta" style={{ margin: 0 }}>
                    {client.email}
                  </p>
                </div>

                <div className="admin-meta" style={{ textAlign: 'right' }}>
                  <div>{downloadCounts.get(client.id) ?? 0} downloads</div>
                  <div>{favoriteCounts.get(client.id) ?? 0} favorites</div>
                </div>

                <form action={deleteContact.bind(null, client.id)}>
                  <ConfirmButton label="Delete" confirmLabel="Confirm" />
                </form>
              </div>

              <div
                style={{
                  marginTop: '0.85rem',
                  paddingTop: '0.75rem',
                  borderTop: '0.5px solid var(--admin-line)',
                }}
              >
                <p className="admin-meta" style={{ margin: '0 0 0.3rem' }}>
                  Private gallery link
                </p>
                <code
                  style={{
                    display: 'block',
                    background: 'var(--admin-bg)',
                    padding: '0.45rem 0.6rem',
                    fontSize: '0.75rem',
                    wordBreak: 'break-all',
                    border: '0.5px solid var(--admin-line)',
                  }}
                >
                  /gallery/{client.access_token}
                </code>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="admin-empty">
          No contacts yet. Add one above, then share an album with them from that album&apos;s settings.
        </div>
      )}
    </div>
  )
}
