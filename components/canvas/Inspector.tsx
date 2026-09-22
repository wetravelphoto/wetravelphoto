'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import SectionFields from '@/components/admin/SectionFields'
import { updateDraftSection, updateDraftSectionValues } from '@/app/actions/canvas'
import { contentKeys, type Field, type LiveSpec, type SectionDef } from '@/lib/sections/registry'
import HeroFocal from '@/components/canvas/editors/HeroFocal'
import HeroStories, { type StoryOption } from '@/components/canvas/editors/HeroStories'
import MarkImage from '@/components/canvas/editors/MarkImage'
import SectionType from '@/components/canvas/SectionType'
import { SEC_VARS, sectionStyle, varsFor, type SectionStyle, type TypeStyles } from '@/lib/type-styles'
import { fontHref } from '@/lib/fonts'
import type { CanvasSection } from '@/components/canvas/Canvas'

/**
 * Whatever is selected, and nothing else.
 *
 * The fields are drawn by the same SectionFields the old admin forms use, from
 * the same registry declarations — so a new section type gets a working
 * inspector for free, and a new setting is one line in lib/sections/registry.ts
 * rather than a change here.
 *
 * SAVING IS AUTOMATIC, because the draft is not the site. There is nothing to
 * protect the photographer from: the live page does not move until Publish, and
 * Discard throws the lot away. A Save button on top of that would be a second
 * commit step guarding nothing — it would only train people to think their
 * unsaved work was safe.
 */
/**
 * How long after the last keystroke the draft is written.
 *
 * The number used to matter for how the editor FELT, because nothing moved in
 * the page until the write and the refresh had both come back. Now a text edit
 * shows in the page on the keystroke itself (onPatch, below), so this only
 * governs how soon the draft is durable — and a slightly longer wait means
 * fewer writes for a sentence typed straight through.
 */
const DEBOUNCE_MS = 450

/**
 * Shorter than the text debounce: these are gestures, not typing. Long enough
 * to swallow a whole drag, short enough that letting go feels like the end of
 * the action rather than the start of a wait.
 */
const VALUE_DEBOUNCE_MS = 250

