import { z } from 'zod'
import { DriftIssueId, EdgeId, ExternalReference, NodeId, SkillId, SourceReference, Timestamp } from './common.js'
import { EdgeTypeId, NodeStatus, NodeTypeId } from './ontology.js'
import { SourceRole } from './source.js'

export const DriftSeverity = z.enum(['error', 'warning', 'info']).describe('How far apart the sources are, `error` where they contradict and `info` where they merely differ.')
export type DriftSeverity = z.infer<typeof DriftSeverity>

/**
 * Re-derived each build, no resolved state. Fix the source or list it in acknowledgedDrifts.
 * Comparison taxonomy lives in the skill prompts, so new dimensions need no migration.
 */
export const DriftIssue = z.object({
  id: DriftIssueId.describe('Id for this drift, minted by whoever raises it. Any non-empty string, and the server never reuses it across builds.'),
  description: z.string().min(1).describe('What the sources disagree about, in one sentence a reader can act on. Plain text, no Markdown, since a person reads it in a review pane.'),
  severity: DriftSeverity,
  sourceReferences: z.array(SourceReference).min(2).describe('The passages that disagree, at least two, one per side.'),
  raisedAt: Timestamp.describe('When this drift was last derived.'),
}).describe('Two or more sources saying different things about one node, derived on each build rather than stored as resolved.').openapi('DriftIssue')
export type DriftIssue = z.infer<typeof DriftIssue>

// Only the hard contract here. Authoring rules (length, tone, language) live in the skill layer.
const nodeName = z.string().min(1).max(200).describe('Human-facing display name, distinct from the id.')
const nodeDescription = z.string().max(4000).optional().describe('What this node is, for a person reading the graph. Markdown allowed.')

export const GraphNodeMetadata = z.object({
  missingRoles: z.array(SourceRole).optional().describe('Source roles the ontology expects on this node and no source covers yet. Absent means none missing.'),
  sourceReferences: z.array(SourceReference).default([]).describe('The passages this node was derived from, which is what makes it evidenced rather than asserted.'),
  lastTouchedBy: SkillId.optional().describe('The skill whose proposal last changed this node.'),
  externalReferences: z.array(ExternalReference).optional().describe('Links out to work about this node, such as the ticket that asked for it.'),
  driftIssues: z.array(DriftIssue).optional().describe('Disagreements between this node\'s sources. A patch replaces the whole list rather than adding to it, since drift is re-derived on each build, so leaving one out is what clears it.'),
  acknowledgedDrifts: z.array(z.string().min(1)).optional().describe('Drift descriptions a person has accepted, where an exact string match suppresses that drift. A person\'s acknowledgement rather than an observation, never sent by a run.'),
}).describe('What is known about a node besides its own content, chiefly the evidence behind it.').openapi('GraphNodeMetadata')
export type GraphNodeMetadata = z.infer<typeof GraphNodeMetadata>

export const GraphEdgeMetadata = z.object({
  sourceReferences: z.array(SourceReference).default([]).describe('The passages that say this relationship holds.'),
  lastTouchedBy: SkillId.optional().describe('The skill whose proposal last changed this edge.'),
  externalReferences: z.array(ExternalReference).optional().describe('Links out to work about this relationship.'),
}).describe('What is known about an edge besides its endpoints, chiefly the evidence behind it.').openapi('GraphEdgeMetadata')
export type GraphEdgeMetadata = z.infer<typeof GraphEdgeMetadata>

/**
 * One shape, registered twice.
 *
 * A patch is the same fields with every one optional,
 * and building it from the shape rather than from the registered schema,
 * keeps the two components apart in the served document.
 */
const graphNodeShape = {
  id: NodeId,
  type: NodeTypeId,
  name: nodeName,
  description: nodeDescription,
  status: NodeStatus,
  metadata: GraphNodeMetadata,
}

export const GraphNode = z.object(graphNodeShape).describe('A node as the graph holds it.').openapi('GraphNode')
export type GraphNode = z.infer<typeof GraphNode>

/** Every field optional, so an update carries only what it changes. */
export const GraphNodePatch = z.object(graphNodeShape).partial().describe('The fields of a node to change, and only those. Anything left out keeps its current value.').openapi('GraphNodePatch')
export type GraphNodePatch = z.infer<typeof GraphNodePatch>

