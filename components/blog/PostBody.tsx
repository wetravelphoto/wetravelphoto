'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Block, BlockImage } from '@/lib/blocks'
import { embedUrl } from '@/lib/blocks'

function Caption({ text }: { text?: string | null }) {
  if (!text) return null
  return <figcaption className="post-caption">{text}</figcaption>
}

/**
 * Renders the post body and owns the lightbox, so any image in the story
 * can be opened full screen and stepped through.
 */
export default function PostBody({ blocks, publicUrl }: { blocks: Block[]; publicUrl: string }) {
  // Flatten every image in reading order so the lightbox can page through them
  const allImages: BlockImage[] = []
  blocks.forEach((block) => {
    if (block.type === 'image') allImages.push(block.image)
    if (block.type === 'image_pair') allImages.push(block.left, block.right)
    if (block.type === 'gallery' || block.type === 'masonry') allImages.push(...block.images)
  })
  const openable = allImages.filter((img) => img.path)

  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const close = useCallback(() => setOpenIndex(null), [])
  const next = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i + 1) % openable.length)),
    [openable.length]
  )
  const prev = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i - 1 + openable.length) % openable.length)),
    [openable.length]
  )

  useEffect(() => {
    if (openIndex === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [openIndex, close, next, prev])

  function indexOf(image: BlockImage) {
    return openable.findIndex((img) => img.path === image.path)
  }

  function Img({ image }: { image: BlockImage }) {
    if (!image.path) return null
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${publicUrl}/${image.path}`}
        alt={image.alt ?? image.caption ?? ''}
        loading="lazy"
        onClick={() => setOpenIndex(indexOf(image))}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'zoom-in' }}
      />
    )
  }

  const current = openIndex !== null ? openable[openIndex] : null

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
              <figure key={block.id} className={block.full ? 'post-figure-full' : 'post-figure-wide'}>
                <Img image={block.image} />
                <Caption text={block.image.caption} />
              </figure>
            )

          case 'image_pair':
            return (
              <div key={block.id} className="post-figure-wide">
                <div className="post-pair">
                  <figure style={{ margin: 0 }}>
                    <Img image={block.left} />
                    <Caption text={block.left.caption} />
                  </figure>
                  <figure style={{ margin: 0 }}>
                    <Img image={block.right} />
                    <Caption text={block.right.caption} />
                  </figure>
                </div>
              </div>
            )

          case 'masonry': {
            // Optionally lead with one large image, then the rest in columns
            const feature = block.featureFirst !== false ? block.images[0] : null
            const rest = feature ? block.images.slice(1) : block.images

            return (
              <div key={block.id} className="post-figure-full">
                {feature && (
                  <figure style={{ margin: 0, marginBottom: 'var(--gap)' }} className="post-masonry-lead">
                    <Img image={feature} />
                    <Caption text={feature.caption} />
                  </figure>
                )}
                {rest.length > 0 && (
                  <div className="post-masonry" style={{ columns: block.columns ?? 2 }}>
                    {rest.map((image, i) => (
                      <figure key={i} style={{ margin: 0, breakInside: 'avoid', marginBottom: 'var(--gap)' }}>
                        <Img image={image} />
                        <Caption text={image.caption} />
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            )
          }

          case 'gallery':
            return (
              <div key={block.id} className="post-figure-wide">
                <div className="post-gallery">
                  {block.images.map((image, i) => (
                    <figure key={i} style={{ margin: 0 }}>
                      <Img image={image} />
                    </figure>
                  ))}
                </div>
              </div>
            )

          case 'video': {
            const src = embedUrl(block.url)
            return (
              <figure key={block.id} className="post-figure-wide">
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

      {current && openIndex !== null && (
        <div className="post-lightbox" onClick={close}>
          <button onClick={close} aria-label="Close" className="post-lightbox-close">
            &times;
          </button>
          {openable.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  prev()
                }}
                aria-label="Previous"
                className="post-lightbox-nav"
                data-side="left"
              >
                &#8249;
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  next()
                }}
                aria-label="Next"
                className="post-lightbox-nav"
                data-side="right"
              >
                &#8250;
              </button>
            </>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${publicUrl}/${current.path}`}
            alt={current.alt ?? current.caption ?? ''}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain', display: 'block' }}
          />
          <div style={{ marginTop: '0.9rem', color: '#faf9f6', display: 'flex', gap: '1.25rem', fontSize: '0.78rem' }}>
            <span style={{ opacity: 0.55 }}>
              {String(openIndex + 1).padStart(2, '0')} / {String(openable.length).padStart(2, '0')}
            </span>
            {current.caption && <span style={{ opacity: 0.85 }}>{current.caption}</span>}
          </div>
        </div>
      )}
    </>
  )
}
