import type { GraphNode, NodeId } from '@braidhq/schema'
import type { ReferenceCandidate, ReferenceResolver, ResolvedReference } from './ReferenceResolver'
import { NODE_REFERENCE_KIND } from '@braidhq/schema'

export interface NodeReferenceResolverDeps {
  readonly nodesById: ReadonlyMap<string, GraphNode>
  /** Absent when no graph navigation is in scope, which makes tags read-only. */
  readonly onOpen?: (nodeId: NodeId) => void
  /** Translated destination label, since this module has no access to i18n. */
  readonly openLabel?: string
}

// Ranked so an exact id beats a name that merely contains the query.
// Type matching sits last, it turns `@aggregate` into a browse of that type.
const SCORE_EXACT_ID = 100
const SCORE_ID_PREFIX = 80
const SCORE_NAME_PREFIX = 70
const SCORE_WORD_PREFIX = 60
const SCORE_ID_CONTAINS = 50
const SCORE_NAME_CONTAINS = 40
const SCORE_TYPE_CONTAINS = 20
const SCORE_BROWSE = 10

const DESCRIPTION_PREVIEW_LIMIT = 240

export function createNodeReferenceResolver(deps: NodeReferenceResolverDeps): ReferenceResolver {
  const { onOpen } = deps

  function toResolved(node: GraphNode): ResolvedReference {
    return {
      reference: { kind: NODE_REFERENCE_KIND, id: node.id },
      title: node.name,
      badge: node.type,
      ...(node.description ? { description: previewOf(node.description) } : {}),
      ...(onOpen ? { open: () => onOpen(node.id) } : {}),
      ...(onOpen && deps.openLabel ? { openLabel: deps.openLabel } : {}),
    }
  }

  return {
    kind: NODE_REFERENCE_KIND,
    resolve: (id) => {
      const node = deps.nodesById.get(id)
      return node ? toResolved(node) : null
    },
    search: (query) => {
      const needle = query.trim().toLowerCase()
      const candidates: ReferenceCandidate[] = []
      for (const node of deps.nodesById.values()) {
        const score = scoreNode(node, needle)
        if (score !== null)
          candidates.push({ ...toResolved(node), score })
      }
      return candidates
    },
  }
}

function scoreNode(node: GraphNode, needle: string): number | null {
  if (needle.length === 0)
    return SCORE_BROWSE
  const id = node.id.toLowerCase()
  const name = node.name.toLowerCase()
  const type = node.type.toLowerCase()
  if (id === needle)
    return SCORE_EXACT_ID
  if (id.startsWith(needle))
    return SCORE_ID_PREFIX
  if (name.startsWith(needle))
    return SCORE_NAME_PREFIX
  if (identifierWords(node.id).some(word => word.startsWith(needle)))
    return SCORE_WORD_PREFIX
  if (id.includes(needle))
    return SCORE_ID_CONTAINS
  if (name.includes(needle))
    return SCORE_NAME_CONTAINS
  if (type.includes(needle))
    return SCORE_TYPE_CONTAINS
  return null
}

/**
 * Splits an id into searchable words so `@task` reaches `ctx.signTask`.
 * CJK needs no splitting, plain substring matching already covers it.
 */
export function identifierWords(value: string): readonly string[] {
  return value
    .split(/[.\-_/\s]+/)
    .flatMap(part => part.split(/(?=[A-Z])/))
    .filter(part => part.length > 0)
    .map(part => part.toLowerCase())
}

function previewOf(description: string): string {
  const paragraph = description.trim().split(/\n\s*\n/)[0] ?? ''
  if (paragraph.length <= DESCRIPTION_PREVIEW_LIMIT)
    return paragraph
  return `${paragraph.slice(0, DESCRIPTION_PREVIEW_LIMIT - 1)}…`
}
