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
  GraphEdgeCreate,
  GraphEdgePatch,
  GraphEdgeUpdate,
  GraphNodeCreate,
  GraphNodePatch,
  GraphNodeUpdate,
} from './model.js'
import { SourceUnit } from './source-unit.js'

// Only the hard contract here. Authoring rules (length, tone, language) live in the skill layer.
const proposalRationale = z.string().min(1).max(1500).describe('One paragraph of plain text saying what changed and why, for the person who decides.')

/**
 * The twelve changes a proposal can carry, each registered on its own.
 *
 * A component per arm rather than one inlined union,
 * because the gateway expands every `$ref` into the tool schema a model reads,
 * and an arm named once is an arm described once.
 * Singular and plural stay separate arms rather than one taking an array,
 * so a caller changing one thing cannot accidentally write a list.
 *
 * What each arm is for sits on its `operation` literal rather than on the arm.
 * The gateway builds one model per variant from the variant's fields alone,
 * so an object's own description is the one part of it a model never sees.
 */
export const GraphOperation = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('addNode').describe('Add one node, for something the graph does not hold yet.'),
    payload: GraphNodeCreate,
  }).openapi('AddNodeOperation'),

  z.object({
    operation: z.literal('addNodes').describe('Add several nodes at once, which is `addNode` in bulk.'),
    payloads: z.array(GraphNodeCreate).describe('The nodes to add, in the order a reader should meet them.'),
  }).openapi('AddNodesOperation'),

  z.object({
    operation: z.literal('removeNode').describe('Remove one node. A node that was ever `completed` is deprecated by an update instead, so its history survives.'),
    nodeId: NodeId.describe('The node to remove, with every edge that touches it.'),
  }).openapi('RemoveNodeOperation'),

  z.object({
    operation: z.literal('removeNodes').describe('Remove several nodes at once, on the same terms as `removeNode`.'),
    nodeIds: z.array(NodeId).describe('The nodes to remove, with every edge that touches them.'),
  }).openapi('RemoveNodesOperation'),

  z.object({
    operation: z.literal('updateNode').describe('Change one node. The id sits beside the patch here, since there is only one of each.'),
    nodeId: NodeId.describe('The node to change.'),
    patch: GraphNodePatch,
  }).openapi('UpdateNodeOperation'),

  z.object({
    operation: z.literal('updateNodes').describe('Change several nodes, each differently. Every entry carries its own id, so there is none beside this operation.'),
    updates: z.array(GraphNodeUpdate).describe('One entry per node, each pairing its own id with its own patch.'),
  }).openapi('UpdateNodesOperation'),

  z.object({
    operation: z.literal('addEdge').describe('Add one relationship between two nodes.'),
    payload: GraphEdgeCreate,
  }).openapi('AddEdgeOperation'),

  z.object({
    operation: z.literal('addEdges').describe('Add several relationships at once, which is `addEdge` in bulk.'),
    payloads: z.array(GraphEdgeCreate).describe('The edges to add.'),
  }).openapi('AddEdgesOperation'),

  z.object({
    operation: z.literal('removeEdge').describe('Remove one relationship, leaving both nodes in place.'),
    edgeId: EdgeId.describe('The edge to remove. Its endpoints stay.'),
  }).openapi('RemoveEdgeOperation'),

  z.object({
    operation: z.literal('removeEdges').describe('Remove several relationships at once, leaving their nodes in place.'),
    edgeIds: z.array(EdgeId).describe('The edges to remove. Their endpoints stay.'),
  }).openapi('RemoveEdgesOperation'),

  z.object({
    operation: z.literal('updateEdge').describe('Change one relationship. The id sits beside the patch here, since there is only one of each.'),
    edgeId: EdgeId.describe('The edge to change.'),
    patch: GraphEdgePatch,
  }).openapi('UpdateEdgeOperation'),

  z.object({
    operation: z.literal('updateEdges').describe('Change several relationships, each differently. Every entry carries its own id, so there is none beside this operation.'),
    updates: z.array(GraphEdgeUpdate).describe('One entry per edge, each pairing its own id with its own patch.'),
  }).openapi('UpdateEdgesOperation'),
]).describe('One change to the graph. `operation` says which kind, and the rest of the fields belong to that kind.').openapi('GraphOperation')
export type GraphOperation = z.infer<typeof GraphOperation>

export const ProposalStatus = z.enum(['pending', 'applied', 'rejected']).describe('Where the proposal stands. `pending` is waiting on a person, and the other two are what they decided.')
export type ProposalStatus = z.infer<typeof ProposalStatus>

export const Proposal = HandoffOwner.extend({
  id: ProposalId,
  workspaceId: WorkspaceId,
  status: ProposalStatus,
  operations: z.array(GraphOperation).describe('The changes this proposal makes, applied together or not at all.'),
  generatedBy: SkillId,
  generatedAt: Timestamp.describe('When the run filed this.'),
  rationale: proposalRationale,
  reviewedBy: UserId.optional().describe('Who applied or rejected this. Absent while it is pending.'),
  reviewedAt: Timestamp.optional().describe('When it was applied or rejected. Absent while it is pending.'),
  externalReferences: z.array(ExternalReference).optional(),
  clarificationId: ClarificationId.optional().describe('The clarification this resolves, when any. Applying the proposal closes that question.'),
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
}).describe('A set of graph changes waiting on a person to apply or reject.').openapi('Proposal')
export type Proposal = z.infer<typeof Proposal>

export const ProposalCreate = z.object({
  workspaceId: WorkspaceId,
  operations: z.array(GraphOperation).describe('The changes to make, applied together or not at all. Keep a proposal under 30 of them and split the rest into another.'),
  generatedBy: SkillId.optional().describe('Which skill produced this. The credential the call arrives with already identifies the run, so a run leaves it unset, and only a caller with no run sends it.'),
  rationale: proposalRationale,
  externalReferences: z.array(ExternalReference).optional().describe('Links out to the work this came from, such as the ticket that asked for it.'),
  clarificationId: ClarificationId.optional().describe('The clarification this proposal resolves, when it resolves one. Sending it closes that question once a person applies this, and leaving it out leaves the question open for somebody to answer twice.'),
  skillRunId: SkillRunId.optional().describe('The run that produced this. Derived from the calling credential, so a run leaves it unset.'),
}).describe('A set of graph changes to file for review.').openapi('ProposalCreate')
export type ProposalCreate = z.infer<typeof ProposalCreate>

export const ProposalFilter = HandoffFilter.extend({
  statuses: z.array(ProposalStatus).optional().describe('Keep only proposals at these statuses. Absent keeps every status.'),
  generatedBy: z.array(SkillId).optional().describe('Keep only proposals these skills filed.'),
})
export type ProposalFilter = z.infer<typeof ProposalFilter>
