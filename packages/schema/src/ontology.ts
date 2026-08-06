import { z } from 'zod'
import { OntologyId } from './common.js'
import { localizedText } from './locale.js'
import { SourceRole } from './source.js'

export const NodeTypeId = z.string().min(1).brand<'NodeTypeId'>()
export type NodeTypeId = z.infer<typeof NodeTypeId>

export const EdgeTypeId = z.string().min(1).brand<'EdgeTypeId'>()
export type EdgeTypeId = z.infer<typeof EdgeTypeId>

export const NodeStatus = z.enum(['draft', 'completed', 'unclear', 'deprecated'])
export type NodeStatus = z.infer<typeof NodeStatus>

/** Layout hints so braid:generate-doc places nodes without ontology-specific code. */
export const NodeTypeRenderHint = z.object({
  container: z.boolean().optional(),
  expandedUnder: NodeTypeId.optional(),
  section: z.string().min(1).optional(),
})
export type NodeTypeRenderHint = z.infer<typeof NodeTypeRenderHint>

export const NodeTypeDescriptor = z.object({
  id: NodeTypeId,
  label: localizedText(z.string().min(1).max(40)),
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
  label: localizedText(z.string().min(1).max(40)),
  description: z.string().optional(),
  fromTypes: z.array(NodeTypeId),
  toTypes: z.array(NodeTypeId),
  cardinality: EdgeCardinality.optional(),
  color: z.string().optional(),
})
export type EdgeTypeDescriptor = z.infer<typeof EdgeTypeDescriptor>

/**
 * A source role the ontology declares. The framework reads the capabilities
 * here, never the id, so a new ontology adds roles without any core edit.
 */
export const SourceRoleDescriptor = z.object({
  id: SourceRole,
  label: localizedText(z.string().min(1)),
  // Sources of this role must be present for the ontology to run.
  required: z.boolean().optional(),
  // Sources of this role enumerate into batch units, and their sync drives the Reactor.
  unitBearing: z.boolean().optional(),
  // Workspace subfolder these sources provision into.
  pathSegment: z.string().min(1).optional(),
})
export type SourceRoleDescriptor = z.infer<typeof SourceRoleDescriptor>

/** Ontology-endpoint response. Descriptor order matters, so Studio keeps the author's order. */
export const OntologyResponse = z.object({
  ontologyId: OntologyId,
  nodeTypes: z.array(NodeTypeDescriptor),
  edgeTypes: z.array(EdgeTypeDescriptor),
  sourceRoles: z.array(SourceRoleDescriptor),
})
export type OntologyResponse = z.infer<typeof OntologyResponse>

/** Catalog of every registered ontology, for pre-workspace flows like the wizard. */
export const OntologyListResponse = z.object({
  ontologies: z.array(OntologyResponse),
})
export type OntologyListResponse = z.infer<typeof OntologyListResponse>
