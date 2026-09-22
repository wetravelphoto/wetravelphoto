'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { sectionDef, type SectionSettings } from '@/lib/sections/registry'
import { PAGES, PAGE_SLUGS } from '@/lib/sections/pages'
import {
  addDraftSection,
  duplicateDraftSection,
  applyDraftPairing,
  applyDraftPalette,
  discard,
  publish,
  removeDraftSection,
  reorderDraft,
  resetDraftStyles,
  setDraftVisible,
  clearDraftSectionTypes,
  updateDraftStyles,
  undoDraft,
  redoDraft,
} from '@/app/actions/canvas'
import type { StepsState } from '@/lib/drafts/steps'
import { cssVariables, fontsToLoad, type StyleTokens } from '@/lib/styles/tokens'
import { hasOwnType, type TypeStyles } from '@/lib/type-styles'
import { fontHref } from '@/lib/fonts'
import SectionRail from '@/components/canvas/SectionRail'
import Inspector from '@/components/canvas/Inspector'
import AddSectionModal from '@/components/canvas/AddSectionModal'
import PresetRail from '@/components/canvas/PresetRail'
import StyleMode from '@/components/canvas/StyleMode'
import PanelResizer from '@/components/canvas/PanelResizer'
import PageSettings from '@/components/canvas/PageSettings'
import type { PageSeo, ResolvedSeo } from '@/lib/seo'
import type { StoryOption } from '@/components/canvas/editors/HeroStories'

export type CanvasSection = {
  id: string
  type: string
  label: string
  blurb: string
  permanent: boolean
  singleton: boolean
  visible: boolean
  settings: SectionSettings
}

type Device = 'desktop' | 'tablet' | 'phone'
type Mode = 'content' | 'style'

/**
 * The width each device's page is laid out at. Desktop is a real desktop
 * width; the preview scales it down to fit the space between the panels.
 */
const WIDTHS: Record<Device, number> = { desktop: 1440, tablet: 820, phone: 390 }

/** The breathing room above and below a tablet or phone frame. */
const FRAME_INSET = 44

/**
 * The shell. Holds the selection, owns the iframe, and is the only thing that
 * talks to the preview.
 *
 * THE REFRESH LOOP. Every edit follows the same path: call the action, then
 * tell the iframe to re-render, then refresh this component's own data. The
 * iframe re-runs the real server components rather than being patched from
 * here, so what appears on screen is what the renderer actually produces from
 * what is actually in the draft. A few hundred milliseconds slower than
 * optimistic patching, and it cannot lie.
 */
