import type { JSX } from 'react'

import type { Backlink, DocumentId } from '@shared/types'

interface BacklinksPanelProps {
  backlinks: Backlink[]
  onNavigate(id: DocumentId): void
}

/** Incoming references. Cheap to derive from the link index and makes the graph navigable both ways. */
export function BacklinksPanel({ backlinks, onNavigate }: BacklinksPanelProps): JSX.Element {
  return (
    <section className="backlinks">
      <h2 className="backlinks__heading">
        Referenced by
        <span className="backlinks__count">{backlinks.length}</span>
      </h2>

      {backlinks.length === 0 ? (
        <p className="backlinks__empty">
          Nothing links here yet. Type <kbd>@</kbd> in another document to create a reference.
        </p>
      ) : (
        <ul className="backlinks__list">
          {backlinks.map((backlink) => (
            <li key={backlink.id}>
              <button type="button" className="backlink" onClick={() => onNavigate(backlink.id)}>
                <span className="backlink__title">
                  {backlink.title}
                  {backlink.count > 1 ? (
                    <span className="backlink__count">{backlink.count} references</span>
                  ) : null}
                </span>
                <span className="backlink__context">{backlink.context}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
