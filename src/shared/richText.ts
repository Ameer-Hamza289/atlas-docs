import {
  MENTION_ID_ATTR,
  MENTION_LABEL_ATTR,
  MENTION_NODE_TYPE,
  type DocumentId,
  type RichTextNode
} from './types'

/** Block-level nodes whose boundaries should become whitespace in plain text. */
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'horizontalRule'
])

export function createEmptyDocument(): RichTextNode {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

export function createParagraphDocument(paragraphs: string[]): RichTextNode {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: text ? [{ type: 'text', text }] : undefined
    }))
  }
}

function walk(node: RichTextNode | undefined, visit: (node: RichTextNode) => void): void {
  if (!node) return
  visit(node)
  for (const child of node.content ?? []) walk(child, visit)
}

export function isMentionNode(node: RichTextNode): boolean {
  return node.type === MENTION_NODE_TYPE
}

export function getMentionId(node: RichTextNode): DocumentId | null {
  const value = node.attrs?.[MENTION_ID_ATTR]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function getMentionLabel(node: RichTextNode): string {
  const value = node.attrs?.[MENTION_LABEL_ATTR]
  return typeof value === 'string' ? value : ''
}

/**
 * Flattens rich text to a searchable/previewable string. Mentions contribute
 * their label so a document can be found by the things it references.
 */
export function toPlainText(node: RichTextNode | undefined): string {
  const parts: string[] = []

  const visit = (current: RichTextNode | undefined): void => {
    if (!current) return
    if (current.text) parts.push(current.text)
    if (isMentionNode(current)) parts.push(`@${getMentionLabel(current)}`)

    for (const child of current.content ?? []) visit(child)

    if (current.type && BLOCK_TYPES.has(current.type)) parts.push('\n')
  }

  visit(node)

  return parts.join('').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
}

/** Unique ids of documents referenced from this content, in document order. */
export function collectMentionIds(node: RichTextNode | undefined): DocumentId[] {
  const ids: DocumentId[] = []
  const seen = new Set<DocumentId>()

  walk(node, (current) => {
    if (!isMentionNode(current)) return
    const id = getMentionId(current)
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  })

  return ids
}

export function countMentionsOf(node: RichTextNode | undefined, targetId: DocumentId): number {
  let count = 0
  walk(node, (current) => {
    if (isMentionNode(current) && getMentionId(current) === targetId) count += 1
  })
  return count
}

/**
 * Rewrites the cached label on mention nodes pointing at `targetId`.
 * Content stays the source of truth for offline/exported copies even though the
 * UI renders live titles.
 */
export function relabelMentions(
  node: RichTextNode,
  targetId: DocumentId,
  label: string
): RichTextNode {
  let changed = false

  const map = (current: RichTextNode): RichTextNode => {
    let next = current

    if (isMentionNode(current) && getMentionId(current) === targetId) {
      if (getMentionLabel(current) !== label) {
        changed = true
        next = { ...current, attrs: { ...current.attrs, [MENTION_LABEL_ATTR]: label } }
      }
    }

    if (next.content) {
      const content = next.content.map(map)
      if (content.some((child, index) => child !== next.content![index])) {
        next = { ...next, content }
      }
    }

    return next
  }

  const result = map(node)
  return changed ? result : node
}

/** Short snippet of text surrounding the first reference to `targetId`. */
export function mentionContext(
  node: RichTextNode | undefined,
  targetId: DocumentId,
  radius = 80
): string {
  const text = toPlainText(node)
  if (!text) return ''

  const label = findMentionLabel(node, targetId)
  const needle = label ? `@${label}` : ''
  const index = needle ? text.indexOf(needle) : -1
  if (index === -1) return truncate(text, radius * 2)

  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + needle.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''

  return `${prefix}${text.slice(start, end).trim()}${suffix}`
}

function findMentionLabel(node: RichTextNode | undefined, targetId: DocumentId): string {
  let label = ''
  walk(node, (current) => {
    if (!label && isMentionNode(current) && getMentionId(current) === targetId) {
      label = getMentionLabel(current)
    }
  })
  return label
}

export function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized
}
