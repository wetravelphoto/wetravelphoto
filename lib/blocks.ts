/** Post bodies are an ordered list of typed blocks. */

export type BlockImage = {
  path: string
  caption?: string | null
  alt?: string | null
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
