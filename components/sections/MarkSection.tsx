import type { SectionSettings } from '@/lib/sections/registry'
import type { SectionContext } from '@/lib/sections/context'
import { editable, live } from '@/lib/sections/editable'
import { markAlign, markSize, markSrc } from '@/lib/sections/mark'

/* eslint-disable @next/next/no-img-element */

/**
 * A small emblem on a line of its own.
 *
 * This used to be BirdBadge, hard-wired under the hero and configured from a
 * form that could not show it. As a section it can sit anywhere, be hidden,
 * be moved, and be edited where it is seen.
 *
 * With no picture it draws nothing in public. In the editor it draws an empty
 * slot so there is something to click — a section that is invisible in the
 * one place you would go to fill it in is a section nobody can find.
 */
export default function MarkSection({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
  const path =
    typeof settings.image_path === 'string' && settings.image_path ? settings.image_path : null
  const align = markAlign(settings.align)

  if (!path) {
    if (!ctx.editable) return null
    return (
      <div className="mark-section" data-align={align} {...live(ctx, ['align'])}>
        <div className="mark-slot" {...editable(ctx, 'image_path')} />
      </div>
    )
  }

  const src = markSrc(path, process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '')

  // Size and position are written as a custom property and an attribute on
  // the outer element — exactly what the fields' `live` declarations name —
  // so the editor can move and resize the mark while the slider is dragged.
  const style = { '--mark-size': `${markSize(settings.size)}px` } as React.CSSProperties

  return (
    <div
      className="mark-section"
      data-align={align}
      style={style}
      aria-hidden="true"
      {...live(ctx, ['size', 'align'])}
    >
      {/* The tag goes on a wrapper, not the <img>: an image has no children,
          so the editor's "empty field" styling would match it. */}
      <span className="mark-frame" {...editable(ctx, 'image_path')}>
        <img src={src} alt="" />
      </span>
    </div>
  )
}
