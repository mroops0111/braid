import type { GeneratedView, ViewFormDescriptor, ViewKind, ViewKindDescriptor } from '@braidhq/schema'

/** Everything written out of one subject, however many forms of it there are. */
export interface DocumentGroup {
  readonly kind: ViewKind
  readonly subject: string
  readonly views: readonly GeneratedView[]
  /**
   * Whether the graph has moved on since these were written.
   * Said over the subject rather than over each form,
   * because one subject projects into one material,
   * so every form of it goes out of date together or not at all.
   */
  readonly stale: boolean
}

/**
 * The documents a reader has, gathered under whatever each was written from.
 *
 * A flat list of paths makes a reader parse a filename to know what it is,
 * and says nothing about the node it came from,
 * which is the thing they would think of it by.
 * The subject written to most recently leads,
 * since a reader coming back is usually coming back to what they just made.
 */
export function documentsFrom(views: readonly GeneratedView[]): readonly DocumentGroup[] {
  const gathered = new Map<string, GeneratedView[]>()
  for (const view of views) {
    const key = `${view.kind}/${view.subject}`
    gathered.set(key, [...(gathered.get(key) ?? []), view])
  }

  return [...gathered.values()]
    .flatMap((held): DocumentGroup[] => {
      const [first] = held
      if (first === undefined)
        return []
      return [{
        kind: first.kind,
        subject: first.subject,
        views: [...held].sort((one, other) => one.form.localeCompare(other.form)),
        stale: held.some(view => view.stale),
      }]
    })
    .sort((one, other) => writtenAt(other) - writtenAt(one))
}

function writtenAt(group: DocumentGroup): number {
  return Math.max(...group.views.map(view => Date.parse(view.writtenAt) || 0))
}

/** One kind of subject, and the documents written out of subjects of it. */
export interface DocumentShelf {
  readonly typeId: string
  readonly label: string
  readonly groups: readonly DocumentGroup[]
}

/**
 * The documents a reader has, shelved by what kind of thing each is about.
 *
 * The shelf comes from the ontology,
 * rather than from anything a person put there,
 * so a graph declaring two kinds of container gets two shelves,
 * without this surface learning either name.
 * A flat list is the honest answer while there is only one kind,
 * and the caller draws no heading in that case.
 */
export function shelvesOf(
  groups: readonly DocumentGroup[],
  kindOf: (subject: string) => { readonly id: string, readonly label: string } | undefined,
): readonly DocumentShelf[] {
  const shelved = new Map<string, DocumentShelf>()
  for (const group of groups) {
    const kind = kindOf(group.subject) ?? { id: '', label: '' }
    const held = shelved.get(kind.id)
    shelved.set(kind.id, {
      typeId: kind.id,
      label: kind.label,
      groups: [...(held?.groups ?? []), group],
    })
  }
  return [...shelved.values()].sort((one, other) => one.label.localeCompare(other.label))
}

/**
 * Whether a document answers to what the reader typed.
 *
 * Matched against the name they would think of it by,
 * and the id they would paste,
 * since both are things a person reaches for.
 */
export function matchesQuery(group: DocumentGroup, name: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '')
    return true
  return name.toLowerCase().includes(needle) || group.subject.toLowerCase().includes(needle)
}

export function formsOf(
  kinds: readonly ViewKindDescriptor[],
  kind: ViewKind,
): readonly ViewFormDescriptor[] {
  return kinds.find(one => one.kind === kind)?.forms ?? []
}

export function formOf(
  kinds: readonly ViewKindDescriptor[],
  view: Pick<GeneratedView, 'kind' | 'form'>,
): ViewFormDescriptor | undefined {
  return formsOf(kinds, view.kind).find(form => form.id === view.form)
}
