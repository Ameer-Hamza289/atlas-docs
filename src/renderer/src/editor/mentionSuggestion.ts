import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import { exitSuggestion, type SuggestionOptions } from '@tiptap/suggestion'

import { MENTION_ID_ATTR, MENTION_LABEL_ATTR, MENTION_NODE_TYPE } from '@shared/types'

import { MentionList, type MentionListHandle, type MentionListProps } from './MentionList'
import type { MentionDependencies, MentionItem, MentionSelection } from './types'

export const mentionPluginKey = new PluginKey('documentMention')

/** Beyond this the user is writing prose, not searching — stop suggesting. */
const MAX_QUERY_LENGTH = 48

export function createMentionSuggestion(
  dependencies: MentionDependencies
): Omit<SuggestionOptions<MentionItem, MentionSelection>, 'editor'> {
  return {
    char: '@',
    pluginKey: mentionPluginKey,
    // Titles contain spaces, so the query must be allowed to as well.
    allowSpaces: true,
    debounce: 100,

    items: async ({ query, signal }) => {
      const trimmed = query.trim()
      if (trimmed.length > MAX_QUERY_LENGTH) return []

      const hits = await dependencies.search(trimmed)
      if (signal.aborted) return []

      const items: MentionItem[] = hits.map((hit) => ({
        kind: 'document',
        id: hit.id,
        title: hit.title,
        excerpt: hit.excerpt
      }))

      const exactMatch = hits.some((hit) => hit.title.toLowerCase() === trimmed.toLowerCase())
      if (trimmed.length > 0 && !exactMatch) items.push({ kind: 'create', title: trimmed })

      return items
    },

    command: ({ editor, range, props }) => {
      // Swallow the trailing space the user may have typed after the query.
      const nodeAfter = editor.view.state.selection.$to.nodeAfter
      const endsWithSpace = nodeAfter?.text?.startsWith(' ')

      editor
        .chain()
        .focus()
        .insertContentAt({ from: range.from, to: endsWithSpace ? range.to + 1 : range.to }, [
          {
            type: MENTION_NODE_TYPE,
            attrs: { [MENTION_ID_ATTR]: props.id, [MENTION_LABEL_ATTR]: props.title }
          },
          { type: 'text', text: ' ' }
        ])
        .run()
    },

    render: () => {
      let renderer: ReactRenderer<MentionListHandle, MentionListProps> | null = null
      let unmount: (() => void) | null = null

      return {
        onStart: (props) => {
          renderer = new ReactRenderer(MentionList, {
            editor: props.editor,
            props: {
              items: props.items,
              query: props.query,
              loading: props.loading,
              command: props.command,
              onCreate: dependencies.createDocument
            }
          })

          // The plugin anchors and repositions the element for us.
          unmount = props.mount(renderer.element as HTMLElement)
        },

        onUpdate: (props) => {
          renderer?.updateProps({
            items: props.items,
            query: props.query,
            loading: props.loading,
            command: props.command
          })
        },

        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            exitSuggestion(props.view, mentionPluginKey)
            return true
          }
          return renderer?.ref?.onKeyDown(props) ?? false
        },

        onExit: () => {
          unmount?.()
          renderer?.destroy()
          unmount = null
          renderer = null
        }
      }
    }
  }
}
