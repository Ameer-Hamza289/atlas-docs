import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  collectMentionIds,
  countMentionsOf,
  mentionContext,
  relabelMentions,
  toPlainText,
  truncate,
  createEmptyDocument
} from '@shared/richText'
import type {
  Backlink,
  DocumentId,
  DocumentRecord,
  DocumentSummary,
  RichTextNode,
  SearchHit
} from '@shared/types'

import { seedDocuments } from './seed'

interface StoreFile {
  version: number
  documents: DocumentRecord[]
}

const STORE_VERSION = 1
const SAVE_DEBOUNCE_MS = 250
/** Deletions are undoable for the session; the bin is not persisted. */
const TRASH_LIMIT = 20

/**
 * Owns every document mutation and the derived link index.
 *
 * Storage is a single JSON file written atomically (tmp file + rename) and
 * debounced, which keeps the app dependency-free while still being crash safe.
 * The interface is intentionally narrow so it can be replaced by SQLite later
 * without changing the IPC layer.
 */
export class DocumentRepository {
  private readonly filePath: string
  private documents = new Map<DocumentId, DocumentRecord>()
  /** target document id -> ids of documents referencing it. */
  private backlinkIndex = new Map<DocumentId, Set<DocumentId>>()
  /** Deleted documents, most recent last. In memory only. */
  private trash: DocumentRecord[] = []
  private saveTimer: NodeJS.Timeout | null = null
  private pendingWrite: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load(): Promise<void> {
    if (this.loaded) return

    const parsed = await this.readFromDisk()
    const documents = parsed?.documents?.length ? parsed.documents : seedDocuments()

    for (const document of documents) {
      const normalized = normalizeDocument(document)
      if (normalized) this.documents.set(normalized.id, normalized)
    }

    this.rebuildIndex()
    this.loaded = true

    if (!parsed) this.scheduleSave()
  }

