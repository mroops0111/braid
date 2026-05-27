import { z } from 'zod'
import {
  EdgeId,
  ExternalReference,
  NodeId,
  ProposalId,
  SkillId,
  Timestamp,
  UserId,
  WorkspaceId,
} from './common.js'
import {
  GraphEdge,
  GraphEdgeUpdate,
  GraphNode,
  GraphNodeUpdate,
  NewGraphEdge,
  NewGraphNode,
} from './model.js'

export const GraphOperation = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('addNode'), payload: NewGraphNode }),
  z.object({ operation: z.literal('addNodes'), payloads: z.array(NewGraphNode) }),
  z.object({ operation: z.literal('removeNode'), nodeId: NodeId }),
  z.object({ operation: z.literal('removeNodes'), nodeIds: z.array(NodeId) }),
  z.object({ operation: z.literal('updateNode'), nodeId: NodeId, patch: GraphNode.partial() }),
  z.object({ operation: z.literal('updateNodes'), updates: z.array(GraphNodeUpdate) }),
  z.object({ operation: z.literal('addEdge'), payload: NewGraphEdge }),
  z.object({ operation: z.literal('addEdges'), payloads: z.array(NewGraphEdge) }),
  z.object({ operation: z.literal('removeEdge'), edgeId: EdgeId }),
  z.object({ operation: z.literal('removeEdges'), edgeIds: z.array(EdgeId) }),
  z.object({ operation: z.literal('updateEdge'), edgeId: EdgeId, patch: GraphEdge.partial() }),
  z.object({ operation: z.literal('updateEdges'), updates: z.array(GraphEdgeUpdate) }),
])
export type GraphOperation = z.infer<typeof GraphOperation>

export const ProposalStatus = z.enum(['pending', 'applied', 'rejected'])
export type ProposalStatus = z.infer<typeof ProposalStatus>

export const Proposal = z.object({
  id: ProposalId,
  workspaceId: WorkspaceId,
  status: ProposalStatus,
  operations: z.array(GraphOperation),
  generatedBy: SkillId,
  generatedAt: Timestamp,
  rationale: z.string().min(1).max(1500).describe('One paragraph: what changed, why, from which sources. Plain text. ≤ 500 chars typical. See content-conventions.md.'),
  reviewedBy: UserId.optional(),
  reviewedAt: Timestamp.optional(),
  externalReferences: z.array(ExternalReference).optional(),
})
export type Proposal = z.infer<typeof Proposal>

export const ProposalDraft = z.object({
  workspaceId: WorkspaceId,
  operations: z.array(GraphOperation),
  generatedBy: SkillId,
  rationale: z.string().min(1).max(1500).describe('One paragraph: what changed, why, from which sources. Plain text. ≤ 500 chars typical. See content-conventions.md.'),
  externalReferences: z.array(ExternalReference).optional(),
})
export type ProposalDraft = z.infer<typeof ProposalDraft>

export const ProposalFilter = z.object({
  workspaceId: WorkspaceId.optional(),
  statuses: z.array(ProposalStatus).optional(),
  generatedBy: z.array(SkillId).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
})
export type ProposalFilter = z.infer<typeof ProposalFilter>
