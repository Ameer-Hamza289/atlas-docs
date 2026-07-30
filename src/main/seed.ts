import {
  MENTION_ID_ATTR,
  MENTION_LABEL_ATTR,
  MENTION_NODE_TYPE,
  type DocumentRecord,
  type RichTextNode
} from '@shared/types'

/**
 * First-run content. Stable ids let the seed documents reference each other,
 * so the app demonstrates cross-links immediately instead of starting empty.
 */
const IDS = {
  onboarding: '00000000-0000-4000-8000-000000000001',
  architecture: '00000000-0000-4000-8000-000000000002',
  roadmap: '00000000-0000-4000-8000-000000000003',
  research: '00000000-0000-4000-8000-000000000004',
  glossary: '00000000-0000-4000-8000-000000000005'
} as const

function text(value: string): RichTextNode {
  return { type: 'text', text: value }
}

function mention(id: string, label: string): RichTextNode {
  return {
    type: MENTION_NODE_TYPE,
    attrs: { [MENTION_ID_ATTR]: id, [MENTION_LABEL_ATTR]: label }
  }
}

function heading(level: number, value: string): RichTextNode {
  return { type: 'heading', attrs: { level }, content: [text(value)] }
}

function paragraph(...content: RichTextNode[]): RichTextNode {
  return { type: 'paragraph', content: content.length ? content : undefined }
}

function bullets(...items: RichTextNode[][]): RichTextNode {
  return {
    type: 'bulletList',
    content: items.map((content) => ({
      type: 'listItem',
      content: [paragraph(...content)]
    }))
  }
}

function doc(...content: RichTextNode[]): RichTextNode {
  return { type: 'doc', content }
}

export function seedDocuments(): DocumentRecord[] {
  const now = Date.now()
  const at = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString()

  return [
    {
      id: IDS.onboarding,
      title: 'Welcome to Atlas',
      createdAt: at(600),
      updatedAt: at(4),
      content: doc(
        paragraph(
          text('Atlas is a small desktop workspace for connected notes. Every document lives on your machine and can point at any other document.')
        ),
        heading(2, 'Linking documents'),
        paragraph(
          text('Type '),
          text('@'),
          text(' anywhere in the editor to search your documents, then press Enter to insert a reference. Try it here, or click through to ')
        ),
        paragraph(
          mention(IDS.architecture, 'System Architecture'),
          text(' to see how the app is put together.')
        ),
        heading(2, 'Good to know'),
        bullets(
          [text('References follow renames — rename a document and every link updates.')],
          [text('The "Referenced by" panel shows incoming links, so navigation works both ways.')],
          [text('Everything autosaves; there is no save button.')]
        ),
        paragraph(
          text('Next up: '),
          mention(IDS.roadmap, 'Q3 Roadmap'),
          text(' and the '),
          mention(IDS.glossary, 'Glossary'),
          text('.')
        )
      )
    },
    {
      id: IDS.architecture,
      title: 'System Architecture',
      createdAt: at(540),
      updatedAt: at(38),
      content: doc(
        paragraph(
          text('Three processes, one direction of trust: the renderer asks, the main process decides.')
        ),
        heading(2, 'Layers'),
        bullets(
          [text('Main — owns storage, search and the backlink index.')],
          [text('Preload — a narrow, typed contextBridge surface. No Node in the renderer.')],
          [text('Renderer — React UI and the editor, kept free of file-system concerns.')]
        ),
        paragraph(
          text('Storage is a single JSON file written atomically. Swapping it for SQLite would only touch the repository described in '),
          mention(IDS.research, 'Storage Options'),
          text('.')
        ),
        heading(2, 'Editor'),
        paragraph(
          text('Tiptap holds the document as a structured tree. Mentions are atomic inline nodes carrying a document id, which is what makes rename-safe links and backlinks possible.')
        )
      )
    },
    {
      id: IDS.roadmap,
      title: 'Q3 Roadmap',
      createdAt: at(480),
      updatedAt: at(96),
      content: doc(
        paragraph(text('Themes for the quarter, roughly in priority order.')),
        bullets(
          [text('Full-text search across the workspace, building on the index in '), mention(IDS.architecture, 'System Architecture')],
          [text('Nested folders and drag-to-reorder in the sidebar')],
          [text('Sync, pending a decision in '), mention(IDS.research, 'Storage Options')],
          [text('Export to Markdown with references rendered as links')]
        ),
        paragraph(
          text('Terminology used above is defined in '),
          mention(IDS.glossary, 'Glossary'),
          text('.')
        )
      )
    },
    {
      id: IDS.research,
      title: 'Storage Options',
      createdAt: at(420),
      updatedAt: at(150),
      content: doc(
        paragraph(text('Comparing candidates for the document store.')),
        heading(2, 'JSON file (current)'),
        paragraph(
          text('Zero native dependencies, trivial to inspect and back up, atomic writes are easy. Loads the whole workspace into memory, which is fine into the low thousands of documents.')
        ),
        heading(2, 'SQLite'),
        paragraph(
          text('Better for large workspaces and gives real full-text search via FTS5. Costs a native module and a rebuild step per Electron version.')
        ),
        paragraph(
          text('Decision recorded in '),
          mention(IDS.architecture, 'System Architecture'),
          text('; revisit when a workspace crosses a few thousand documents.')
        )
      )
    },
    {
      id: IDS.glossary,
      title: 'Glossary',
      createdAt: at(360),
      updatedAt: at(220),
      content: doc(
        bullets(
          [text('Reference — an inline pointer from one document to another, inserted with @.')],
          [text('Backlink — the reverse direction: every document that points at the one you are reading.')],
          [text('Unresolved reference — a link whose target was deleted. It keeps the last known title.')]
        ),
        paragraph(
          text('See '),
          mention(IDS.onboarding, 'Welcome to Atlas'),
          text(' for a walkthrough.')
        )
      )
    }
  ]
}
