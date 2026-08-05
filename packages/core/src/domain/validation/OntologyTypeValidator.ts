import type {
  ModelSnapshot,
  ValidationCode,
  ValidationIssue,
} from '@braidhq/schema'
import type { OntologyPlugin, OntologyValidator } from '../plugin/OntologyPlugin.js'

/**
 * Generic engine reading an `OntologyPlugin`'s declared vocabulary.
 * Rejects any graph reference outside it, a node or edge `type`,
 * or a node's `metadata.missingRoles` entry.
 *
 * Not a plugin: callers construct an instance bound to their ontology,
 * typically `defineOntologyPlugin()` in the SDK,
 * and expose it via `OntologyPlugin.validators[]`.
 * Other ontologies reuse the same engine without importing the ddd package,
 * e.g. c4 or event-modeling.
 */
export class OntologyTypeValidator implements OntologyValidator {
  private readonly knownNodeTypes: ReadonlySet<string>
  private readonly knownEdgeTypes: ReadonlySet<string>
  private readonly knownSourceRoles: ReadonlySet<string>

  constructor(private readonly ontology: OntologyPlugin) {
    this.knownNodeTypes = new Set(ontology.nodeTypes.map(nodeType => nodeType.id))
    this.knownEdgeTypes = new Set(ontology.edgeTypes.map(edgeType => edgeType.id))
    this.knownSourceRoles = new Set(ontology.sourceRoles.map(role => role.id))
  }

  async validate(snapshot: ModelSnapshot): Promise<readonly ValidationIssue[]> {
    const issues: ValidationIssue[] = []
    for (const node of snapshot.nodes) {
      if (!this.knownNodeTypes.has(node.type)) {
        issues.push({
          code: 'ontology.unknown-node-type' as ValidationCode,
          severity: 'error',
          message: `Node "${node.name}" has type "${node.type}" which is not in the ${this.ontology.ontologyId} ontology. Valid types: ${[...this.knownNodeTypes].join(', ')}.`,
          nodeId: node.id,
        })
      }
      for (const role of node.metadata.missingRoles ?? []) {
        if (!this.knownSourceRoles.has(role)) {
          issues.push({
            code: 'ontology.unknown-source-role' as ValidationCode,
            severity: 'error',
            message: `Node "${node.name}" declares a missing role "${role}" which is not a source role in the ${this.ontology.ontologyId} ontology. Valid roles: ${[...this.knownSourceRoles].join(', ')}.`,
            nodeId: node.id,
          })
        }
      }
    }
    for (const edge of snapshot.edges) {
      if (!this.knownEdgeTypes.has(edge.type)) {
        issues.push({
          code: 'ontology.unknown-edge-type' as ValidationCode,
          severity: 'error',
          message: `Edge "${edge.id}" has type "${edge.type}" which is not in the ${this.ontology.ontologyId} ontology. Valid types: ${[...this.knownEdgeTypes].join(', ')}.`,
          edgeId: edge.id,
        })
      }
    }
    return issues
  }
}
