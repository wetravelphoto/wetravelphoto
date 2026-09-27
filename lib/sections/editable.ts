import type { CSSProperties } from 'react'
import type { SectionContext } from '@/lib/sections/context'
import { deviceTextStyleVars } from '@/lib/sections/text-style'

/**
 * MARKS A PIECE OF TEXT AS A SETTING
 * ══════════════════════════════════
 *
 * Spread onto whatever element draws a setting:
 *
 *     <h2 {...editable(ctx, 'heading')}>{heading}</h2>
 *
 * In the editor's preview this becomes `data-field="heading"`, and three things
 * follow from it: hovering that heading outlines it rather than the whole
 * section, clicking it opens the section AND jumps to that field in the right
 * panel, and typing in that field updates this exact element with no round trip
 * to the server.
 *
 * Off the editor it renders nothing at all, so the public page carries no trace
 * of the field names.
 *
 * WHY THE INSTANT UPDATE IS NOT A LIE. Patching the page from the editor is
 * normally the thing to avoid — a second, hand-written renderer that drifts
 * from the real one. This is the narrow exception: for a plain text setting the
 * server's output IS the string, so writing the string into the element is the
 * identity, not a re-implementation. Anything cleverer than that — a heading
 * that gets title-cased, a date that gets formatted, a value that changes the
 * layout — must not be patched, and is not: the server refresh that follows a
 * moment later is what makes every other kind of change appear.
 *
 * So: only put this on an element whose entire content is the setting's own
 * text, unchanged.
 */
export function editable(ctx: SectionContext, key: string): Record<string, string> {
  return ctx.editable ? { 'data-field': key } : {}
}

/**
 * Marks the element that carries these settings' live properties — the data
 * attribute or CSS variable each one declares in its field's `live`. The
 * renderer must write that property itself, on this same element; the preview
 * only ever changes a value the server has already put there. See LiveSpec in
 * lib/sections/registry.ts.
 */
export function live(ctx: SectionContext, keys: string[]): Record<string, string> {
  return ctx.editable ? { 'data-live': keys.join(' ') } : {}
}

/**
 * Marks the element a section's typography variables are written on, so the
 * editor can repaint them while a font or size is being chosen. Must be the
 * element that has `style={sectionVars(...)}`: an inline property on a child
 * would beat one set on its parent.
 */
export function typeRoot(ctx: SectionContext): Record<string, string> {
  return ctx.editable ? { 'data-type-root': '' } : {}
}

/**
 * A PIECE OF TEXT THAT CAN BE SELECTED *AND* STYLED
 * ═════════════════════════════════════════════════
 *
 *     <h2 className="intro-heading" {...styledText(ctx, settings, 'heading')}>
 *
 * Everything `editable` above does, plus this text's own typography — the
 * `--txt-*` custom properties chosen in the panel beside its box.
 *
 * The two belong in one call because they must land on the SAME element and
 * neither works alone. The editor finds the text by `data-field`, and the
 * live-update channel writes the properties to `[data-field="…"]`; put the
 * style on a wrapper and the first keystroke in the panel would repaint the
 * wrapper while the save repaints the text, so they would disagree until the
 * next render. One call, one element, no way to do half of it.
 *
 * Note that the STYLE is returned on the public page too, while `data-field`
 * is not: the typography is the visitor's to see, the field name is the
 * editor's business.
 *
 * Three conditions, all of which the registry's `textStyle` flag documents:
 * the section's defaults must contain `text: {}`, this key must be flagged,
 * and the element's CSS rule must read `--txt-*` ahead of its own value. Miss
 * the last one and the panel stores a choice that changes nothing — which is
 * the only failure here that is completely silent.
 */
export function styledText(
  ctx: SectionContext,
  settings: Record<string, unknown>,
  key: string
): { 'data-field'?: string; 'data-txt'?: string; style?: CSSProperties } {
  const style = deviceTextStyleVars(settings, key) as CSSProperties
  /*
   * `data-txt` is ALWAYS here, on the public page as well, and it is not
   * decoration: it is what the resolver in app/globals.css selects, the rule
   * that turns this element's --txtd- and --txtm- properties into the --txt- its own
   * stylesheet reads. Without it the properties sit on the element and
   * nothing looks at them.
   *
   * It is also on an element with no typography at all, deliberately. The
   * resolver then sets every --txt-* to a var() of something unset, which
   * computes to invalid and makes each rule fall through to its own value —
   * so an element with nothing of its own is isolated from an ancestor that
   * has something, instead of quietly inheriting it.
   */
  return ctx.editable
    ? { 'data-field': key, 'data-txt': '', style }
    : { 'data-txt': '', style }
}
