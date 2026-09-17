'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { sectionDef, type SectionSettings } from '@/lib/sections/registry'
import {
  addDraftSection,
  applyDraftPairing,
  applyDraftPalette,
  discard,
  publish,
  removeDraftSection,
  reorderDraft,
  resetDraftStyles,
  setDraftVisible,
  clearDraftSectionTypes,
  updateDraftSectionType,
  updateDraftStyles,
} from '@/app/actions/canvas'
import { cssVariables, fontsToLoad, type StyleTokens } from '@/lib/styles/tokens'
import { styleFor, type StyledSection, type TypeStyles } from '@/lib/type-styles'
import { fontHref } from '@/lib/fonts'
import SectionRail from '@/components/canvas/SectionRail'
import Inspector from '@/components/canvas/Inspector'
import AddSectionModal from '@/components/canvas/AddSectionModal'
import PresetRail from '@/components/canvas/PresetRail'
import StyleMode from '@/components/canvas/StyleMode'
import PanelResizer from '@/components/canvas/PanelResizer'
import type { StoryOption } from '@/components/canvas/editors/HeroStories'

export type CanvasSection = {
  id: string
  type: string
  label: string
  blurb: string
  permanent: boolean
  visible: boolean
  settings: SectionSettings
}

type Device = 'desktop' | 'tablet' | 'phone'
type Mode = 'content' | 'style'

const WIDTHS: Record<Device, number | null> = { desktop: null, tablet: 820, phone: 390 }

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
  publicUrl,
  tokens,
  typeStyles,
  stories,
  initialMode = 'content',
}: {
  page: string
  title: string
  sections: CanvasSection[]
  legacy: boolean
  missing: boolean
  hasDraft: boolean
  draftUpdatedAt: string | null
  publicUrl: string
  /** The draft's style if it has any, otherwise the live site's. */
  tokens: StyleTokens
  /** Per-section overrides, from the draft if there is one. */
  typeStyles: TypeStyles
  /** Published stories the hero can feature. */
  stories: StoryOption[]
  initialMode?: Mode
}) {
  const router = useRouter()
  const frame = useRef<HTMLIFrameElement>(null)
  const [pending, startTransition] = useTransition()

  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [device, setDevice] = useState<Device>('desktop')
  const [picking, setPicking] = useState(false)
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
      vars?: Record<string, string>
      fonts?: string[]
      index?: number
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
          <span className="cv-title">{title}</span>
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
            onAdd={() => setPicking(true)}
          />
        )}

        <main className="cv-stage">
          <div className="cv-frame-wrap" data-device={device}>
            <iframe
              ref={frame}
              className="cv-frame"
              src={`/preview/${page}`}
              title={`${title} preview`}
              style={WIDTHS[device] ? { width: WIDTHS[device]! } : undefined}
            />
          </div>
        </main>

        {mode === 'style' ? (
          <StyleMode
            resizer={<PanelResizer />}
            tokens={tokens}
            overriddenGroups={Object.keys(typeStyles).filter(
              (g) => Object.keys(typeStyles[g] ?? {}).length > 0
            )}
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
          <Inspector
            resizer={<PanelResizer />}
            page={page}
            section={current}
            def={def}
            publicUrl={publicUrl}
            stories={stories}
            focusField={focusField}
            sectionStyle={def?.styled ? styleFor(typeStyles, def.styled) : {}}
            styleBase={{
              font: tokens.display_font,
              color: tokens.ink,
              bodyFont: tokens.body_font,
              bodyColor: tokens.ink_soft,
            }}
            onType={(group, changes) =>
              run(() => updateDraftSectionType(group as StyledSection, changes))
            }
            // Cropping for the phone while looking at the desktop layout is
            // guessing, so the preview follows the crop being edited.
            onDevice={(d) => setDevice(d === 'mobile' ? 'phone' : 'desktop')}
            onShowStory={(index) => tell({ type: 'hero-story', index: index ?? undefined })}
            onPatch={(field, value) => {
              if (selected) tell({ type: 'patch', id: selected, field, value })
            }}
            onSaved={() => {
              tell({ type: 'refresh' })
              router.refresh()
            }}
            onClose={() => choose(null)}
          />
        )}
      </div>

      {picking && (
        <AddSectionModal
          used={new Set(order.map((s) => s.type))}
          onClose={() => setPicking(false)}
          onPick={(type) => {
            setPicking(false)
            run(async () => {
              const id = await addDraftSection(page, type, selected ?? undefined)
              setSelected(id)
            })
          }}
        />
      )}
    </div>
  )
}
