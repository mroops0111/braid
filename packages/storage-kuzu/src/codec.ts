import type {
  EdgeId,
  Embedding,
  GraphEdge,
  GraphEdgeMetadata,
  GraphNode,
  GraphNodeMetadata,
  NodeId,
} from '@braidhq/schema'
import {
  Embedding as EmbeddingSchema,
  GraphEdgeMetadata as GraphEdgeMetadataSchema,
  GraphNodeMetadata as GraphNodeMetadataSchema,
} from '@braidhq/schema'

export interface NodeRow extends Record<string, string> {
  id: string
  type: string
  name: string
  description: string
  status: string
  metadata: string
  embedding: string
}

export interface EdgeRow extends Record<string, string> {
  id: string
  type: string
  metadata: string
  fromId: string
  toId: string
}

export function nodeToParams(node: GraphNode): NodeRow {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    description: node.description ?? '',
    status: node.status,
    metadata: JSON.stringify(node.metadata),
    embedding: node.embedding ? JSON.stringify(node.embedding) : '',
  }
}

export function edgeToParams(edge: GraphEdge): EdgeRow {
  return {
    id: edge.id,
    type: edge.type,
    metadata: JSON.stringify(edge.metadata),
    fromId: edge.fromNodeId,
    toId: edge.toNodeId,
  }
}

export function rowToNode(row: NodeRow): GraphNode {
  const node: GraphNode = {
    id: row.id as NodeId,
    type: row.type as GraphNode['type'],
    name: row.name,
    status: row.status as GraphNode['status'],
    metadata: parseMetadata(row.metadata),
  }
  if (row.description !== '')
    node.description = row.description
  if (row.embedding !== '')
    node.embedding = parseEmbedding(row.embedding)
  return node
}

export function rowToEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id as EdgeId,
    type: row.type as GraphEdge['type'],
    fromNodeId: row.fromId as NodeId,
    toNodeId: row.toId as NodeId,
    metadata: parseEdgeMetadata(row.metadata),
  }
}

function parseMetadata(raw: string): GraphNodeMetadata {
  return GraphNodeMetadataSchema.parse(raw === '' ? {} : JSON.parse(raw))
}

function parseEdgeMetadata(raw: string): GraphEdgeMetadata {
  return GraphEdgeMetadataSchema.parse(raw === '' ? {} : JSON.parse(raw))
}

function parseEmbedding(raw: string): Embedding {
  return EmbeddingSchema.parse(JSON.parse(raw))
}
