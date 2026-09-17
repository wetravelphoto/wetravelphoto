import type { SectionContext } from '@/lib/sections/context'

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
