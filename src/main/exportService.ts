import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { DocumentId, DocumentRecord } from '@shared/types'

import { buildFileNameMap, documentToMarkdown } from './markdown'

/**
 * File-system side of exporting. Kept apart from the dialogs in `ipc.ts` so it
 * can be tested against a temp directory without an Electron window.
 */

/** Writes one document. References resolve only if the target still exists. */
export async function exportDocumentTo(
  filePath: string,
  document: DocumentRecord,
  workspace: DocumentRecord[]
): Promise<number> {
  const fileNames = buildFileNameMap(workspace)

  const markdown = documentToMarkdown(document, {
    // Siblings are not written next to a single-document export, but the link
    // still tells the reader which file the reference points at.
    resolveLink: (id) => resolve(fileNames, id, document.id)
  })

  await writeFile(filePath, markdown, 'utf8')
  return 1
}

/** Writes the whole workspace as a folder of files that link to each other. */
export async function exportWorkspaceTo(
  directory: string,
  workspace: DocumentRecord[]
): Promise<number> {
  await mkdir(directory, { recursive: true })

  const fileNames = buildFileNameMap(workspace)

  await Promise.all(
    workspace.map((document) => {
      const markdown = documentToMarkdown(document, {
        resolveLink: (id) => resolve(fileNames, id, document.id)
      })
      return writeFile(join(directory, fileNames.get(document.id) ?? 'untitled.md'), markdown, 'utf8')
    })
  )

  await writeFile(join(directory, 'index.md'), buildIndex(workspace, fileNames), 'utf8')

  return workspace.length + 1
}

function resolve(
  fileNames: Map<DocumentId, string>,
  targetId: DocumentId,
  sourceId: DocumentId
): string | null {
  if (targetId === sourceId) return null

  const name = fileNames.get(targetId)
  return name ? `./${name}` : null
}

function buildIndex(
  workspace: DocumentRecord[],
  fileNames: Map<DocumentId, string>
): string {
  const entries = [...workspace]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((document) => `- [${document.title}](./${fileNames.get(document.id)})`)

  return `# Workspace\n\n${entries.join('\n')}\n`
}
