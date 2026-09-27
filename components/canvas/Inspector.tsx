'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import SectionFields from '@/components/admin/SectionFields'
import { updateDraftSection, updateDraftSectionValues } from '@/app/actions/canvas'
import {
  contentKeys,
  deviceView,
  liveFor,
  type Field,
  type LiveSpec,
  type SectionDef,
} from '@/lib/sections/registry'
import { overrideValue } from '@/lib/sections/backdrop'
import HeroFocal from '@/components/canvas/editors/HeroFocal'
import HeroStories, { type StoryOption } from '@/components/canvas/editors/HeroStories'
import SpotPicker from '@/components/canvas/editors/SpotPicker'
import ShownPicker from '@/components/canvas/editors/ShownPicker'
import MarkImage from '@/components/canvas/editors/MarkImage'
import ImageField from '@/components/canvas/ImageField'
import TextStylePanel, { describeTextStyle } from '@/components/canvas/editors/TextStylePanel'
import Customize from '@/components/canvas/editors/Customize'
import DeviceSwitcher, { type PreviewDevice } from '@/components/canvas/DeviceSwitcher'
import { DEFAULT_SPOT, PLACEABLE, describeSpot, spotPair, type SpotPair } from '@/lib/sections/spots'
import { SHOWN_LABEL, shownBag, withShown, type Shown } from '@/lib/sections/shown'
import { SEC_VARS, ownStyle, sectionStyle, type TypeStyles } from '@/lib/type-styles'
import {
  TEXT_VARS,
  effectiveTextStyle,
  overrideAgainst,
  textStyleVars,
  textStyles,
  withTextStyle,
  type TextStyle,
  type TextStyles,
} from '@/lib/sections/text-style'
import {
  BASE_DEVICE,
  DEVICE_LABEL,
  deviceKey,
  type Device,
} from '@/lib/sections/devices'
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
/**
 * Which of the section's three typography roles each piece of text follows —
 * for the "Following (…)" labels in its panel, and nothing else. Anything not
 * listed reads as body text, which is the common case.
 */
/**
 * Has this piece of copy been PUT somewhere, as opposed to left where it
 * started? On a phone, "put somewhere" means given a place of its own rather
 * than following the desktop.
 */
function changedPlace(pair: SpotPair, device: Device): boolean {
  return device === BASE_DEVICE ? pair.desktop !== DEFAULT_SPOT : pair.mobile !== null
}

/**
 * The closed button's right-hand side: what has been done to this text, in a
 * few words.
 *
 * One button now stands for three panels, so the summary has to cover all
 * three without becoming a sentence. Typography first because it is what
 * changes most, then the place, then where it appears — and capped at three
 * parts, because a row that wraps has stopped being a row.
 */
function describeAll(
  style: TextStyle | null,
  followingFont: string,
  pair: SpotPair | null,
  seen: Shown,
  device: Device
): string {
  const parts: string[] = []
  if (style && Object.keys(style).length > 0) {
    parts.push(...describeTextStyle(style, followingFont).split(' · '))
  }
  if (pair && changedPlace(pair, device)) {
    parts.push(describeSpot(device === BASE_DEVICE ? pair.desktop : pair.effectiveMobile))
  }
  if (seen !== 'all') parts.push(SHOWN_LABEL[seen])

  if (parts.length === 0) return 'Default'
  return parts.slice(0, 3).join(' · ')
}

