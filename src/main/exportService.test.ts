import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MENTION_NODE_TYPE, type DocumentRecord } from '@shared/types'

import { exportDocumentTo, exportWorkspaceTo } from './exportService'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atlas-export-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function makeDocument(id: string, title: string, references: string[] = []): DocumentRecord {
  return {
    id,
    title,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Body of ' },
            { type: 'text', text: title },
            ...references.map((target) => ({
              type: MENTION_NODE_TYPE,
              attrs: { docId: target, label: target }
            }))
          ]
        }
      ]
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('exportWorkspaceTo', () => {
  it('writes one file per document plus an index', async () => {
    const workspace = [makeDocument('a', 'Alpha', ['b']), makeDocument('b', 'Beta')]
    const target = join(directory, 'out')

    const fileCount = await exportWorkspaceTo(target, workspace)

    expect(fileCount).toBe(3)
    expect((await readdir(target)).sort()).toEqual(['alpha.md', 'beta.md', 'index.md'])
  })

  it('renders references as relative links between the exported files', async () => {
    const workspace = [makeDocument('a', 'Alpha', ['b']), makeDocument('b', 'Beta')]
    const target = join(directory, 'out')

    await exportWorkspaceTo(target, workspace)
    const alpha = await readFile(join(target, 'alpha.md'), 'utf8')

    expect(alpha).toContain('[b](./beta.md)')
    expect(alpha.startsWith('# Alpha')).toBe(true)
  })

  it('lists every document in the index', async () => {
    const workspace = [makeDocument('a', 'Alpha'), makeDocument('b', 'Beta')]
    const target = join(directory, 'out')

    await exportWorkspaceTo(target, workspace)
    const index = await readFile(join(target, 'index.md'), 'utf8')

    expect(index).toContain('- [Alpha](./alpha.md)')
    expect(index).toContain('- [Beta](./beta.md)')
  })

  it('leaves references to missing documents as plain text', async () => {
    const workspace = [makeDocument('a', 'Alpha', ['deleted'])]
    const target = join(directory, 'out')

    await exportWorkspaceTo(target, workspace)
    const alpha = await readFile(join(target, 'alpha.md'), 'utf8')

    expect(alpha).toContain('@deleted')
    expect(alpha).not.toContain('](./deleted')
  })

  it('creates the target directory if it does not exist', async () => {
    const target = join(directory, 'nested', 'deeper')
    await exportWorkspaceTo(target, [makeDocument('a', 'Alpha')])

    expect(await readdir(target)).toContain('alpha.md')
  })
})

describe('exportDocumentTo', () => {
  it('writes a single file and names the referenced document', async () => {
    const workspace = [makeDocument('a', 'Alpha', ['b']), makeDocument('b', 'Beta')]
    const filePath = join(directory, 'alpha.md')

    const fileCount = await exportDocumentTo(filePath, workspace[0], workspace)
    const markdown = await readFile(filePath, 'utf8')

    expect(fileCount).toBe(1)
    expect(markdown).toContain('[b](./beta.md)')
    expect(await readdir(directory)).toEqual(['alpha.md'])
  })

  it('does not link a document to itself', async () => {
    const self = makeDocument('a', 'Alpha', ['a'])
    const filePath = join(directory, 'alpha.md')

    await exportDocumentTo(filePath, self, [self])

    expect(await readFile(filePath, 'utf8')).toContain('@a')
  })
})
