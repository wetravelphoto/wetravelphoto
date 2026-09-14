'use client'

import { useState } from 'react'
import WallMockup from '@/components/shop/WallMockup'

export type BuyOption = {
  id: string
  label: string
  kind: string
  price_cents: number
}

/** Pulls '16 × 24' out of a label so the mockup can draw it at the right size. */
function inchesFrom(label: string): { w: number; h: number } | null {
  const match = label.match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)/i)
  if (!match) return null

  const w = Number(match[1])
  const h = Number(match[2])

  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

export default function BuyPanel({
  options,
  imageUrl,
  srcSet,
  alt,
  aspect,
  currency = 'usd',
  orderNote,
}: {
  options: BuyOption[]
  imageUrl: string
  srcSet?: string
  alt: string
  aspect: number
  currency?: string
  orderNote?: string | null
}) {
  const [selectedId, setSelectedId] = useState(options[0]?.id ?? '')

  const selected = options.find((o) => o.id === selectedId) ?? options[0]

  // The print's real dimensions drive the mockup. Landscape images get the
  // long edge as width; portrait ones get it as height.
  const parsed = selected ? inchesFrom(selected.label) : null
  const long = parsed ? Math.max(parsed.w, parsed.h) : 24
  const short = parsed ? Math.min(parsed.w, parsed.h) : 16

  const widthInches = aspect >= 1 ? long : short
  const heightInches = aspect >= 1 ? short : long

  return (
    <div className="product-layout">
      <WallMockup
        imageUrl={imageUrl}
        srcSet={srcSet}
        alt={alt}
        aspect={aspect}
        widthInches={widthInches}
        heightInches={heightInches}
      />

      <div className="product-buy">
        <fieldset className="product-sizes">
          <legend className="product-label">Size</legend>

          {options.map((option) => (
            <label key={option.id} className="product-size" data-active={option.id === selected?.id}>
              <input
                type="radio"
                name="print_option"
                value={option.id}
                checked={option.id === selected?.id}
                onChange={() => setSelectedId(option.id)}
              />
              <span className="product-size-label">{option.label}</span>
              <span className="product-size-kind">{option.kind}</span>
              <span className="product-size-price">{money(option.price_cents, currency)}</span>
            </label>
          ))}
        </fieldset>

        <div className="product-total">
          <span>{selected ? money(selected.price_cents, currency) : '—'}</span>
          <span className="product-total-note">plus shipping</span>
        </div>

        <button type="button" className="product-buy-btn" disabled>
          Add to cart
        </button>
        <p className="product-pending">Checkout isn&apos;t switched on yet.</p>

        {orderNote && <p className="product-note">{orderNote}</p>}
      </div>
    </div>
  )
}
