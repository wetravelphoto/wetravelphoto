'use client'

import { useState } from 'react'
import { fontHref, getFont } from '@/lib/fonts'
import LogoUploader from '@/components/admin/LogoUploader'
import FontSelect from '@/components/admin/FontSelect'
import DeviceSwitch from '@/components/admin/DeviceSwitch'
import SaveBar from '@/components/admin/SaveBar'

type Props = {
  siteTitle: string
  headerLogoUrl: string | null
  footerLogoUrl: string | null
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
    headerHeightMobile: number
    navScaleMobile: number
    footerHeightMobile: number
    footerScaleMobile: number
    tagline: string | null
  }
}

const NAV = ['Galleries', 'Journal', 'Contact']

export default function ChromeEditor({
  siteTitle,
  headerLogoUrl,
  footerLogoUrl,
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

  const [headerHeightMobile, setHeaderHeightMobile] = useState(initial.headerHeightMobile)
  const [navScaleMobile, setNavScaleMobile] = useState(initial.navScaleMobile)
  const [footerHeightMobile, setFooterHeightMobile] = useState(initial.footerHeightMobile)
  const [footerScaleMobile, setFooterScaleMobile] = useState(initial.footerScaleMobile)

  // Which device the sliders and previews are showing
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const onMobile = device === 'mobile'


  // Previews are drawn at 60% so a full-width header fits the panel
  const SCALE = 0.6

  const shownHeaderHeight = onMobile ? headerHeightMobile : headerHeight
  const shownNavScale = onMobile ? navScaleMobile : navScale
  const shownFooterHeight = onMobile ? footerHeightMobile : footerHeight
  const shownFooterScale = onMobile ? footerScaleMobile : footerScale

  const nav = getFont(navFont)
  const footer = getFont(footerFont)

  const headerLogo = headerLogoUrl || '/logos/we-travel-photo-word.svg'
  const footerLogo = footerLogoUrl || '/logos/we-travel-photo-full.svg'

  const navStyle: React.CSSProperties = {
    fontFamily: nav.stack,
    fontWeight: nav.weight,
    textTransform: nav.uppercase ? 'uppercase' : 'none',
    letterSpacing: nav.tracking,
    fontSize: `${0.78 * shownNavScale}rem`,
  }

  return (
    <>
      <link rel="stylesheet" href={fontHref(navFont)} />
      <link rel="stylesheet" href={fontHref(footerFont)} />

      {/* ---------------- HEADER ---------------- */}
      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Header</h2>
        <div className="chrome-device-row">
          <DeviceSwitch device={device} onDevice={setDevice} />
          <span className="admin-meta">
            {onMobile ? 'Editing phone sizes' : 'Editing desktop sizes'}
          </span>
        </div>


        <div className="chrome-preview" data-tone="photo" data-device={device}>
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
                height: shownHeaderHeight * SCALE,
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
            <img src={headerLogo} alt="" className="chrome-logo" style={{ height: shownHeaderHeight * SCALE }} />
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
              Logo height — {shownHeaderHeight}px
              <input
                type="range"
                min="16"
                max="110"
                step="1"
                value={shownHeaderHeight}
                onChange={(e) => {
                  const next = parseInt(e.target.value, 10)
                  if (onMobile) setHeaderHeightMobile(next)
                  else setHeaderHeight(next)
                }}
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

            <FontSelect name="header_nav_font" label="Menu font" value={navFont} onChange={setNavFont} />

            <label className="admin-field">
              Menu size — {Math.round(shownNavScale * 100)}%
              <input
                type="range"
                min="0.7"
                max="1.8"
                step="0.05"
                value={shownNavScale}
                onChange={(e) => {
                  const next = parseFloat(e.target.value)
                  if (onMobile) setNavScaleMobile(next)
                  else setNavScale(next)
                }}
                style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* ---------------- FOOTER ---------------- */}
      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Footer</h2>
        <div className="chrome-device-row">
          <DeviceSwitch device={device} onDevice={setDevice} />
          <span className="admin-meta">
            {onMobile ? 'Editing phone sizes' : 'Editing desktop sizes'}
          </span>
        </div>


        <div className="chrome-preview" data-tone="footer" data-device={device}>
          <div className="chrome-footer" data-align={footerAlign}>
            <div className="chrome-footer-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={footerLogo}
                alt=""
                style={{
                  height: shownFooterHeight * SCALE,
                  filter: footerLogoUrl ? undefined : 'brightness(0) invert(1)',
                }}
              />
              {initial.tagline && (
                <p
                  style={{
                    fontFamily: footer.stack,
                    fontSize: `${0.98 * shownFooterScale * SCALE}rem`,
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
              style={{ fontFamily: footer.stack, fontSize: `${1 * shownFooterScale * SCALE}rem` }}
            >
              <span className="chrome-footer-head">Explore</span>
              <span>Home</span>
              <span>Galleries</span>
              <span>Journal</span>
              <span>Contact</span>
            </div>

            <div
              className="chrome-footer-signup"
              style={{ fontFamily: footer.stack, fontSize: `${0.92 * shownFooterScale * SCALE}rem` }}
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
              Logo height — {shownFooterHeight}px
              <input
                type="range"
                min="40"
                max="280"
                step="2"
                value={shownFooterHeight}
                onChange={(e) => {
                  const next = parseInt(e.target.value, 10)
                  if (onMobile) setFooterHeightMobile(next)
                  else setFooterHeight(next)
                }}
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

            <FontSelect name="footer_font" label="Text font" value={footerFont} onChange={setFooterFont} />

            <label className="admin-field">
              Text size — {Math.round(shownFooterScale * 100)}%
              <input
                type="range"
                min="0.7"
                max="1.6"
                step="0.05"
                value={shownFooterScale}
                onChange={(e) => {
                  const next = parseFloat(e.target.value)
                  if (onMobile) setFooterScaleMobile(next)
                  else setFooterScale(next)
                }}
                style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
              />
            </label>
          </div>
        </div>
      </div>

      <input type="hidden" name="logo_header_height" value={headerHeight} />
      <input type="hidden" name="logo_header_height_mobile" value={headerHeightMobile} />
      <input type="hidden" name="header_nav_scale" value={navScale} />
      <input type="hidden" name="header_nav_scale_mobile" value={navScaleMobile} />
      <input type="hidden" name="logo_footer_height" value={footerHeight} />
      <input type="hidden" name="logo_footer_height_mobile" value={footerHeightMobile} />
      <input type="hidden" name="footer_scale" value={footerScale} />
      <input type="hidden" name="footer_scale_mobile" value={footerScaleMobile} />

      <SaveBar label="Save header & footer" title={siteTitle} />
    </>
  )
}
