import type { EdgeTypeId, ModelSnapshot, NodeStatus, NodeTypeId, OntologyId, ValidationIssue } from '@braidhq/schema'
import type { Plugin } from './Plugin.js'

export interface NodeTypeDescriptor {
  readonly id: NodeTypeId
  readonly label: string
  readonly description?: string
  readonly allowedStatuses?: readonly NodeStatus[]
  /**
   * Optional UI accent colour. Any CSS colour string the browser
   * accepts (`oklch(...)`, `#7c3aed`, `rgb(...)`). Studio uses it for
   * node-card type badges and edge strokes; if omitted, Studio falls
   * back to a deterministic hash-of-id colour so an ontology without
   * authored colours still renders distinguishable types.
   */
  readonly color?: string
  /**
   * Whether this type is shown by default when the user first opens the
   * graph. When any descriptor sets this, Studio initialises the type
   * filter to only those types (typically the high-level structural
   * types like boundedContext / aggregate). User can clear the filter
   * to reveal the rest. If no descriptor sets it, all types show.
   */
  readonly defaultVisible?: boolean
}

export interface EdgeTypeDescriptor {
  readonly id: EdgeTypeId
  readonly label?: string
  readonly fromTypes: readonly NodeTypeId[]
  readonly toTypes: readonly NodeTypeId[]
  readonly cardinality?: '1:1' | '1:N' | 'N:1' | 'N:N'
  /** Optional UI accent colour. Same semantics as `NodeTypeDescriptor.color`. */
  readonly color?: string
}

/**
 * Validator bundled with an ontology. The ontology brings its own
 * enforcement (type check, structural rules, future ontology-specific
 * invariants) instead of those being separate plugins that have to
 * cross-reference the ontology at runtime.
 *
 * `defineOntology()` auto-binds the framework's two generic engines
 * (`OntologyTypeValidator` + `StructuralValidator`); ontology authors
 * pass `extraValidators` for anything beyond declarative checks.
 */
export interface OntologyValidator {
  validate: (snapshot: ModelSnapshot) => Promise<readonly ValidationIssue[]>
}

export interface OntologyPlugin extends Plugin {
  readonly type: 'ontology'
  readonly ontologyId: OntologyId
  readonly nodeTypes: readonly NodeTypeDescriptor[]
  readonly edgeTypes: readonly EdgeTypeDescriptor[]
  /**
   * Validators that run against the model whenever the workspace is
   * configured to use this ontology. Populated by `defineOntology()`.
   */
  readonly validators: readonly OntologyValidator[]
}
