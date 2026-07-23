import type {
  GraphNode,
  ModelSnapshot,
  ValidationCode,
  ValidationIssue,
} from '@braidhq/schema'

/**
 * Framework invariant: every node must declare some evidence trail.
 * One of these must hold:
 *   - at least one `metadata.sourceReferences[]` entry,
 *   - `metadata.implementationMissing: true`, intent-only, code not built yet,
 *   - `metadata.intentMissing: true`, code-only, intent not written yet.
 *
 * Without this, the graph silently accepts wishful thinking,
 * intent claimed as done with no code and no explicit "not yet" flag.
 *
 * Also catches the contradiction of `status: 'completed'` with zero references,
 * completion is a claim of fact, and needs at least one source citation.
 *
 * Not a plugin, this rule is structural to Braid's HITL trust model.
 * The host runs it unconditionally, never as an opt-in ontology validator.
 */
export function validateEvidence(snapshot: ModelSnapshot): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const node of snapshot.nodes) {
    issues.push(...checkNode(node))
  }
  return issues
}

function checkNode(node: GraphNode): ValidationIssue[] {
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

  issues.push(...surfaceDriftIssues(node))

  return issues
}

/**
 * Drift detection itself happens upstream in build-cycle skills,
 * e.g. ddd:extract or ddd:reconcile,
 * which write structured DriftIssue entries onto the node's metadata.
 * This job is to surface those entries as `ValidationIssue`s,
 * so the proposal review pane shows them, and the apply-gate respects severity.
 * Drift entries whose description appears in `acknowledgedDrifts` are silenced.
 */
function surfaceDriftIssues(node: GraphNode): ValidationIssue[] {
  const drifts = node.metadata.driftIssues
  if (!drifts || drifts.length === 0)
    return []
  const acknowledged = new Set(node.metadata.acknowledgedDrifts ?? [])
  return drifts
    .filter(drift => !acknowledged.has(drift.description))
    .map(drift => ({
      code: 'evidence.drift' as ValidationCode,
      severity: drift.severity,
      message: `Drift on "${node.name}": ${drift.description}`,
      nodeId: node.id,
    }))
}
