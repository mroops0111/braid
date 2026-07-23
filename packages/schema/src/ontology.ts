import { z } from 'zod'
import { OntologyId } from './common.js'

export const NodeTypeId = z.string().min(1).brand<'NodeTypeId'>()
export type NodeTypeId = z.infer<typeof NodeTypeId>

export const EdgeTypeId = z.string().min(1).brand<'EdgeTypeId'>()
export type EdgeTypeId = z.infer<typeof EdgeTypeId>

export const NodeStatus = z.enum(['draft', 'completed', 'unclear', 'deprecated'])
export type NodeStatus = z.infer<typeof NodeStatus>

// Layout hints so braid:generate-doc places nodes without ontology-specific code.
export const NodeTypeRenderHint = z.object({
  container: z.boolean().optional(),
  expandedUnder: NodeTypeId.optional(),
  section: z.string().min(1).optional(),
})
export type NodeTypeRenderHint = z.infer<typeof NodeTypeRenderHint>

export const NodeTypeDescriptor = z.object({
  id: NodeTypeId,
  label: z.string().min(1).max(40),
  description: z.string().optional(),
  allowedStatuses: z.array(NodeStatus).optional(),
  color: z.string().optional(),
  defaultVisible: z.boolean().optional(),
  renderHint: NodeTypeRenderHint.optional(),
})
export type NodeTypeDescriptor = z.infer<typeof NodeTypeDescriptor>

export const EdgeCardinality = z.enum(['1:1', '1:N', 'N:1', 'N:N'])
export type EdgeCardinality = z.infer<typeof EdgeCardinality>

export const EdgeTypeDescriptor = z.object({
  id: EdgeTypeId,
  label: z.string().min(1).max(40),
  description: z.string().optional(),
  fromTypes: z.array(NodeTypeId),
  toTypes: z.array(NodeTypeId),
  cardinality: EdgeCardinality.optional(),
  color: z.string().optional(),
})
export type EdgeTypeDescriptor = z.infer<typeof EdgeTypeDescriptor>

// Ontology-endpoint response. Descriptor order matters, so Studio keeps the author's order.
export const OntologyResponse = z.object({
  ontologyId: OntologyId,
  nodeTypes: z.array(NodeTypeDescriptor),
  edgeTypes: z.array(EdgeTypeDescriptor),
})
export type OntologyResponse = z.infer<typeof OntologyResponse>