export default function Canvas({
  page,
  title,
  sections,
  legacy,
  missing,
  hasDraft,
  draftUpdatedAt,
  steps,
  publicUrl,
  tokens,
  typeStyles,
  stories,
  seo,
  seoResolved,
  siteTitle,
  siteHost,
  initialMode = 'content',
}: {
  page: string
  title: string
  sections: CanvasSection[]
  legacy: boolean
  missing: boolean
  hasDraft: boolean
  draftUpdatedAt: string | null
  /** What Undo and Redo would do right now (null: nothing). */
  steps: StepsState
  publicUrl: string
  /** The draft's style if it has any, otherwise the live site's. */
  tokens: StyleTokens
  /** Per-section overrides, from the draft if there is one. */
  typeStyles: TypeStyles
  /** Published stories the hero can feature. */
  stories: StoryOption[]
  /** This page's stored search and sharing values (draft first). */
  seo: PageSeo
  /** What the page uses for anything not stored. */
  seoResolved: ResolvedSeo
  siteTitle: string
  /** The site's address without the scheme, for the previews. */
  siteHost: string
  initialMode?: Mode
}) {
  const router = useRouter()
  const frame = useRef<HTMLIFrameElement>(null)

  // The stage's size, so the preview can be laid out at a real device width
  // and scaled to fit it.
  const stage = useRef<HTMLElement>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const [pending, startTransition] = useTransition()

  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [device, setDevice] = useState<Device>('desktop')

  const frameWidth = WIDTHS[device]
  const frameInset = device === 'desktop' ? 0 : FRAME_INSET
  // Until the stage has been measured the frame just fills it; after that it is
  // laid out at the device width and scaled.
  const measured = stageSize.width > 0 && stageSize.height > 0
  const scale = measured ? Math.min(1, stageSize.width / frameWidth) : 1
  const frameHeight = measured ? stageSize.height - frameInset : 0
  /**
   * The add-section picker, and where the new section goes: after a given
   * section (from "+" between rows or "Add section below" in the page), or at
   * the end of the page (null).
   */
  const [picking, setPicking] = useState<{ after: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  /**
   * A drag should move the row under the cursor now, not after a round trip —
   * but mirroring the whole `sections` array into state would duplicate every
   * section's SETTINGS as well, and then the inspector could be editing a copy
   * the server had already moved on from. So only the ORDER is held locally,
   * as a list of ids, and everything else is read straight from the server on
   * every render. The override is dropped as soon as an action completes.
   */
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)

  const order = dragOrder
    ? (dragOrder
        .map((id) => sections.find((s) => s.id === id))
        .filter((s): s is CanvasSection => s !== undefined))
    : sections

  /**
   * A setting clicked in the page, so the inspector can jump straight to it.
   *
   * Carries a nonce because the interesting case is clicking the SAME heading
   * twice — after tabbing away, say. On a bare string the second click would
   * change nothing and the effect that focuses the input would never re-run.
   */
  const [focusField, setFocusField] = useState<{ field: string; nonce: number } | null>(null)
  const nonce = useRef(0)

  const tell = useCallback(
    (message: {
      type: string
      id?: string
      field?: string
      value?: string
      vars?: Record<string, string | null>
      fonts?: string[]
      index?: number
      var?: string
      unit?: string
      attr?: string
    }) => {
      frame.current?.contentWindow?.postMessage(
        { source: 'wtp-canvas', ...message },
        window.location.origin
      )
    },
    []
  )

  /** Run an action, then re-render the preview and this rail. */
  const run = useCallback(
    (work: () => Promise<unknown>, after?: () => void) => {
      setError(null)
      startTransition(async () => {
        try {
          await work()
          setDragOrder(null)
          tell({ type: 'refresh' })
          router.refresh()
          after?.()
        } catch (e) {
          setDragOrder(null)
          setError(e instanceof Error ? e.message : 'Something went wrong.')
        }
      })
    },
    [router, tell]
  )

  /**
   * UNDO AND REDO
   *
   * Three things have to happen in order. Anything still waiting on a panel's
   * debounce is saved first, or it would land after the undo and put the
   * change straight back. Then the step is taken on the server. Then the
   * panels are rebuilt (`revision`), because their inputs hold what was typed
   * and would otherwise go on showing the value that was just undone.
   */
  const inspectorFlush = useRef<(() => Promise<void>) | null>(null)
  const pageFlush = useRef<(() => Promise<void>) | null>(null)
  const styleFlush = useRef<(() => Promise<void>) | null>(null)
  const [revision, setRevision] = useState(0)
  const [remountArmed, setRemountArmed] = useState(false)
  const [seenSections, setSeenSections] = useState(sections)

  // The panels are rebuilt when the refreshed sections actually ARRIVE, not
  // when the undo returns — rebuilt any earlier, they would read the old ones.
  // ("Adjusting state during render", as StyleMode does for its tokens.)
  if (sections !== seenSections) {
    setSeenSections(sections)
    if (remountArmed) {
      setRemountArmed(false)
      setRevision((r) => r + 1)
    }
  }

  const history = useCallback(
    (direction: 'undo' | 'redo') => {
      setError(null)
      startTransition(async () => {
        try {
          await inspectorFlush.current?.()
          await pageFlush.current?.()
          await styleFlush.current?.()
          // Nothing painted on ahead of the server is true after this.
          tell({ type: 'settle' })

          const result = direction === 'undo' ? await undoDraft() : await redoDraft()
          if (!result) {
            setNote(direction === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.')
            router.refresh()
            return
          }

          setDragOrder(null)
          setRemountArmed(true)
          setNote(`${direction === 'undo' ? 'Undone' : 'Redone'}: ${result.label}`)

          // The step was on another page: go and show it, rather than
          // appearing to do nothing.
          const elsewhere = !result.styles && result.pages.length > 0 && !result.pages.includes(page)
          if (elsewhere) {
            router.push(`/edit/${result.pages[0]}${mode === 'style' ? '?mode=style' : ''}`)
          } else {
            tell({ type: 'refresh' })
            router.refresh()
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Something went wrong.')
        }
      })
    },
    [mode, page, router, tell]
  )

  // Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or Ctrl+Y), anywhere in the editor except a
  // text field, which keeps its own typing undo. The preview forwards the same
  // keys when it has focus (PreviewBridge).
  const historyRef = useRef(history)
  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const el = event.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      historyRef.current(key === 'y' || event.shiftKey ? 'redo' : 'undo')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Clicks inside the preview.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as {
        source?: string
        type?: string
        id?: string
        field?: string
      } | null
      if (!data || data.source !== 'wtp-preview') return

      if (data.type === 'select' && data.id) {
        setSelected(data.id)
        setFocusField(data.field ? { field: data.field, nonce: ++nonce.current } : null)
      }

      if (data.type === 'clear') {
        setSelected(null)
        setFocusField(null)
      }

      // "Add section below" on a section in the page itself.
      if (data.type === 'add-after' && data.id) {
        setPicking({ after: data.id })
      }

      // Undo/redo keys pressed while the preview had focus.
      if (data.type === 'undo' || data.type === 'redo') {
        historyRef.current(data.type)
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  /**
   * Style, painted onto the page on the spot.
   *
   * The same narrow exception as the text patch, and for the same reason: these
   * tokens ARE the CSS custom properties the page is drawn from, so writing
   * them onto the preview is the identity rather than a second renderer. Any
   * chosen typeface is sent along as a stylesheet href, because a font the
   * preview has not loaded would otherwise show as a fallback until the next
   * refresh — which looks exactly like a broken font picker.
   */
  const paintStyle = useCallback(
    (next: StyleTokens) => {
      tell({
        type: 'styles',
        vars: cssVariables(next),
        fonts: fontsToLoad(next).map(fontHref),
      })
    },
    [tell]
  )

  // Selecting in the rail scrolls the preview to it.
  const choose = (id: string | null) => {
    setSelected(id)
    setFocusField(null)
    tell({ type: 'select', id: id ?? undefined })
  }

  const current = order.find((s) => s.id === selected) ?? null
  const def = current ? sectionDef(current.type) : null

  const reorder = (next: CanvasSection[]) => {
    const ids = next.map((s) => s.id)
    setDragOrder(ids)
    run(() => reorderDraft(page, ids))
  }

  if (missing) {
    return (
      <div className="cv-missing">
        <h1>The editor needs one more migration</h1>
        <p>
          Run <code>db/migrations/2026-09-16_site_draft.sql</code> in Supabase, then{' '}
          <code>notify pgrst, &apos;reload schema&apos;</code>. Nothing on the live site depends on
          it — this screen is the only thing waiting.
        </p>
        <Link href="/admin/design" className="cv-btn">
          ← Back to Design
        </Link>
      </div>
    )
  }

  return (
    <div className="cv-shell" data-busy={pending}>
      <header className="cv-top">
        <div className="cv-top-left">
          <Link href="/admin/design" className="cv-back" aria-label="Back to admin">
            ←
          </Link>
          {/* Which page is open. The draft is one for the whole site, so moving
              between pages keeps every unpublished change, and Publish sends
              them all live together. */}
          <label className="cv-page">
            <span className="cv-sr">Page</span>
            <select
              className="cv-page-select"
              value={page}
              onChange={(e) =>
                router.push(`/edit/${e.target.value}${mode === 'style' ? '?mode=style' : ''}`)
              }
            >
              {PAGE_SLUGS.map((slug) => (
                <option key={slug} value={slug}>
                  {PAGES[slug].label}
                </option>
              ))}
            </select>
          </label>
          <div className="cv-history" role="group" aria-label="Undo and redo">
            <button
              type="button"
              className="cv-ico cv-history-btn"
              disabled={!steps.undo || pending}
              onClick={() => history('undo')}
              aria-label={steps.undo ? `Undo ${steps.undo}` : 'Undo'}
              title={steps.undo ? `Undo: ${steps.undo}  (Ctrl/⌘ Z)` : 'Nothing to undo'}
            >
              ↶
            </button>
            <button
              type="button"
              className="cv-ico cv-history-btn"
              disabled={!steps.redo || pending}
              onClick={() => history('redo')}
              aria-label={steps.redo ? `Redo ${steps.redo}` : 'Redo'}
              title={steps.redo ? `Redo: ${steps.redo}  (Ctrl/⌘ Shift Z)` : 'Nothing to redo'}
            >
              ↷
            </button>
          </div>
          {hasDraft && (
            <span className="cv-flag" title={draftUpdatedAt ?? undefined}>
              Unpublished changes
            </span>
          )}
          {legacy && !hasDraft && (
            <span className="cv-flag cv-flag-quiet">Not yet edited here</span>
          )}
        </div>

        <div className="cv-modes" role="group" aria-label="What you are editing">
          {(['content', 'style'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              className="cv-mode"
              data-on={mode === m}
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m)
                // Selection is a content idea. Leaving a section outlined while
                // you change the palette draws the eye to one band of a page
                // you are trying to judge as a whole.
                if (m === 'style') choose(null)
              }}
            >
              {m === 'content' ? 'Content' : 'Style'}
            </button>
          ))}
        </div>

        <div className="cv-devices" role="group" aria-label="Preview width">
          {(['desktop', 'tablet', 'phone'] as Device[]).map((d) => (
            <button
              key={d}
              type="button"
              className="cv-device"
              data-on={device === d}
              onClick={() => setDevice(d)}
              aria-pressed={device === d}
            >
              {d === 'desktop' ? '🖥' : d === 'tablet' ? '▭' : '▯'}
              <span className="cv-sr">{d}</span>
            </button>
          ))}
        </div>

        <div className="cv-top-right">
          <a href={`/preview/${page}`} target="_blank" rel="noreferrer" className="cv-btn cv-btn-ghost">
            Open preview ↗
          </a>
          <button
            type="button"
            className="cv-btn cv-btn-ghost"
            disabled={!hasDraft || pending}
            onClick={() => {
              if (confirm('Throw away every unpublished change and go back to the live page?')) {
                run(() => discard(), () => {
                  setSelected(null)
                  setNote('Draft discarded. This is the live page again.')
                })
              }
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="cv-btn cv-btn-go"
            disabled={!hasDraft || pending}
            onClick={() =>
              run(
                () => publish(),
                () => setNote('Published. The live site now matches this.')
              )
            }
          >
            Publish
          </button>
        </div>
      </header>

      {(error || note) && (
        <div className={error ? 'cv-bar cv-bar-bad' : 'cv-bar'} role="status">
          {error ?? note}
          <button type="button" className="cv-bar-x" onClick={() => { setError(null); setNote(null) }}>
            ×
          </button>
        </div>
      )}

      <div className="cv-body" data-mode={mode}>
        {mode === 'style' ? (
          <PresetRail
            tokens={tokens}
            onPairing={(id) => run(() => applyDraftPairing(id))}
            onPalette={(id) => run(() => applyDraftPalette(id))}
            onReset={() => {
              if (confirm('Put the colours and type back to the original?')) {
                run(() => resetDraftStyles())
              }
            }}
          />
        ) : (
          <SectionRail
            sections={order}
            selected={selected}
            onSelect={choose}
            onReorder={reorder}
            onToggle={(id, visible) => run(() => setDraftVisible(page, id, visible))}
            onRemove={(id, label) => {
              if (confirm(`Remove the ${label} section from this page?`)) {
                run(() => removeDraftSection(page, id), () => setSelected(null))
              }
            }}
            onAdd={(after) => setPicking({ after })}
            onPageSettings={() => choose(null)}
            onDuplicate={(id) =>
              run(async () => {
                const copy = await duplicateDraftSection(page, id)
                setSelected(copy)
              })
            }
          />
        )}

        <main className="cv-stage" ref={stage}>
          <div className="cv-frame-wrap" data-device={device}>
            {/* The page is laid out at the device's real width and scaled down
                to fit, so "desktop" really is a desktop layout — rather than
                whatever width happens to be left between the two panels, which
                is a tablet's, and hides every desktop-only setting (four
                prints across, four galleries across). */}
            <div
              className="cv-frame-box"
              style={measured ? { width: frameWidth * scale, height: frameHeight } : undefined}
              title={scale < 1 ? `${frameWidth}px wide, shown at ${Math.round(scale * 100)}%` : undefined}
            >
              <iframe
                ref={frame}
                className="cv-frame"
                src={`/preview/${page}`}
                title={`${title} preview`}
                style={
                  measured
                    ? {
                        width: frameWidth,
                        height: frameHeight / scale,
                        transform: scale < 1 ? `scale(${scale})` : undefined,
                      }
                    : undefined
                }
              />
            </div>
          </div>
        </main>

        {mode === 'style' ? (
          <StyleMode
            key={`style-${revision}`}
            flushRef={styleFlush}
            resizer={<PanelResizer />}
            tokens={tokens}
            overridden={order
              .filter((s) => hasOwnType(s.type, s.settings, typeStyles))
              .map((s) => s.label)}
            onClearOverrides={() => {
              if (confirm('Let every section follow the site style again?')) {
                run(() => clearDraftSectionTypes())
              }
            }}
            pending={pending}
            onPreview={paintStyle}
            onCommit={(changes) => run(() => updateDraftStyles(changes))}
          />
        ) : (
          current ? (
            <Inspector
              // Rebuilt after an undo or redo, so its inputs show the restored
              // values rather than what was typed into them. See `revision`.
              key={`inspector-${revision}`}
              flushRef={inspectorFlush}
              resizer={<PanelResizer />}
              page={page}
              section={current}
              def={def}
              publicUrl={publicUrl}
              stories={stories}
              focusField={focusField}
              typeStyles={typeStyles}
              styleBase={{
                font: tokens.display_font,
                color: tokens.ink,
                bodyFont: tokens.body_font,
                bodyColor: tokens.ink_soft,
              }}
              onTypeVars={(id, vars, fonts) => tell({ type: 'type-vars', id, vars, fonts })}
              // Cropping for the phone while looking at the desktop layout is
              // guessing, so the preview follows the crop being edited.
              onDevice={(d) => setDevice(d === 'mobile' ? 'phone' : 'desktop')}
              onShowStory={(index) => tell({ type: 'hero-story', index: index ?? undefined })}
              onPatch={(field, value) => {
                if (selected) tell({ type: 'patch', id: selected, field, value })
              }}
              onLive={(field, value, spec) => {
                if (selected) tell({ type: 'live', id: selected, field, value, ...spec })
              }}
              onSettled={(id) => tell({ type: 'settle', id })}
              onSaved={() => {
                tell({ type: 'refresh' })
                router.refresh()
              }}
              onClose={() => choose(null)}
            />
          ) : (
            // Nothing selected: the page's own settings.
            <PageSettings
              key={`page-${page}-${revision}`}
              flushRef={pageFlush}
              resizer={<PanelResizer />}
              page={page}
              pageLabel={title}
              path={PAGES[page as keyof typeof PAGES]?.path ?? '/'}
              seo={seo}
              resolved={seoResolved}
              siteTitle={siteTitle}
              siteHost={siteHost}
              publicUrl={publicUrl}
              onSaved={() => router.refresh()}
            />
          )
        )}
      </div>

      {picking && (
        <AddSectionModal
          used={new Set(order.map((s) => s.type))}
          onClose={() => setPicking(null)}
          onPick={(type) => {
            const after = picking.after
            setPicking(null)
            run(async () => {
              const id = await addDraftSection(page, type, after ?? undefined)
              setSelected(id)
              tell({ type: 'select', id })
            })
          }}
        />
      )}
    </div>
  )
}
