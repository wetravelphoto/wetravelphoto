'use client'

import type { PostOption } from '@/components/admin/HeroPicker'

export type PreviewGallery = { id: string; title: string; location: string | null; coverPath: string | null }

/**
 * Miniature of the live homepage, driven by the form's current state so it
 * reflects unsaved edits. Proportions match the real page; type is scaled.
 */
export default function HomePreview({
  device,
  publicUrl,
  heroPosts,
  heroKicker,
  showIntro,
  introKicker,
  introHeading,
  introBody,
  introImage,
  introSide,
  showGalleries,
  galleryHeading,
  galleries,
  showJournal,
  journalHeading,
  journalPosts,
  showContact,
  contactHeading,
}: {
  device: 'desktop' | 'mobile'
  publicUrl: string
  heroPosts: PostOption[]
  heroKicker: string
  showIntro: boolean
  introKicker: string
  introHeading: string
  introBody: string
  introImage: string | null
  introSide: string
  showGalleries: boolean
  galleryHeading: string
  galleries: PreviewGallery[]
  showJournal: boolean
  journalHeading: string
  journalPosts: PostOption[]
  showContact: boolean
  contactHeading: string
}) {
  const hero = heroPosts[0]
  const introParas = introBody.split('\n\n').filter(Boolean).slice(0, 2)

  return (
    <div className="hp" data-device={device}>
      {/* ---- HERO ---- */}
      <div className="hp-hero">
        {hero?.imagePath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${publicUrl}/${hero.imagePath}`} alt="" />
        ) : (
          <div className="hp-hero-empty">No hero image</div>
        )}
        <div className="hp-hero-scrim" />

        <div className="hp-header">
          <span>WETRAVELPHOTO</span>
          <span className="hp-nav">Galleries · Journal · Contact</span>
        </div>

        {hero && (
          <div className="hp-hero-copy">
            <p className="hp-kicker">{heroKicker || hero.category || 'Featured'}</p>
            <p className="hp-hero-title">{hero.title}</p>
            <span className="hp-btn-outline">Read the story</span>
          </div>
        )}

        <div className="hp-hero-picker">
          {heroPosts.map((post, i) => (
            <span key={post.id} data-active={i === 0}>
              {String(i + 1).padStart(2, '0')} {post.title}
            </span>
          ))}
        </div>
      </div>

      {/* ---- INTRO ---- */}
      {showIntro && (introHeading || introParas.length > 0 || introImage) && (
        <div className="hp-section hp-intro" data-side={introSide}>
          {introImage && (
            <div className="hp-intro-media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${publicUrl}/${introImage}`} alt="" />
            </div>
          )}
          <div className="hp-intro-copy">
            {introKicker && <p className="hp-kicker" data-tone="ember">{introKicker}</p>}
            {introHeading && <p className="hp-heading">{introHeading}</p>}
            {introParas.map((para, i) => (
              <p key={i} className="hp-body">
                {para}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* ---- GALLERIES ---- */}
      {showGalleries && (
        <div className="hp-carousel">
          <p className="hp-carousel-head">{galleryHeading || 'Recent trips'}</p>
          <div className="hp-carousel-track">
            {galleries.length > 0 ? (
              galleries.slice(0, 3).map((gallery) => (
                <div key={gallery.id} className="hp-mat">
                  <div className="hp-print">
                    {gallery.coverPath && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${publicUrl}/${gallery.coverPath}`} alt="" />
                    )}
                  </div>
                </div>
              ))
            ) : (
              <span className="hp-empty-note">No public galleries</span>
            )}
          </div>
        </div>
      )}

      {/* ---- JOURNAL ---- */}
      {showJournal && (
        <div className="hp-section">
          <p className="hp-heading" style={{ marginBottom: '0.5rem' }}>
            {journalHeading || 'From the journal'}
          </p>
          <div className="hp-trio">
            {journalPosts.length > 0 ? (
              journalPosts.slice(0, 3).map((post) => (
                <div key={post.id} className="hp-trio-card">
                  <div className="hp-trio-media">
                    {post.imagePath && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${publicUrl}/${post.imagePath}`} alt="" />
                    )}
                  </div>
                  <p className="hp-trio-title">{post.title}</p>
                </div>
              ))
            ) : (
              <span className="hp-empty-note">No published stories</span>
            )}
          </div>
          <div className="hp-cta-row">
            <span className="hp-btn-dark">View all stories</span>
          </div>
        </div>
      )}

      {/* ---- CONTACT ---- */}
      {showContact && (
        <div className="hp-section hp-contact">
          <p className="hp-heading">{contactHeading || 'Get in touch'}</p>
          <div className="hp-form">
            <span />
            <span />
            <span data-tall="true" />
          </div>
        </div>
      )}

      {/* ---- FOOTER ---- */}
      <div className="hp-footer">
        <span>WETRAVELPHOTO</span>
        <span className="hp-nav">Galleries · Journal · About · Contact</span>
      </div>
    </div>
  )
}
