import type {
  EdgeTypeId,
  GraphEdge,
  ModelSnapshot,
  NodeId,
  NodeTypeId,
  ValidationCode,
  ValidationIssue,
} from '@braidhq/schema'
import type { EdgeTypeDescriptor, OntologyPlugin, OntologyValidator } from '../../domain/plugin/OntologyPlugin.js'

/**
 * Generic engine. Reads `EdgeTypeDescriptor.fromTypes / toTypes / cardinality`,
 * from an `OntologyPlugin` instance.
 * Rejects edges whose endpoints violate the declared topology,
 * or whose count violates the declared cardinality.
 *
 * Complements `OntologyTypeValidator` and `OrphanEdgeValidator`,
 * the type allow-list and the endpoints-exist check.
 * Without this, the extract skill could land a reversed edge,
 * such as `aggregate contains boundedContext`.
 * Every consumer would then read the edge in the wrong direction,
 * and produce wrong results.
 *
 * Edge types not declared by the ontology are skipped here.
 * The type validator already flags them as unknown.
 *
 * Not a plugin: each ontology constructs its own instance,
 * exposed via `OntologyPlugin.validators[]`.
 */
export class StructuralValidator implements OntologyValidator {
  private readonly edgeTypeById: ReadonlyMap<EdgeTypeId, EdgeTypeDescriptor>

  constructor(ontology: OntologyPlugin) {
    this.edgeTypeById = new Map(ontology.edgeTypes.map(descriptor => [descriptor.id, descriptor]))
  }

  async validate(snapshot: ModelSnapshot): Promise<readonly ValidationIssue[]> {
    const issues: ValidationIssue[] = []
    const nodeTypeById = new Map<NodeId, NodeTypeId>(snapshot.nodes.map(node => [node.id, node.type]))

    for (const edge of snapshot.edges) {
      const descriptor = this.edgeTypeById.get(edge.type)
      if (!descriptor)
        continue
      issues.push(...this.checkEndpoints(edge, descriptor, nodeTypeById))
    }

    issues.push(...this.checkCardinality(snapshot.edges))
    return issues
  }

  private checkEndpoints(
    edge: GraphEdge,
    descriptor: EdgeTypeDescriptor,
    nodeTypeById: ReadonlyMap<NodeId, NodeTypeId>,
  ): readonly ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const fromType = nodeTypeById.get(edge.fromNodeId)
    const toType = nodeTypeById.get(edge.toNodeId)

    // Missing nodes are OrphanEdgeValidator's job, skip silently here.
    if (fromType && !descriptor.fromTypes.includes(fromType)) {
      issues.push({
        code: 'structural.endpoint-type-from' as ValidationCode,
        severity: 'error',
        message: `Edge "${edge.id}" of type "${edge.type}" has source node of type "${fromType}". Allowed source types: ${formatTypes(descriptor.fromTypes)}.`,
        edgeId: edge.id,
      })
    }
    if (toType && !descriptor.toTypes.includes(toType)) {
      issues.push({
        code: 'structural.endpoint-type-to' as ValidationCode,
        severity: 'error',
        message: `Edge "${edge.id}" of type "${edge.type}" has target node of type "${toType}". Allowed target types: ${formatTypes(descriptor.toTypes)}.`,
        edgeId: edge.id,
      })
    }
    return issues
  }

  /**
   * Cardinality is a property of the edge **type**,
   * evaluated by counting how many edges each node participates in.
   * Bucket edges by type, then count source / target frequency per node.
   * Surface the offending node, so the user sees where the duplicate lives,
   * not just that it exists.
   */
  private checkCardinality(edges: readonly GraphEdge[]): readonly ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const byType = new Map<EdgeTypeId, GraphEdge[]>()
    for (const edge of edges) {
      const bucket = byType.get(edge.type) ?? []
      bucket.push(edge)
      byType.set(edge.type, bucket)
    }

    for (const [edgeType, bucket] of byType) {
      const descriptor = this.edgeTypeById.get(edgeType)
      if (!descriptor?.cardinality)
        continue
      const sourceLimit = limitForSource(descriptor.cardinality)
      const targetLimit = limitForTarget(descriptor.cardinality)
      if (sourceLimit !== Infinity)
        issues.push(...overLimit(bucket, edge => edge.fromNodeId, sourceLimit, edgeType, 'source'))
      if (targetLimit !== Infinity)
        issues.push(...overLimit(bucket, edge => edge.toNodeId, targetLimit, edgeType, 'target'))
    }
    return issues
  }
}

// Cardinality reads as "one-to-many".
// '1:N' means one source relates to many targets,
// so each TARGET has at most one source. The SOURCE side can fan out without limit.
// Mnemonic:
//   sourceLimit = right side  (max outgoing edges a single source can have)
//   targetLimit = left side   (max incoming edges a single target can have)
function limitForSource(cardinality: NonNullable<EdgeTypeDescriptor['cardinality']>): number {
  return cardinality.endsWith('1') ? 1 : Infinity
}

function limitForTarget(cardinality: NonNullable<EdgeTypeDescriptor['cardinality']>): number {
  return cardinality.startsWith('1') ? 1 : Infinity
}

function overLimit(
  bucket: readonly GraphEdge[],
  nodeOf: (edge: GraphEdge) => NodeId,
  limit: number,
  edgeType: EdgeTypeId,
  endpoint: 'source' | 'target',
): readonly ValidationIssue[] {
  const counts = new Map<NodeId, number>()
  for (const edge of bucket) {
    const nodeId = nodeOf(edge)
    counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1)
  }
  const issues: ValidationIssue[] = []
  for (const [nodeId, count] of counts) {
    if (count <= limit)
      continue
    issues.push({
      code: `structural.cardinality-${endpoint}` as ValidationCode,
      severity: 'error',
      message: `Node "${nodeId}" appears as ${endpoint} on ${count} "${edgeType}" edges; cardinality allows at most ${limit}.`,
      nodeId,
    })
  }
  return issues
}

function formatTypes(types: readonly NodeTypeId[]): string {
  return types.length === 0 ? '(none)' : types.join(', ')
}
