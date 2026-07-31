import { describe, expect, it } from 'vitest'

import { MENTION_NODE_TYPE, type DocumentRecord, type RichTextNode } from '@shared/types'

import { buildFileNameMap, documentToMarkdown, slugify } from './markdown'

function text(value: string, marks?: string[]): RichTextNode {
  return { type: 'text', text: value, marks: marks?.map((type) => ({ type })) }
}

function paragraph(...content: RichTextNode[]): RichTextNode {
  return { type: 'paragraph', content }
}

function mention(docId: string, label: string): RichTextNode {
  return { type: MENTION_NODE_TYPE, attrs: { docId, label } }
}

function listItem(...content: RichTextNode[]): RichTextNode {
  return { type: 'listItem', content }
}

function document(content: RichTextNode[], overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc-1',
    title: 'Test Document',
    content: { type: 'doc', content },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('documentToMarkdown', () => {
  it('writes the title as a top-level heading', () => {
    const markdown = documentToMarkdown(document([paragraph(text('Body'))]))
    expect(markdown).toBe('# Test Document\n\nBody\n')
  })

  it('renders headings, clamping the level to valid Markdown', () => {
    const markdown = documentToMarkdown(
      document([
        { type: 'heading', attrs: { level: 2 }, content: [text('Section')] },
        { type: 'heading', attrs: { level: 99 }, content: [text('Too deep')] }
      ])
    )

    expect(markdown).toContain('## Section')
    expect(markdown).toContain('###### Too deep')
  })

  it('renders marks, and treats code as literal', () => {
    const markdown = documentToMarkdown(
      document([
        paragraph(
          text('bold', ['bold']),
          text(' '),
          text('italic', ['italic']),
          text(' '),
          text('gone', ['strike']),
          text(' '),
          text('a_b', ['code'])
        )
      ])
    )

    expect(markdown).toContain('**bold** *italic* ~~gone~~ `a_b`')
  })

  it('escapes Markdown syntax in plain text', () => {
    const markdown = documentToMarkdown(document([paragraph(text('a*b_c[d]'))]))
    expect(markdown).toContain('a\\*b\\_c\\[d\\]')
  })

  it('renders links from marks', () => {
    const markdown = documentToMarkdown(
      document([
        paragraph({
          type: 'text',
          text: 'Tiptap',
          marks: [{ type: 'link', attrs: { href: 'https://tiptap.dev' } }]
        })
      ])
    )

    expect(markdown).toContain('[Tiptap](https://tiptap.dev)')
  })

  it('renders bullet and ordered lists', () => {
    const markdown = documentToMarkdown(
      document([
        { type: 'bulletList', content: [listItem(paragraph(text('One'))), listItem(paragraph(text('Two')))] },
        { type: 'orderedList', attrs: { start: 3 }, content: [listItem(paragraph(text('Third')))] }
      ])
    )

    expect(markdown).toContain('- One\n- Two')
    expect(markdown).toContain('3. Third')
  })

  it('indents nested lists under their parent item', () => {
    const markdown = documentToMarkdown(
      document([
        {
          type: 'bulletList',
          content: [
            listItem(paragraph(text('Parent')), {
              type: 'bulletList',
              content: [listItem(paragraph(text('Child')))]
            })
          ]
        }
      ])
    )

    expect(markdown).toContain('- Parent\n  - Child')
  })

  it('renders blockquotes, code blocks and rules', () => {
    const markdown = documentToMarkdown(
      document([
        { type: 'blockquote', content: [paragraph(text('Quoted'))] },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1' }] },
        { type: 'horizontalRule' }
      ])
    )

    expect(markdown).toContain('> Quoted')
    expect(markdown).toContain('```ts\nconst a = 1\n```')
    expect(markdown).toContain('\n---')
  })

  it('renders a reference as a link when it resolves', () => {
    const markdown = documentToMarkdown(
      document([paragraph(text('See '), mention('target-1', 'Architecture'))]),
      { resolveLink: (id) => (id === 'target-1' ? './architecture.md' : null) }
    )

    expect(markdown).toContain('See [Architecture](./architecture.md)')
  })

  it('falls back to plain text for references that cannot be resolved', () => {
    const markdown = documentToMarkdown(
      document([paragraph(mention('deleted', 'Ghost Doc'))]),
      { resolveLink: () => null }
    )

    expect(markdown).toContain('@Ghost Doc')
    expect(markdown).not.toContain('](')
  })

  it('wraps link targets containing spaces', () => {
    const markdown = documentToMarkdown(document([paragraph(mention('a', 'A'))]), {
      resolveLink: () => './my file.md'
    })

    expect(markdown).toContain('[A](<./my file.md>)')
  })

  it('keeps text from block types it does not recognise', () => {
    const markdown = documentToMarkdown(
      document([{ type: 'somethingNew', content: [paragraph(text('Still here'))] }])
    )

    expect(markdown).toContain('Still here')
  })

  it('handles an empty document', () => {
    expect(documentToMarkdown(document([{ type: 'paragraph' }]))).toBe('# Test Document\n')
  })
})

describe('slugify', () => {
  it('produces filesystem-friendly names', () => {
    expect(slugify('Q3 Roadmap')).toBe('q3-roadmap')
    expect(slugify('  Hello / World!  ')).toBe('hello-world')
    expect(slugify('Café Notes')).toBe('cafe-notes')
  })

  it('returns an empty string when nothing usable remains', () => {
    expect(slugify('!!!')).toBe('')
  })
})

describe('buildFileNameMap', () => {
  it('disambiguates documents that share a title', () => {
    const documents = [
      document([], { id: 'a', title: 'Notes' }),
      document([], { id: 'b', title: 'Notes' }),
      document([], { id: 'c', title: '???' })
    ]

    const names = buildFileNameMap(documents)

    expect(names.get('a')).toBe('notes.md')
    expect(names.get('b')).toBe('notes-2.md')
    expect(names.get('c')).toBe('untitled.md')
  })

  it('is deterministic regardless of input order', () => {
    const first = document([], { id: 'a', title: 'Notes' })
    const second = document([], { id: 'b', title: 'Notes' })

    expect([...buildFileNameMap([first, second])]).toEqual([...buildFileNameMap([second, first])])
  })
})
