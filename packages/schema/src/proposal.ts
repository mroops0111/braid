import { z } from 'zod'
import {
  Actor,
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
  GraphEdgeCreate,
  GraphEdgeUpdate,
  GraphNode,
  GraphNodeCreate,
  GraphNodeUpdate,
} from './model.js'

// Only the hard contract here. Authoring rules (length, tone, language) live in the skill layer.
const proposalRationale = z.string().min(1).max(1500).describe('One-paragraph plain-text summary of what changed and why.')

export const GraphOperation = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('addNode'), payload: GraphNodeCreate }),
  z.object({ operation: z.literal('addNodes'), payloads: z.array(GraphNodeCreate) }),
  z.object({ operation: z.literal('removeNode'), nodeId: NodeId }),
  z.object({ operation: z.literal('removeNodes'), nodeIds: z.array(NodeId) }),
  z.object({ operation: z.literal('updateNode'), nodeId: NodeId, patch: GraphNode.partial() }),
  z.object({ operation: z.literal('updateNodes'), updates: z.array(GraphNodeUpdate) }),
  z.object({ operation: z.literal('addEdge'), payload: GraphEdgeCreate }),
  z.object({ operation: z.literal('addEdges'), payloads: z.array(GraphEdgeCreate) }),
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
  rationale: proposalRationale,
  reviewedBy: UserId.optional(),
  reviewedAt: Timestamp.optional(),
  externalReferences: z.array(ExternalReference).optional(),
  // The user who created it, or 'system' for autonomous ones. Pending is owner-only.
  owner: Actor,
  // Name at submit time, survives renames. Absent for the 'system' owner.
  ownerDisplayName: z.string().min(1).optional(),
})
export type Proposal = z.infer<typeof Proposal>

export const ProposalCreate = z.object({
  workspaceId: WorkspaceId,
  operations: z.array(GraphOperation),
  generatedBy: SkillId,
  rationale: proposalRationale,
  externalReferences: z.array(ExternalReference).optional(),
})
export type ProposalCreate = z.infer<typeof ProposalCreate>

export const ProposalFilter = z.object({
  workspaceId: WorkspaceId.optional(),
  statuses: z.array(ProposalStatus).optional(),
  generatedBy: z.array(SkillId).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  // When set, hides others' pending proposals. Non-pending stay visible, absent shows all.
  viewerId: UserId.optional(),
  // Whether the viewer also sees service-account-owned pending. Owners only.
  includeServiceAccounts: z.boolean().optional(),
})
export type ProposalFilter = z.infer<typeof ProposalFilter>
