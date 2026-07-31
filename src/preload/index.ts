import { contextBridge, ipcRenderer } from 'electron'

import { IpcChannel } from '@shared/types'
import type {
  AppApi,
  CreateDocumentRequest,
  DocumentId,
  ExportRequest,
  SearchRequest,
  UpdateDocumentRequest
} from '@shared/types'

/**
 * The only bridge between renderer and main. It exposes a fixed set of
 * operations — never `ipcRenderer` itself — so the renderer cannot reach
 * arbitrary channels.
 */
const api: AppApi = {
  documents: {
    list: () => ipcRenderer.invoke(IpcChannel.DocumentsList),
    get: (id: DocumentId) => ipcRenderer.invoke(IpcChannel.DocumentsGet, id),
    create: (request?: CreateDocumentRequest) =>
      ipcRenderer.invoke(IpcChannel.DocumentsCreate, request ?? {}),
    update: (request: UpdateDocumentRequest) =>
      ipcRenderer.invoke(IpcChannel.DocumentsUpdate, request),
    remove: (id: DocumentId) => ipcRenderer.invoke(IpcChannel.DocumentsDelete, id),
    restoreLast: () => ipcRenderer.invoke(IpcChannel.DocumentsRestoreLast),
    search: (request: SearchRequest) => ipcRenderer.invoke(IpcChannel.DocumentsSearch, request),
    backlinks: (id: DocumentId) => ipcRenderer.invoke(IpcChannel.DocumentsBacklinks, id),
    export: (request: ExportRequest) => ipcRenderer.invoke(IpcChannel.DocumentsExport, request)
  },
  workspace: {
    revealStorage: () => ipcRenderer.invoke(IpcChannel.WorkspaceRevealStorage)
  }
}

contextBridge.exposeInMainWorld('api', api)