  list(): DocumentSummary[] {
    return [...this.documents.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((document) => this.toSummary(document))
  }

  get(id: DocumentId): DocumentRecord | null {
    return this.documents.get(id) ?? null
  }

  create(title?: string): DocumentRecord {
    const now = new Date().toISOString()
    const document: DocumentRecord = {
      id: randomUUID(),
      title: normalizeTitle(title),
      content: createEmptyDocument(),
      createdAt: now,
      updatedAt: now
    }

    this.documents.set(document.id, document)
    this.indexDocument(document)
    this.scheduleSave()

    return document
  }

  update(id: DocumentId, patch: { title?: string; content?: RichTextNode }): DocumentRecord {
    const current = this.documents.get(id)
    if (!current) throw new Error(`Document not found: ${id}`)

    const title = patch.title === undefined ? current.title : normalizeTitle(patch.title)
    const content = patch.content ?? current.content
    const titleChanged = title !== current.title

    const next: DocumentRecord = {
      ...current,
      title,
      content,
      updatedAt: new Date().toISOString()
    }

    this.documents.set(id, next)
    this.indexDocument(next)

    // Keep the cached labels inside other documents in sync with the new title.
    if (titleChanged) this.relabelReferences(id, title)

    this.scheduleSave()
    return next
  }

  /** Removes a document and returns it, so the caller can offer an undo. */
  delete(id: DocumentId): DocumentRecord | null {
    const removed = this.documents.get(id)
    if (!removed) return null

    this.documents.delete(id)

    // Only the outgoing edges go away. Incoming edges are derived from other
    // documents' content, which still references this id, so they outlive the
    // target — references degrade to "unresolved" in the UI instead of silently
    // mutating other documents, and a restore re-resolves them for free.
    for (const sources of this.backlinkIndex.values()) sources.delete(id)
    this.trash.push(removed)
    if (this.trash.length > TRASH_LIMIT) this.trash.shift()

    this.scheduleSave()
    return removed
  }

  /**
   * Puts the most recently deleted document back under its original id, which
   * is what makes every reference to it resolve again.
   */
  restoreLast(): DocumentRecord | null {
    const restored = this.trash.pop()
    if (!restored) return null

    // A new document could have taken the id in the meantime (it cannot today,
    // ids are random, but restoring must never clobber live content).
    if (this.documents.has(restored.id)) return null

    this.documents.set(restored.id, restored)
    this.indexDocument(restored)
    this.scheduleSave()

    return restored
  }

  /** Full records, for exporting. */
  all(): DocumentRecord[] {
    return [...this.documents.values()].sort((a, b) => a.title.localeCompare(b.title))
  }

  search(query: string, excludeId?: DocumentId | null, limit = 8): SearchHit[] {
    const needle = query.trim().toLowerCase()

    const candidates = [...this.documents.values()].filter((document) => document.id !== excludeId)

    const scored = candidates
      .map((document) => ({ document, score: scoreDocument(document, needle) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || b.document.updatedAt.localeCompare(a.document.updatedAt)
      )
      .slice(0, limit)

    return scored.map(({ document }) => ({
      id: document.id,
      title: document.title,
      excerpt: excerptFor(document, needle),
      updatedAt: document.updatedAt
    }))
  }

  backlinks(id: DocumentId): Backlink[] {
    const sources = this.backlinkIndex.get(id)
    if (!sources?.size) return []

    return [...sources]
      .map((sourceId) => this.documents.get(sourceId))
      .filter((document): document is DocumentRecord => Boolean(document))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((document) => ({
        id: document.id,
        title: document.title,
        context: mentionContext(document.content, id),
        count: countMentionsOf(document.content, id)
      }))
  }

  /** Flush any debounced write; called before the app quits. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.enqueueWrite()
    }
    await this.pendingWrite
  }

  private toSummary(document: DocumentRecord): DocumentSummary {
    return {
      id: document.id,
      title: document.title,
      excerpt: truncate(toPlainText(document.content), 120),
      updatedAt: document.updatedAt,
      backlinkCount: this.backlinkIndex.get(document.id)?.size ?? 0
    }
  }

  private rebuildIndex(): void {
    this.backlinkIndex = new Map()
    for (const document of this.documents.values()) this.indexDocument(document)
  }

  private indexDocument(document: DocumentRecord): void {
    for (const sources of this.backlinkIndex.values()) sources.delete(document.id)

    for (const targetId of collectMentionIds(document.content)) {
      if (targetId === document.id) continue
      const sources = this.backlinkIndex.get(targetId) ?? new Set<DocumentId>()
      sources.add(document.id)
      this.backlinkIndex.set(targetId, sources)
    }
  }

  private relabelReferences(targetId: DocumentId, label: string): void {
    for (const sourceId of this.backlinkIndex.get(targetId) ?? []) {
      const source = this.documents.get(sourceId)
      if (!source) continue

      const content = relabelMentions(source.content, targetId, label)
      if (content !== source.content) this.documents.set(sourceId, { ...source, content })
    }
  }

  private async readFromDisk(): Promise<StoreFile | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as StoreFile
      if (!parsed || !Array.isArray(parsed.documents)) return null
      return parsed
    } catch {
      // Missing or corrupt store: fall back to seed content rather than crash.
      return null
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.enqueueWrite()
    }, SAVE_DEBOUNCE_MS)
  }

  private enqueueWrite(): void {
    const snapshot: StoreFile = {
      version: STORE_VERSION,
      documents: [...this.documents.values()]
    }

    this.pendingWrite = this.pendingWrite
      .then(() => writeAtomically(this.filePath, JSON.stringify(snapshot, null, 2)))
      .catch((error) => {
        console.error('[documents] failed to persist store', error)
      })
  }
}

async function writeAtomically(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.tmp`
  await writeFile(tempPath, contents, 'utf8')
  await rename(tempPath, filePath)
}

function normalizeTitle(title?: string): string {
  const trimmed = (title ?? '').trim()
  return trimmed.length > 0 ? trimmed.slice(0, 200) : 'Untitled'
}

function normalizeDocument(document: DocumentRecord): DocumentRecord | null {
  if (!document || typeof document.id !== 'string') return null
  const now = new Date().toISOString()

  return {
    id: document.id,
    title: normalizeTitle(document.title),
    content: document.content ?? createEmptyDocument(),
    createdAt: document.createdAt ?? now,
    updatedAt: document.updatedAt ?? now
  }
}

function scoreDocument(document: DocumentRecord, needle: string): number {
  // Empty query: everything matches, ordered by recency by the caller.
  if (!needle) return 1

  const title = document.title.toLowerCase()
  if (title === needle) return 120
  if (title.startsWith(needle)) return 100
  if (title.includes(needle)) return 70
  if (matchesInitials(title, needle)) return 50
  if (toPlainText(document.content).toLowerCase().includes(needle)) return 30

  return 0
}

/** "prd" matches "Product Requirements Doc". */
function matchesInitials(title: string, needle: string): boolean {
  if (needle.length < 2) return false
  const initials = title
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
  return initials.startsWith(needle)
}

function excerptFor(document: DocumentRecord, needle: string): string {
  const text = toPlainText(document.content)
  if (!text) return 'Empty document'
  if (!needle) return truncate(text, 90)

  const index = text.toLowerCase().indexOf(needle)
  if (index <= 0) return truncate(text, 90)

  const start = Math.max(0, index - 30)
  return `${start > 0 ? '…' : ''}${truncate(text.slice(start), 90)}`
}

export function defaultStorePath(userDataPath: string): string {
  return join(userDataPath, 'documents.json')
}
