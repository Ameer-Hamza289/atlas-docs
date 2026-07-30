import { mergeAttributes, Node } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'

import {
  MENTION_ID_ATTR,
  MENTION_LABEL_ATTR,
  MENTION_NODE_TYPE,
  type DocumentId
} from '@shared/types'

import { MentionNodeView } from './MentionNodeView'
import type { MentionItem, MentionSelection } from './types'

export interface DocumentMentionOptions {
  navigate(id: DocumentId): void
  suggestion: Omit<SuggestionOptions<MentionItem, MentionSelection>, 'editor'>
  HTMLAttributes: Record<string, unknown>
}

/**
 * An atomic inline node holding the *id* of another document.
 *
 * Storing the id (with the title only as a cached fallback) is what makes
 * references survive renames and makes a reliable backlink index possible.
 */
export const DocumentMention = Node.create<DocumentMentionOptions>({
  name: MENTION_NODE_TYPE,

  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      navigate: () => undefined,
      suggestion: { char: '@' },
      HTMLAttributes: {}
    }
  },

  addAttributes() {
    return {
      [MENTION_ID_ATTR]: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-doc-id'),
        renderHTML: (attributes) => {
          const id = attributes[MENTION_ID_ATTR]
          return id ? { 'data-doc-id': id } : {}
        }
      },
      [MENTION_LABEL_ATTR]: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-label') ?? element.textContent?.replace(/^@/, '') ?? '',
        renderHTML: (attributes) => ({ 'data-label': attributes[MENTION_LABEL_ATTR] ?? '' })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-document-mention]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { 'data-document-mention': '', class: 'mention' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `@${node.attrs[MENTION_LABEL_ATTR] || 'Untitled'}`
    ]
  },

  renderText({ node }) {
    return `@${node.attrs[MENTION_LABEL_ATTR] || 'Untitled'}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionNodeView)
  },

  addKeyboardShortcuts() {
    return {
      // A selected reference behaves like a focused link.
      Enter: () => {
        const { selection } = this.editor.state
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) {
          return false
        }

        const id = selection.node.attrs[MENTION_ID_ATTR]
        if (typeof id !== 'string' || !id) return false

        this.options.navigate(id)
        return true
      }
    }
  },

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })]
  }
})
