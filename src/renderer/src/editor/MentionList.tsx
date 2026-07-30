import { useEffect, useImperativeHandle, useRef, useState, type JSX, type Ref } from 'react'

import type { SuggestionKeyDownProps } from '@tiptap/suggestion'

import type { MentionItem, MentionSelection } from './types'

export interface MentionListHandle {
  onKeyDown(props: SuggestionKeyDownProps): boolean
}

export interface MentionListProps {
  items: MentionItem[]
  query: string
  loading: boolean
  command(selection: MentionSelection): void
  onCreate(title: string): Promise<MentionSelection | null>
  ref?: Ref<MentionListHandle>
}

/** The @ menu. Owns highlight state and keyboard handling; the plugin owns position. */
export function MentionList({
  items,
  query,
  loading,
  command,
  onCreate,
  ref
}: MentionListProps): JSX.Element | null {
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    setIndex(0)
  }, [items])

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const select = (item: MentionItem | undefined): void => {
    if (!item || busyRef.current) return

    if (item.kind === 'document') {
      command({ id: item.id, title: item.title })
      return
    }

    // Creating a document is async; guard against double submits while it runs.
    busyRef.current = true
    void onCreate(item.title)
      .then((created) => {
        if (created) command(created)
      })
      .finally(() => {
        busyRef.current = false
      })
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false

      switch (event.key) {
        case 'ArrowUp':
          setIndex((current) => (current + items.length - 1) % items.length)
          return true
        case 'ArrowDown':
          setIndex((current) => (current + 1) % items.length)
          return true
        case 'Enter':
        case 'Tab':
          select(items[index])
          return true
        default:
          return false
      }
    }
  }))

  if (items.length === 0 && !loading) return null

  return (
    <div className="mention-popup" ref={listRef}>
      <div className="mention-popup__header">
        {query ? `Documents matching “${query}”` : 'Recent documents'}
      </div>

      {items.length === 0 && loading ? (
        <div className="mention-popup__empty">Searching…</div>
      ) : null}

      {items.map((item, itemIndex) => (
        <button
          key={item.kind === 'document' ? item.id : `create:${item.title}`}
          type="button"
          className="mention-option"
          data-active={itemIndex === index}
          // mousedown would move focus out of the editor before the click lands.
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setIndex(itemIndex)}
          onClick={() => select(item)}
        >
          {item.kind === 'document' ? (
            <>
              <span className="mention-option__title">{item.title}</span>
              <span className="mention-option__excerpt">{item.excerpt}</span>
            </>
          ) : (
            <span className="mention-option__title mention-option__title--create">
              Create “{item.title}”
            </span>
          )}
        </button>
      ))}

      <div className="mention-popup__footer">
        <kbd>↑</kbd>
        <kbd>↓</kbd>
        <span>navigate</span>
        <kbd>↵</kbd>
        <span>insert</span>
        <kbd>esc</kbd>
        <span>dismiss</span>
      </div>
    </div>
  )
}
