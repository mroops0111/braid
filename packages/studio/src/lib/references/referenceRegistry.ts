import type { Reference, ReferenceKind } from '@braidhq/schema'
import type { ReactNode } from 'react'
import type { ReferenceCandidate, ReferenceResolver, ResolvedReference } from './ReferenceResolver'

export interface ReferenceSearchOptions {
  /** Restricts the search to one kind, used by pickers bound to a single field. */
  readonly kind?: ReferenceKind
  readonly limit?: number
}

/**
 * What a search found, and how much of it the caller is being shown.
 *
 * `total` counts every match rather than the truncated page.
 * A menu that silently drops the ninth reads as though there were eight.
 */
export interface ReferenceSearchResult {
  readonly items: readonly ReferenceCandidate[]
  readonly total: number
}

export interface ReferenceRegistry {
  readonly resolve: (reference: Reference) => ResolvedReference | null
  readonly search: (query: string, options?: ReferenceSearchOptions) => ReferenceSearchResult
  /** Null when the kind ships no detail body, which leaves the peek to its fallback. */
  readonly renderDetail: (reference: Reference) => ReactNode | null
}

const DEFAULT_SEARCH_LIMIT = 20

export function createReferenceRegistry(resolvers: readonly ReferenceResolver[]): ReferenceRegistry {
  const byKind = new Map<ReferenceKind, ReferenceResolver>(resolvers.map(resolver => [resolver.kind, resolver]))
  return {
    resolve: reference => byKind.get(reference.kind)?.resolve(reference.id) ?? null,
    renderDetail: reference => byKind.get(reference.kind)?.renderDetail?.(reference.id) ?? null,
    search: (query, options) => {
      const scoped = scopedResolvers(resolvers, byKind, options?.kind)
      const ranked = scoped
        .flatMap(resolver => resolver.search(query))
        .sort((left, right) => right.score - left.score)
      return {
        items: ranked.slice(0, options?.limit ?? DEFAULT_SEARCH_LIMIT),
        total: ranked.length,
      }
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
