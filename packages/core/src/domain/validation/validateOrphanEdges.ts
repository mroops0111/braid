import type {
  ModelSnapshot,
  ValidationCode,
  ValidationIssue,
} from '@braidhq/schema'

/**
 * Framework invariant: defense in depth on edge integrity.
 * `Model.preview` already rejects edges whose endpoints are missing,
 * but a corrupt JSONL stream or a buggy storage adapter,
 * could still land us in a state with dangling edges.
 * Surface that loudly rather than letting queries return bad neighbours.
 *
 * Not a plugin, the host runs it unconditionally as a framework invariant.
 */
export function validateOrphanEdges(snapshot: ModelSnapshot): readonly ValidationIssue[] {
  const nodeIds = new Set(snapshot.nodes.map(node => node.id))
  const issues: ValidationIssue[] = []
  for (const edge of snapshot.edges) {
    if (!nodeIds.has(edge.fromNodeId)) {
      issues.push({
        code: 'edge.dangling-source' as ValidationCode,
        severity: 'error',
        message: `Edge "${edge.id}" references source node "${edge.fromNodeId}" which does not exist.`,
        edgeId: edge.id,
      })
    }
    if (!nodeIds.has(edge.toNodeId)) {
      issues.push({
        code: 'edge.dangling-target' as ValidationCode,
        severity: 'error',
        message: `Edge "${edge.id}" references target node "${edge.toNodeId}" which does not exist.`,
        edgeId: edge.id,
      })
    }
  }
  return issues
}
