/** Post bodies are an ordered list of typed blocks. */

export type BlockImage = {
  /** The stored file: authoritative, what every story written before P5 renders from. */
  path: string
  caption?: string | null
  /** This placement's own description. Blank is unset, never "decorative": a story image is content. */
  alt?: string | null
  /**
   * The photograph's identity (P5), written by the picker beside the path it
   * chose. Absent on every older block, which keeps rendering from its path.
   */
  assetId?: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Every image object in a story's blocks, in order. */
export function blockImages(blocks: unknown): unknown[] {
  if (!Array.isArray(blocks)) return []
  const out: unknown[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'image') out.push(b.image)
    else if (b.type === 'image_pair') out.push(b.left, b.right)
    else if ((b.type === 'gallery' || b.type === 'masonry') && Array.isArray(b.images)) out.push(...b.images)
  }
  return out
}

/**
 * The identities a story asks to store, each with the path it was chosen
 * with — for the server to check both name the same photograph of this site.
 * Throws on an identity that is not one (a malformed id is not an absent one),
 * on an identity with no path, and on a description that is not text.
 */
export function blockIdentities(blocks: unknown): Array<{ assetId: string; path: string }> {
  const out: Array<{ assetId: string; path: string }> = []
  for (const image of blockImages(blocks)) {
    if (!image || typeof image !== 'object') continue
    const i = image as Record<string, unknown>
    if (i.alt !== undefined && i.alt !== null && typeof i.alt !== 'string') throw new Error('A photograph’s description is not text.')
    if (i.assetId === undefined || i.assetId === null) continue
    if (typeof i.assetId !== 'string' || !UUID.test(i.assetId)) throw new Error('A photograph in this story is not one of this site’s.')
    if (typeof i.path !== 'string' || i.path === '') throw new Error('A photograph in this story has no file.')
    out.push({ assetId: i.assetId, path: i.path })
  }
  return out
}

export type Block =
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'lead'; text: string }
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'quote'; text: string; attribution?: string | null }
  | { id: string; type: 'image'; image: BlockImage; full?: boolean }
  | { id: string; type: 'image_pair'; left: BlockImage; right: BlockImage }
  | { id: string; type: 'gallery'; images: BlockImage[] }
  | { id: string; type: 'masonry'; images: BlockImage[]; columns?: number; featureFirst?: boolean }
  | { id: string; type: 'video'; url: string; caption?: string | null }
  | { id: string; type: 'credit'; text: string }
  | { id: string; type: 'divider' }

export const BLOCK_LABELS: Record<Block['type'], string> = {
  lead: 'Intro paragraph',
  paragraph: 'Paragraph',
  heading: 'Heading',
  quote: 'Pull quote',
  image: 'Single image',
  image_pair: 'Two images side by side',
  gallery: 'Gallery strip',
  masonry: 'Masonry photo set',
  video: 'Video',
  credit: 'Credit line',
  divider: 'Divider',
}

export function newBlock(type: Block['type']): Block {
  const id = Math.random().toString(36).slice(2, 10)

  switch (type) {
    case 'lead':
      return { id, type: 'lead', text: '' }
    case 'heading':
      return { id, type: 'heading', text: '' }
    case 'quote':
      return { id, type: 'quote', text: '', attribution: '' }
    case 'image':
      return { id, type: 'image', image: { path: '' }, full: false }
    case 'image_pair':
      return { id, type: 'image_pair', left: { path: '' }, right: { path: '' } }
    case 'gallery':
      return { id, type: 'gallery', images: [] }
    case 'masonry':
      return { id, type: 'masonry', images: [], columns: 2, featureFirst: true }
    case 'video':
      return { id, type: 'video', url: '', caption: '' }
    case 'credit':
      return { id, type: 'credit', text: '' }
    case 'divider':
      return { id, type: 'divider' }
    default:
      return { id, type: 'paragraph', text: '' }
  }
}

/** Rough reading time from the text blocks only. */
export function estimateReadMinutes(blocks: Block[]): number {
  const words = blocks.reduce((total, block) => {
    if (block.type === 'paragraph' || block.type === 'lead' || block.type === 'quote') {
      return total + block.text.trim().split(/\s+/).filter(Boolean).length
    }
    return total
  }, 0)

  return Math.max(1, Math.round(words / 220))
}

/** Turns a YouTube or Vimeo link into its embed URL. */
export function embedUrl(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/)
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`

  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`

  return null
}
