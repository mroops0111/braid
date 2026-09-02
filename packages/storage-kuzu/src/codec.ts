import type { KuzuValue } from 'kuzu'
import { GraphEdge, GraphNode } from '@braidhq/schema'

export interface NodeRow extends Record<string, string> {
  id: string
  type: string
  name: string
  description: string
  status: string
  metadata: string
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

/**
 * updateEdge intentionally does not touch endpoints,
 * since changing fromId or toId means a different edge.
 * The prepared statement binds only id, type, and metadata,
 * and Kùzu rejects extra params at execute time.
 */
export function edgeToUpdateParams(edge: GraphEdge): Pick<EdgeRow, 'id' | 'type' | 'metadata'> {
  return {
    id: edge.id,
    type: edge.type,
    metadata: JSON.stringify(edge.metadata),
  }
}

/**
 * A row is persisted, but still a boundary. Parse it through the schema,
 * so a branded id, an unknown status, or a corrupt row fails loudly here,
 * the same way the filesystem serializer validates what it reads back.
 */
export function rowToNode(row: Record<string, KuzuValue>): GraphNode {
  const description = asString(row.description, 'description')
  const metadata = asString(row.metadata, 'metadata')
  return GraphNode.parse({
    id: asString(row.id, 'id'),
    type: asString(row.type, 'type'),
    name: asString(row.name, 'name'),
    status: asString(row.status, 'status'),
    metadata: metadata === '' ? {} : JSON.parse(metadata),
    ...(description !== '' ? { description } : {}),
  })
}

export function rowToEdge(row: Record<string, KuzuValue>): GraphEdge {
  const metadata = asString(row.metadata, 'metadata')
  return GraphEdge.parse({
    id: asString(row.id, 'id'),
    type: asString(row.type, 'type'),
    fromNodeId: asString(row.fromId, 'fromId'),
    toNodeId: asString(row.toId, 'toId'),
    metadata: metadata === '' ? {} : JSON.parse(metadata),
  })
}

function asString(value: KuzuValue | undefined, field: string): string {
  if (typeof value !== 'string')
    throw new TypeError(`Expected string for column "${field}", got ${typeof value}`)
  return value
}
