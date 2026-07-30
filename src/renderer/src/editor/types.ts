import type { DocumentId, SearchHit } from '@shared/types'

/** An entry in the @ menu: either an existing document or a "create" affordance. */
export type MentionItem =
  | { kind: 'document'; id: DocumentId; title: string; excerpt: string }
  | { kind: 'create'; title: string }

/** What the suggestion command receives once the user picks an entry. */
export interface MentionSelection {
  id: DocumentId
  title: string
}

/**
 * Everything the editor needs from the outside world. Injecting these keeps the
 * Tiptap layer independent of the store and trivial to exercise in isolation.
 */
export interface MentionDependencies {
  search(query: string): Promise<SearchHit[]>
  createDocument(title: string): Promise<MentionSelection | null>
  navigate(id: DocumentId): void
}
