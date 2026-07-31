import { basename, dirname, join } from 'node:path'

import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'

import { IpcChannel } from '@shared/types'
import type {
  CreateDocumentRequest,
  DocumentId,
  ExportRequest,
  ExportResult,
  RichTextNode,
  SearchRequest,
  UpdateDocumentRequest
} from '@shared/types'

import type { DocumentRepository } from './documentRepository'
import { exportDocumentTo, exportWorkspaceTo } from './exportService'
import { slugify } from './markdown'

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
    const removed = repository.delete(requireId(id))
    return removed ? { id: removed.id, title: removed.title } : null
  })

  ipcMain.handle(IpcChannel.DocumentsRestoreLast, () => repository.restoreLast())

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

  ipcMain.handle(
    IpcChannel.DocumentsExport,
    (event, request: unknown): Promise<ExportResult> => {
      const { scope, id } = requireObject<ExportRequest>(request)
      return scope === 'workspace'
        ? exportWorkspace(event, repository)
        : exportSingleDocument(event, repository, requireId(id))
    }
  )

  ipcMain.handle(IpcChannel.WorkspaceRevealStorage, () => {
    shell.showItemInFolder(storePath)
  })
}

async function exportSingleDocument(
  event: IpcMainInvokeEvent,
  repository: DocumentRepository,
  id: DocumentId
): Promise<ExportResult> {
  const document = repository.get(id)
  if (!document) throw new Error(`Document not found: ${id}`)

  const { canceled, filePath } = await dialog.showSaveDialog(windowFor(event), {
    title: 'Export document as Markdown',
    defaultPath: `${slugify(document.title) || 'untitled'}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })

  if (canceled || !filePath) return { canceled: true }

  const fileCount = await exportDocumentTo(withExtension(filePath), document, repository.all())
  return { canceled: false, path: filePath, fileCount }
}

async function exportWorkspace(
  event: IpcMainInvokeEvent,
  repository: DocumentRepository
): Promise<ExportResult> {
  const { canceled, filePaths } = await dialog.showOpenDialog(windowFor(event), {
    title: 'Choose a folder for the exported workspace',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Export here'
  })

  const target = filePaths?.[0]
  if (canceled || !target) return { canceled: true }

  // Export into a subfolder so we never scatter files into an existing directory.
  const directory = join(target, 'atlas-export')
  const fileCount = await exportWorkspaceTo(directory, repository.all())

  return { canceled: false, path: directory, fileCount }
}

function windowFor(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) throw new Error('No window for this request')
  return window
}

function withExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith('.md')
    ? filePath
    : join(dirname(filePath), `${basename(filePath)}.md`)
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
