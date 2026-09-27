/**
 * THE SCREEN SIZES A SETTING CAN DIFFER BY
 * ════════════════════════════════════════
 *
 * Two, because the site's stylesheets have exactly one breakpoint. Offering a
 * tablet in the editor before there is a tablet in the CSS would be a control
 * that looks like it works and changes nothing on an actual iPad — the same
 * fault as a font picker that never fetches the font.
 *
 * Adding one later is this list plus its media query. Everything downstream —
 * storage keys, custom-property prefixes, the panel, the live channel — is
 * derived from here, so nothing else has to be found and changed.
 */

export const DEVICES = ['desktop', 'mobile'] as const
export type Device = (typeof DEVICES)[number]

export const DEFAULT_DEVICE: Device = 'desktop'

/**
 * The widest device is the BASE and every narrower one is an override of it.
 *
 * This is the decision that makes the editor usable rather than twice the
 * work: set a title once on desktop and the phone follows, until the phone is
 * given a value of its own — and then only for the one control that was
 * touched. Editing a narrower size can never change a wider one, which is the
 * property that matters: you cannot break the desktop site by tidying the
 * phone one.
 */
export const BASE_DEVICE: Device = 'desktop'

export const DEVICE_LABEL: Record<Device, string> = {
  desktop: 'Desktop',
  mobile: 'Phone',
}

/** What the editor's preview is called for each, in Canvas's own vocabulary. */
export const DEVICE_PREVIEW: Record<Device, 'desktop' | 'phone'> = {
  desktop: 'desktop',
  mobile: 'phone',
}

/**
 * Where a device's values live in a settings bag.
 *
 * The base keeps the ORIGINAL key — `text`, not `text_desktop` — so every row
 * already in the database is a desktop row and no migration is needed. That is
 * also why this returns a suffix rather than a whole name: the same rule has
 * to apply to any setting that becomes per-device later.
 */
export function deviceKey(base: string, device: Device): string {
  return device === BASE_DEVICE ? base : `${base}_${device}`
}

/**
 * The custom-property prefix each device writes on the element.
 *
 * Both sets go on at once, because an inline style attribute cannot carry a
 * media query. One global rule (app/globals.css) resolves them into the
 * `--txt-*` the section stylesheets read: the base straight through, and at
 * each breakpoint `var(--txtm-x, var(--txtd-x))`, so an unset mobile value
 * falls back to desktop and an unset desktop value falls through to whatever
 * the stylesheet's own fallback is.
 */
export const DEVICE_PREFIX: Record<Device, string> = {
  desktop: '--txtd-',
  mobile: '--txtm-',
}

/** The media query each non-base device is resolved inside. */
export const DEVICE_QUERY: Partial<Record<Device, string>> = {
  mobile: '(max-width: 760px)',
}
