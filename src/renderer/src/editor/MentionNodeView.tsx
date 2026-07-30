import type { JSX, MouseEvent } from 'react'

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

import { MENTION_ID_ATTR, MENTION_LABEL_ATTR } from '@shared/types'

import { useDocumentTitle } from '../state/workspaceStore'
import type { DocumentMentionOptions } from './documentMention'

/**
 * Renders a reference. The title is resolved from live workspace state rather
 * than from the stored attribute, so renames are reflected instantly and a
 * deleted target degrades into a visibly unresolved link instead of a lie.
 */
export function MentionNodeView({ node, selected, extension }: NodeViewProps): JSX.Element {
  const docId = typeof node.attrs[MENTION_ID_ATTR] === 'string' ? node.attrs[MENTION_ID_ATTR] : ''
  const cachedLabel =
    typeof node.attrs[MENTION_LABEL_ATTR] === 'string' ? node.attrs[MENTION_LABEL_ATTR] : ''

  const liveTitle = useDocumentTitle(docId)
  const resolved = liveTitle !== null
  const title = liveTitle ?? cachedLabel ?? 'Untitled'

  const { navigate } = extension.options as DocumentMentionOptions

  const handleClick = (event: MouseEvent<HTMLSpanElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    if (resolved) navigate(docId)
  }

  return (
    <NodeViewWrapper as="span" className="mention-wrapper">
      <span
        className={[
          'mention',
          resolved ? 'mention--resolved' : 'mention--unresolved',
          selected ? 'mention--selected' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        contentEditable={false}
        role={resolved ? 'link' : undefined}
        title={
          resolved
            ? `Open “${title}”`
            : `“${title}” no longer exists — the reference kept its last known title`
        }
        onClick={handleClick}
      >
        <span className="mention__at">@</span>
        {title}
      </span>
    </NodeViewWrapper>
  )
}
