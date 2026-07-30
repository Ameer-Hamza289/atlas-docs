import { useSyncExternalStore } from 'react'

import type {
  Backlink,
  DocumentId,
  DocumentRecord,
  DocumentSummary,
  RichTextNode,
  SearchHit
} from '@shared/types'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface WorkspaceState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  documents: DocumentSummary[]
  activeId: DocumentId | null
  activeDocument: DocumentRecord | null
  backlinks: Backlink[]
  saveState: SaveState
  history: DocumentId[]
  historyIndex: number
}

interface PendingPatch {
  id: DocumentId
  title?: string
  content?: RichTextNode
}

const AUTOSAVE_DEBOUNCE_MS = 400

const initialState: WorkspaceState = {
  status: 'loading',
  error: null,
  documents: [],
  activeId: null,
  activeDocument: null,
  backlinks: [],
  saveState: 'idle',
  history: [],
  historyIndex: -1
}

/**
 * Single source of truth for the renderer.
 *
 * It is a plain observable object rather than a React context so that code
 * outside the component tree — Tiptap node views and the mention suggestion
 * plugin — can read titles and trigger navigation without prop drilling.
 */
class WorkspaceStore {
  private state = initialState
  private listeners = new Set<() => void>()

  private pending: PendingPatch | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saveChain: Promise<void> = Promise.resolve()
  /** Guards against a slow `get` overwriting a newer navigation. */
  private loadToken = 0

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getState = (): WorkspaceState => this.state

  async init(): Promise<void> {
    try {
      const documents = await window.api.documents.list()
      this.patch({ documents, status: 'ready' })
      if (documents.length > 0) await this.open(documents[0].id)
    } catch (error) {
      this.fail(error)
    }
  }

  async open(id: DocumentId, options: { history?: boolean } = {}): Promise<void> {
    const { history = true } = options
    if (id === this.state.activeId) return

    await this.flush()

    const token = ++this.loadToken
    if (history) this.pushHistory(id)
    this.patch({ activeId: id, saveState: 'idle' })

    try {
      const [document, backlinks] = await Promise.all([
        window.api.documents.get(id),
        window.api.documents.backlinks(id)
      ])
      if (token !== this.loadToken) return

      this.patch({ activeDocument: document, backlinks })
    } catch (error) {
      this.fail(error)
    }
  }

  async createDocument(title?: string): Promise<DocumentRecord | null> {
    try {
      await this.flush()
      const document = await window.api.documents.create({ title })

      this.loadToken += 1
      this.pushHistory(document.id)
      this.patch({
        activeId: document.id,
        activeDocument: document,
        backlinks: [],
        saveState: 'idle'
      })
      await this.refreshDocuments()

      return document
    } catch (error) {
      this.fail(error)
      return null
    }
  }

  /** Creates a document without navigating to it — used by the @ menu. */
  async createReferenceTarget(title: string): Promise<DocumentRecord | null> {
    try {
      const document = await window.api.documents.create({ title })
      await this.refreshDocuments()
      return document
    } catch (error) {
      this.fail(error)
      return null
    }
  }

  rename(title: string): void {
    const { activeDocument } = this.state
    if (!activeDocument) return

    this.patch({ activeDocument: { ...activeDocument, title } })
    this.queueSave({ id: activeDocument.id, title })
  }

  setContent(content: RichTextNode): void {
    const { activeDocument } = this.state
    if (!activeDocument) return

    this.patch({ activeDocument: { ...activeDocument, content } })
    this.queueSave({ id: activeDocument.id, content })
  }

  async deleteDocument(id: DocumentId): Promise<void> {
    try {
      if (this.pending?.id === id) this.cancelPending()
      await window.api.documents.remove(id)

      const remaining = this.state.documents.filter((document) => document.id !== id)
      const history = this.state.history.filter((entry) => entry !== id)

      this.patch({
        documents: remaining,
        history,
        historyIndex: Math.min(this.state.historyIndex, history.length - 1)
      })

      if (this.state.activeId === id) {
        this.patch({ activeId: null, activeDocument: null, backlinks: [] })
        if (remaining.length > 0) await this.open(remaining[0].id)
      }

      await this.refreshDocuments()
      await this.refreshBacklinks()
    } catch (error) {
      this.fail(error)
    }
  }

  search(query: string, excludeId?: DocumentId | null): Promise<SearchHit[]> {
    return window.api.documents.search({ query, excludeId, limit: 8 })
  }

  canGoBack(): boolean {
    return this.state.historyIndex > 0
  }

  canGoForward(): boolean {
    return this.state.historyIndex < this.state.history.length - 1
  }

  async goBack(): Promise<void> {
    if (!this.canGoBack()) return
    const index = this.state.historyIndex - 1
    this.patch({ historyIndex: index })
    await this.open(this.state.history[index], { history: false })
  }

  async goForward(): Promise<void> {
    if (!this.canGoForward()) return
    const index = this.state.historyIndex + 1
    this.patch({ historyIndex: index })
    await this.open(this.state.history[index], { history: false })
  }

  titleFor(id: DocumentId): string | null {
    return this.state.documents.find((document) => document.id === id)?.title ?? null
  }

  /** Writes any debounced edit immediately (navigation, delete, unload). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.commit()
    }
    await this.saveChain
  }

  private queueSave(patch: Omit<PendingPatch, 'id'> & { id: DocumentId }): void {
    // A patch for a different document means navigation happened mid-edit.
    if (this.pending && this.pending.id !== patch.id) this.commit()

    this.pending = { ...this.pending, ...patch }
    this.patch({ saveState: 'saving' })

    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.commit()
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  private cancelPending(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.pending = null
  }

  private commit(): void {
    const patch = this.pending
    this.pending = null
    if (!patch) return

    this.saveChain = this.saveChain
      .then(async () => {
        await window.api.documents.update(patch)
        await this.refreshDocuments()
        await this.refreshBacklinks()
        if (!this.pending) this.patch({ saveState: 'saved' })
      })
      .catch((error) => {
        this.patch({ saveState: 'error' })
        this.fail(error)
      })
  }

  private async refreshDocuments(): Promise<void> {
    const documents = await window.api.documents.list()
    this.patch({ documents })
  }

  private async refreshBacklinks(): Promise<void> {
    const { activeId } = this.state
    if (!activeId) return

    const backlinks = await window.api.documents.backlinks(activeId)
    if (activeId === this.state.activeId) this.patch({ backlinks })
  }

  private pushHistory(id: DocumentId): void {
    const history = [...this.state.history.slice(0, this.state.historyIndex + 1), id]
    this.patch({ history, historyIndex: history.length - 1 })
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[workspace]', error)
    this.patch({ error: message, status: this.state.status === 'loading' ? 'error' : 'ready' })
  }

  private patch(partial: Partial<WorkspaceState>): void {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) listener()
  }
}

export const workspace = new WorkspaceStore()

export function useWorkspace<T>(selector: (state: WorkspaceState) => T): T {
  return useSyncExternalStore(workspace.subscribe, () => selector(workspace.getState()))
}

/** Live title lookup used by mention node views; `null` means unresolved. */
export function useDocumentTitle(id: DocumentId): string | null {
  return useWorkspace((state) => state.documents.find((doc) => doc.id === id)?.title ?? null)
}
