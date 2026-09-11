'use client'

import { useState } from 'react'
import { COVER_FONTS, fontHref, getFont } from '@/lib/fonts'
import LogoUploader from '@/components/admin/LogoUploader'
import SaveBar from '@/components/admin/SaveBar'

type Props = {
  siteTitle: string
  headerLogoUrl: string | null
  footerLogoUrl: string | null
  birdLogoUrl: string | null
  sampleImageUrl: string | null
  initial: {
    headerHeight: number
    headerAlign: string
    navFont: string
    navScale: number
    footerHeight: number
    footerAlign: string
    footerFont: string
    footerScale: number
    birdSize: number
    showBird: boolean
    tagline: string | null
  }
}

const NAV = ['Galleries', 'Journal', 'Contact']

export default function ChromeEditor({
  siteTitle,
  headerLogoUrl,
  footerLogoUrl,
  birdLogoUrl,
  sampleImageUrl,
  initial,
}: Props) {
  const [headerHeight, setHeaderHeight] = useState(initial.headerHeight)
  const [headerAlign, setHeaderAlign] = useState(initial.headerAlign)
  const [navFont, setNavFont] = useState(initial.navFont)
  const [navScale, setNavScale] = useState(initial.navScale)

  const [footerHeight, setFooterHeight] = useState(initial.footerHeight)
  const [footerAlign, setFooterAlign] = useState(initial.footerAlign)
  const [footerFont, setFooterFont] = useState(initial.footerFont)
  const [footerScale, setFooterScale] = useState(initial.footerScale)

  const [birdSize, setBirdSize] = useState(initial.birdSize)
  const [showBird, setShowBird] = useState(initial.showBird)

  // Previews are drawn at 60% so a full-width header fits the panel
  const SCALE = 0.6

  const nav = getFont(navFont)
  const footer = getFont(footerFont)

  const headerLogo = headerLogoUrl || '/logos/we-travel-photo-word.svg'
  const footerLogo = footerLogoUrl || '/logos/we-travel-photo-full.svg'
  const birdLogo = birdLogoUrl || '/logos/we-travel-photo-bird.svg'

  const navStyle: React.CSSProperties = {
    fontFamily: nav.stack,
    fontWeight: nav.weight,
    textTransform: nav.uppercase ? 'uppercase' : 'none',
    letterSpacing: nav.tracking,
    fontSize: `${0.78 * navScale}rem`,
  }

  return (
    <>
      <link rel="stylesheet" href={fontHref(navFont)} />
      <link rel="stylesheet" href={fontHref(footerFont)} />

      {/* ---------------- HEADER ---------------- */}
      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Header</h2>

        <div className="chrome-preview" data-tone="photo">
          {sampleImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sampleImageUrl} alt="" className="chrome-preview-bg" />
          )}
          <span className="chrome-preview-scrim" />

          <div className="chrome-header" data-align={headerAlign}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={headerLogo}
              alt=""
              className="chrome-logo"
              style={{
                height: headerHeight * SCALE,
                filter: headerLogoUrl ? undefined : 'brightness(0) invert(1)',
              }}
            />
            <nav className="chrome-nav" style={navStyle}>
              {NAV.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </nav>
          </div>

          <span className="chrome-preview-label">Over a hero image</span>
        </div>

        <div className="chrome-preview" data-tone="solid" style={{ marginTop: '0.6rem' }}>
          <div className="chrome-header" data-align={headerAlign} data-solid="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={headerLogo} alt="" className="chrome-logo" style={{ height: headerHeight * SCALE }} />
            <nav className="chrome-nav" style={navStyle}>
              {NAV.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </nav>
          </div>

          <span className="chrome-preview-label" data-tone="dark">
            Once scrolled
          </span>
        </div>

        <div className="size-row" style={{ marginTop: '1rem' }}>
          <div className="logo-grid" style={{ gridTemplateColumns: '1fr', margin: 0 }}>
            <LogoUploader
              slot="header"
              label="Header logo"
              currentUrl={headerLogoUrl}
              builtInUrl="/logos/we-travel-photo-word.svg"
              previewTone="light"
            />
          </div>

          <div>
            <label className="admin-field">
              Logo height — {headerHeight}px
              <input
                type="range"
                name="logo_header_height"
                min="16"
                max="110"
                step="1"
                value={headerHeight}
                onChange={(e) => setHeaderHeight(parseInt(e.target.value, 10))}
                style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
              />
            </label>

            <label className="admin-field">
              Layout
              <select
                name="header_align"
                value={headerAlign}
                onChange={(e) => setHeaderAlign(e.target.value)}
                className="admin-select"
              >
                <option value="split">Logo left, menu right</option>
                <option value="center">Logo centred, menu below</option>
                <option value="left">Logo and menu both left</option>
              </select>
            </label>

            <label className="admin-field">
              Menu font
              <select
                name="header_nav_font"
                value={navFont}
                onChange={(e) => setNavFont(e.target.value)}
                className="admin-select"
              >
                {COVER_FONTS.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} — {f.category}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              Menu size — {Math.round(navScale * 100)}%
              <input
                type="range"
                name="header_nav_scale"
                min="0.7"
                max="1.8"
                step="0.05"
                value={navScale}
                onChange={(e) => setNavScale(parseFloat(e.target.value))}
                style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* ---------------- FOOTER ---------------- */}
      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Footer</h2>

        <div className="chrome-preview" data-tone="footer">
          <div className="chrome-footer" data-align={footerAlign}>
            <div className="chrome-footer-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={footerLogo}
                alt=""
                style={{
                  height: footerHeight * SCALE,
                  filter: footerLogoUrl ? undefined : 'brightness(0) invert(1)',
                }}
              />
              {initial.tagline && (
                <p
                  style={{
                    fontFamily: footer.stack,
                    fontSize: `${0.98 * footerScale * SCALE}rem`,
                    margin: '0.6rem 0 0',
                    opacity: 0.75,
                  }}
                >
                  {initial.tagline}
                </p>
              )}
            </div>

            <div
              className="chrome-footer-links"
              style={{ fontFamily: footer.stack, fontSize: `${1 * footerScale * SCALE}rem` }}
            >
              <span className="chrome-footer-head">Explore</span>
              <span>Home</span>
              <span>Galleries</span>
              <span>Journal</span>
              <span>Contact</span>
            </div>

            <div
              className="chrome-footer-signup"
              style={{ fontFamily: footer.stack, fontSize: `${0.92 * footerScale * SCALE}rem` }}
            >
              <span className="chrome-footer-head">Newsletter</span>
              <span className="chrome-footer-input" />
            </div>
          </div>
        </div>

        <div className="size-row" style={{ marginTop: '1rem' }}>
          <div className="logo-grid" style={{ gridTemplateColumns: '1fr', margin: 0 }}>
            <LogoUploader
              slot="footer"
              label="Footer logo"
              currentUrl={footerLogoUrl}
              builtInUrl="/logos/we-travel-photo-full.svg"
              previewTone="dark"
            />
          </div>

          <div>
            <label className="admin-field">
              Logo height — {footerHeight}px
              <input
                type="range"
                name="logo_footer_height"
                min="40"
                max="280"
                step="2"
                value={footerHeight}
                onChange={(e) => setFooterHeight(parseInt(e.target.value, 10))}
                style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
              />
            </label>

            <label className="admin-field">
              Layout
              <select
                name="footer_align"
                value={footerAlign}
                onChange={(e) => setFooterAlign(e.target.value)}
                className="admin-select"
              >
                <option value="left">Three columns</option>
                <option value="center">Stacked and centred</option>
              </select>
            </label>

            <label className="admin-field">
              Text font
              <select
                name="footer_font"
                value={footerFont}
                onChange={(e) => setFooterFont(e.target.value)}
                className="admin-select"
              >
                {COVER_FONTS.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} — {f.category}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              Text size — {Math.round(footerScale * 100)}%
              <input
                type="range"
                name="footer_scale"
                min="0.7"
                max="1.6"
                step="0.05"
                value={footerScale}
                onChange={(e) => setFooterScale(parseFloat(e.target.value))}
                style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* ---------------- ACCENT MARK ---------------- */}
      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Accent mark</h2>

        <div className="chrome-preview" data-tone="solid" style={{ padding: '1.25rem' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={birdLogo}
            alt=""
            style={{ width: birdSize * SCALE, height: 'auto', margin: '0 auto', display: 'block', opacity: showBird ? 0.85 : 0.2 }}
          />
        </div>

        <div className="size-row" style={{ marginTop: '1rem' }}>
          <div className="logo-grid" style={{ gridTemplateColumns: '1fr', margin: 0 }}>
            <LogoUploader
              slot="bird"
              label="Accent logo"
              currentUrl={birdLogoUrl}
              builtInUrl="/logos/we-travel-photo-bird.svg"
              previewTone="light"
            />
          </div>

          <div>
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

            <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                name="show_bird"
                checked={showBird}
                onChange={(e) => setShowBird(e.target.checked)}
              />
              Show it below the hero
            </label>
          </div>
        </div>
      </div>

      <SaveBar label="Save header & footer" title={siteTitle} />
    </>
  )
}
