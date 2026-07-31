/**
 * Types shared by the main process, the preload bridge and the renderer.
 *
 * The main process deliberately knows nothing about Tiptap: documents carry a
 * structural rich-text tree, so the editor can be swapped without touching
 * storage, search or the link index.
 */

export type DocumentId = string

export interface RichTextMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface RichTextNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: RichTextMark[]
  content?: RichTextNode[]
}

export interface DocumentRecord {
  id: DocumentId
  title: string
  content: RichTextNode
  createdAt: string
  updatedAt: string
}

/** Lightweight projection kept in renderer memory for lists and mention labels. */
export interface DocumentSummary {
  id: DocumentId
  title: string
  excerpt: string
  updatedAt: string
  /** Number of other documents referencing this one. */
  backlinkCount: number
}

export interface SearchHit {
  id: DocumentId
  title: string
  excerpt: string
  updatedAt: string
}

export interface Backlink {
  id: DocumentId
  title: string
  /** Text around the reference, so the panel shows context rather than a bare title. */
  context: string
  count: number
}

export interface SearchRequest {
  query: string
  excludeId?: DocumentId | null
  limit?: number
}

export interface CreateDocumentRequest {
  title?: string
}

export interface UpdateDocumentRequest {
  id: DocumentId
  title?: string
  content?: RichTextNode
}

/** A single document, or the whole workspace as a folder of linked files. */
export type ExportScope = 'document' | 'workspace'

export interface ExportRequest {
  scope: ExportScope
  id?: DocumentId
}

export type ExportResult =
  | { canceled: true }
  | { canceled: false; path: string; fileCount: number }

/** The node type used for cross-document references inside document content. */
export const MENTION_NODE_TYPE = 'documentMention'

/** Attribute holding the referenced document id on a mention node. */
export const MENTION_ID_ATTR = 'docId'

/** Snapshot of the referenced title, used as a fallback for deleted documents. */
export const MENTION_LABEL_ATTR = 'label'

export const IpcChannel = {
  DocumentsList: 'documents:list',
  DocumentsGet: 'documents:get',
  DocumentsCreate: 'documents:create',
  DocumentsUpdate: 'documents:update',
  DocumentsDelete: 'documents:delete',
  DocumentsRestoreLast: 'documents:restore-last',
  DocumentsSearch: 'documents:search',
  DocumentsBacklinks: 'documents:backlinks',
  DocumentsExport: 'documents:export',
  WorkspaceRevealStorage: 'workspace:reveal-storage'
} as const

/** The full surface exposed to the renderer through `window.api`. */
export interface DocumentsApi {
  list(): Promise<DocumentSummary[]>
  get(id: DocumentId): Promise<DocumentRecord | null>
  create(request?: CreateDocumentRequest): Promise<DocumentRecord>
  update(request: UpdateDocumentRequest): Promise<DocumentRecord>
  remove(id: DocumentId): Promise<DeletedDocument | null>
  /** Puts the most recently deleted document back, references and all. */
  restoreLast(): Promise<DocumentRecord | null>
  search(request: SearchRequest): Promise<SearchHit[]>
  backlinks(id: DocumentId): Promise<Backlink[]>
  export(request: ExportRequest): Promise<ExportResult>
}

/** What the renderer needs to offer an undo affordance after a deletion. */
export interface DeletedDocument {
  id: DocumentId
  title: string
}

export interface WorkspaceApi {
  revealStorage(): Promise<void>
}

export interface AppApi {
  documents: DocumentsApi
  workspace: WorkspaceApi
}
