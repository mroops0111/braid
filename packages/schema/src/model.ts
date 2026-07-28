import { z } from 'zod'
import { DriftIssueId, EdgeId, ExternalReference, NodeId, SkillId, SourceReference, Timestamp } from './common.js'
import { EdgeTypeId, NodeStatus, NodeTypeId } from './ontology.js'

export const DriftSeverity = z.enum(['error', 'warning', 'info'])
export type DriftSeverity = z.infer<typeof DriftSeverity>

/**
 * Re-derived each build, no resolved state. Fix the source or list it in acknowledgedDrifts.
 * Comparison taxonomy lives in the skill prompts, so new dimensions need no migration.
 */
export const DriftIssue = z.object({
  id: DriftIssueId,
  description: z.string().min(1),
  severity: DriftSeverity,
  sourceReferences: z.array(SourceReference).min(2),
  raisedAt: Timestamp,
})
export type DriftIssue = z.infer<typeof DriftIssue>

// Only the hard contract here. Authoring rules (length, tone, language) live in the skill layer.
const nodeName = z.string().min(1).max(200).describe('Human-facing display name, distinct from id.')
const nodeDescription = z.string().max(4000).optional().describe('Human-facing description of the node. Markdown allowed.')

export const Embedding = z.object({
  // Plain number[], not Float32Array. The storage adapter converts at its own boundary.
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
  // Re-derived each build. EvidenceValidator surfaces each as a ValidationIssue.
  driftIssues: z.array(DriftIssue).optional(),
  // Drift descriptions the human keeps. An exact match suppresses that drift.
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
  name: nodeName,
  description: nodeDescription,
  status: NodeStatus,
  metadata: GraphNodeMetadata,
  embedding: Embedding.optional(),
})
export type GraphNode = z.infer<typeof GraphNode>

export const GraphNodeCreate = z.object({
  id: NodeId.optional(),
  type: NodeTypeId,
  name: nodeName,
  description: nodeDescription,
  status: NodeStatus.default('draft'),
  metadata: GraphNodeMetadata.optional(),
  embedding: Embedding.optional(),
})
export type GraphNodeCreate = z.infer<typeof GraphNodeCreate>

export const GraphEdge = z.object({
  id: EdgeId,
  type: EdgeTypeId,
  fromNodeId: NodeId,
  toNodeId: NodeId,
  metadata: GraphEdgeMetadata,
})
export type GraphEdge = z.infer<typeof GraphEdge>

export const GraphEdgeCreate = z.object({
  id: EdgeId.optional(),
  type: EdgeTypeId,
  fromNodeId: NodeId,
  toNodeId: NodeId,
  metadata: GraphEdgeMetadata.optional(),
})
export type GraphEdgeCreate = z.infer<typeof GraphEdgeCreate>

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
})
export type GraphNodeFilter = z.infer<typeof GraphNodeFilter>

export const GraphEdgeFilter = z.object({
  types: z.array(EdgeTypeId).optional(),
  fromNodeId: NodeId.optional(),
  toNodeId: NodeId.optional(),
})
export type GraphEdgeFilter = z.infer<typeof GraphEdgeFilter>
