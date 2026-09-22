/**
 * THE EDITOR'S KEYBOARD SHORTCUTS
 * ═══════════════════════════════
 *
 * One list, read by two documents. The editor is the page; the preview is an
 * iframe inside it. A key pressed with the preview focused is heard only by
 * the preview, and a key pressed in the rail only by the editor — so both
 * listen, both read the event with the function below, and the preview
 * forwards what it finds to the editor (PreviewBridge → Canvas). Keeping the
 * reading in one place is what stops the two sides drifting apart, which is
 * how a shortcut ends up working in one half of the screen and not the other.
 *
 * What is deliberately NOT here: what each shortcut does. The preview has no
 * idea whether anything is selected or whether a window is open; it only
 * names the key. The editor decides whether to act (`runShortcut` in
 * Canvas.tsx), and nothing is prevented unless it did.
 */

export type Shortcut =
  /** Ctrl/⌘+Z, and Ctrl/⌘+Shift+Z or Ctrl+Y. */
  | 'undo'
  | 'redo'
  /** Ctrl/⌘+D on the selected section. */
  | 'duplicate'
  /** Delete or Backspace on the selected section. */
  | 'remove'
  /** Esc. */
  | 'deselect'
  /** ↑ / ↓ between sections. */
  | 'prev'
  | 'next'

/**
 * How each one reads in a tooltip.
 *
 * Deliberately names both modifiers rather than asking the browser which
 * machine this is: the editor is rendered on the server first, and a tooltip
 * that says ⌘ on one pass and Ctrl on the next is a hydration mismatch for
 * the sake of a character.
 */
export function shortcutHint(name: Shortcut): string {
  switch (name) {
    case 'undo':
      return 'Ctrl/⌘ Z'
    case 'redo':
      return 'Ctrl/⌘ Shift Z'
    case 'duplicate':
      return 'Ctrl/⌘ D'
    case 'remove':
      return 'Del or ⌫'
    case 'deselect':
      return 'Esc'
    case 'prev':
      return '↑'
    case 'next':
      return '↓'
  }
}

/**
 * The shortcut this key press means, or null.
 *
 * **A text field keeps its own keys.** Typing Backspace in the heading field
 * must delete a letter, not the section, and ⌘Z there must undo the typing —
 * so anything aimed at an input, textarea, select or contenteditable is not a
 * shortcut at all. That includes the contact form inside the preview.
 *
 * Alt is never part of a shortcut here: on several keyboard layouts it is how
 * ordinary characters are typed.
 */
export function readShortcut(event: KeyboardEvent): Shortcut | null {
  if (event.altKey || event.isComposing) return null

  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return null

  if (event.metaKey || event.ctrlKey) {
    const key = event.key.toLowerCase()
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
    if (key === 'y') return 'redo'
    if (key === 'd' && !event.shiftKey) return 'duplicate'
    return null
  }

  if (event.shiftKey) return null

  switch (event.key) {
    case 'Escape':
      return 'deselect'
    // Backspace is the key labelled "delete" on a Mac keyboard, so both.
    case 'Delete':
    case 'Backspace':
      return 'remove'
    case 'ArrowUp':
      return 'prev'
    case 'ArrowDown':
      return 'next'
    default:
      return null
  }
}
