import { z } from 'zod'
import { EdgeId, ExternalReference, NodeId, SkillId, SourceReference, Timestamp } from './common.js'
import { DriftIssue } from './drift.js'
import { EdgeTypeId, NodeStatus, NodeTypeId } from './ontology.js'

export const Embedding = z.object({
  // number[] not Float32Array; infrastructure converts at the Neo4j boundary.
  vector: z.array(z.number()),
  modelId: z.string().min(1),
  createdAt: Timestamp,
})
export type Embedding = z.infer<typeof Embedding>

export const GraphNodeMetadata = z.object({
  intentMissing: z.boolean().optional(),
  intentConflict: z.boolean().optional(),
  implementationMissing: z.boolean().optional(),
  sourceReferences: z.array(SourceReference).default([]),
  lastTouchedBy: SkillId.optional(),
  externalReferences: z.array(ExternalReference).optional(),
  /**
   * Structured drift observations produced by build-cycle skills.
   * `EvidenceValidator` surfaces each entry as a `ValidationIssue`.
   * See `DriftIssue` for the lifecycle (re-derived each build, no
   * resolved state).
   */
  driftIssues: z.array(DriftIssue).optional(),
  /**
   * Descriptions matching this list suppress matching drift issues —
   * the human has acknowledged the inconsistency and chosen to keep it.
   * Match is exact string equality on `DriftIssue.description`.
   */
  acknowledgedDrifts: z.array(z.string().min(1)).optional(),
})
export type GraphNodeMetadata = z.infer<typeof GraphNodeMetadata>

export const GraphEdgeMetadata = z.object({
  sourceReferences: z.array(SourceReference).default([]),
  lastTouchedBy: SkillId.optional(),
  externalReferences: z.array(ExternalReference).optional(),
})
export type GraphEdgeMetadata = z.infer<typeof GraphEdgeMetadata>

export const GraphNode = z.object({
  id: NodeId,
  type: NodeTypeId,
  name: z.string().min(1),
  description: z.string().optional(),
  status: NodeStatus,
  metadata: GraphNodeMetadata,
  embedding: Embedding.optional(),
})
export type GraphNode = z.infer<typeof GraphNode>

export const NewGraphNode = z.object({
  id: NodeId.optional(),
  type: NodeTypeId,
  name: z.string().min(1),
  description: z.string().optional(),
  status: NodeStatus.default('draft'),
  metadata: GraphNodeMetadata.optional(),
  embedding: Embedding.optional(),
})
export type NewGraphNode = z.infer<typeof NewGraphNode>

export const GraphEdge = z.object({
  id: EdgeId,
  type: EdgeTypeId,
  fromNodeId: NodeId,
  toNodeId: NodeId,
  metadata: GraphEdgeMetadata,
})
export type GraphEdge = z.infer<typeof GraphEdge>

export const NewGraphEdge = z.object({
  id: EdgeId.optional(),
  type: EdgeTypeId,
  fromNodeId: NodeId,
  toNodeId: NodeId,
  metadata: GraphEdgeMetadata.optional(),
})
export type NewGraphEdge = z.infer<typeof NewGraphEdge>

export const GraphNodeUpdate = z.object({
  nodeId: NodeId,
  patch: GraphNode.partial(),
})
export type GraphNodeUpdate = z.infer<typeof GraphNodeUpdate>

export const GraphEdgeUpdate = z.object({
  edgeId: EdgeId,
  patch: GraphEdge.partial(),
})
export type GraphEdgeUpdate = z.infer<typeof GraphEdgeUpdate>

export const ModelSnapshot = z.object({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
})
export type ModelSnapshot = z.infer<typeof ModelSnapshot>

export const GraphNodeFilter = z.object({
  types: z.array(NodeTypeId).optional(),
  statuses: z.array(NodeStatus).optional(),
  nameContains: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
})
export type GraphNodeFilter = z.infer<typeof GraphNodeFilter>

export const GraphEdgeFilter = z.object({
  types: z.array(EdgeTypeId).optional(),
  fromNodeId: NodeId.optional(),
  toNodeId: NodeId.optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
})
export type GraphEdgeFilter = z.infer<typeof GraphEdgeFilter>
