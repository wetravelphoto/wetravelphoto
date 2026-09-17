'use client'

import { useState } from 'react'
import HeroPicker, { type PostOption } from '@/components/admin/HeroPicker'
import FocalPicker from '@/components/admin/FocalPicker'
import ImagePickerModal from '@/components/admin/ImagePickerModal'
import HomePreview, { type PreviewGallery } from '@/components/admin/HomePreview'
import TypographyControls from '@/components/admin/TypographyControls'
import Toggle from '@/components/admin/Toggle'
import DeviceSwitch from '@/components/admin/DeviceSwitch'
import LogoUploader from '@/components/admin/LogoUploader'
import SaveBar from '@/components/admin/SaveBar'
import { effectiveStyle, LEGACY_BASE, type TypeStyles } from '@/lib/type-styles'
import type { BlockImage } from '@/lib/blocks'

type Settings = {
  featured_post_ids: string[]
  hero_titles: Record<string, string>
  hero_subtitles: Record<string, string>
  hero_focal: Record<string, { x: number; y: number; mx: number; my: number }>
  hero_title_position: string
  hero_story_align: string
  hero_show_mark: boolean
  hero_mode: string
  logo_bird_size: number
  show_bird: boolean
  logo_bird_path: string | null
  hero_image_path: string | null
  hero_fixed_title: string | null
  hero_fixed_subtitle: string | null
  hero_fixed_cta_label: string | null
  hero_fixed_cta_href: string | null
  hero_fixed_focal: { x?: number; y?: number; mx?: number; my?: number }
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
  show_instagram: boolean
  instagram_heading: string | null
  type_styles: TypeStyles
}

