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
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

/**
 * The buying column. Size and quantity are live; the cart is the one piece
 * still stubbed, so the button says so rather than pretending to work.
 */
export default function BuyPanel({
  options,
  currency = 'usd',
  orderNote,
}: {
  options: BuyOption[]
  currency?: string
  orderNote?: string | null
}) {
  const [selectedId, setSelectedId] = useState(options[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)

  const selected = options.find((o) => o.id === selectedId) ?? options[0]
  const total = selected ? selected.price_cents * quantity : 0

  if (options.length === 0) {
    return (
      <p className="product-pending" style={{ marginTop: 0 }}>
        This print isn&apos;t available to order yet.
      </p>
    )
  }

  return (
    <>
      <p className="product-price">{money(total, currency)}</p>
      <p className="product-tax">Shipping calculated at checkout.</p>

      <fieldset className="product-options">
        <legend className="product-label">Size</legend>
        <div className="product-pills">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelectedId(option.id)}
              data-active={option.id === selected?.id}
              className="product-pill"
            >
              {option.label}
              {option.kind && option.kind !== 'print' && (
                <span className="product-pill-kind"> · {option.kind}</span>
              )}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="product-qty-block">
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

      <button type="button" className="product-buy-btn" disabled>
        Add to cart
      </button>
      <p className="product-pending">Checkout isn&apos;t switched on yet.</p>

      {orderNote && <p className="product-note">{orderNote}</p>}
    </>
  )
}
