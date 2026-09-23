import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { currentEditor } from '@/lib/auth'
import { UI_FONT_HREF } from '@/lib/fonts'
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

  // The admin's own typeface, loaded only here (see admin.css). The sign-in
  // page has no shell, so it is loaded for that too.
  const font = <link rel="stylesheet" href={UI_FONT_HREF} precedence="default" />

  if (!user)
    return (
      <>
        {font}
        {children}
      </>
    )

  // Whether to show the cross-site group. Read here rather than in the
  // sidebar, which is a client component and has no business asking.
  const editor = await currentEditor()

  const { count } = await supabase
    .from('contact_messages')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false)

  return (
    <div className="admin-shell">
      {font}
      <AdminSidebar
        email={user.email ?? ''}
        unreadCount={count ?? 0}
        platformAdmin={editor?.platformAdmin === true}
      />
      <main className="admin-main">{children}</main>
    </div>
  )
}
