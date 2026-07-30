import { memo, type JSX } from 'react'

import type { Backlink, DocumentId, DocumentRecord, RichTextNode } from '@shared/types'

import type { MentionDependencies } from '../editor/types'
import { formatRelativeTime } from '../lib/format'
import type { SaveState } from '../state/workspaceStore'
import { BacklinksPanel } from './BacklinksPanel'
import { DocumentEditor } from './DocumentEditor'

/** Remount the editor only when the document identity changes, not on every keystroke. */
const KeyedEditor = memo(DocumentEditor, (previous, next) => previous.document.id === next.document.id)

interface DocumentViewProps {
  document: DocumentRecord
  backlinks: Backlink[]
  saveState: SaveState
  canGoBack: boolean
  canGoForward: boolean
  dependencies: MentionDependencies
  onBack(): void
  onForward(): void
  onRename(title: string): void
  onChange(content: RichTextNode): void
  onNavigate(id: DocumentId): void
}

const SAVE_LABELS: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed'
}

export function DocumentView({
  document,
  backlinks,
  saveState,
  canGoBack,
  canGoForward,
  dependencies,
  onBack,
  onForward,
  onRename,
  onChange,
  onNavigate
}: DocumentViewProps): JSX.Element {
  return (
    <main className="document">
      <header className="document__toolbar">
        <div className="document__nav">
          <button
            type="button"
            className="button button--icon"
            onClick={onBack}
            disabled={!canGoBack}
            title="Back (Alt+←)"
            aria-label="Back"
          >
            ←
          </button>
          <button
            type="button"
            className="button button--icon"
            onClick={onForward}
            disabled={!canGoForward}
            title="Forward (Alt+→)"
            aria-label="Forward"
          >
            →
          </button>
        </div>

        <div className="document__status">
          <span className="document__updated">Edited {formatRelativeTime(document.updatedAt)}</span>
          <span className={`save-state save-state--${saveState}`}>{SAVE_LABELS[saveState]}</span>
        </div>
      </header>

      <div className="document__scroll">
        <div className="document__body">
          <input
            className="document__title"
            value={document.title}
            spellCheck={false}
            placeholder="Untitled"
            onChange={(event) => onRename(event.target.value)}
          />

          <KeyedEditor document={document} dependencies={dependencies} onChange={onChange} />

          <BacklinksPanel backlinks={backlinks} onNavigate={onNavigate} />
        </div>
      </div>
    </main>
  )
}
