import { useEffect, useRef, type JSX } from 'react'

import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

import type { DocumentRecord, RichTextNode } from '@shared/types'

import { DocumentMention } from '../editor/documentMention'
import { createMentionSuggestion } from '../editor/mentionSuggestion'
import type { MentionDependencies } from '../editor/types'

interface DocumentEditorProps {
  document: DocumentRecord
  dependencies: MentionDependencies
  onChange(content: RichTextNode): void
}

/**
 * Mounted per document (the parent keys it by id), so the editor never has to
 * reconcile a document swap — a fresh ProseMirror state is cheaper and avoids
 * undo history leaking between documents.
 */
export function DocumentEditor({
  document,
  dependencies,
  onChange
}: DocumentEditorProps): JSX.Element {
  // Editor callbacks are bound once; refs keep them pointing at current props.
  const dependenciesRef = useRef(dependencies)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    dependenciesRef.current = dependencies
    onChangeRef.current = onChange
  })

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          link: { openOnClick: false, autolink: true },
          heading: { levels: [1, 2, 3] }
        }),
        Placeholder.configure({
          placeholder: 'Write something, or type @ to reference another document…'
        }),
        DocumentMention.configure({
          navigate: (id) => dependenciesRef.current.navigate(id),
          suggestion: createMentionSuggestion({
            search: (query) => dependenciesRef.current.search(query),
            createDocument: (title) => dependenciesRef.current.createDocument(title),
            navigate: (id) => dependenciesRef.current.navigate(id)
          })
        })
      ],
      content: document.content as JSONContent,
      autofocus: 'start',
      editorProps: {
        attributes: { class: 'editor__surface', spellcheck: 'true' }
      },
      onUpdate: ({ editor: instance }) => {
        onChangeRef.current(instance.getJSON() as RichTextNode)
      }
    },
    []
  )

  return <EditorContent editor={editor} className="editor" />
}
