import { createClient } from '@/lib/supabase/server'
import AdminShell from '@/components/admin/AdminShell'
import SupportingBanner from '@/components/admin/SupportingBanner'
import { currentEditor } from '@/lib/auth'
import { getSiteSettings } from '@/lib/site'
import { photoUrl } from '@/lib/images'
import { draftStatus } from '@/lib/drafts/store'
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
// Last, on purpose: the workspace's tokens and shell are a layer OVER the
// sheets above, so the whole visual language is one file to read and one file
// to revert. See the note at the top of it.
import './workspace.css'
import './pages-board.css'


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

  const [{ count }, settings, draft] = await Promise.all([
    supabase
      .from('contact_messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', editor?.tenantId ?? '')
      .eq('is_read', false),
    getSiteSettings(),
    draftStatus(),
  ])

  /*
   * HOW MANY THINGS ARE WAITING TO PUBLISH.
   *
   * Each edited page counts as one, and style and the site's own settings —
   * its pages, its menu, its header and footer — count as one each, because
   * that is how `publishDraft` describes what it did. A page edited twice is
   * still one thing waiting, which is what somebody looking at the badge
   * means by the question.
   *
   * Search-and-sharing is deliberately not counted on its own: it is edited
   * inside a page's panel, so it would double-count the page it belongs to.
   */
  const waiting =
    draft.pages.length + (draft.stylesTouched ? 1 : 0) + (draft.siteTouched ? 1 : 0)

  return (
    <>
      {font}
      <AdminShell
        email={user.email ?? ''}
        unreadCount={count ?? 0}
        platformAdmin={editor?.platformAdmin === true}
        siteName={settings.site_title || 'Your site'}
        siteLogoUrl={settings.logo_header_path ? photoUrl(settings.logo_header_path) : null}
        role={editor?.role ?? null}
        waiting={waiting}
      >
        {children}
      </AdminShell>
      <SupportingBanner />
    </>
  )
}
