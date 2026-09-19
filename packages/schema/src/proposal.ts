import { z } from 'zod'
import {
  ClarificationId,
  EdgeId,
  ExternalReference,
  NodeId,
  ProposalId,
  SkillId,
  SkillRunId,
  Timestamp,
  UserId,
  WorkspaceId,
} from './common.js'
import { HandoffFilter, HandoffOwner } from './handoff.js'
import {
  GraphEdge,
  GraphEdgeCreate,
  GraphEdgeUpdate,
  GraphNode,
  GraphNodeCreate,
  GraphNodeUpdate,
} from './model.js'
import { SourceUnit } from './source-unit.js'

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

export const Proposal = HandoffOwner.extend({
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
  // Set when the clarify skill materialised this from an answered clarification.
  // Applying the proposal transitions that clarification to `applied`.
  clarificationId: ClarificationId.optional(),
  /**
   * The run that produced this, when a skill did.
   * Absent on a human-authored proposal.
   * It is what lets a batch tell its own output from anything else,
   * created while it was running,
   * and what links a proposal back to the conversation that reasoned about it.
   */
  skillRunId: SkillRunId.optional(),
  /**
   * The source units this was derived from, each at the version that was read.
   *
   * Stamped by the server from the run's own scope,
   * never reported by the agent,
   * because which document a run was pointed at, and what it hashed to,
   * are both facts the server already holds.
   *
   * Applying a proposal is what moves a unit into the model,
   * so this is what makes coverage answerable.
   * Reading a unit is not incorporating it,
   * and without this a rejected proposal would leave the unit looking current,
   * while the model reflected none of it.
   */
  sourceUnits: z.array(SourceUnit).optional(),
})
export type Proposal = z.infer<typeof Proposal>

export const ProposalCreate = z.object({
  workspaceId: WorkspaceId,
  operations: z.array(GraphOperation),
  /**
   * Which skill produced this, taken from the run that filed it.
   *
   * Optional on the way in,
   * since a running skill is identified by the credential it calls with,
   * so the server already knows.
   * A caller with no run has nothing to derive it from and must say.
   */
  generatedBy: SkillId.optional(),
  rationale: proposalRationale,
  externalReferences: z.array(ExternalReference).optional(),
  // Links the proposal back to the clarification it resolves, when any.
  clarificationId: ClarificationId.optional(),
  skillRunId: SkillRunId.optional(),
})
export type ProposalCreate = z.infer<typeof ProposalCreate>

export const ProposalFilter = HandoffFilter.extend({
  statuses: z.array(ProposalStatus).optional(),
  generatedBy: z.array(SkillId).optional(),
})
export type ProposalFilter = z.infer<typeof ProposalFilter>
