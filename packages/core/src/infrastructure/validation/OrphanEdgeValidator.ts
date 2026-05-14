import type {
  ModelSnapshot,
  PluginId,
  ValidationCode,
  ValidationIssue,
} from '@telos/schema'
import type { Validator } from '../../domain/plugin/Validator.js'
import { z } from 'zod'

/**
 * Defense in depth: `Model.preview` already rejects edges whose endpoints do
 * not exist in the snapshot, but a corrupt JSONL stream or a buggy storage
 * adapter could still land us in a state with dangling edges. We surface that
 * loud rather than letting downstream queries return inconsistent neighbours.
 */
export class OrphanEdgeValidator implements Validator {
  readonly id = 'core.orphan-edge' as PluginId
  readonly type = 'validator' as const
  readonly configSchema = z.object({})

  async validate(snapshot: ModelSnapshot): Promise<readonly ValidationIssue[]> {
    const nodeIds = new Set(snapshot.nodes.map(n => n.id))
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
}
