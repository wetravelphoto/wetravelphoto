import type { Block, BlockImage } from '@/lib/blocks'
import { embedUrl } from '@/lib/blocks'

function url(publicUrl: string, path: string) {
  return `${publicUrl}/${path}`
}

function Caption({ text }: { text?: string | null }) {
  if (!text) return null
  return (
    <figcaption
      style={{
        fontSize: '0.75rem',
        letterSpacing: '0.02em',
        color: 'var(--ink-mute)',
        marginTop: '0.65rem',
        lineHeight: 1.5,
      }}
    >
      {text}
    </figcaption>
  )
}

function Img({ image, publicUrl }: { image: BlockImage; publicUrl: string }) {
  if (!image.path) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url(publicUrl, image.path)}
      alt={image.alt ?? image.caption ?? ''}
      loading="lazy"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    />
  )
}

export default function BlockRenderer({ blocks, publicUrl }: { blocks: Block[]; publicUrl: string }) {
  return (
    <>
      {blocks.map((block) => {
        switch (block.type) {
          case 'lead':
            return (
              <p key={block.id} className="post-lead">
                {block.text}
              </p>
            )

          case 'paragraph':
            return (
              <p key={block.id} className="post-body">
                {block.text}
              </p>
            )

          case 'heading':
            return (
              <h2 key={block.id} className="post-heading">
                {block.text}
              </h2>
            )

          case 'quote':
            return (
              <blockquote key={block.id} className="post-quote">
                <p style={{ margin: 0 }}>{block.text}</p>
                {block.attribution && <cite className="post-quote-cite">{block.attribution}</cite>}
              </blockquote>
            )

          case 'credit':
            return (
              <p key={block.id} className="post-credit">
                {block.text}
              </p>
            )

          case 'divider':
            return <hr key={block.id} className="post-divider" />

          case 'image':
            return (
              <figure key={block.id} className={block.full ? 'post-figure-full' : 'post-figure'}>
                <Img image={block.image} publicUrl={publicUrl} />
                <Caption text={block.image.caption} />
              </figure>
            )

          case 'image_pair':
            return (
              <div key={block.id} className="post-figure-wide">
                <div className="post-pair">
                  <figure style={{ margin: 0 }}>
                    <Img image={block.left} publicUrl={publicUrl} />
                    <Caption text={block.left.caption} />
                  </figure>
                  <figure style={{ margin: 0 }}>
                    <Img image={block.right} publicUrl={publicUrl} />
                    <Caption text={block.right.caption} />
                  </figure>
                </div>
              </div>
            )

          case 'gallery':
            return (
              <div key={block.id} className="post-figure-wide">
                <div className="post-gallery">
                  {block.images.map((image, i) => (
                    <figure key={i} style={{ margin: 0 }}>
                      <Img image={image} publicUrl={publicUrl} />
                    </figure>
                  ))}
                </div>
              </div>
            )

          case 'video': {
            const src = embedUrl(block.url)
            return (
              <figure key={block.id} className="post-figure">
                {src ? (
                  <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, background: '#14100e' }}>
                    <iframe
                      src={src}
                      title={block.caption ?? 'Video'}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                    />
                  </div>
                ) : block.url ? (
                  <video src={block.url} controls style={{ width: '100%', display: 'block' }} />
                ) : null}
                <Caption text={block.caption} />
              </figure>
            )
          }

          default:
            return null
        }
      })}
    </>
  )
}
