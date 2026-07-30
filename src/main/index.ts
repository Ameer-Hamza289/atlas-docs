import { join } from 'node:path'

import { app, BrowserWindow, shell } from 'electron'

import { DocumentRepository, defaultStorePath } from './documentRepository'
import { registerIpcHandlers } from './ipc'

const isDev = !app.isPackaged

let repository: DocumentRepository | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111318',
    title: 'Atlas',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })

  window.once('ready-to-show', () => window.show())

  // Anything that is not the app itself opens in the user's browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

async function bootstrap(): Promise<void> {
  const storePath = defaultStorePath(app.getPath('userData'))

  repository = new DocumentRepository(storePath)
  await repository.load()

  registerIpcHandlers(repository, storePath)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error('[main] failed to start', error)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Debounced writes must land before the process goes away.
app.on('before-quit', (event) => {
  if (!repository) return

  const pending = repository
  repository = null
  event.preventDefault()

  pending
    .flush()
    .catch((error) => console.error('[main] failed to flush documents', error))
    .finally(() => app.quit())
})
