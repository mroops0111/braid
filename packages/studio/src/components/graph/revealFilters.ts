import type { GraphNode, NodeTypeId } from '@braidhq/schema'
import type { GraphFilters } from './GraphNavigator'

export interface RevealTarget {
  readonly node: GraphNode
  readonly isOrphan: boolean
  /** Revealed alongside the target, so its neighbourhood renders whole. */
  readonly neighbourTypes: readonly NodeTypeId[]
}

/** Single definition of the free-text match, shared with the filter pass. */
export function matchesSearch(search: string, node: GraphNode): boolean {
  if (!search)
    return true
  const haystack = `${node.name} ${node.description ?? ''}`.toLowerCase()
  return haystack.includes(search.toLowerCase())
}

/**
 * Relaxes a browsing filter just enough to show a node someone asked to open.
 * Arriving from a reference is a fresh intent, so it outranks the filter the
 * reader set while browsing. Only the axes actually hiding the target move,
 * and the type whitelist grows rather than resetting, which keeps the rest of
 * the reader's choices intact. Returns the same object when nothing hides it,
 * so callers can skip a pointless state write.
 */
export function revealNode(filters: GraphFilters, target: RevealTarget): GraphFilters {
  const missingTypes = [target.node.type, ...target.neighbourTypes]
    .filter(type => !filters.types.includes(type))
  const uniqueMissing = [...new Set(missingTypes)]
  const searchHides = !matchesSearch(filters.search, target.node)
  const orphanHides = filters.orphansOnly && !target.isOrphan

  if (uniqueMissing.length === 0 && !searchHides && !orphanHides)
    return filters

  return {
    types: [...filters.types, ...uniqueMissing],
    search: searchHides ? '' : filters.search,
    orphansOnly: orphanHides ? false : filters.orphansOnly,
  }
}
