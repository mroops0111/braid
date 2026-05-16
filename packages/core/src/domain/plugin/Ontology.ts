import type { EdgeTypeId, NodeStatus, NodeTypeId, OntologyId } from '@telos/schema'
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

export interface Ontology extends Plugin {
  readonly type: 'ontology'
  readonly ontologyId: OntologyId
  readonly nodeTypes: readonly NodeTypeDescriptor[]
  readonly edgeTypes: readonly EdgeTypeDescriptor[]
}
