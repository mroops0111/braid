import type { EdgeTypeId, NodeStatus, NodeTypeId, OntologyId } from '@telos/schema'
import type { Plugin } from './Plugin.js'

export interface NodeTypeDescriptor {
  readonly id: NodeTypeId
  readonly label: string
  readonly description?: string
  readonly allowedStatuses?: readonly NodeStatus[]
}

export interface EdgeTypeDescriptor {
  readonly id: EdgeTypeId
  readonly label?: string
  readonly fromTypes: readonly NodeTypeId[]
  readonly toTypes: readonly NodeTypeId[]
  readonly cardinality?: '1:1' | '1:N' | 'N:1' | 'N:N'
}

export interface Ontology extends Plugin {
  readonly type: 'ontology'
  readonly ontologyId: OntologyId
  readonly nodeTypes: readonly NodeTypeDescriptor[]
  readonly edgeTypes: readonly EdgeTypeDescriptor[]
}
