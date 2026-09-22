'use client'

import { useState } from 'react'
import { BLOCK_LABELS, newBlock, type Block, type BlockImage } from '@/lib/blocks'
import ImagePickerModal from '@/components/admin/ImagePickerModal'
import PostBody from '@/components/blog/PostBody'

const ADD_ORDER: Block['type'][] = [
  'paragraph',
  'heading',
  'lead',
  'image',
  'image_pair',
  'masonry',
  'gallery',
  'quote',
  'video',
  'credit',
  'divider',
]

type PickerTarget = { blockId: string; slot: 'image' | 'left' | 'right' | 'gallery' | 'masonry' }

export default function BlockEditor({
  initialBlocks,
  publicUrl,
  title,
  category,
  featuredPath,
}: {
  initialBlocks: Block[]
  publicUrl: string
  title?: string
  category?: string | null
  featuredPath?: string | null
}) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks)
  const [rail, setRail] = useState<'blocks' | 'preview'>('blocks')
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [wide, setWide] = useState(false)

  // Drag state: either a new block type from the palette, or an existing block
  const [dragging, setDragging] = useState<{ kind: 'new'; type: Block['type'] } | { kind: 'move'; id: string } | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  function update(id: string, patch: Partial<Block>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)))
  }

  function insertAt(index: number, block: Block) {
    setBlocks((prev) => {
      const next = [...prev]
      next.splice(index, 0, block)
      return next
    })
  }

  function moveTo(id: string, index: number) {
    setBlocks((prev) => {
      const from = prev.findIndex((b) => b.id === id)
      if (from === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      // Account for the gap left behind when moving downwards
      const target = from < index ? index - 1 : index
      next.splice(target, 0, moved)
      return next
    })
  }

  function handleDrop(index: number) {
    if (!dragging) return
    if (dragging.kind === 'new') insertAt(index, newBlock(dragging.type))
    else moveTo(dragging.id, index)
    setDragging(null)
    setDropIndex(null)
  }

  function duplicate(id: string) {
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id)
      if (i === -1) return prev
      const copy = {
        ...structuredClone(prev[i]),
        id: Math.random().toString(36).slice(2, 10),
      } as Block
      const next = [...prev]
      next.splice(i + 1, 0, copy)
      return next
    })
  }

  function remove(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  function move(id: string, direction: -1 | 1) {
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id)
      const j = i + direction
      if (i === -1 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function applyImage(images: BlockImage[]) {
    if (!picker) return
    const { blockId, slot } = picker

    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== blockId) return b
        if (slot === 'gallery' && b.type === 'gallery') return { ...b, images: [...b.images, ...images] }
        if (slot === 'masonry' && b.type === 'masonry') return { ...b, images: [...b.images, ...images] }
        if (slot === 'image' && b.type === 'image') return { ...b, image: images[0] ?? b.image }
        if ((slot === 'left' || slot === 'right') && b.type === 'image_pair') {
          return { ...b, [slot]: images[0] ?? b[slot] } as Block
        }
        return b
      })
    )
    setPicker(null)
  }

  const leadBlock = blocks.find((b) => b.type === 'lead') as { type: 'lead'; text: string } | undefined
  const bodyBlocks = blocks.filter((b) => b.type !== 'lead')

  const DropZone = ({ index, first = false }: { index: number; first?: boolean }) => (
    <div
      className="block-dropzone"
      data-first={first}
      data-armed={dragging !== null}
      data-active={dragging !== null && dropIndex === index}
      onDragOver={(e) => {
        e.preventDefault()
        setDropIndex(index)
      }}
      onDragLeave={() => setDropIndex((cur) => (cur === index ? null : cur))}
      onDrop={(e) => {
        e.preventDefault()
        handleDrop(index)
      }}
    />
  )

  const previewContent = (
    <div className="editor-preview">
      {category && (
        <p className="post-breadcrumb">
          <span className="cat">{category}</span>
        </p>
      )}
      {title && <h1 className="post-title">{title}</h1>}
      {leadBlock && <p className="post-lead">{leadBlock.text}</p>}
      {featuredPath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${publicUrl}/${featuredPath}`}
          alt=""
          style={{ width: '100%', height: 'auto', display: 'block', margin: '0.9rem 0' }}
        />
      )}
      {bodyBlocks.length > 0 ? (
        <PostBody blocks={bodyBlocks} publicUrl={publicUrl} />
      ) : (
        <p className="admin-meta">Add blocks to see them here.</p>
      )}
    </div>
  )

  return (
    <div className="editor-layout">
      <div style={{ minWidth: 0 }}>
        {blocks.length === 0 && (
          <div className="admin-empty" style={{ marginBottom: '0.5rem' }}>
            Empty story. Drag a block from the right, or click one to add it.
          </div>
        )}

        {blocks.length > 0 && (
          <button
            type="button"
            className="insert-top"
            onClick={() => insertAt(0, newBlock('paragraph'))}
            title="Add a paragraph above everything"
          >
            + Add at the top
          </button>
        )}

        <DropZone index={0} first />

        {blocks.map((block, index) => (
          <div key={block.id}>
            <div
              className="admin-panel block-card"
              data-dragging={dragging?.kind === 'move' && dragging.id === block.id}
              style={{ padding: '0.85rem' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '0.6rem',
                  gap: '0.5rem',
                }}
              >
                <span
                  draggable
                  onDragStart={() => setDragging({ kind: 'move', id: block.id })}
                  onDragEnd={() => {
                    setDragging(null)
                    setDropIndex(null)
                  }}
                  style={{
                    fontFamily: 'var(--admin-font)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    fontSize: '0.68rem',
                    color: 'var(--admin-mute)',
                    cursor: 'grab',
                    userSelect: 'none',
                  }}
                  title="Drag to move this block"
                >
                  ⠿ {BLOCK_LABELS[block.type]}
                </span>

                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <button
                    type="button"
                    onClick={() => duplicate(block.id)}
                    className="admin-btn admin-btn-sm admin-btn-ghost"
                    title="Duplicate this block"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => move(block.id, -1)}
                    disabled={index === 0}
                    className="admin-btn admin-btn-sm admin-btn-ghost"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(block.id, 1)}
                    disabled={index === blocks.length - 1}
                    className="admin-btn admin-btn-sm admin-btn-ghost"
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => remove(block.id)} className="admin-btn admin-btn-sm admin-btn-danger">
                    Remove
                  </button>
                </div>
              </div>

              <BlockFields
                block={block}
                publicUrl={publicUrl}
                onChange={(patch) => update(block.id, patch)}
                onPick={(slot) => setPicker({ blockId: block.id, slot })}
              />
            </div>

            <DropZone index={index + 1} />
          </div>
        ))}

        <input type="hidden" name="blocks" value={JSON.stringify(blocks)} />
      </div>

      <aside className="editor-rail">
        <div className="editor-rail-inner">
          <div className="editor-rail-tabs">
            <button type="button" onClick={() => setRail('blocks')} data-active={rail === 'blocks'}>
              Add block
            </button>
            <button type="button" onClick={() => setRail('preview')} data-active={rail === 'preview'}>
              Preview
            </button>
          </div>

          <div className="editor-rail-body">
            {rail === 'blocks' ? (
              <>
                <p className="admin-meta" style={{ margin: '0 0 0.6rem', lineHeight: 1.5 }}>
                  Drag a block into place, or click to add it at the end.
                </p>
                {ADD_ORDER.map((type) => (
                  <button
                    key={type}
                    type="button"
                    draggable
                    onDragStart={() => setDragging({ kind: 'new', type })}
                    onDragEnd={() => {
                      setDragging(null)
                      setDropIndex(null)
                    }}
                    onClick={() => insertAt(blocks.length, newBlock(type))}
                    className="admin-btn admin-btn-sm admin-btn-ghost palette-btn"
                  >
                    ⠿ {BLOCK_LABELS[type]}
                  </button>
                ))}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setWide(true)}
                  className="admin-btn admin-btn-sm admin-btn-ghost"
                  style={{ width: '100%', marginBottom: '0.75rem' }}
                >
                  Open wide preview
                </button>
                {previewContent}
              </>
            )}
          </div>
        </div>
      </aside>

      {wide && (
        <div className="preview-overlay" onClick={() => setWide(false)}>
          <div className="preview-overlay-inner" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setWide(false)}
              className="admin-btn admin-btn-sm preview-overlay-close"
            >
              Close
            </button>
            <div className="post-shell" style={{ paddingTop: '2.5rem', paddingBottom: '2.5rem' }}>
              {category && (
                <p className="post-breadcrumb">
                  <span className="cat">{category}</span>
                </p>
              )}
              {title && <h1 className="post-title">{title}</h1>}
              {leadBlock && <p className="post-lead">{leadBlock.text}</p>}
              {featuredPath && (
                <figure className="post-figure-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${publicUrl}/${featuredPath}`} alt="" style={{ width: '100%', display: 'block' }} />
                </figure>
              )}
              <PostBody blocks={bodyBlocks} publicUrl={publicUrl} />
            </div>
          </div>
        </div>
      )}

      {picker && (
        <ImagePickerModal
          publicUrl={publicUrl}
          multiple={picker.slot === 'gallery' || picker.slot === 'masonry'}
          onClose={() => setPicker(null)}
          onSelect={applyImage}
        />
      )}
    </div>
  )
}

