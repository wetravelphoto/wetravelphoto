import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import './admin.css'
import './settings-extra.css'
import './admin-extra.css'
import './gallery.css'
import './home-editor.css'
import './home-preview.css'
import './hero-title.css'
import './home-preview-ig.css'
import './save-bar.css'
import '../hero.css'
import './branding.css'
import './uploader.css'
import '../journal/block-editor-fix.css'
import './admin-ui.css'
import './hero-picker.css'
import './chrome-device.css'
import './shop.css'
import './catalog.css'
import '../frame.css'
import './scenes.css'


export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return <>{children}</>

  const { count } = await supabase
    .from('contact_messages')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false)

  return (
    <div className="admin-shell">
      <AdminSidebar email={user.email ?? ''} unreadCount={count ?? 0} />
      <main className="admin-main">{children}</main>
    </div>
  )
}
