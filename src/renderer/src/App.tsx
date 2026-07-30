import { useEffect, type JSX } from 'react'

import type { DocumentId } from '@shared/types'

import { DocumentView } from './components/DocumentView'
import { Sidebar } from './components/Sidebar'
import type { MentionDependencies } from './editor/types'
import { useWorkspace, workspace } from './state/workspaceStore'

/**
 * Stable module-level bindings: the editor holds on to these for its lifetime,
 * so they must not be recreated per render.
 */
const mentionDependencies: MentionDependencies = {
  search: (query) => workspace.search(query, workspace.getState().activeId),
  createDocument: async (title) => {
    const created = await workspace.createReferenceTarget(title)
    return created ? { id: created.id, title: created.title } : null
  },
  navigate: (id) => void workspace.open(id)
}

const openDocument = (id: DocumentId): void => void workspace.open(id)

export function App(): JSX.Element {
  const status = useWorkspace((state) => state.status)
  const error = useWorkspace((state) => state.error)
  const documents = useWorkspace((state) => state.documents)
  const activeId = useWorkspace((state) => state.activeId)
  const activeDocument = useWorkspace((state) => state.activeDocument)
  const backlinks = useWorkspace((state) => state.backlinks)
  const saveState = useWorkspace((state) => state.saveState)
  const canGoBack = useWorkspace((state) => state.historyIndex > 0)
  const canGoForward = useWorkspace((state) => state.historyIndex < state.history.length - 1)

  useEffect(() => {
    void workspace.init()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const accelerator = event.ctrlKey || event.metaKey

      if (accelerator && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void workspace.createDocument()
      } else if (accelerator && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        document.getElementById('sidebar-filter')?.focus()
      } else if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault()
        void workspace.goBack()
      } else if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault()
        void workspace.goForward()
      }
    }

    // Debounced edits must reach disk even if the window goes away.
    const onBeforeUnload = (): void => void workspace.flush()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('blur', onBeforeUnload)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('blur', onBeforeUnload)
    }
  }, [])

  const handleDelete = (id: DocumentId): void => {
    const summary = documents.find((entry) => entry.id === id)
    const confirmed = window.confirm(
      `Delete “${summary?.title ?? 'this document'}”?\n\n` +
        'References to it in other documents will remain, marked as unresolved.'
    )
    if (confirmed) void workspace.deleteDocument(id)
  }

  if (status === 'loading') {
    return <div className="app app--loading">Loading workspace…</div>
  }

  return (
    <div className="app">
      <Sidebar
        documents={documents}
        activeId={activeId}
        onSelect={openDocument}
        onCreate={() => void workspace.createDocument()}
        onDelete={handleDelete}
        onRevealStorage={() => void window.api.workspace.revealStorage()}
      />

      {activeDocument ? (
        <DocumentView
          document={activeDocument}
          backlinks={backlinks}
          saveState={saveState}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          dependencies={mentionDependencies}
          onBack={() => void workspace.goBack()}
          onForward={() => void workspace.goForward()}
          onRename={(title) => workspace.rename(title)}
          onChange={(content) => workspace.setContent(content)}
          onNavigate={openDocument}
        />
      ) : (
        <main className="document document--empty">
          <div>
            <h1>No document open</h1>
            <p>Create one to get started, or pick a document from the sidebar.</p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void workspace.createDocument()}
            >
              New document
            </button>
          </div>
        </main>
      )}

      {error ? <div className="toast toast--error">{error}</div> : null}
    </div>
  )
}
