'use client'

import { useState } from 'react'

export type BuyOption = {
  id: string
  label: string
  kind: string
  price_cents: number
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

/**
 * The buying column. Size and quantity are live and the button carries the
 * running total; the cart is the one piece still stubbed, so it says so rather
 * than pretending to work.
 */
export default function BuyPanel({
  options,
  currency = 'usd',
  orderNote,
  orientation,
  description,
}: {
  options: BuyOption[]
  currency?: string
  orderNote?: string | null
  /** Landscape, Portrait or Square — stated next to the chosen size. */
  orientation?: string
  description?: string | null
}) {
  const [selectedId, setSelectedId] = useState(options[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)

  const selected = options.find((o) => o.id === selectedId) ?? options[0]
  const total = selected ? selected.price_cents * quantity : 0

  const blurb = description
    ?.split('\n\n')
    .map((p) => p.trim())
    .filter(Boolean)

  if (options.length === 0) {
    return (
      <>
        {blurb && blurb.length > 0 && (
          <div className="product-description">
            {blurb.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        )}
        <p className="product-pending">This print isn&apos;t available to order yet.</p>
      </>
    )
  }

  return (
    <>
      <p className="product-price">{money(selected.price_cents, currency)}</p>

      {blurb && blurb.length > 0 && (
        <div className="product-description">
          {blurb.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      )}

      <div className="product-spec">
        <div className="product-row" role="group" aria-label="Size">
          <span className="product-label">Size</span>
          <div className="product-pills">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelectedId(option.id)}
                data-active={option.id === selected.id}
                className="product-pill"
              >
                {option.label}
                {option.kind && option.kind !== 'print' && (
                  <span className="product-pill-kind"> · {option.kind}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {orientation && (
          <div className="product-row">
            <span className="product-label">Orientation</span>
            <p className="product-static">
              {orientation}
              {selected.label ? ` (${selected.label})` : ''}
            </p>
          </div>
        )}

        <div className="product-row">
          <span className="product-label">Quantity</span>
          <div className="product-qty">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="Decrease quantity"
              disabled={quantity <= 1}
            >
              −
            </button>
            <span aria-live="polite">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(20, q + 1))}
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <button type="button" className="product-buy-btn" disabled>
        Add to cart <span aria-hidden>—</span> {money(total, currency)}
      </button>
      <p className="product-pending">Checkout isn&apos;t switched on yet.</p>

      {orderNote && <p className="product-note">{orderNote}</p>}
    </>
  )
}
