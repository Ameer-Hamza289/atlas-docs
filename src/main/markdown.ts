import { getMentionId, getMentionLabel, isMentionNode } from '@shared/richText'
import type { DocumentId, DocumentRecord, RichTextMark, RichTextNode } from '@shared/types'

export interface MarkdownOptions {
  /**
   * Resolves a referenced document to a link target. Returning `null` renders
   * the reference as plain text — the right behaviour for a deleted document, or
   * for a target that is not part of this export.
   */
  resolveLink?: (id: DocumentId) => string | null
}

/** Characters that would otherwise be read as Markdown syntax inside a text run. */
const ESCAPE_PATTERN = /([\\`*_[\]<>])/g

export function documentToMarkdown(
  document: DocumentRecord,
  options: MarkdownOptions = {}
): string {
  const body = renderBlocks(document.content?.content ?? [], options)
  return `${`# ${document.title}\n\n${body}`.trimEnd()}\n`
}

function renderBlocks(nodes: RichTextNode[], options: MarkdownOptions): string {
  return nodes
    .map((node) => renderBlock(node, options))
    .filter((block) => block.length > 0)
    .join('\n\n')
}

function renderBlock(node: RichTextNode, options: MarkdownOptions): string {
  switch (node.type) {
    case 'heading': {
      const level = clampLevel(node.attrs?.level)
      return `${'#'.repeat(level)} ${renderInline(node.content ?? [], options)}`
    }

    case 'paragraph':
      return renderInline(node.content ?? [], options)

    case 'bulletList':
      return renderList(node, options, () => '- ')

    case 'orderedList': {
      const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
      return renderList(node, options, (index) => `${start + index}. `)
    }

    case 'blockquote':
      return prefixLines(renderBlocks(node.content ?? [], options), '> ')

    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      return `\`\`\`${language}\n${plainText(node.content ?? [])}\n\`\`\``
    }

    case 'horizontalRule':
      return '---'

    default:
      // Unknown block: keep the text rather than dropping the user's content.
      return node.content ? renderBlocks(node.content, options) : ''
  }
}

/**
 * Nesting is handled purely by indenting continuation lines, so a list renders
 * the same whatever depth it sits at.
 */
function renderList(
  node: RichTextNode,
  options: MarkdownOptions,
  marker: (index: number) => string
): string {
  return (node.content ?? [])
    .map((item, index) => {
      const bullet = marker(index)
      const padding = ' '.repeat(bullet.length)
      const [first, ...rest] = renderListItem(item.content ?? [], options).split('\n')

      return [`${bullet}${first}`, ...rest.map((line) => (line ? `${padding}${line}` : line))].join(
        '\n'
      )
    })
    .join('\n')
}

function renderListItem(nodes: RichTextNode[], options: MarkdownOptions): string {
  return nodes.reduce((accumulated, node, index) => {
    const block = renderBlock(node, options)
    if (index === 0) return block

    // Keep nested lists tight against their parent item; other blocks get a gap.
    const separator = node.type === 'bulletList' || node.type === 'orderedList' ? '\n' : '\n\n'
    return `${accumulated}${separator}${block}`
  }, '')
}

function renderInline(nodes: RichTextNode[], options: MarkdownOptions): string {
  return nodes.map((node) => renderInlineNode(node, options)).join('')
}

function renderInlineNode(node: RichTextNode, options: MarkdownOptions): string {
  if (isMentionNode(node)) return renderMention(node, options)
  if (node.type === 'hardBreak') return '  \n'

  if (typeof node.text === 'string') {
    return applyMarks(escapeText(node.text), node.marks ?? [])
  }

  return node.content ? renderInline(node.content, options) : ''
}

function renderMention(node: RichTextNode, options: MarkdownOptions): string {
  const label = getMentionLabel(node) || 'Untitled'
  const id = getMentionId(node)
  const target = id ? options.resolveLink?.(id) : null

  return target ? `[${escapeText(label)}](${encodeTarget(target)})` : `@${escapeText(label)}`
}

function applyMarks(text: string, marks: RichTextMark[]): string {
  // `code` wins: its content is literal, so other marks cannot apply inside it.
  if (marks.some((mark) => mark.type === 'code')) return `\`${text.replace(/\\(.)/g, '$1')}\``

  let result = text

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        result = `**${result}**`
        break
      case 'italic':
        result = `*${result}*`
        break
      case 'strike':
        result = `~~${result}~~`
        break
      case 'underline':
        // Markdown has no underline; emphasis is the closest honest mapping.
        result = `*${result}*`
        break
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''
        if (href) result = `[${result}](${encodeTarget(href)})`
        break
      }
      default:
        break
    }
  }

  return result
}

function plainText(nodes: RichTextNode[]): string {
  return nodes.map((node) => node.text ?? plainText(node.content ?? [])).join('')
}

function escapeText(text: string): string {
  return text.replace(ESCAPE_PATTERN, '\\$1')
}

function encodeTarget(target: string): string {
  return target.includes(' ') ? `<${target}>` : target
}

function prefixLines(block: string, prefix: string): string {
  return block
    .split('\n')
    .map((line) => `${prefix}${line}`.trimEnd())
    .join('\n')
}

function clampLevel(level: unknown): number {
  return typeof level === 'number' ? Math.min(Math.max(Math.trunc(level), 1), 6) : 1
}

/**
 * Stable, collision-free file names for a set of documents. Sorting by id keeps
 * the mapping deterministic, so re-exporting a workspace produces the same names.
 */
export function buildFileNameMap(documents: DocumentRecord[]): Map<DocumentId, string> {
  const used = new Set<string>()
  const names = new Map<DocumentId, string>()

  for (const document of [...documents].sort((a, b) => a.id.localeCompare(b.id))) {
    const base = slugify(document.title) || 'untitled'
    let name = `${base}.md`
    let suffix = 2

    while (used.has(name.toLowerCase())) {
      name = `${base}-${suffix}.md`
      suffix += 1
    }

    used.add(name.toLowerCase())
    names.set(document.id, name)
  }

  return names
}

export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
