'use client'

import { useState } from 'react'
import HeroPicker, { type PostOption } from '@/components/admin/HeroPicker'
import ImagePickerModal from '@/components/admin/ImagePickerModal'
import HomePreview, { type PreviewGallery } from '@/components/admin/HomePreview'
import type { BlockImage } from '@/lib/blocks'

type Settings = {
  featured_post_ids: string[]
  hero_titles: Record<string, string>
  hero_kicker: string | null
  show_intro: boolean
  intro_kicker: string | null
  intro_heading: string | null
  intro_body: string | null
  intro_image_path: string | null
  intro_image_side: string
  show_galleries: boolean
  carousel_heading: string | null
  show_journal: boolean
  journal_heading: string | null
  journal_count: number
  show_contact_section: boolean
  contact_heading: string | null
}

export default function HomepageEditor({
  posts,
  settings,
  publicUrl,
  galleryCount,
  galleries,
}: {
  posts: PostOption[]
  settings: Settings
  publicUrl: string
  galleryCount: number
  galleries: PreviewGallery[]
}) {
  const [heroIds, setHeroIds] = useState<string[]>(settings.featured_post_ids ?? [])
  const [heroTitles, setHeroTitles] = useState<Record<string, string>>(settings.hero_titles ?? {})
  const [showIntro, setShowIntro] = useState(settings.show_intro !== false)
  const [showGalleries, setShowGalleries] = useState(settings.show_galleries !== false)
  const [showJournal, setShowJournal] = useState(settings.show_journal !== false)
  const [showContact, setShowContact] = useState(settings.show_contact_section !== false)
  const [introImage, setIntroImage] = useState<string | null>(settings.intro_image_path)
  const [introSide, setIntroSide] = useState(settings.intro_image_side || 'left')
  const [introHeading, setIntroHeading] = useState(settings.intro_heading ?? '')
  const [journalCount, setJournalCount] = useState(settings.journal_count ?? 3)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [openSection, setOpenSection] = useState<string | null>('hero')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [heroKicker, setHeroKicker] = useState(settings.hero_kicker ?? '')
  const [introKicker, setIntroKicker] = useState(settings.intro_kicker ?? '')
  const [introBody, setIntroBody] = useState(settings.intro_body ?? '')
  const [galleryHeading, setGalleryHeading] = useState(settings.carousel_heading ?? '')
  const [journalHeading, setJournalHeading] = useState(settings.journal_heading ?? '')
  const [contactHeading, setContactHeading] = useState(settings.contact_heading ?? '')

  const heroPosts = heroIds
    .map((id) => posts.find((p) => p.id === id))
    .filter(Boolean) as PostOption[]

  const fallbackPosts = posts.slice(0, 3)
  const previewHero = heroPosts.length > 0 ? heroPosts : fallbackPosts

  function toggle(id: string) {
    setOpenSection((cur) => (cur === id ? null : id))
  }

  return (
    <div className="home-editor">
      <div className="home-editor-main">
        {/* ---------- HERO ---------- */}
        <Section
          id="hero"
          index={1}
          title="Hero"
          summary="Full-screen images, switched by hovering the titles"
          open={openSection === 'hero'}
          onToggle={toggle}
        >
          <HeroPicker
            posts={posts}
            initialIds={settings.featured_post_ids ?? []}
            initialTitles={settings.hero_titles ?? {}}
            publicUrl={publicUrl}
            onChange={setHeroIds}
            onTitlesChange={setHeroTitles}
          />

          <label className="admin-field" style={{ marginTop: '1rem' }}>
            Kicker
            <input
              type="text"
              name="hero_kicker"
              value={heroKicker}
              onChange={(e) => setHeroKicker(e.target.value)}
              placeholder="Falls back to each story's category"
              className="admin-input"
            />
          </label>
        </Section>

        {/* ---------- INTRO ---------- */}
        <Section
          id="intro"
          index={2}
          title="Intro"
          summary="A photo beside your story"
          open={openSection === 'intro'}
          onToggle={toggle}
          enabled={showIntro}
          onEnabledChange={setShowIntro}
          enabledName="show_intro"
        >
          <div className="admin-field">
            Photo
            {introImage ? (
              <div style={{ marginTop: '0.4rem' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${publicUrl}/${introImage}`} alt="" style={{ width: '100%', maxWidth: 220, display: 'block' }} />
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => setPickerOpen(true)} className="admin-btn admin-btn-sm admin-btn-ghost">
                    Change
                  </button>
                  <button type="button" onClick={() => setIntroImage(null)} className="admin-btn admin-btn-sm admin-btn-danger">
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                style={{
                  width: '100%',
                  maxWidth: 220,
                  marginTop: '0.4rem',
                  border: '1px dashed var(--admin-line)',
                  background: 'none',
                  cursor: 'pointer',
                  padding: '1.5rem 1rem',
                  color: 'var(--admin-mute)',
                  fontFamily: 'inherit',
                  fontSize: '0.85rem',
                }}
              >
                Choose a photo
              </button>
            )}
            <input type="hidden" name="intro_image_path" value={introImage ?? ''} />
          </div>

          <label className="admin-field">
            Photo position
            <select
              name="intro_image_side"
              value={introSide}
              onChange={(e) => setIntroSide(e.target.value)}
              className="admin-select"
            >
              <option value="left">Photo left, text right</option>
              <option value="right">Photo right, text left</option>
            </select>
          </label>

          <label className="admin-field">
            Kicker
            <input
              type="text"
              name="intro_kicker"
              value={introKicker}
              onChange={(e) => setIntroKicker(e.target.value)}
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Heading
            <input
              type="text"
              name="intro_heading"
              value={introHeading}
              onChange={(e) => setIntroHeading(e.target.value)}
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Body
            <textarea
              name="intro_body"
              value={introBody}
              onChange={(e) => setIntroBody(e.target.value)}
              rows={6}
              placeholder="Leave a blank line between paragraphs."
              className="admin-input"
              style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
            />
          </label>
        </Section>

        {/* ---------- GALLERIES ---------- */}
        <Section
          id="galleries"
          index={3}
          title="Galleries"
          summary="The dark, draggable carousel"
          open={openSection === 'galleries'}
          onToggle={toggle}
          enabled={showGalleries}
          onEnabledChange={setShowGalleries}
          enabledName="show_galleries"
        >
          <label className="admin-field">
            Heading
            <input
              type="text"
              name="carousel_heading"
              value={galleryHeading}
              onChange={(e) => setGalleryHeading(e.target.value)}
              placeholder="Recent trips"
              className="admin-input"
            />
          </label>

          <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
            Shows every public gallery, newest first — {galleryCount} right now. A gallery needs its privacy set
            to public and a cover photo to appear.
          </p>
        </Section>

        {/* ---------- JOURNAL ---------- */}
        <Section
          id="journal"
          index={4}
          title="Journal"
          summary="Recent stories with a link to the full index"
          open={openSection === 'journal'}
          onToggle={toggle}
          enabled={showJournal}
          onEnabledChange={setShowJournal}
          enabledName="show_journal"
        >
          <label className="admin-field">
            Heading
            <input
              type="text"
              name="journal_heading"
              value={journalHeading}
              onChange={(e) => setJournalHeading(e.target.value)}
              placeholder="From the journal"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            How many to show
            <select
              name="journal_count"
              value={journalCount}
              onChange={(e) => setJournalCount(parseInt(e.target.value, 10))}
              className="admin-select"
            >
              <option value={3}>3</option>
              <option value={6}>6</option>
              <option value={9}>9</option>
            </select>
          </label>
        </Section>

        {/* ---------- CONTACT ---------- */}
        <Section
          id="contact"
          index={5}
          title="Contact"
          summary="Form at the foot of the page"
          open={openSection === 'contact'}
          onToggle={toggle}
          enabled={showContact}
          onEnabledChange={setShowContact}
          enabledName="show_contact_section"
        >
          <label className="admin-field">
            Heading
            <input
              type="text"
              name="contact_heading"
              value={contactHeading}
              onChange={(e) => setContactHeading(e.target.value)}
              placeholder="Get in touch"
              className="admin-input"
            />
          </label>
          <p className="admin-meta" style={{ margin: 0 }}>
            Intro copy and public email live on the contact page.
          </p>
        </Section>
      </div>

      {/* ---------- PREVIEW ---------- */}
      <aside className="home-editor-rail">
        <div className="home-editor-rail-inner">
          <div className="preview-toolbar">
            <span className="admin-meta">Live preview</span>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <button
                type="button"
                onClick={() => setDevice('desktop')}
                className="admin-btn admin-btn-sm admin-btn-ghost"
                data-active={device === 'desktop'}
              >
                Desktop
              </button>
              <button
                type="button"
                onClick={() => setDevice('mobile')}
                className="admin-btn admin-btn-sm admin-btn-ghost"
                data-active={device === 'mobile'}
              >
                Mobile
              </button>
            </div>
          </div>

          <div className="preview-frame">
            <HomePreview
              device={device}
              publicUrl={publicUrl}
              heroPosts={previewHero.map((post) => ({ ...post, title: heroTitles[post.id] || post.title }))}
              heroKicker={heroKicker}
              showIntro={showIntro}
              introKicker={introKicker}
              introHeading={introHeading}
              introBody={introBody}
              introImage={introImage}
              introSide={introSide}
              showGalleries={showGalleries}
              galleryHeading={galleryHeading}
              galleries={galleries}
              showJournal={showJournal}
              journalHeading={journalHeading}
              journalPosts={posts.slice(0, journalCount)}
              showContact={showContact}
              contactHeading={contactHeading}
            />
          </div>

          <p className="admin-meta" style={{ margin: '0.6rem 0 0', lineHeight: 1.5 }}>
            Updates as you type. Click a section header to jump to its settings.
          </p>
        </div>
      </aside>

      {pickerOpen && (
        <ImagePickerModal
          publicUrl={publicUrl}
          onClose={() => setPickerOpen(false)}
          onSelect={(images: BlockImage[]) => {
            if (images[0]?.path) setIntroImage(images[0].path)
            setPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}

function Section({
  id,
  index,
  title,
  summary,
  open,
  onToggle,
  enabled,
  onEnabledChange,
  enabledName,
  children,
}: {
  id: string
  index: number
  title: string
  summary: string
  open: boolean
  onToggle: (id: string) => void
  enabled?: boolean
  onEnabledChange?: (value: boolean) => void
  enabledName?: string
  children: React.ReactNode
}) {
  return (
    <section className="page-section" data-off={enabled === false}>
      <div className="page-section-head-row">
        <button type="button" className="page-section-head" onClick={() => onToggle(id)}>
          <span className="page-section-index">{String(index).padStart(2, '0')}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="page-section-title">{title}</span>
            <span className="page-section-summary">{summary}</span>
          </span>
          <span className="page-section-chevron">{open ? '−' : '+'}</span>
        </button>

        {onEnabledChange && enabledName && (
          <label className="section-switch" title={enabled ? 'Visible' : 'Hidden'}>
            <input
              type="checkbox"
              name={enabledName}
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
            />
            <span />
          </label>
        )}
      </div>

      {/* Kept mounted so collapsed fields still submit */}
      <div className="page-section-body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}
