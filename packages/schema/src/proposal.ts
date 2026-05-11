import { z } from 'zod'
import {
  EdgeId,
  ExternalReference,
  NodeId,
  ProposalId,
  SkillId,
  Timestamp,
  UserId,
} from './common.js'
import {
  GraphEdge,
  GraphEdgeUpdate,
  GraphNode,
  GraphNodeUpdate,
  NewGraphEdge,
  NewGraphNode,
} from './model.js'

export const GraphOperation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addNode'), payload: NewGraphNode }),
  z.object({ op: z.literal('addNodes'), payloads: z.array(NewGraphNode) }),
  z.object({ op: z.literal('removeNode'), nodeId: NodeId }),
  z.object({ op: z.literal('removeNodes'), nodeIds: z.array(NodeId) }),
  z.object({ op: z.literal('updateNode'), nodeId: NodeId, patch: GraphNode.partial() }),
  z.object({ op: z.literal('updateNodes'), updates: z.array(GraphNodeUpdate) }),
  z.object({ op: z.literal('addEdge'), payload: NewGraphEdge }),
  z.object({ op: z.literal('addEdges'), payloads: z.array(NewGraphEdge) }),
  z.object({ op: z.literal('removeEdge'), edgeId: EdgeId }),
  z.object({ op: z.literal('removeEdges'), edgeIds: z.array(EdgeId) }),
  z.object({ op: z.literal('updateEdge'), edgeId: EdgeId, patch: GraphEdge.partial() }),
  z.object({ op: z.literal('updateEdges'), updates: z.array(GraphEdgeUpdate) }),
])
export type GraphOperation = z.infer<typeof GraphOperation>

export const ProposalStatus = z.enum(['pending', 'applied', 'rejected'])
export type ProposalStatus = z.infer<typeof ProposalStatus>

export const Proposal = z.object({
  id: ProposalId,
  status: ProposalStatus,
  operations: z.array(GraphOperation),
  generatedBy: SkillId,
  generatedAt: Timestamp,
  rationale: z.string(),
  reviewedBy: UserId.optional(),
  reviewedAt: Timestamp.optional(),
  externalReferences: z.array(ExternalReference).optional(),
})
export type Proposal = z.infer<typeof Proposal>

export const ProposalDraft = z.object({
  operations: z.array(GraphOperation),
  generatedBy: SkillId,
  rationale: z.string(),
  externalReferences: z.array(ExternalReference).optional(),
})
export type ProposalDraft = z.infer<typeof ProposalDraft>

export const ProposalFilter = z.object({
  statuses: z.array(ProposalStatus).optional(),
  generatedBy: z.array(SkillId).optional(),
})
export type ProposalFilter = z.infer<typeof ProposalFilter>
