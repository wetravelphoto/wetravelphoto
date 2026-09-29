import { createRoot } from 'react-dom/client'
import AdminShell from '@/components/admin/AdminShell'
import PagesBoard from '@/components/admin/PagesBoard'
import Overview from '@/components/admin/Overview'
import SettingsNav from '@/components/admin/SettingsNav'
import SettingsRail from '@/components/admin/SettingsRail'
import { SETTINGS_SECTIONS } from '@/lib/admin/settings-sections'
import { pageIcon, type AdminPage } from '@/lib/admin/page-status'

/**
 * The real workspace, drawn from the real components, so it can be looked at.
 *
 * The page data below stands in for a site's own — the components take it as
 * props, so what is measured here is the interface, not the data. The
 * miniatures inside the cards are served by the browser suite, which
 * intercepts the preview route.
 */
const make = (
  key: string,
  label: string,
  path: string | null,
  state: AdminPage['state'],
  builtin = true
): AdminPage => ({
  key,
  label,
  path,
  editHref: `/edit/${key}`,
  builtin,
  state,
  icon: pageIcon(key),
  home: key === 'home',
})

const PAGES: AdminPage[] = [
  make('home', 'Homepage', '/', 'changes'),
  make('about', 'About', '/about', 'live'),
  make('galleries', 'Galleries', '/trips', 'live'),
  make('journal', 'Journal', '/journal', 'changes'),
  make('contact', 'Contact', '/contact', 'live'),
  make('shop', 'Shop', '/shop', 'hidden'),
  make('notfound', 'Not found (404)', null, 'live'),
]

const SCREEN = new URLSearchParams(location.search).get('screen') ?? 'pages'

const OVERVIEW = (
  <Overview
    firstName="Gon"
    siteName="Gon Mata Photo"
    host="gon.lensgrid.co"
    hasDraft
    audience={{ days: 30, visitors: 3, views: 3, inquiries: 0, subscribers: 0, subscribersAllTime: false }}
    steps={[
      { id: 'look', title: 'Personalize your design', detail: 'Make it feel like your own.', href: '/edit/home', cta: 'Open the editor', done: true },
      { id: 'gallery', title: 'Add your first gallery', detail: 'Upload a collection of your own work.', href: '/admin/trips/new', cta: 'Galleries', done: false },
      { id: 'samples', title: 'Replace sample photographs', detail: 'Give every page your own perspective.', href: '/admin/trips', cta: 'Galleries', done: false },
    ]}
    stepsDone={1}
    showSteps
    recent={[
      { id: 'a', title: 'Sample gallery', kind: 'gallery', href: '/admin/trips/a', note: 'Gallery · 6 photos', thumbUrl: '/thumb/a.jpg', state: 'live', stateLabel: 'Public', sample: true, updatedAt: null },
      { id: 'b', title: 'A sample story', kind: 'story', href: '/admin/journal/b', note: 'Journal', thumbUrl: '/thumb/b.jpg', state: 'live', stateLabel: 'Published', sample: false, updatedAt: null },
    ]}
    unread={0}
    essentials={[
      { id: 'published', label: 'Website published', detail: 'Your site is live at gon.lensgrid.co.', done: true, href: '/admin/pages', cta: 'Publish' },
      { id: 'domain', label: 'Custom domain', detail: 'Connect your own domain.', done: false, href: '/admin/settings', cta: 'Connect' },
      { id: 'instagram', label: 'Instagram feed', detail: 'Show your latest photos on your site.', done: false, href: '/admin/settings', cta: 'Connect' },
    ]}
  />
)

/**
 * SETTINGS.
 *
 * The middle column is server-rendered in the real screen, so what stands in
 * for it here is a panel carrying the real class names — everything measured on
 * this screen is the three-column arrangement, the section list and the preview
 * rail, which are the parts that are not server-rendered.
 */
const SECTION = SETTINGS_SECTIONS.find((s) => s.id === (new URLSearchParams(location.search).get('s') ?? 'general'))!

const SETTINGS = (
  <div className="st">
    <header className="pb-head st-head">
      <div className="pb-head-words">
        <h1 className="pb-title">Settings</h1>
        <p className="pb-sub">Your site&rsquo;s name, its contacts, and what it is connected to.</p>
      </div>
    </header>

    <div className="st-grid">
      <SettingsNav active={SECTION.id} />

      <div className="st-body">
        <div className="st-body-head">
          <h2 className="st-h2">{SECTION.label}</h2>
          <p className="st-body-note">{SECTION.blurb}</p>
        </div>

        <div className="admin-panel st-panel">
          <h3 className="admin-h2">Naming</h3>
          <label className="admin-field">
            Site name
            <input type="text" defaultValue="Gon Mata Photo" className="admin-input" />
            <span className="admin-meta st-hint">Used in page titles, link previews and image alt text.</span>
          </label>
          <label className="admin-field">
            Owner name
            <input type="text" defaultValue="Gonzalo Mata" className="admin-input" />
          </label>
        </div>

        <div className="admin-panel st-panel">
          <h3 className="admin-h2">Site icon</h3>
          <p className="admin-meta st-note">The small picture on the browser tab.</p>
        </div>
      </div>

      <SettingsRail siteName="Gon Mata Photo" host="gon.lensgrid.co" faviconUrl="/thumb/fav.png" />
    </div>
  </div>
)

createRoot(document.getElementById('root')!).render(
  <AdminShell
    email="gon@wetravelphoto.com"
    unreadCount={3}
    platformAdmin={false}
    siteName="Gon Mata Photo"
    siteLogoUrl={null}
    role="owner"
    waiting={2}
  >
    {SCREEN === 'settings' ? (
      SETTINGS
    ) : SCREEN === 'overview' ? (
      OVERVIEW
    ) : (
      <PagesBoard
        pages={PAGES}
        host="gon.lensgrid.co"
        lastPublished={new Date(Date.now() - 86_400_000).toISOString()}
        hasDraft
      />
    )}
  </AdminShell>
)
