import type {
  ModelSnapshot,
  PluginId,
  ValidationCode,
  ValidationIssue,
} from '@braidhq/schema'
import type { Ontology } from '../../domain/plugin/Ontology.js'
import type { Validator } from '../../domain/plugin/Validator.js'
import { z } from 'zod'

/**
 * Validator that reads its allow-list from a live Ontology instance.
 *
 * Generic across ontologies: there is exactly one place that lists
 * the valid node and edge types — the ontology plugin itself — and
 * this validator, the `GET /ontology` endpoint, and the docs served
 * to skills all consume the same arrays. Adding a new type cannot
 * drift out of sync with what the validator accepts.
 */
export class OntologyTypeValidator implements Validator {
  readonly type = 'validator' as const
  readonly id: PluginId
  readonly configSchema = z.object({})

  private readonly knownNodeTypes: ReadonlySet<string>
  private readonly knownEdgeTypes: ReadonlySet<string>

  constructor(private readonly ontology: Ontology) {
    this.id = `ontology-type-validator.${ontology.ontologyId}` as PluginId
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
