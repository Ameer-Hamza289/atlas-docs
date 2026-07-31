import { useMemo, useState, type JSX } from 'react'

import type { DocumentId, DocumentSummary } from '@shared/types'

import { formatRelativeTime } from '../lib/format'

interface SidebarProps {
  documents: DocumentSummary[]
  activeId: DocumentId | null
  onSelect(id: DocumentId): void
  onCreate(): void
  onDelete(id: DocumentId): void
  onExportWorkspace(): void
  onRevealStorage(): void
}

export function Sidebar({
  documents,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onExportWorkspace,
  onRevealStorage
}: SidebarProps): JSX.Element {
  const [filter, setFilter] = useState('')

  // The sidebar filters the summaries it already has; only the @ menu needs to
  // hit the main process, where full document bodies live.
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return documents
    return documents.filter(
      (document) =>
        document.title.toLowerCase().includes(needle) ||
        document.excerpt.toLowerCase().includes(needle)
    )
  }, [documents, filter])

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <div className="sidebar__brand">
          <span className="sidebar__logo">A</span>
          <div>
            <div className="sidebar__title">Atlas</div>
            <div className="sidebar__subtitle">
              {documents.length} document{documents.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <button type="button" className="button button--primary" onClick={onCreate}>
          New
        </button>
      </header>

      <input
        id="sidebar-filter"
        className="sidebar__filter"
        type="search"
        placeholder="Filter documents"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <nav className="sidebar__list">
        {visible.map((document) => (
          <div
            key={document.id}
            className={`doc-item ${document.id === activeId ? 'doc-item--active' : ''}`}
          >
            <button type="button" className="doc-item__main" onClick={() => onSelect(document.id)}>
              <span className="doc-item__title">{document.title}</span>
              <span className="doc-item__excerpt">{document.excerpt || 'Empty document'}</span>
              <span className="doc-item__meta">
                <span>{formatRelativeTime(document.updatedAt)}</span>
                {document.backlinkCount > 0 ? (
                  <span className="doc-item__badge" title="Incoming references">
                    ↩ {document.backlinkCount}
                  </span>
                ) : null}
              </span>
            </button>
            <button
              type="button"
              className="doc-item__delete"
              title={`Delete “${document.title}”`}
              aria-label={`Delete ${document.title}`}
              onClick={() => onDelete(document.id)}
            >
              ×
            </button>
          </div>
        ))}

        {visible.length === 0 ? (
          <p className="sidebar__empty">No documents match “{filter}”.</p>
        ) : null}
      </nav>

      <footer className="sidebar__footer">
        <div className="sidebar__links">
          <button type="button" className="sidebar__link" onClick={onExportWorkspace}>
            Export workspace
          </button>
          <button type="button" className="sidebar__link" onClick={onRevealStorage}>
            Show data file
          </button>
        </div>
        <span className="sidebar__hint">
          <kbd>Ctrl</kbd>+<kbd>N</kbd> new · <kbd>@</kbd> reference
        </span>
      </footer>
    </aside>
  )
}
