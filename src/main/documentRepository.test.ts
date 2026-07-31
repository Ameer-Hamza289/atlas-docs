import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MENTION_NODE_TYPE, type RichTextNode } from '@shared/types'

import { DocumentRepository, defaultStorePath } from './documentRepository'

let directory: string
let storePath: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atlas-repo-'))
  storePath = defaultStorePath(directory)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function loadRepository(): Promise<DocumentRepository> {
  const repository = new DocumentRepository(storePath)
  await repository.load()
  return repository
}

function contentWithMentions(...mentions: { id: string; label: string }[]): RichTextNode {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Links to ' },
          ...mentions.map(({ id, label }) => ({
            type: MENTION_NODE_TYPE,
            attrs: { docId: id, label }
          }))
        ]
      }
    ]
  }
}

describe('load', () => {
  it('seeds a fresh workspace with cross-referencing documents', async () => {
    const repository = await loadRepository()
    const documents = repository.list()

    expect(documents.length).toBeGreaterThan(1)
    expect(documents.some((document) => document.backlinkCount > 0)).toBe(true)
  })

  it('falls back to seed content when the store file is corrupt', async () => {
    await writeFile(storePath, '{ not json', 'utf8')

    const repository = await loadRepository()
    expect(repository.list().length).toBeGreaterThan(0)
  })

  it('reads documents back from disk after a flush', async () => {
    const first = await loadRepository()
    const created = first.create('Persisted')
    first.update(created.id, { content: contentWithMentions() })
    await first.flush()

    const second = await loadRepository()
    expect(second.get(created.id)?.title).toBe('Persisted')
    expect(JSON.parse(await readFile(storePath, 'utf8')).version).toBe(1)
  })
})

describe('create and update', () => {
  it('defaults an untitled document and lists it first', async () => {
    const repository = await loadRepository()
    const created = repository.create()

    expect(created.title).toBe('Untitled')
    expect(repository.list()[0].id).toBe(created.id)
  })

  it('rejects updates to unknown documents', async () => {
    const repository = await loadRepository()
    expect(() => repository.update('missing', { title: 'x' })).toThrow(/not found/i)
  })

  it('trims titles and falls back to Untitled when blank', async () => {
    const repository = await loadRepository()
    const created = repository.create('  Spaced  ')
    expect(created.title).toBe('Spaced')
    expect(repository.update(created.id, { title: '   ' }).title).toBe('Untitled')
  })
})

describe('backlinks', () => {
  it('indexes references and reports count and context', async () => {
    const repository = await loadRepository()
    const target = repository.create('Target')
    const source = repository.create('Source')

    repository.update(source.id, {
      content: contentWithMentions(
        { id: target.id, label: 'Target' },
        { id: target.id, label: 'Target' }
      )
    })

    const backlinks = repository.backlinks(target.id)
    expect(backlinks).toHaveLength(1)
    expect(backlinks[0]).toMatchObject({ id: source.id, title: 'Source', count: 2 })
    expect(backlinks[0].context).toContain('@Target')
    expect(repository.list().find((entry) => entry.id === target.id)?.backlinkCount).toBe(1)
  })

  it('drops references that an edit removed', async () => {
    const repository = await loadRepository()
    const target = repository.create('Target')
    const source = repository.create('Source')

    repository.update(source.id, { content: contentWithMentions({ id: target.id, label: 'Target' }) })
    expect(repository.backlinks(target.id)).toHaveLength(1)

    repository.update(source.id, { content: contentWithMentions() })
    expect(repository.backlinks(target.id)).toHaveLength(0)
  })

  it('ignores self-references', async () => {
    const repository = await loadRepository()
    const document = repository.create('Self')

    repository.update(document.id, {
      content: contentWithMentions({ id: document.id, label: 'Self' })
    })

    expect(repository.backlinks(document.id)).toHaveLength(0)
  })
})

describe('rename propagation', () => {
  it('rewrites cached labels in every referencing document', async () => {
    const repository = await loadRepository()
    const target = repository.create('Old Name')
    const source = repository.create('Source')

    repository.update(source.id, {
      content: contentWithMentions({ id: target.id, label: 'Old Name' })
    })
    repository.update(target.id, { title: 'New Name' })

    const paragraph = repository.get(source.id)?.content.content?.[0].content ?? []
    const mention = paragraph.find((node) => node.type === MENTION_NODE_TYPE)

    expect(mention?.attrs?.label).toBe('New Name')
  })

  it('leaves other documents untouched when only content changes', async () => {
    const repository = await loadRepository()
    const target = repository.create('Target')
    const source = repository.create('Source')

    repository.update(source.id, { content: contentWithMentions({ id: target.id, label: 'Target' }) })
    const before = repository.get(source.id)

    repository.update(target.id, { content: contentWithMentions() })

    expect(repository.get(source.id)).toBe(before)
  })
})