export default function HomepageEditor({
  posts,
  settings,
  publicUrl,
  galleryCount,
  galleries,
  instagramCount,
  instagramConnected,
}: {
  posts: PostOption[]
  settings: Settings
  publicUrl: string
  galleryCount: number
  galleries: PreviewGallery[]
  instagramCount: number
  instagramConnected: boolean
}) {
  const [heroIds, setHeroIds] = useState<string[]>(settings.featured_post_ids ?? [])
  const [heroMode, setHeroMode] = useState(settings.hero_mode || 'stories')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [wide, setWide] = useState(false)
  const [birdSize, setBirdSize] = useState(settings.logo_bird_size ?? 64)
  const [heroImage, setHeroImage] = useState<string | null>(settings.hero_image_path)
  const [heroFixedFocal, setHeroFixedFocal] = useState(settings.hero_fixed_focal ?? {})
  const [heroTitles, setHeroTitles] = useState<Record<string, string>>(settings.hero_titles ?? {})
  const [heroSubtitles, setHeroSubtitles] = useState<Record<string, string>>(settings.hero_subtitles ?? {})
  const [typeStyles, setTypeStyles] = useState<TypeStyles>(settings.type_styles ?? {})
  const [pickerTarget, setPickerTarget] = useState<'intro' | 'hero' | null>(null)
  const [showIntro, setShowIntro] = useState(settings.show_intro !== false)
  const [showGalleries, setShowGalleries] = useState(settings.show_galleries !== false)
  const [showJournal, setShowJournal] = useState(settings.show_journal !== false)
  const [introImage, setIntroImage] = useState<string | null>(settings.intro_image_path)
  const [introSide, setIntroSide] = useState(settings.intro_image_side || 'left')
  const [introHeading, setIntroHeading] = useState(settings.intro_heading ?? '')
  const [journalCount, setJournalCount] = useState(settings.journal_count ?? 3)
  const [openSection, setOpenSection] = useState<string | null>('hero')
  const [heroKicker, setHeroKicker] = useState(settings.hero_kicker ?? '')
  const [introKicker, setIntroKicker] = useState(settings.intro_kicker ?? '')
  const [introBody, setIntroBody] = useState(settings.intro_body ?? '')
  const [galleryHeading, setGalleryHeading] = useState(settings.carousel_heading ?? '')
  const [journalHeading, setJournalHeading] = useState(settings.journal_heading ?? '')
  const [showInstagram, setShowInstagram] = useState(settings.show_instagram === true)
  const [instagramHeading, setInstagramHeading] = useState(settings.instagram_heading ?? '')

  const heroPosts = heroIds
    .map((id) => posts.find((p) => p.id === id))
    .filter(Boolean) as PostOption[]

  const fallbackPosts = posts.slice(0, 3)
  const previewHero = heroPosts.length > 0 ? heroPosts : fallbackPosts

  function setStyle(section: string, next: { font: string; color: string; scale: number }) {
    setTypeStyles((prev) => ({ ...prev, [section]: next }))
  }

  function toggle(id: string) {
    setOpenSection((cur) => (cur === id ? null : id))
  }

  return (
    <>
    <SaveBar label="Save homepage" title="Homepage" />

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
          <div className="admin-field">
            What the hero shows

            <div className="mode-choice">
              <button
                type="button"
                className="mode-card"
                data-active={heroMode === 'stories'}
                onClick={() => setHeroMode('stories')}
              >
                <span className="mode-card-art" data-kind="stories" />
                <span className="mode-card-title">Featured stories</span>
                <span className="mode-card-note">
                  Up to three stories. Their images fill the screen and swap as visitors hover the titles
                  along the bottom.
                </span>
              </button>

              <button
                type="button"
                className="mode-card"
                data-active={heroMode === 'fixed'}
                onClick={() => setHeroMode('fixed')}
              >
                <span className="mode-card-art" data-kind="fixed" />
                <span className="mode-card-title">One standing image</span>
                <span className="mode-card-note">
                  A single photograph with its own heading and button. Steady, and never depends on what
                  you&apos;ve published.
                </span>
              </button>
            </div>

            <input type="hidden" name="hero_mode" value={heroMode} />

            <p className="admin-meta" style={{ margin: 0, lineHeight: 1.55 }}>
              Whichever you pick, the standing image is used automatically if no published story has a
              featured image — so the hero can never come up empty.
            </p>
          </div>

          <div hidden={heroMode !== 'fixed'}>
            <div className="admin-field">
              Standing image
              {heroImage ? (
                <div style={{ marginTop: '0.4rem' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${publicUrl}/${heroImage}`}
                    alt=""
                    style={{ width: '100%', maxWidth: 260, display: 'block' }}
                  />
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => setPickerTarget('hero')}
                      className="admin-btn admin-btn-sm admin-btn-ghost"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={() => setHeroImage(null)}
                      className="admin-btn admin-btn-sm admin-btn-danger"
                    >
                      Remove
                    </button>
                  </div>

                  <div style={{ marginTop: '0.75rem' }}>
                    <FocalPicker
                      imageUrl={`${publicUrl}/${heroImage}`}
                      desktop={{ x: heroFixedFocal.x ?? 0.5, y: heroFixedFocal.y ?? 0.5 }}
                      mobile={{ x: heroFixedFocal.mx ?? 0.5, y: heroFixedFocal.my ?? 0.5 }}
                      onChange={(next) =>
                        setHeroFixedFocal({
                          x: next.desktop.x,
                          y: next.desktop.y,
                          mx: next.mobile.x,
                          my: next.mobile.y,
                        })
                      }
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerTarget('hero')}
                  style={{
                    width: '100%',
                    maxWidth: 260,
                    marginTop: '0.4rem',
                    border: '1px dashed var(--admin-line)',
                    background: 'none',
                    cursor: 'pointer',
                    padding: '1.75rem 1rem',
                    color: 'var(--admin-mute)',
                    fontFamily: 'inherit',
                    fontSize: '0.85rem',
                  }}
                >
                  Choose a photo
                </button>
              )}
              <input type="hidden" name="hero_image_path" value={heroImage ?? ''} />
              <input type="hidden" name="hero_fixed_focal" value={JSON.stringify(heroFixedFocal)} />

              <p className="admin-meta" style={{ margin: '0.5rem 0 0', lineHeight: 1.55 }}>
                Used whenever the hero is set to one standing image, and as the fallback if no published
                story has a featured image.
              </p>
            </div>

          </div>

          <div hidden={heroMode === 'fixed'}>
          <HeroPicker
            posts={posts}
            initialIds={settings.featured_post_ids ?? []}
            initialTitles={settings.hero_titles ?? {}}
            initialSubtitles={settings.hero_subtitles ?? {}}
            initialFocal={settings.hero_focal ?? {}}
            publicUrl={publicUrl}
            onChange={setHeroIds}
            onTitlesChange={setHeroTitles}
            onSubtitlesChange={setHeroSubtitles}
          />

          <details className="fallback-block">
            <summary>Fallback image</summary>
            <p className="admin-meta" style={{ margin: '0 0 0.6rem', lineHeight: 1.55 }}>
              Used only if no published story has a featured image, so the hero can never come up empty.
            </p>

            {heroImage ? (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${publicUrl}/${heroImage}`}
                  alt=""
                  style={{ width: '100%', maxWidth: 200, display: 'block' }}
                />
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setPickerTarget('hero')}
                    className="admin-btn admin-btn-sm admin-btn-ghost"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => setHeroImage(null)}
                    className="admin-btn admin-btn-sm admin-btn-danger"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPickerTarget('hero')}
                className="admin-btn admin-btn-sm admin-btn-ghost"
              >
                Choose a photo
              </button>
            )}
          </details>
          </div>

          <div className="hero-copy-block">
            <p className="type-block-label">Overlay copy</p>
            <p className="admin-meta" style={{ margin: '0 0 0.75rem', lineHeight: 1.55 }}>
              Sits over the photograph in either mode. Leave blank to show only the wordmark and the
              story titles.
            </p>

            <label className="admin-field">
              Heading
              <input
                type="text"
                name="hero_fixed_title"
                defaultValue={settings.hero_fixed_title ?? ''}
                className="admin-input"
              />
            </label>

            <label className="admin-field">
              Subtitle
              <input
                type="text"
                name="hero_fixed_subtitle"
                defaultValue={settings.hero_fixed_subtitle ?? ''}
                className="admin-input"
              />
            </label>

            <div className="size-row">
              <label className="admin-field">
                Button label
                <input
                  type="text"
                  name="hero_fixed_cta_label"
                  defaultValue={settings.hero_fixed_cta_label ?? ''}
                  placeholder="View galleries"
                  className="admin-input"
                />
              </label>

              <label className="admin-field">
                Button link
                <input
                  type="text"
                  name="hero_fixed_cta_href"
                  defaultValue={settings.hero_fixed_cta_href ?? ''}
                  placeholder="/trips"
                  className="admin-input"
                />
              </label>
            </div>
          </div>

          <div className="type-block">
            <p className="type-block-label">Typography</p>
            <TypographyControls
              value={effectiveStyle(typeStyles, 'hero', LEGACY_BASE)}
              onChange={(next) => setStyle('hero', next)}
            />
          </div>

          <label
            className="admin-field"
            style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <input
              type="checkbox"
              name="hero_show_mark"
              defaultChecked={settings.hero_show_mark !== false}
            />
            Show the wordmark over the image
          </label>

          <label className="admin-field" hidden={heroMode === 'fixed'}>
            Story titles
            <select
              name="hero_story_align"
              defaultValue={settings.hero_story_align || 'left'}
              className="admin-select"
            >
              <option value="left">Aligned left in each column</option>
              <option value="center">Centred in each column</option>
            </select>
          </label>

          <label className="admin-field">
            Wordmark position
            <select
              name="hero_title_position"
              defaultValue={settings.hero_title_position || 'center'}
              className="admin-select"
            >
              <option value="upper">Upper third</option>
              <option value="center">Centre</option>
              <option value="lower">Lower third</option>
            </select>
            <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem', lineHeight: 1.55 }}>
              The site wordmark sits over the photograph; each story is named along the bottom.
            </span>
          </label>

          <label className="admin-field">
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

        <section className="page-section">
          <div className="page-section-head-row">
            <div className="page-section-head" style={{ cursor: 'default' }}>
              <span className="page-section-index">—</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="page-section-title">Accent mark</span>
                <span className="page-section-summary">Small mark between the hero and what follows</span>
              </span>
            </div>
          </div>

          <div className="page-section-body">
            <Toggle
              name="show_bird"
              label="Show the accent mark"
              defaultChecked={settings.show_bird !== false}
            />

            <div className="size-row">
              <div className="logo-grid" style={{ gridTemplateColumns: '1fr', margin: 0 }}>
                <LogoUploader
                  slot="bird"
                  label="Mark"
                  currentUrl={settings.logo_bird_path ? `${publicUrl}/${settings.logo_bird_path}` : null}
                  builtInUrl="/logos/we-travel-photo-bird.svg"
                  previewTone="light"
                />
              </div>

              <label className="admin-field">
                Size — {birdSize}px
                <input
                  type="range"
                  name="logo_bird_size"
                  min="24"
                  max="180"
                  step="2"
                  value={birdSize}
                  onChange={(e) => setBirdSize(parseInt(e.target.value, 10))}
                  style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
                />
              </label>
            </div>
          </div>
        </section>

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
                  <button type="button" onClick={() => setPickerTarget('intro')} className="admin-btn admin-btn-sm admin-btn-ghost">
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
                onClick={() => setPickerTarget('intro')}
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

          <div className="type-block">
            <p className="type-block-label">Typography</p>
            <p className="admin-meta" style={{ margin: '0 0 0.6rem' }}>
              Also styles the galleries heading below.
            </p>
            <TypographyControls value={effectiveStyle(typeStyles, 'intro', LEGACY_BASE)} onChange={(next) => setStyle('intro', next)} />
          </div>
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

          <div className="type-block">
            <p className="type-block-label">Typography</p>
            <TypographyControls value={effectiveStyle(typeStyles, 'journal', LEGACY_BASE)} onChange={(next) => setStyle('journal', next)} />
          </div>
        </Section>

        {/* ---------- INSTAGRAM ---------- */}
        <Section
          id="instagram"
          index={5}
          title="Instagram"
          summary="Recent posts in a grid above the footer"
          open={openSection === 'instagram'}
          onToggle={toggle}
          enabled={showInstagram}
          onEnabledChange={setShowInstagram}
          enabledName="show_instagram"
        >
          <label className="admin-field">
            Heading
            <input
              type="text"
              name="instagram_heading"
              value={instagramHeading}
              onChange={(e) => setInstagramHeading(e.target.value)}
              placeholder="Instagram"
              className="admin-input"
            />
          </label>

          {instagramConnected ? (
            <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
              {instagramCount} post{instagramCount === 1 ? '' : 's'} cached. Shows your nine most recent.
              Connection and syncing are managed in{' '}
              <a href="/admin/settings" style={{ borderBottom: '0.5px solid currentColor' }}>
                settings
              </a>
              .
            </p>
          ) : (
            <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6, color: 'var(--admin-accent)' }}>
              Not connected yet — add an access token in{' '}
              <a href="/admin/settings" style={{ borderBottom: '0.5px solid currentColor' }}>
                settings
              </a>{' '}
              before turning this on.
            </p>
          )}
        </Section>
        {/* ---------- CONTACT ---------- */}
        <Section
          id="contact"
          index={6}
          title="Contact"
          summary="Form at the foot of the page"
          open={openSection === 'contact'}
          onToggle={toggle}
        >
          <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
            The photograph, copy and whether this section appears are all set on the{' '}
            <a href="/admin/pages/contact" style={{ borderBottom: '0.5px solid currentColor' }}>
              contact page
            </a>
            , since the same settings drive both the homepage section and the page itself.
          </p>
        </Section>

      </div>

      {/* ---------- PREVIEW ---------- */}
      <aside className="home-editor-rail">
        <div className="home-editor-rail-inner">
          <div className="preview-toolbar">
            <span className="admin-meta">Live preview</span>
            <DeviceSwitch device={device} onDevice={setDevice} onExpand={() => setWide(true)} />
          </div>

          <div className="preview-frame" data-focus={!!openSection}>
            <HomePreview
              focus={openSection}
              typeStyles={typeStyles}
              device={device}
              publicUrl={publicUrl}
              heroPosts={previewHero.map((post) => ({
                ...post,
                title: heroTitles[post.id] || post.title,
                category: heroSubtitles[post.id] || null,
              }))}
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
              showContact={settings.show_contact_section !== false}
              contactHeading={settings.contact_heading ?? ''}
              showInstagram={showInstagram}
              instagramHeading={instagramHeading}
              instagramCount={instagramCount}
            />
          </div>

          <p className="admin-meta" style={{ margin: '0.6rem 0 0', lineHeight: 1.5 }}>
            {openSection
              ? 'Showing the section you\u2019re editing. Collapse it to see the whole page.'
              : 'Updates as you type. Open a section to preview it on its own.'}
          </p>
        </div>
      </aside>

      {wide && (
        <div className="preview-overlay" onClick={() => setWide(false)}>
          <div className="preview-overlay-inner" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setWide(false)}
              className="admin-btn admin-btn-sm preview-overlay-close"
            >
              Close
            </button>

            <div className="preview-wide" data-device={device}>
              <HomePreview
                focus={openSection}
                typeStyles={typeStyles}
              device={device}
                publicUrl={publicUrl}
                heroPosts={previewHero.map((post) => ({
                  ...post,
                  title: heroTitles[post.id] || post.title,
                  category: heroSubtitles[post.id] || null,
                }))}
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
                showContact={settings.show_contact_section !== false}
                contactHeading={settings.contact_heading ?? ''}
                showInstagram={showInstagram}
                instagramHeading={instagramHeading}
                instagramCount={instagramCount}
              />
            </div>
          </div>
        </div>
      )}

      {pickerTarget && (
        <ImagePickerModal
          publicUrl={publicUrl}
          onClose={() => setPickerTarget(null)}
          onSelect={(images: BlockImage[]) => {
            const path = images[0]?.path
            if (path) {
              if (pickerTarget === 'hero') setHeroImage(path)
              else setIntroImage(path)
            }
            setPickerTarget(null)
          }}
        />
      )}

      <input type="hidden" name="type_styles" value={JSON.stringify(typeStyles)} />
    </div>
    </>
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