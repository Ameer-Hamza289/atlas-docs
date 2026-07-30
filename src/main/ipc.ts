import { ipcMain, shell } from 'electron'

import { IpcChannel } from '@shared/types'
import type {
  CreateDocumentRequest,
  DocumentId,
  RichTextNode,
  SearchRequest,
  UpdateDocumentRequest
} from '@shared/types'

import type { DocumentRepository } from './documentRepository'

/**
 * Every renderer request crosses this boundary, so arguments are validated here
 * rather than trusted. Handlers stay thin: all behaviour lives in the repository.
 */
export function registerIpcHandlers(repository: DocumentRepository, storePath: string): void {
  ipcMain.handle(IpcChannel.DocumentsList, () => repository.list())

  ipcMain.handle(IpcChannel.DocumentsGet, (_event, id: unknown) =>
    repository.get(requireId(id))
  )

  ipcMain.handle(IpcChannel.DocumentsCreate, (_event, request: unknown) => {
    const { title } = (request ?? {}) as CreateDocumentRequest
    return repository.create(typeof title === 'string' ? title : undefined)
  })

  ipcMain.handle(IpcChannel.DocumentsUpdate, (_event, request: unknown) => {
    const { id, title, content } = requireObject<UpdateDocumentRequest>(request)
    return repository.update(requireId(id), {
      title: typeof title === 'string' ? title : undefined,
      content: isRichTextNode(content) ? content : undefined
    })
  })

  ipcMain.handle(IpcChannel.DocumentsDelete, (_event, id: unknown) => {
    repository.delete(requireId(id))
  })

  ipcMain.handle(IpcChannel.DocumentsSearch, (_event, request: unknown) => {
    const { query, excludeId, limit } = requireObject<SearchRequest>(request)
    return repository.search(
      typeof query === 'string' ? query : '',
      typeof excludeId === 'string' ? excludeId : null,
      typeof limit === 'number' ? Math.min(Math.max(limit, 1), 25) : undefined
    )
  })

  ipcMain.handle(IpcChannel.DocumentsBacklinks, (_event, id: unknown) =>
    repository.backlinks(requireId(id))
  )

  ipcMain.handle(IpcChannel.WorkspaceRevealStorage, () => {
    shell.showItemInFolder(storePath)
  })
}

function requireObject<T>(value: unknown): Partial<T> {
  if (!value || typeof value !== 'object') throw new Error('Invalid request payload')
  return value as Partial<T>
}

function requireId(value: unknown): DocumentId {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid document id')
  return value
}

function isRichTextNode(value: unknown): value is RichTextNode {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
