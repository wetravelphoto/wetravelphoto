'use client'

import { useState } from 'react'

export default function FocalPointPicker({
  imageUrl,
  initialX,
  initialY,
}: {
  imageUrl: string
  initialX: number
  initialY: number
}) {
  const [x, setX] = useState(initialX)
  const [y, setY] = useState(initialY)

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const newX = (e.clientX - rect.left) / rect.width
    const newY = (e.clientY - rect.top) / rect.height
    setX(Math.min(1, Math.max(0, newX)))
    setY(Math.min(1, Math.max(0, newY)))
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>
        Click the image to set the focal point (keeps the subject centered when the cover gets cropped)
      </p>
      <div
        onClick={handleClick}
        style={{
          position: 'relative',
          width: 320,
          height: 200,
          cursor: 'crosshair',
          userSelect: 'none',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: 16,
            height: 16,
            borderRadius: '50%',
            border: '2px solid white',
            boxShadow: '0 0 0 1px black',
            pointerEvents: 'none',
          }}
        />
      </div>
      <input type="hidden" name="cover_focal_x" value={x} />
      <input type="hidden" name="cover_focal_y" value={y} />
    </div>
  )
}