/** Reorderable thumbnail strip used by gallery and masonry blocks. */
function ThumbStrip({
  images,
  publicUrl,
  onChange,
}: {
  images: BlockImage[]
  publicUrl: string
  onChange: (images: BlockImage[]) => void
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  function drop(target: number) {
    if (dragIndex === null || dragIndex === target) {
      setDragIndex(null)
      setOverIndex(null)
      return
    }
    const next = [...images]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(target, 0, moved)
    onChange(next)
    setDragIndex(null)
    setOverIndex(null)
  }

  if (images.length === 0) {
    return (
      <span className="admin-meta" style={{ fontStyle: 'italic' }}>
        No images yet
      </span>
    )
  }

  return (
    <div className="thumb-strip">
      {images.map((img, i) => (
        <div
          key={`${img.path}-${i}`}
          className="thumb-strip-item"
          draggable
          data-dragging={dragIndex === i}
          data-over={overIndex === i && dragIndex !== i}
          onDragStart={(e) => {
            e.stopPropagation()
            setDragIndex(i)
          }}
          onDragEnd={() => {
            setDragIndex(null)
            setOverIndex(null)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setOverIndex(i)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            drop(i)
          }}
          title="Drag to reorder"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${publicUrl}/${img.path}`}
            alt=""
            draggable={false}
            style={{ width: 70, height: 70, objectFit: 'cover', display: 'block' }}
          />
          <button
            type="button"
            onClick={() => onChange(images.filter((_, j) => j !== i))}
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              background: 'rgba(0,0,0,0.65)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.7rem',
              lineHeight: 1,
              padding: '2px 4px',
            }}
          >
            ×
          </button>
          <span
            style={{
              position: 'absolute',
              bottom: 2,
              left: 2,
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              fontSize: '0.58rem',
              padding: '0 3px',
            }}
          >
            {i + 1}
          </span>
        </div>
      ))}
    </div>
  )
}

function BlockFields({
  block,
  publicUrl,
  onChange,
  onPick,
}: {
  block: Block
  publicUrl: string
  onChange: (patch: Partial<Block>) => void
  onPick: (slot: 'image' | 'left' | 'right' | 'gallery' | 'masonry') => void
}) {
  const textarea = (value: string, onText: (v: string) => void, rows = 4, placeholder = '') => (
    <textarea
      value={value}
      onChange={(e) => onText(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="admin-input"
      style={{ marginTop: 0, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
    />
  )

  switch (block.type) {
    case 'paragraph':
      return textarea(block.text, (text) => onChange({ text } as Partial<Block>), 4, 'Body text…')

    case 'lead':
      return textarea(block.text, (text) => onChange({ text } as Partial<Block>), 3, 'Opening paragraph — sits above the featured image.')

    case 'heading':
      return (
        <input
          type="text"
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value } as Partial<Block>)}
          placeholder="Section heading"
          className="admin-input"
          style={{ marginTop: 0 }}
        />
      )

    case 'credit':
      return textarea(block.text, (text) => onChange({ text } as Partial<Block>), 2, 'Photography by…')

    case 'quote':
      return (
        <>
          {textarea(block.text, (text) => onChange({ text } as Partial<Block>), 3, 'Pull quote…')}
          <input
            type="text"
            value={block.attribution ?? ''}
            onChange={(e) => onChange({ attribution: e.target.value } as Partial<Block>)}
            placeholder="Attribution (optional)"
            className="admin-input"
            style={{ marginTop: '0.5rem' }}
          />
        </>
      )

    case 'divider':
      return (
        <p className="admin-meta" style={{ margin: 0 }}>
          A thin rule between sections.
        </p>
      )

    case 'video':
      return (
        <>
          <input
            type="url"
            value={block.url}
            onChange={(e) => onChange({ url: e.target.value } as Partial<Block>)}
            placeholder="YouTube or Vimeo link"
            className="admin-input"
            style={{ marginTop: 0 }}
          />
          <input
            type="text"
            value={block.caption ?? ''}
            onChange={(e) => onChange({ caption: e.target.value } as Partial<Block>)}
            placeholder="Caption (optional)"
            className="admin-input"
            style={{ marginTop: '0.5rem' }}
          />
        </>
      )

    case 'image':
      return (
        <>
          <ImageSlot
            image={block.image}
            publicUrl={publicUrl}
            onPick={() => onPick('image')}
            onCaption={(caption) => onChange({ image: { ...block.image, caption } } as Partial<Block>)}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', marginTop: '0.6rem' }}>
            <input
              type="checkbox"
              checked={!!block.full}
              onChange={(e) => onChange({ full: e.target.checked } as Partial<Block>)}
            />
            Extra wide
          </label>
        </>
      )

    case 'image_pair':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          <ImageSlot
            image={block.left}
            publicUrl={publicUrl}
            onPick={() => onPick('left')}
            onCaption={(caption) => onChange({ left: { ...block.left, caption } } as Partial<Block>)}
          />
          <ImageSlot
            image={block.right}
            publicUrl={publicUrl}
            onPick={() => onPick('right')}
            onCaption={(caption) => onChange({ right: { ...block.right, caption } } as Partial<Block>)}
          />
        </div>
      )

    case 'masonry':
      return (
        <>
          <div style={{ marginBottom: '0.6rem' }}>
            <ThumbStrip
              images={block.images}
              publicUrl={publicUrl}
              onChange={(images) => onChange({ images } as Partial<Block>)}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => onPick('masonry')} className="admin-btn admin-btn-sm admin-btn-ghost">
              Add images
            </button>
            <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input
                type="checkbox"
                checked={block.featureFirst !== false}
                onChange={(e) => onChange({ featureFirst: e.target.checked } as Partial<Block>)}
              />
              Lead with one large image
            </label>
            <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              Columns
              <select
                value={block.columns ?? 2}
                onChange={(e) => onChange({ columns: parseInt(e.target.value, 10) } as Partial<Block>)}
                className="admin-select"
                style={{ marginTop: 0, width: 'auto', padding: '0.25rem 0.4rem' }}
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
          </div>
        </>
      )

    case 'gallery':
      return (
        <>
          <div style={{ marginBottom: '0.6rem' }}>
            <ThumbStrip
              images={block.images}
              publicUrl={publicUrl}
              onChange={(images) => onChange({ images } as Partial<Block>)}
            />
          </div>
          <button type="button" onClick={() => onPick('gallery')} className="admin-btn admin-btn-sm admin-btn-ghost">
            Add images
          </button>
        </>
      )

    default:
      return null
  }
}

function ImageSlot({
  image,
  publicUrl,
  onPick,
  onCaption,
}: {
  image: BlockImage
  publicUrl: string
  onPick: () => void
  onCaption: (caption: string) => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onPick}
        style={{
          width: '100%',
          padding: 0,
          border: '1px dashed var(--admin-line)',
          background: 'none',
          cursor: 'pointer',
          display: 'block',
          minHeight: 90,
        }}
      >
        {image.path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${publicUrl}/${image.path}`}
            alt=""
            style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <span className="admin-meta" style={{ display: 'block', padding: '2rem 0.5rem' }}>
            Choose an image
          </span>
        )}
      </button>
      <input
        type="text"
        value={image.caption ?? ''}
        onChange={(e) => onCaption(e.target.value)}
        placeholder="Caption (optional)"
        className="admin-input"
        style={{ marginTop: '0.4rem', fontSize: '0.78rem', padding: '0.35rem 0.45rem' }}
      />
    </div>
  )
}
