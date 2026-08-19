import type { Reference, ReferenceKind } from '@braidhq/schema'
import type { ReactNode } from 'react'
import type { ReferenceCandidate, ReferenceResolver, ResolvedReference } from './ReferenceResolver'

export interface ReferenceSearchOptions {
  /** Restricts the search to one kind, used by pickers bound to a single field. */
  readonly kind?: ReferenceKind
  readonly limit?: number
}

export interface ReferenceRegistry {
  readonly resolve: (reference: Reference) => ResolvedReference | null
  readonly search: (query: string, options?: ReferenceSearchOptions) => readonly ReferenceCandidate[]
  /** Null when the kind ships no detail body, which leaves the peek to its fallback. */
  readonly renderDetail: (reference: Reference) => ReactNode | null
}

const DEFAULT_SEARCH_LIMIT = 8

export function createReferenceRegistry(resolvers: readonly ReferenceResolver[]): ReferenceRegistry {
  const byKind = new Map<ReferenceKind, ReferenceResolver>(resolvers.map(resolver => [resolver.kind, resolver]))
  return {
    resolve: reference => byKind.get(reference.kind)?.resolve(reference.id) ?? null,
    renderDetail: reference => byKind.get(reference.kind)?.renderDetail?.(reference.id) ?? null,
    search: (query, options) => {
      const scoped = scopedResolvers(resolvers, byKind, options?.kind)
      return scoped
        .flatMap(resolver => resolver.search(query))
        .sort((left, right) => right.score - left.score)
        .slice(0, options?.limit ?? DEFAULT_SEARCH_LIMIT)
    },
  }
}

function scopedResolvers(
  all: readonly ReferenceResolver[],
  byKind: ReadonlyMap<ReferenceKind, ReferenceResolver>,
  kind: ReferenceKind | undefined,
): readonly ReferenceResolver[] {
  if (kind === undefined)
    return all
  const only = byKind.get(kind)
  return only ? [only] : []
}
