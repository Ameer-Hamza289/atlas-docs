import type { JSX } from 'react'

import type { Notice } from '../state/workspaceStore'

interface NoticeBarProps {
  notice: Notice
  onUndo(): void
  onDismiss(): void
}

/** Transient feedback: deletion undo, export confirmations and errors. */
export function NoticeBar({ notice, onUndo, onDismiss }: NoticeBarProps): JSX.Element {
  return (
    <div className={`notice notice--${notice.kind}`} role="status">
      <span className="notice__message">{notice.message}</span>

      {notice.kind === 'undo-delete' ? (
        <button type="button" className="notice__action" onClick={onUndo}>
          Undo
        </button>
      ) : null}

      <button type="button" className="notice__close" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
