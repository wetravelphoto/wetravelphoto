'use client'

import { useEffect } from 'react'
import { FAMILIES, SECTIONS } from '@/lib/sections/registry'
import SectionThumb from '@/components/canvas/SectionThumb'

/**
 * What can go on a page, grouped by family, straight from the registry.
 *
 * Nothing here is a list of section names kept in step by hand: adding a type
 * to lib/sections/registry.ts puts it in this picker, in the right family, with
 * its own blurb and its own "needs something first" note.
 */
export default function AddSectionModal({
  used,
  onPick,
  onClose,
}: {
  used: Set<string>
  onPick: (type: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const all = Object.values(SECTIONS)

  return (
    <div className="cv-modal" role="dialog" aria-modal="true" aria-label="Add a section" onClick={onClose}>
      <div className="cv-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="cv-modal-head">
          <div>
            <h2>Add a section</h2>
            <p className="cv-modal-sub">
              It drops in below whatever is selected. Drag it anywhere afterwards.
            </p>
          </div>
          <button type="button" className="cv-ico" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="cv-modal-body">
          {FAMILIES.map((family) => {
            const members = all.filter((d) => d.family === family)
            if (members.length === 0) return null

            return (
              <section key={family} className="cv-family">
                <p className="cv-family-name">{family}</p>
                <div className="cv-cards">
                  {members.map((def) => {
                    const taken = def.singleton && used.has(def.type)

                    return (
                      <button
                        key={def.type}
                        type="button"
                        className="cv-card"
                        disabled={taken}
                        onClick={() => onPick(def.type)}
                      >
                        <SectionThumb type={def.type} />
                        <span className="cv-card-name">{def.label}</span>
                        <span className="cv-card-blurb">{def.blurb}</span>
                        {taken ? (
                          <span className="cv-card-note">Already on this page</span>
                        ) : (
                          def.requires && <span className="cv-card-note">{def.requires}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
