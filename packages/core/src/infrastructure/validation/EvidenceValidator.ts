import type {
  GraphNode,
  ModelSnapshot,
  PluginId,
  ValidationCode,
  ValidationIssue,
} from '@braidhq/schema'
import type { Validator } from '../../domain/plugin/Validator.js'
import { z } from 'zod'

/**
 * Core invariant: every node must declare *some* evidence trail.
 *
 *   - At least one `metadata.sourceReferences[]` entry, OR
 *   - `metadata.implementationMissing: true` (intent-only, code not built yet), OR
 *   - `metadata.intentMissing: true` (code-only, intent not written yet).
 *
 * Without that, the graph silently accepts wishful thinking (which is what
 * happened the first time we ran braid-extract on intent without code).
 *
 * Also catches the contradiction `status: 'completed'` + zero source references
 * (completion is a claim of fact, which needs at least one source citation).
 */
export class EvidenceValidator implements Validator {
  readonly id = 'core.evidence' as PluginId
  readonly type = 'validator' as const
  readonly configSchema = z.object({})

  async validate(snapshot: ModelSnapshot): Promise<readonly ValidationIssue[]> {
    const issues: ValidationIssue[] = []
    for (const node of snapshot.nodes) {
      issues.push(...this.checkNode(node))
    }
    return issues
  }

  private checkNode(node: GraphNode): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const refs = node.metadata.sourceReferences
    const hasSources = refs.length > 0
    const intentMissing = node.metadata.intentMissing === true
    const implementationMissing = node.metadata.implementationMissing === true

    if (!hasSources && !intentMissing && !implementationMissing) {
      issues.push({
        code: 'evidence.no-source-or-flag' as ValidationCode,
        severity: 'error',
        message: `Node "${node.name}" has no sourceReferences and neither intentMissing nor implementationMissing is set. Every node must declare evidence (a source) or an explicit "not yet" flag.`,
        nodeId: node.id,
      })
    }

    if (node.status === 'completed' && !hasSources) {
      issues.push({
        code: 'evidence.completed-no-source' as ValidationCode,
        severity: 'error',
        message: `Node "${node.name}" is status=completed but has no sourceReferences. Completion is a claim of fact and requires at least one citation.`,
        nodeId: node.id,
      })
    }

    return issues
  }
}
