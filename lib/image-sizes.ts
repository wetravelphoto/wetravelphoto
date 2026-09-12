/**
 * Shared between the server-side image pipeline and the client components
 * that build srcset attributes. Kept free of any server-only imports so it
 * can be bundled for the browser.
 */

/** Long-edge widths generated for every photograph. */
export const SIZES = [400, 800, 1600, 2400] as const

export type SizeKey = `${(typeof SIZES)[number]}`

export type Derivatives = Partial<Record<SizeKey, string>>