export default function Inspector({
  resizer,
  page,
  section,
  def,
  publicUrl,
  stories,
  focusField,
  typeStyles,
  styleBase,
  onPatch,
  onLive,
  onTypeVars,
  onDevice,
  onShowStory,
  onSaved,
  onSettled,
  onClose,
  flushRef,
}: {
  /** The drag handle on this panel's left edge. */
  resizer: React.ReactNode
  page: string
  section: CanvasSection | null
  def: SectionDef | null
  publicUrl: string
  /** Published stories the hero can feature. */
  stories: StoryOption[]
  /**
   * A setting clicked in the page itself — scroll to it and put the cursor in
   * it. The nonce is what makes clicking the same one twice work.
   */
  focusField: { field: string; nonce: number } | null
  /** The old shared group overrides, which a section without its own inherits. */
  typeStyles: TypeStyles
  /** What it falls back to — the site's tokens. */
  styleBase: { font: string; color: string; bodyFont: string; bodyColor: string }
  /** Text as it is typed, for the page to show immediately. */
  onPatch: (field: string, value: string) => void
  /** A design value as it moves — a slider, a layout menu. See LiveSpec. */
  onLive: (field: string, value: string, spec: LiveSpec) => void
  /** A section's typography variables, for the page to repaint at once. */
  onTypeVars: (sectionId: string, vars: Record<string, string | null>, fonts: string[]) => void
  /** Put the preview into the width whose crop is being edited. */
  onDevice: (device: 'desktop' | 'mobile') => void
  /** Bring one of the hero's stories up in the preview. */
  onShowStory: (index: number | null) => void
  onSaved: () => void
  /**
   * The newest edit to this section has been written — nothing is queued
   * behind it — so values painted on live can be handed back to the server.
   */
  onSettled: (sectionId: string) => void
  onClose: () => void
  /**
   * Filled in by this panel: writes anything still waiting on a debounce and
   * resolves once it is saved. Undo calls it first, so a half-second-old
   * keystroke cannot land AFTER the undo and quietly re-apply itself.
   */
  flushRef?: React.MutableRefObject<(() => Promise<void>) | null>
}) {
  const form = useRef<HTMLFormElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const id = section?.id ?? null

  /**
   * The pending edit, snapshotted at the moment of the keystroke rather than
   * read off the form when the timer fires.
   *
   * This matters at exactly one moment, and it is a moment that happens all
   * day: type into a field and click straight onto another section. The panel
   * is keyed by section id, so React tears the old form out of the DOM — and a
   * debounced save that reads `form.current` when it fires would find either
   * nothing or, worse, the NEW section's form, and write one section's text
   * onto another. Holding the data instead of the element means the flush
   * below has something real to send no matter what happened to the DOM.
   */
  const queued = useRef<{ id: string; data: FormData } | null>(null)

  /**
   * Custom editors save through here, coalesced.
   *
   * A focal picker fires on every mouse-move of a drag, and a story reorder
   * fires on every click — and the first version of this sent each one straight
   * to the server. Dragging a crop across an image queued sixty round trips
   * that then arrived one after another, which is why the preview appeared to
   * move frame by frame for ten seconds after the mouse stopped. The last value
   * is the only one that matters; the rest are the drag.
   */
  const valueTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const valueQueue = useRef<{ id: string; values: Record<string, unknown> } | null>(null)

  /**
   * Saves that have been sent and not yet answered. Clicking Undo takes focus
   * out of a text box, and the blur sends that box's edit — so flushNow has to
   * wait for saves already on their way, not only the ones still queued.
   */
  const inflight = useRef(new Set<Promise<unknown>>())
  const track = <T,>(work: Promise<T>): Promise<T> => {
    inflight.current.add(work)
    work.then(
      () => inflight.current.delete(work),
      () => inflight.current.delete(work)
    )
    return work
  }

  const sendValues = () => {
    if (valueTimer.current) {
      clearTimeout(valueTimer.current)
      valueTimer.current = null
    }
    const batch = valueQueue.current
    valueQueue.current = null
    if (!batch) return

    setError(null)
    startTransition(async () => {
      try {
        await track(updateDraftSectionValues(page, batch.id, batch.values))
        setSavedAt(Date.now())
        onSaved()
        if (!valueQueue.current) onSettled(batch.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save that.')
      }
    })
  }

  const saveValues = (sectionId: string, values: Record<string, unknown>) => {
    valueQueue.current = {
      id: sectionId,
      // Merged, so a drag that only moves the crop does not drop a title typed
      // a moment earlier and still waiting in the same batch.
      values: { ...(valueQueue.current?.id === sectionId ? valueQueue.current.values : {}), ...values },
    }

    if (valueTimer.current) clearTimeout(valueTimer.current)
    valueTimer.current = setTimeout(sendValues, VALUE_DEBOUNCE_MS)
  }

  const send = (target: { id: string; data: FormData }) => {
    setError(null)
    startTransition(async () => {
      try {
        await track(updateDraftSection(page, target.id, target.data))
        setSavedAt(Date.now())
        onSaved()
        if (!queued.current) onSettled(target.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save that.')
      }
    })
  }

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const pendingEdit = queued.current
    queued.current = null
    if (pendingEdit) send(pendingEdit)
  }

  const queue = (event: React.FormEvent<HTMLFormElement>) => {
    if (!form.current || !id) return

    // Straight to the page, before anything touches the network. Only plain
    // text: the preview decides what it can honestly apply, and everything else
    // arrives with the refresh after the save.
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | null
    if (
      target?.name &&
      !target.name.startsWith('__present_') &&
      (target.type === 'text' || target.tagName === 'TEXTAREA')
    ) {
      onPatch(target.name, target.value)
    }

    // A design value the page can show on the spot: sliders and layout menus
    // whose field declares exactly which property it changes. The save below
    // still happens on its usual debounce; this only stops the page waiting
    // for it.
    const spec = target?.name ? def?.fields.find((f) => f.key === target.name)?.live : undefined
    if (spec && target) onLive(target.name, target.value, spec)

    queued.current = { id, data: new FormData(form.current) }

    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, DEBOUNCE_MS)
  }

  /** Everything waiting, written now, and awaited. See flushRef. */
  const flushNow = async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (valueTimer.current) {
      clearTimeout(valueTimer.current)
      valueTimer.current = null
    }
    const pendingValues = valueQueue.current
    valueQueue.current = null
    const pendingEdit = queued.current
    queued.current = null

    if (pendingEdit) {
      await updateDraftSection(page, pendingEdit.id, pendingEdit.data)
      onSettled(pendingEdit.id)
    }
    if (pendingValues) {
      await updateDraftSectionValues(page, pendingValues.id, pendingValues.values)
      onSettled(pendingValues.id)
    }
    await Promise.allSettled([...inflight.current])
  }

  useEffect(() => {
    if (!flushRef) return
    flushRef.current = flushNow
    return () => {
      flushRef.current = null
    }
  })

  // A setting clicked in the page: bring its input into view and put the cursor
  // in it, so clicking a heading on the page is the same gesture as clicking
  // into the heading box.
  useEffect(() => {
    if (!focusField || !form.current) return

    const input = form.current.querySelector<HTMLElement>(
      `[name="${CSS.escape(focusField.field)}"]`
    )
    if (!input) return

    input.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // A frame later, so the scroll is not fought by the focus.
    const id = requestAnimationFrame(() => input.focus())
    return () => cancelAnimationFrame(id)
  }, [focusField, section?.id])

  // The selection moved or the panel closed with a keystroke still in flight.
  // Send it rather than dropping it.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      if (valueTimer.current) {
        clearTimeout(valueTimer.current)
        valueTimer.current = null
      }
      const pendingValues = valueQueue.current
      valueQueue.current = null
      if (pendingValues) {
        updateDraftSectionValues(page, pendingValues.id, pendingValues.values).catch(() => {})
      }

      const pendingEdit = queued.current
      queued.current = null
      if (pendingEdit) {
        updateDraftSection(page, pendingEdit.id, pendingEdit.data).catch(() => {
          // Nothing is left to show it on — this panel is going away. The edit
          // is lost either way if the request fails; not throwing at least
          // leaves the rest of the editor working.
        })
      }
    }
    // Deliberately keyed on the section, so the flush happens when the
    // selection changes and not on every render.

  }, [id, page])

  if (!section || !def) {
    return (
      <aside className="cv-inspector cv-inspector-empty" aria-label="Section settings">
        {resizer}
        <p className="cv-hint">
          Click a section — in the page or in the list — to edit it.
        </p>
      </aside>
    )
  }

  const preserved = contentKeys(def)

  return (
    <aside className="cv-inspector" aria-label={`${def.label} settings`}>
      {resizer}
      <div className="cv-insp-head">
        <div>
          <p className="cv-insp-label">{def.label}</p>
          <p className="cv-insp-blurb">{def.blurb}</p>
        </div>
        <button type="button" className="cv-ico" onClick={onClose} aria-label="Close settings">
          ×
        </button>
      </div>

      {error && <p className="cv-insp-error">{error}</p>}

      <form
        key={section.id}
        ref={form}
        className="cv-insp-form"
        autoComplete="off"
        onChange={queue}
        onBlur={flush}
        onSubmit={(e) => {
          e.preventDefault()
          flush()
        }}
      >
        <SectionFields
          def={def}
          settings={section.settings}
          publicUrl={publicUrl}
          collapsible
          renderCustom={(field: Field, value: unknown) => {
            // A `custom` field names the editor it needs; this is where the
            // canvas supplies one. Anything without an editor yet falls back to
            // the field's own note rather than a blank space.
            if (field.kind !== 'custom') return null

            if (field.editor === 'hero-focal') {
              return (
                <HeroFocal
                  value={value}
                  imagePath={(section.settings.image_path as string) ?? null}
                  publicUrl={publicUrl}
                  onDevice={onDevice}
                  onChange={(next) => saveValues(section.id, { [field.key]: next })}
                />
              )
            }

            if (field.editor === 'hero-stories') {
              const settings = section.settings as Record<string, unknown>
              return (
                <HeroStories
                  ids={(settings.featured_post_ids as string[]) ?? []}
                  titles={(settings.titles as Record<string, string>) ?? {}}
                  subtitles={(settings.subtitles as Record<string, string>) ?? {}}
                  focals={
                    (settings.story_focal as Record<
                      string,
                      { x: number; y: number; mx: number; my: number }
                    >) ?? {}
                  }
                  options={stories}
                  publicUrl={publicUrl}
                  onDevice={onDevice}
                  onShowStory={onShowStory}
                  onChange={(values) => saveValues(section.id, values)}
                />
              )
            }

            if (field.editor === 'typography') {
              const current = sectionStyle(section.type, section.settings, typeStyles)
              return (
                <SectionType
                  style={current}
                  base={styleBase}
                  hasEyebrow={def.fields.some((f) => f.key === 'eyebrow' || f.key === 'kicker')}
                  onChange={(next: SectionStyle | null) => {
                    // Painted on the page at once — varsFor is what the renderer
                    // uses, so this is the identity — then saved, coalesced.
                    const vars = varsFor(next ?? {})
                    const all: Record<string, string | null> = {}
                    for (const name of SEC_VARS) all[name] = vars[name] ?? null
                    const fonts = [next?.font, next?.bodyFont, next?.eyebrowFont]
                      .filter((f): f is string => !!f)
                      .map(fontHref)
                    onTypeVars(section.id, all, fonts)
                    // {} rather than null: "follow the site" must not fall back to
                    // an old shared group override.
                    saveValues(section.id, { [field.key]: next ?? {} })
                  }}
                />
              )
            }

            if (field.editor === 'mark-image') {
              return (
                <MarkImage
                  value={value}
                  publicUrl={publicUrl}
                  onChange={(path) => saveValues(section.id, { [field.key]: path })}
                />
              )
            }

            return null
          }}
        />
      </form>

      <div className="cv-insp-foot">
        <span className="cv-insp-state" aria-live="polite">
          {pending ? 'Saving…' : savedAt ? 'Saved to draft' : 'Changes save as you type'}
        </span>
        {preserved.length > 0 && (
          <span className="cv-insp-note">
            Your writing and photographs here are yours — switching look never replaces them.
          </span>
        )}
      </div>
    </aside>
  )
}