const HEADINGS = new Set(['title', 'heading'])
const OVERLINES = new Set(['eyebrow', 'kicker', 'subheading'])

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
  onMoveSpot,
  onTypeVars,
  onTextVars,
  onShown,
  editing,
  previewDevice,
  onPreviewDevice,
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
  /**
   * A hero placement chosen in the panel. The preview carries the element to
   * the new place at once — by a transform, never by re-parenting — so the
   * picker feels like the drag rather than like waiting.
   */
  onMoveSpot: (field: string, value: string) => void
  /** A section's typography variables, for the page to repaint at once. */
  onTypeVars: (sectionId: string, vars: Record<string, string | null>, fonts: string[]) => void
  /**
   * ONE PIECE OF TEXT'S typography, for the page to repaint at once. The same
   * channel as onTypeVars one line up, scoped to the element rather than the
   * section: the preview writes exactly the custom properties the renderer
   * would have written, on the element carrying that field's name.
   */
  onTextVars: (
    sectionId: string,
    field: string,
    vars: Record<string, string | null>,
    fonts: string[]
  ) => void
  /**
   * A piece of text's visibility, for the page to show at once. `data-at` is
   * the whole of what it changes — see the handler in PreviewBridge.
   */
  onShown: (sectionId: string, field: string, at: string) => void
  /**
   * WHICH SIZE EVERY CONTROL IN HERE IS EDITING.
   *
   * Chosen by the one switcher at the top of the editor, which also sets the
   * preview's width — so what is on screen and what is being changed are the
   * same thing by construction rather than by remembering.
   */
  editing: Device
  /** The preview's own width, so the panel's switcher shows the same answer. */
  previewDevice: PreviewDevice
  onPreviewDevice: (next: PreviewDevice) => void
  /** Bring one of the hero's stories up in the preview. */
  onShowStory: (index: number | null) => void
  /**
   * A save has landed.
   *
   * `quiet` means the preview ALREADY shows this correctly, because the change
   * went out on a live channel first — so there is nothing for a re-render to
   * add, and asking for one is a round trip whose only visible effect is a
   * flicker as the page redraws through its cached state on the way back.
   */
  onSaved: (quiet?: boolean) => void
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
  const queued = useRef<{ id: string; data: FormData; quiet: boolean } | null>(null)

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
  const valueQueue = useRef<{
    id: string
    values: Record<string, unknown>
    /**
     * Every change in this batch was painted on the page before it was sent,
     * so the server has nothing to tell the preview that it does not already
     * show. One change that was not resets it for the whole batch: they are
     * saved together and a re-render is all-or-nothing.
     */
    quiet: boolean
  } | null>(null)

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
        onSaved(batch.quiet)
        if (!valueQueue.current) onSettled(batch.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save that.')
      }
    })
  }

  /**
   * @param painted The preview already shows this — see `quiet` on the queue.
   *   Left false by default: a control that does NOT paint its own change is
   *   the common case, and being wrong in that direction costs a re-render
   *   nobody notices, while being wrong the other way leaves the page showing
   *   something that is not what was saved.
   */
  const saveValues = (
    sectionId: string,
    values: Record<string, unknown>,
    painted = false
  ) => {
    const same = valueQueue.current?.id === sectionId
    valueQueue.current = {
      id: sectionId,
      // Merged, so a drag that only moves the crop does not drop a title typed
      // a moment earlier and still waiting in the same batch.
      values: { ...(same ? valueQueue.current!.values : {}), ...values },
      quiet: painted && (!same || valueQueue.current!.quiet),
    }

    if (valueTimer.current) clearTimeout(valueTimer.current)
    valueTimer.current = setTimeout(sendValues, VALUE_DEBOUNCE_MS)
  }

  /**
   * THE `text` BAG AS THIS PANEL LAST LEFT IT.
   *
   * Every piece of text in a section shares one settings key, so saving one
   * element's typography means writing the WHOLE bag — and the obvious way to
   * build it, reading `section.settings` each time, is wrong by about half a
   * second. Style the title, then style the sub-heading before the first save
   * has come back and re-rendered: the second write reads a `section.settings`
   * that still predates the first, rebuilds the bag without the title in it,
   * and the title's typography is gone. `saveValues` merges by KEY, so the
   * second `text` simply replaces the first — the merge cannot save this.
   *
   * Holding what was last written closes that window. It is dropped whenever
   * the panel is rebuilt, which is what Undo does (Canvas keys this component
   * on `revision`), so it can never outlive the values it describes.
   */
  const textBag = useRef<{ id: string; device: Device; bag: TextStyles } | null>(null)

  /** The bag this panel last wrote for a section AND a device, or the stored one. */
  const currentBag = (sectionId: string, device: Device): TextStyles =>
    textBag.current?.id === sectionId && textBag.current.device === device
      ? textBag.current.bag
      : textStyles(section?.settings ?? {}, device)

  const saveTextStyle = (sectionId: string, field: string, next: TextStyle | null) => {
    /*
     * ON A NARROWER DEVICE, ONLY THE DIFFERENCE IS STORED.
     *
     * The panel shows the EFFECTIVE style — desktop with this device's
     * overrides on top — so `next` arrives complete, most of it the desktop
     * values showing through. Storing that whole object would freeze the
     * inherited half: change the desktop typeface afterwards and the phone
     * would keep the old one, having copied it the moment anything else was
     * touched. Storing the difference is what keeps "follows until you change
     * it" true after the first change.
     */
    const stored =
      editing === BASE_DEVICE
        ? next
        : overrideAgainst(textStyles(section?.settings ?? {}, BASE_DEVICE)[field] ?? null, next)

    const bag = withTextStyle(currentBag(sectionId, editing), field, stored)
    textBag.current = { id: sectionId, device: editing, bag }
    saveValues(sectionId, { [deviceKey('text', editing)]: bag }, true)
  }

  const send = (target: { id: string; data: FormData; quiet: boolean }) => {
    setError(null)
    startTransition(async () => {
      try {
        await track(updateDraftSection(page, target.id, target.data))
        setSavedAt(Date.now())
        onSaved(target.quiet)
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
    const isText =
      !!target?.name &&
      !target.name.startsWith('__present_') &&
      (target.type === 'text' || target.tagName === 'TEXTAREA')
    if (isText && target) onPatch(target.name, target.value)

    // A design value the page can show on the spot: sliders and layout menus
    // whose field declares exactly which property it changes. The save below
    // still happens on its usual debounce; this only stops the page waiting
    // for it.
    /*
     * Which property this paints depends on the SIZE being edited: an element
     * that can differ by size carries both values at once under two names and
     * the stylesheet picks between them at the breakpoint. See `liveFor`.
     */
    const changed = target?.name ? def?.fields.find((f) => f.key === target.name) : undefined
    const spec = changed ? liveFor(changed, editing) : undefined
    if (spec && target) onLive(target.name, target.value, spec)

    /*
     * Did the page already get this?
     *
     * Typing and a `live` field both reach the preview before the network
     * does, so the save that follows has nothing to add — and the re-render it
     * used to trigger is what made a slider judder and a change of case flash
     * back to the old value and forward again on every keystroke's worth of
     * debounce. Anything else still needs the server to draw it.
     *
     * One unpainted change in the batch makes the whole batch loud: they save
     * together, and a re-render is all or nothing.
     */
    const painted = isText || !!spec
    queued.current = {
      id,
      data: new FormData(form.current),
      quiet: painted && (queued.current?.id !== id || queued.current.quiet),
    }

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

  /**
   * THE SETTINGS AS THE SIZE BEING EDITED SEES THEM.
   *
   * Per-device fields resolved: the phone's own value where it has one, the
   * desktop's showing through where it does not. Everything below reads this
   * rather than `section.settings`, so a control cannot show one size's value
   * while writing another's.
   */
  const view = deviceView(def, section.settings, editing)

  /**
   * A value from a custom editor — an image picker, a focal point — saved
   * under the right size's key.
   *
   * The form path does this in lib/sections/form.ts; these save outside the
   * form, so they need the same rule: on a narrower size, store only what
   * DIFFERS from the desktop, and null when it matches, because null is
   * "following" and a copy is a freeze.
   */
  const saveField = (field: Field, value: unknown) => {
    if (!field.device || editing === BASE_DEVICE) {
      saveValues(section.id, { [field.key]: value })
      return
    }
    saveValues(section.id, {
      [deviceKey(field.key, editing)]: overrideValue(section.settings[field.key], value),
    })
  }

  /**
   * WHETHER THIS SIZE HAS AN ANSWER OF ITS OWN.
   *
   * Drawn only on a narrower size, and only for settings that can differ —
   * on the desktop every control is its own and a badge saying so on all six
   * would be noise. Which leaves the one question worth answering: am I
   * looking at the phone's photograph or the desktop's?
   */
  const deviceBadge = (field: Field) => {
    if (editing === BASE_DEVICE) return null
    const own = section.settings[deviceKey(field.key, editing)]
    const following = own === null || own === undefined

    return (
      <p className="cv-follow" data-own={!following || undefined}>
        <span>
          {following
            ? `Following ${DEVICE_LABEL[BASE_DEVICE].toLowerCase()}`
            : `${DEVICE_LABEL[editing]} only`}
        </span>
        {!following && (
          <button
            type="button"
            onClick={() => {
              // Null, not the desktop's value: following has to stay absent to
              // stay following.
              saveValues(section.id, { [deviceKey(field.key, editing)]: null })
              sendValues()
            }}
          >
            Follow {DEVICE_LABEL[BASE_DEVICE].toLowerCase()}
          </button>
        )}
      </p>
    )
  }

  const preserved = contentKeys(def)
  /** A section-wide typography override from before per-element replaced it. */
  const legacyType = ownStyle(section.settings) !== null

  /**
   * A HERO HIDDEN ON ONE SIZE, FROM BEFORE ITS COPY COULD BE HIDDEN PIECE BY
   * PIECE.
   *
   * The hero's "Show on" went away because each piece of text now says where
   * it belongs, and what was left underneath was a photograph — which you
   * hide by removing the hero, not by hiding it. But a site that had already
   * used it is still wearing the result, with nothing on screen to explain
   * why the hero vanishes on a phone.
   *
   * Shown only where one is set, and once cleared it never comes back.
   */
  const heroHidden =
    def.type === 'hero' &&
    !def.fields.some((f) => f.key === 'hide_on') &&
    typeof section.settings.hide_on === 'string' &&
    section.settings.hide_on !== 'none'

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

      {/*
        * The same switcher as the top of the editor, icons only.
        *
        * Not a second control — it writes the same state — but a second place
        * to see it. The one at the top is easy to miss while you are looking
        * down at a slider, and finding out afterwards that you styled the
        * wrong size costs ten minutes and some trust.
        */}
      <div className="cv-insp-device">
        <DeviceSwitcher value={previewDevice} onChange={onPreviewDevice} size="compact" />
        <span className="cv-insp-device-now">
          Editing {previewDevice === 'tablet' ? 'desktop' : DEVICE_LABEL[editing].toLowerCase()}
        </span>
      </div>

      {error && <p className="cv-insp-error">{error}</p>}

      <form
        /*
         * Keyed by the SIZE as well as the section.
         *
         * The panel is handed one size's view of the settings and most of its
         * inputs are uncontrolled, so switching from desktop to phone has to
         * rebuild the form or every box would keep showing the desktop's
         * values while writing the phone's.
         */
        key={`${section.id}:${editing}`}
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
          /*
           * THIS SIZE'S VIEW, not the raw settings.
           *
           * Per-device fields resolved to what the phone actually draws — the
           * desktop's value showing through wherever the phone has none of
           * its own — under their plain keys, so the panel, its `when`
           * conditions and the form read all stay in one vocabulary. Only
           * `formDevice` in lib/sections/form.ts and `saveField` below know
           * that a phone twin exists.
           */
          settings={view}
          device={editing}
          deviceBadge={deviceBadge}
          publicUrl={publicUrl}
          collapsible
          renderTextStyle={(field: Field) => {
            /*
             * What this text looks like ON THE SIZE BEING EDITED: the desktop
             * values with this device's overrides laid over them. The panel
             * shows and edits that, so a phone that has changed only its size
             * still shows the desktop typeface rather than an empty control
             * that pretends nothing is set.
             *
             * Read from the panel's own copy first, for the same reason
             * saveTextStyle writes to it: two elements styled in quick
             * succession must not each start from a stale bag.
             */
            const live = textBag.current?.id === section.id && textBag.current.device === editing
              ? textBag.current.bag[field.key] ?? null
              : null
            const stored = effectiveTextStyle(section.settings, field.key, editing)
            const shown =
              live !== null && editing !== BASE_DEVICE
                ? { ...(textStyles(section.settings, BASE_DEVICE)[field.key] ?? {}), ...live }
                : live ?? stored

            // What it falls back to, for the "Following (…)" labels. The
            // section's own typography wins over the site's, which is the same
            // order the CSS cascade puts them in.
            //
            // This is a LABEL, not a value: nothing here is stored, and a
            // wrong guess shows the wrong name beside "Following" rather than
            // changing anything. Which is why a key list is enough — the three
            // roles are a property of how each renderer draws its text, and
            // the registry does not record it.
            const own = sectionStyle(section.type, section.settings, typeStyles)
            const role = HEADINGS.has(field.key)
              ? 'heading'
              : OVERLINES.has(field.key)
                ? 'eyebrow'
                : 'body'

            const base =
              role === 'heading'
                ? { font: own.font ?? styleBase.font, color: own.color ?? styleBase.color }
                : role === 'eyebrow'
                  ? {
                      font: own.eyebrowFont ?? own.font ?? styleBase.font,
                      color: own.eyebrowColor ?? styleBase.color,
                    }
                  : {
                      font: own.bodyFont ?? styleBase.bodyFont,
                      color: own.bodyColor ?? styleBase.bodyColor,
                    }

            /*
             * THE PLACEMENT THAT BELONGS TO THIS TEXT, IF ANY.
             *
             * PLACEABLE maps each spot setting to the piece of copy it moves,
             * and those settings are no longer fields of their own — a
             * placement is one of three things you do to a piece of text, not
             * a row sitting below it pretending to be unrelated.
             */
            const placeable = PLACEABLE.find((p) => p.field === field.key)
            const pair = placeable ? spotPair(section.settings, placeable.key) : null
            const seen = shownBag(section.settings)[field.key] ?? 'all'

            return (
              <Customize
                label={field.label}
                device={editing}
                deviceName={DEVICE_LABEL[editing]}
                summary={describeAll(shown, base.font, pair, seen, editing)}
                quiet={shown === null && seen === 'all' && (pair === null || !changedPlace(pair, editing))}
                type={
                  <TextStylePanel
                    label={field.label}
                    button={field.button}
                    device={editing}
                    inheriting={
                      editing !== BASE_DEVICE &&
                      (currentBag(section.id, editing)[field.key] ?? null) === null &&
                      stored !== null
                    }
                    value={shown}
                    base={base}
                    onChange={(next) => {
                      // Painted on the page first: textStyleVars is what the
                      // renderer writes, so setting the same properties to the
                      // same values is the identity rather than a second
                      // renderer. Every property this can set is sent on every
                      // change, the unset ones as null, or clearing one would
                      // leave the last value stranded until the re-render.
                      const vars = textStyleVars(next)
                      const all: Record<string, string | null> = {}
                      for (const name of TEXT_VARS) all[name] = vars[name] ?? null
                      onTextVars(
                        section.id,
                        field.key,
                        all,
                        next?.family ? [fontHref(next.family)] : []
                      )
                      saveTextStyle(section.id, field.key, next)
                    }}
                  />
                }
                place={
                  placeable && pair ? (
                    <SpotPicker
                      pair={pair}
                      device={editing}
                      deviceName={DEVICE_LABEL[editing]}
                      label={field.label}
                      onFollow={() => {
                        // Null, not a place: following has to stay absent to
                        // stay following. See `spotPair`.
                        saveValues(section.id, { [deviceKey(placeable.key, editing)]: null })
                        sendValues()
                      }}
                      onChange={(next) => {
                        /*
                         * Sent at once rather than on the usual debounce. The
                         * element is moved by the server's render — the
                         * preview cannot move it itself without re-parenting a
                         * node React owns, which crashes the page — so the
                         * round trip IS the feedback, and half a second of
                         * debounce on top of it is what made this feel broken.
                         */
                        onMoveSpot(placeable.key, next)
                        saveValues(section.id, { [deviceKey(placeable.key, editing)]: next })
                        sendValues()
                      }}
                    />
                  ) : undefined
                }
                shown={
                  /*
                   * Not governed by the switcher at the top, unlike the other
                   * two: it is ABOUT the sizes, so it names all of them at
                   * once rather than taking two visits to say one thing.
                   *
                   * Waits for the re-render rather than being painted live —
                   * the element is being added to or removed from the page,
                   * which is more than one property and so not something a
                   * patch may express. See LiveSpec in the registry.
                   */
                  <ShownPicker
                    label={field.label}
                    value={seen}
                    onChange={(next: Shown) => {
                      /*
                       * Painted first, where it can be.
                       *
                       * `data-at` is the whole of what this changes on an
                       * element that is drawn ONCE — which is every piece of
                       * text whose two places agree, and all of them until
                       * somebody moves one on the phone. Where the places
                       * differ the element exists twice, and which copy
                       * survives is a question about both at once; that case
                       * waits for the server rather than being guessed at.
                       */
                      const single = pair === null || !pair.differs
                      if (single) onShown(section.id, field.key, next === 'all' ? '' : next)
                      saveValues(
                        section.id,
                        { shown: withShown(shownBag(section.settings), field.key, next) },
                        single
                      )
                      sendValues()
                    }}
                  />
                }
              />
            )
          }}
          renderImage={(field: Field, value: unknown, set) => (
            <ImageField
              name={field.key}
              label={field.label}
              value={typeof value === 'string' && value ? value : null}
              publicUrl={publicUrl}
              note={field.kind === 'image' ? field.help : undefined}
              onChange={(path) => {
                // Written into the panel's own copy so a `when` on this field
                // re-evaluates now, and saved straight away rather than waiting
                // for a keystroke somewhere else in the form.
                set(field.key, path ?? '')
                saveField(field, path)
              }}
            />
          )}
          renderCustom={(field: Field, value: unknown) => {
            // A `custom` field names the editor it needs; this is where the
            // canvas supplies one. Anything without an editor yet falls back to
            // the field's own note rather than a blank space.
            if (field.kind !== 'custom') return null

            if (field.editor === 'hero-focal') {
              return (
                <HeroFocal
                  value={value}
                  // The photograph THIS SIZE shows — cropping the desktop's
                  // picture while looking at a different one on the phone is
                  // the kind of thing nobody notices until it ships.
                  imagePath={(view.image_path as string) ?? null}
                  publicUrl={publicUrl}
                  device={editing}
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
                  device={editing}
                  onShowStory={onShowStory}
                  onChange={(values) => saveValues(section.id, values)}
                />
              )
            }

            if (field.editor === 'spot') {
              const pair = spotPair(section.settings, field.key)
              // The phone's place lives beside the desktop's, under its own
              // key, so moving one can never write the other.
              const storeAt = deviceKey(field.key, editing)
              return (
                <SpotPicker
                  pair={pair}
                  device={editing}
                  deviceName={DEVICE_LABEL[editing]}
                  label={field.label}
                  onFollow={() => {
                    // Null, not a place: following has to stay absent to stay
                    // following. See `spotPair`.
                    saveValues(section.id, { [storeAt]: null })
                    sendValues()
                  }}
                  onChange={(next) => {
                    /*
                     * Sent at once rather than on the usual debounce.
                     *
                     * The element is moved by the server's render — the
                     * preview cannot move it itself without re-parenting a
                     * node React owns, which crashes the page — so the round
                     * trip IS the feedback, and half a second of debounce on
                     * top of it is what made this feel broken.
                     */
                    onMoveSpot(field.key, next)
                    saveValues(section.id, { [storeAt]: next })
                    sendValues()
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

      {heroHidden && (
        <div className="cv-insp-legacy">
          <p>
            This hero is hidden on some screens, set before each piece of text
            could say where it belongs.
          </p>
          <button
            type="button"
            onClick={() => {
              onLive('hide_on', 'none', { attr: 'data-hide' })
              saveValues(section.id, { hide_on: 'none' })
              sendValues()
            }}
          >
            Show it everywhere
          </button>
        </div>
      )}

      {legacyType && (
        /*
         * THIS SECTION SET ITS OWN TYPOGRAPHY BEFORE THE CONTROL WENT AWAY.
         *
         * Per-element typography replaced the section-wide kind, and the
         * panel for it is gone — but a site that had already used it is still
         * wearing the result, with nothing on screen to say why its headings
         * ignore the look. Removing a control without leaving a way to undo
         * what it did is how a setting becomes permanent by accident.
         *
         * Shown only where one exists, and once cleared it never comes back.
         */
        <div className="cv-insp-legacy">
          <p>
            This section still carries typography of its own, set before each
            piece of text had its own. It overrides the look for every heading
            in here.
          </p>
          <button
            type="button"
            onClick={() => {
              const all: Record<string, string | null> = {}
              for (const name of SEC_VARS) all[name] = null
              onTypeVars(section.id, all, [])
              // {} rather than null: "follow the site" must not fall back to
              // an old shared group override.
              saveValues(section.id, { type: {} })
              sendValues()
            }}
          >
            Follow the look again
          </button>
        </div>
      )}

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
