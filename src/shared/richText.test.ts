import { describe, expect, it } from 'vitest'

import {
  collectMentionIds,
  countMentionsOf,
  mentionContext,
  relabelMentions,
  toPlainText,
  truncate
} from './richText'
import { MENTION_NODE_TYPE, type RichTextNode } from './types'

function mention(docId: string, label: string): RichTextNode {
  return { type: MENTION_NODE_TYPE, attrs: { docId, label } }
}

function paragraph(...content: RichTextNode[]): RichTextNode {
  return { type: 'paragraph', content }
}

function doc(...content: RichTextNode[]): RichTextNode {
  return { type: 'doc', content }
}

function paragraphs(...texts: string[]): RichTextNode {
  return doc(...texts.map((text) => paragraph({ type: 'text', text })))
}

describe('toPlainText', () => {
  it('joins block content with line breaks', () => {
    const content = paragraphs('First line', 'Second line')
    expect(toPlainText(content)).toBe('First line\nSecond line')
  })

  it('includes mention labels so documents are findable by what they reference', () => {
    const content = doc(paragraph({ type: 'text', text: 'See ' }, mention('a', 'Roadmap')))
    expect(toPlainText(content)).toBe('See @Roadmap')
  })

  it('walks nested structures', () => {
    const content = doc({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph({ type: 'text', text: 'Nested' })] }]
    })
    expect(toPlainText(content)).toBe('Nested')
  })

  it('returns an empty string for empty or missing content', () => {
    expect(toPlainText(undefined)).toBe('')
    expect(toPlainText({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('')
  })
})

describe('collectMentionIds', () => {
  it('returns unique ids in document order', () => {
    const content = doc(
      paragraph(mention('b', 'B'), mention('a', 'A')),
      paragraph(mention('b', 'B'))
    )
    expect(collectMentionIds(content)).toEqual(['b', 'a'])
  })

  it('ignores mentions without an id', () => {
    const content = doc(paragraph({ type: MENTION_NODE_TYPE, attrs: { label: 'orphan' } }))
    expect(collectMentionIds(content)).toEqual([])
  })
})

describe('countMentionsOf', () => {
  it('counts every occurrence, not just distinct ones', () => {
    const content = doc(paragraph(mention('a', 'A'), mention('a', 'A')), paragraph(mention('b', 'B')))
    expect(countMentionsOf(content, 'a')).toBe(2)
    expect(countMentionsOf(content, 'missing')).toBe(0)
  })
})

describe('relabelMentions', () => {
  it('rewrites cached labels for the target document only', () => {
    const content = doc(paragraph(mention('a', 'Old'), mention('b', 'Other')))
    const next = relabelMentions(content, 'a', 'New')

    const [first, second] = next.content![0].content!
    expect(first.attrs?.label).toBe('New')
    expect(second.attrs?.label).toBe('Other')
  })

  it('returns the same object when nothing changed, so callers can skip a write', () => {
    const content = doc(paragraph(mention('a', 'Same')))
    expect(relabelMentions(content, 'a', 'Same')).toBe(content)
    expect(relabelMentions(content, 'unknown', 'Whatever')).toBe(content)
  })

  it('does not mutate the input', () => {
    const content = doc(paragraph(mention('a', 'Old')))
    relabelMentions(content, 'a', 'New')
    expect(content.content![0].content![0].attrs?.label).toBe('Old')
  })

  it('reaches mentions nested inside lists', () => {
    const content = doc({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph(mention('a', 'Old'))] }]
    })

    const next = relabelMentions(content, 'a', 'New')
    expect(next.content![0].content![0].content![0].content![0].attrs?.label).toBe('New')
  })
})

describe('mentionContext', () => {
  it('returns the text surrounding the reference', () => {
    const content = doc(
      paragraph(
        { type: 'text', text: 'Decision recorded in ' },
        mention('a', 'Architecture'),
        { type: 'text', text: ' for later.' }
      )
    )

    expect(mentionContext(content, 'a')).toBe('Decision recorded in @Architecture for later.')
  })

  it('trims long context with ellipses', () => {
    const filler = 'word '.repeat(60)
    const content = doc(paragraph({ type: 'text', text: filler }, mention('a', 'Target')))
    const context = mentionContext(content, 'a', 20)

    expect(context.startsWith('…')).toBe(true)
    expect(context).toContain('@Target')
    expect(context.length).toBeLessThan(60)
  })

  it('falls back to leading text when the reference is missing', () => {
    const content = paragraphs('Just some text')
    expect(mentionContext(content, 'missing')).toBe('Just some text')
  })
})

describe('truncate', () => {
  it('collapses whitespace and appends an ellipsis past the limit', () => {
    expect(truncate('a  b\n c', 20)).toBe('a b c')
    expect(truncate('abcdefghij', 5)).toBe('abcd…')
  })
})
