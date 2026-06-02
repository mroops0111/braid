import type {
  EdgeId,
  Embedding,
  GraphEdge,
  GraphEdgeMetadata,
  GraphNode,
  GraphNodeMetadata,
  NodeId,
} from '@braidhq/schema'
import type { KuzuValue } from 'kuzu'
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

// updateEdge intentionally does not touch endpoints (changing fromId /
// toId means a different edge). The prepared statement only binds id /
// type / metadata, and Kùzu rejects extra params at execute time.
export function edgeToUpdateParams(edge: GraphEdge): Pick<EdgeRow, 'id' | 'type' | 'metadata'> {
  return {
    id: edge.id,
    type: edge.type,
    metadata: JSON.stringify(edge.metadata),
  }
}

export function rowToNode(row: Record<string, KuzuValue>): GraphNode {
  const description = asString(row.description, 'description')
  const embedding = asString(row.embedding, 'embedding')
  const node: GraphNode = {
    id: asString(row.id, 'id') as NodeId,
    type: asString(row.type, 'type') as GraphNode['type'],
    name: asString(row.name, 'name'),
    status: asString(row.status, 'status') as GraphNode['status'],
    metadata: parseMetadata(asString(row.metadata, 'metadata')),
  }
  if (description !== '')
    node.description = description
  if (embedding !== '')
    node.embedding = parseEmbedding(embedding)
  return node
}

export function rowToEdge(row: Record<string, KuzuValue>): GraphEdge {
  return {
    id: asString(row.id, 'id') as EdgeId,
    type: asString(row.type, 'type') as GraphEdge['type'],
    fromNodeId: asString(row.fromId, 'fromId') as NodeId,
    toNodeId: asString(row.toId, 'toId') as NodeId,
    metadata: parseEdgeMetadata(asString(row.metadata, 'metadata')),
  }
}

function asString(value: KuzuValue | undefined, field: string): string {
  if (typeof value !== 'string')
    throw new TypeError(`Expected string for column "${field}", got ${typeof value}`)
  return value
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