export const GraphNodeCreate = z.object({
  id: NodeId.optional().describe('Id to give the new node. Absent leaves the server to derive one.'),
  type: NodeTypeId,
  name: nodeName,
  description: nodeDescription,
  status: NodeStatus.default('draft').describe('How settled this node is. Defaults to `draft`, which is what a new node from a run should be.'),
  metadata: GraphNodeMetadata.optional().describe('Evidence for the new node. Send the passages it was derived from, since a node without them is an assertion.'),
}).describe('A node to add to the graph.').openapi('GraphNodeCreate')
export type GraphNodeCreate = z.infer<typeof GraphNodeCreate>

const graphEdgeShape = {
  id: EdgeId,
  type: EdgeTypeId,
  fromNodeId: NodeId.describe('The node the relationship starts at.'),
  toNodeId: NodeId.describe('The node the relationship points to.'),
  metadata: GraphEdgeMetadata,
}

export const GraphEdge = z.object(graphEdgeShape).describe('An edge as the graph holds it.').openapi('GraphEdge')
export type GraphEdge = z.infer<typeof GraphEdge>

/** Every field optional, so an update carries only what it changes. */
export const GraphEdgePatch = z.object(graphEdgeShape).partial().describe('The fields of an edge to change, and only those. Anything left out keeps its current value.').openapi('GraphEdgePatch')
export type GraphEdgePatch = z.infer<typeof GraphEdgePatch>

export const GraphEdgeCreate = z.object({
  id: EdgeId.optional().describe('Id to give the new edge. Absent leaves the server to derive one.'),
  type: EdgeTypeId,
  fromNodeId: NodeId.describe('The node the relationship starts at. It must already exist, or be added in the same proposal.'),
  toNodeId: NodeId.describe('The node the relationship points to. It must already exist, or be added in the same proposal.'),
  metadata: GraphEdgeMetadata.optional().describe('Evidence for the new edge, such as the passage that says the two are related.'),
}).describe('An edge to add to the graph.').openapi('GraphEdgeCreate')
export type GraphEdgeCreate = z.infer<typeof GraphEdgeCreate>

export const GraphNodeUpdate = z.object({
  nodeId: NodeId.describe('The node to change.'),
  patch: GraphNodePatch,
}).describe('One node and the change to make to it.').openapi('GraphNodeUpdate')
export type GraphNodeUpdate = z.infer<typeof GraphNodeUpdate>

export const GraphEdgeUpdate = z.object({
  edgeId: EdgeId.describe('The edge to change.'),
  patch: GraphEdgePatch,
}).describe('One edge and the change to make to it.').openapi('GraphEdgeUpdate')
export type GraphEdgeUpdate = z.infer<typeof GraphEdgeUpdate>

export const ModelSnapshot = z.object({
  nodes: z.array(GraphNode).describe('Every node the workspace holds.'),
  edges: z.array(GraphEdge).describe('Every edge the workspace holds.'),
}).describe('The whole graph at one moment.').openapi('ModelSnapshot')
export type ModelSnapshot = z.infer<typeof ModelSnapshot>

export const GraphNodeFilter = z.object({
  types: z.array(NodeTypeId).optional().describe('Keep only nodes of these types. Absent keeps every type.'),
  statuses: z.array(NodeStatus).optional().describe('Keep only nodes at these statuses. Absent keeps every status.'),
  textContains: z.string().optional().describe('Keep only nodes whose name or description contains this text, case-insensitively.'),
}).describe('Which nodes to read, narrowed before the graph is returned.').openapi('GraphNodeFilter')
export type GraphNodeFilter = z.infer<typeof GraphNodeFilter>

export const GraphEdgeFilter = z.object({
  types: z.array(EdgeTypeId).optional().describe('Keep only edges of these types. Absent keeps every type.'),
  fromNodeId: NodeId.optional().describe('Keep only edges starting at this node.'),
  toNodeId: NodeId.optional().describe('Keep only edges pointing at this node.'),
}).describe('Which edges to read, narrowed before the graph is returned.').openapi('GraphEdgeFilter')
export type GraphEdgeFilter = z.infer<typeof GraphEdgeFilter>