describe('delete and restore', () => {
  it('returns the removed document and keeps references intact', async () => {
    const repository = await loadRepository()
    const target = repository.create('Doomed')
    const source = repository.create('Source')
    repository.update(source.id, { content: contentWithMentions({ id: target.id, label: 'Doomed' }) })

    const removed = repository.delete(target.id)

    expect(removed?.title).toBe('Doomed')
    expect(repository.get(target.id)).toBeNull()

    // The reference survives in the source document, now unresolved.
    const paragraph = repository.get(source.id)?.content.content?.[0].content ?? []
    expect(paragraph.some((node) => node.attrs?.docId === target.id)).toBe(true)

    // The index is derived from content, so it still records who points here.
    expect(repository.backlinks(target.id).map((entry) => entry.id)).toEqual([source.id])
  })

  it('forgets the outgoing references of a deleted document', async () => {
    const repository = await loadRepository()
    const target = repository.create('Target')
    const source = repository.create('Doomed Source')
    repository.update(source.id, { content: contentWithMentions({ id: target.id, label: 'Target' }) })

    repository.delete(source.id)

    expect(repository.backlinks(target.id)).toHaveLength(0)
    expect(repository.list().find((entry) => entry.id === target.id)?.backlinkCount).toBe(0)
  })

  it('returns null when deleting something that is not there', async () => {
    const repository = await loadRepository()
    expect(repository.delete('missing')).toBeNull()
  })

  it('restores the last deletion under its original id, re-resolving references', async () => {
    const repository = await loadRepository()
    const target = repository.create('Doomed')
    const source = repository.create('Source')
    repository.update(source.id, { content: contentWithMentions({ id: target.id, label: 'Doomed' }) })

    repository.delete(target.id)
    const restored = repository.restoreLast()

    expect(restored?.id).toBe(target.id)
    expect(repository.get(target.id)?.title).toBe('Doomed')
    expect(repository.backlinks(target.id)).toHaveLength(1)
  })

  it('undoes deletions most recent first, then reports nothing left', async () => {
    const repository = await loadRepository()
    const first = repository.create('First')
    const second = repository.create('Second')

    repository.delete(first.id)
    repository.delete(second.id)

    expect(repository.restoreLast()?.id).toBe(second.id)
    expect(repository.restoreLast()?.id).toBe(first.id)
    expect(repository.restoreLast()).toBeNull()
  })

  it('persists a restored document', async () => {
    const first = await loadRepository()
    const created = first.create('Comes Back')
    first.delete(created.id)
    first.restoreLast()
    await first.flush()

    const second = await loadRepository()
    expect(second.get(created.id)?.title).toBe('Comes Back')
  })
})

describe('search', () => {
  it('ranks exact and prefix title matches above body matches', async () => {
    const repository = await loadRepository()
    const exact = repository.create('Roadmap')
    const prefix = repository.create('Roadmap Planning')
    const body = repository.create('Unrelated Title')
    repository.update(body.id, {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'roadmap notes' }] }] }
    })

    const ids = repository.search('roadmap', null, 10).map((hit) => hit.id)

    expect(ids.indexOf(exact.id)).toBeLessThan(ids.indexOf(prefix.id))
    expect(ids.indexOf(prefix.id)).toBeLessThan(ids.indexOf(body.id))
  })

  it('matches title initials', async () => {
    const repository = await loadRepository()
    const created = repository.create('Product Requirements Doc')

    expect(repository.search('prd', null, 10).map((hit) => hit.id)).toContain(created.id)
  })

  it('excludes the current document and honours the limit', async () => {
    const repository = await loadRepository()
    const current = repository.create('Meeting Notes')
    repository.create('Meeting Agenda')

    const hits = repository.search('meeting', current.id, 10)
    expect(hits.map((hit) => hit.id)).not.toContain(current.id)
    expect(repository.search('', null, 2)).toHaveLength(2)
  })

  it('returns nothing for a query that matches nothing', async () => {
    const repository = await loadRepository()
    expect(repository.search('zzzzzzz', null, 10)).toEqual([])
  })

  it('describes empty documents in the excerpt', async () => {
    const repository = await loadRepository()
    const created = repository.create('Blank')

    const hit = repository.search('blank', null, 10).find((entry) => entry.id === created.id)
    expect(hit?.excerpt).toBe('Empty document')
  })
})
