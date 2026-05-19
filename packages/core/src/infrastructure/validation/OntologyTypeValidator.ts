import type {
  ModelSnapshot,
  ValidationCode,
  ValidationIssue,
} from '@braidhq/schema'
import type { OntologyPlugin, OntologyValidator } from '../../domain/plugin/Ontology.js'

/**
 * Generic engine: reads `nodeTypes` / `edgeTypes` from an `OntologyPlugin`
 * and rejects graph nodes/edges whose `type` field isn't in the allow-list.
 *
 * Not a plugin: callers (typically `defineOntology()` in the SDK) `new` an
 * instance bound to their ontology and expose it via `OntologyPlugin.validators[]`.
 * Other ontologies (c4, event-modeling, ...) reuse the same engine without
 * importing the ddd package.
 */
export class OntologyTypeValidator implements OntologyValidator {
  private readonly knownNodeTypes: ReadonlySet<string>
  private readonly knownEdgeTypes: ReadonlySet<string>

  constructor(private readonly ontology: OntologyPlugin) {
    this.knownNodeTypes = new Set(ontology.nodeTypes.map(t => t.id))
    this.knownEdgeTypes = new Set(ontology.edgeTypes.map(t => t.id))
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
