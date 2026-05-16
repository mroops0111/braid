import type { ModelRepository } from '@braidhq/core'
import type {
  GraphEdge,
  GraphEdgeFilter,
  GraphNode,
  GraphNodeFilter,
  GraphOperation,
  ModelSnapshot,
  NodeId,
  WorkspaceId,
} from '@braidhq/schema'
import type { Connection, Database, PreparedStatement, QueryResult } from 'kuzu'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Model, NotFoundError, paginate } from '@braidhq/core'
import * as kuzu from 'kuzu'
import { type EdgeRow, edgeToParams, type NodeRow, nodeToParams, rowToEdge, rowToNode } from './codec.js'
import { DDL_CREATE_EDGE_TABLE, DDL_CREATE_NODE_TABLE } from './schema.js'

export interface KuzuModelRepositoryOptions {
  /**
   * Resolve the absolute Kuzu DB file path for a workspace id. Composition
   * roots typically look this up via the `WorkspaceRepository`. The parent
   * directory is created on demand. Called once per workspace per process
   * and cached.
   */
  readonly resolveDbPath: (workspaceId: WorkspaceId) => Promise<string> | string
}

interface CachedConnection {
  readonly db: Database
  readonly conn: Connection
  readonly stmts: PreparedStatementCache
}

interface PreparedStatementCache {
  insertNode: PreparedStatement
  updateNode: PreparedStatement
  deleteNode: PreparedStatement
  insertEdge: PreparedStatement
  deleteEdge: PreparedStatement
  updateEdge: PreparedStatement
}

/**
 * Embedded graph storage for Braid. Each workspace gets its own Kuzu DB
 * directory; the schema is shared (one generic `Node` / `Edge` table since
 * Braid ontology is dynamic and lives in the `type` property).
 *
 * Writes use diff-against-snapshot semantics: load → preview ops via the
 * domain `Model` (which validates and mints ids) → translate the diff into
 * Cypher mutations. That keeps domain invariants in one place and lets us
 * stay non-transactional at the Kuzu layer until we actually need it.
 */
export class KuzuModelRepository implements ModelRepository {
  private readonly cache = new Map<WorkspaceId, CachedConnection>()

  constructor(private readonly opts: KuzuModelRepositoryOptions) {}

  async load(workspaceId: WorkspaceId): Promise<ModelSnapshot> {
    const cached = await this.connect(workspaceId)
    return readSnapshot(cached.conn)
  }

  async applyOperations(workspaceId: WorkspaceId, operations: GraphOperation[]): Promise<void> {
    const cached = await this.connect(workspaceId)
    const previous = await readSnapshot(cached.conn)
    const next = Model.preview(previous, operations)
    await writeDiff(cached, previous, next)
  }

  async findNodes(workspaceId: WorkspaceId, filter?: GraphNodeFilter): Promise<GraphNode[]> {
    const snapshot = await this.load(workspaceId)
    return applyNodeFilter(snapshot.nodes, filter)
  }

  async getNode(workspaceId: WorkspaceId, nodeId: NodeId): Promise<GraphNode> {
    const snapshot = await this.load(workspaceId)
    const node = snapshot.nodes.find(n => n.id === nodeId)
    if (!node)
      throw new NotFoundError(`Node "${nodeId}" not found in workspace "${workspaceId}"`)
    return node
  }

  async scopeOf(workspaceId: WorkspaceId, nodeId: NodeId, depth: number): Promise<ModelSnapshot> {
    const snapshot = await this.load(workspaceId)
    if (!snapshot.nodes.some(n => n.id === nodeId))
      throw new NotFoundError(`Node "${nodeId}" not found in workspace "${workspaceId}"`)
    return scopeBfs(snapshot, nodeId, depth)
  }

  async listEdges(workspaceId: WorkspaceId, filter?: GraphEdgeFilter): Promise<GraphEdge[]> {
    const snapshot = await this.load(workspaceId)
    return applyEdgeFilter(snapshot.edges, filter)
  }

  /** Close every cached connection. Safe to call multiple times. */
  async close(): Promise<void> {
    for (const cached of this.cache.values()) {
      await cached.conn.close()
      await cached.db.close()
    }
    this.cache.clear()
  }

  private async connect(workspaceId: WorkspaceId): Promise<CachedConnection> {
    const existing = this.cache.get(workspaceId)
    if (existing)
      return existing
    const path = await this.opts.resolveDbPath(workspaceId)
    // Kuzu 0.11+ stores the DB as a single file; we just need the parent.
    await mkdir(dirname(path), { recursive: true })
    const db = new kuzu.Database(path)
    const conn = new kuzu.Connection(db)
    await conn.query(DDL_CREATE_NODE_TABLE)
    await conn.query(DDL_CREATE_EDGE_TABLE)
    const stmts = await prepareStatements(conn)
    const cached: CachedConnection = { db, conn, stmts }
    this.cache.set(workspaceId, cached)
    return cached
  }
}

async function prepareStatements(conn: Connection): Promise<PreparedStatementCache> {
  return {
    insertNode: await conn.prepare(`
      CREATE (n:Node {
        id: $id, type: $type, name: $name, description: $description,
        status: $status, metadata: $metadata, embedding: $embedding
      });
    `),
    updateNode: await conn.prepare(`
      MATCH (n:Node {id: $id})
      SET n.type = $type, n.name = $name, n.description = $description,
          n.status = $status, n.metadata = $metadata, n.embedding = $embedding;
    `),
    deleteNode: await conn.prepare(`
      MATCH (n:Node {id: $id}) DETACH DELETE n;
    `),
    insertEdge: await conn.prepare(`
      MATCH (a:Node {id: $fromId}), (b:Node {id: $toId})
      CREATE (a)-[e:Edge {id: $id, type: $type, metadata: $metadata}]->(b);
    `),
    deleteEdge: await conn.prepare(`
      MATCH (a:Node)-[r:Edge {id: $id}]->(b:Node) DELETE r;
    `),
    updateEdge: await conn.prepare(`
      MATCH (a:Node)-[r:Edge {id: $id}]->(b:Node)
      SET r.type = $type, r.metadata = $metadata;
    `),
  }
}

async function readSnapshot(conn: Connection): Promise<ModelSnapshot> {
  const nodesResult = await conn.query(`
    MATCH (n:Node)
    RETURN n.id AS id, n.type AS type, n.name AS name, n.description AS description,
           n.status AS status, n.metadata AS metadata, n.embedding AS embedding;
  `)
  const nodes = (await firstResult(nodesResult).getAll() as unknown as NodeRow[]).map(rowToNode)

  const edgesResult = await conn.query(`
    MATCH (a:Node)-[r:Edge]->(b:Node)
    RETURN r.id AS id, r.type AS type, r.metadata AS metadata,
           a.id AS fromId, b.id AS toId;
  `)
  const edges = (await firstResult(edgesResult).getAll() as unknown as EdgeRow[]).map(rowToEdge)

  return { nodes, edges }
}

function firstResult(result: QueryResult | QueryResult[]): QueryResult {
  return Array.isArray(result) ? result[0]! : result
}

async function writeDiff(cached: CachedConnection, previous: ModelSnapshot, next: ModelSnapshot): Promise<void> {
  const prevNodes = new Map(previous.nodes.map(n => [n.id, n]))
  const nextNodes = new Map(next.nodes.map(n => [n.id, n]))
  const prevEdges = new Map(previous.edges.map(e => [e.id, e]))
  const nextEdges = new Map(next.edges.map(e => [e.id, e]))

  // Edges first: removing a node DETACH-deletes its edges, so we drop
  // edges before nodes to keep our explicit-delete bookkeeping accurate.
  for (const [id, prev] of prevEdges) {
    const after = nextEdges.get(id)
    if (!after) {
      await cached.conn.execute(cached.stmts.deleteEdge, { id })
    }
    else if (!shallowEqual(prev, after)) {
      await cached.conn.execute(cached.stmts.updateEdge, edgeToParams(after))
    }
  }

  for (const [id, prev] of prevNodes) {
    const after = nextNodes.get(id)
    if (!after) {
      await cached.conn.execute(cached.stmts.deleteNode, { id })
    }
    else if (!shallowEqual(prev, after)) {
      await cached.conn.execute(cached.stmts.updateNode, nodeToParams(after))
    }
  }

  for (const [id, node] of nextNodes) {
    if (!prevNodes.has(id))
      await cached.conn.execute(cached.stmts.insertNode, nodeToParams(node))
  }

  for (const [id, edge] of nextEdges) {
    if (!prevEdges.has(id))
      await cached.conn.execute(cached.stmts.insertEdge, edgeToParams(edge))
  }
}

function shallowEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function scopeBfs(snapshot: ModelSnapshot, seed: NodeId, depth: number): ModelSnapshot {
  const visited = new Set<NodeId>([seed])
  let frontier: NodeId[] = [seed]
  for (let hop = 0; hop < depth; hop += 1) {
    const next: NodeId[] = []
    for (const edge of snapshot.edges) {
      if (frontier.includes(edge.fromNodeId) && !visited.has(edge.toNodeId)) {
        visited.add(edge.toNodeId)
        next.push(edge.toNodeId)
      }
      if (frontier.includes(edge.toNodeId) && !visited.has(edge.fromNodeId)) {
        visited.add(edge.fromNodeId)
        next.push(edge.fromNodeId)
      }
    }
    if (next.length === 0)
      break
    frontier = next
  }
  return {
    nodes: snapshot.nodes.filter(n => visited.has(n.id)),
    edges: snapshot.edges.filter(e => visited.has(e.fromNodeId) && visited.has(e.toNodeId)),
  }
}

function applyNodeFilter(nodes: GraphNode[], filter?: GraphNodeFilter): GraphNode[] {
  let out = nodes
  if (filter?.types?.length) {
    const t = filter.types
    out = out.filter(n => t.includes(n.type))
  }
  if (filter?.statuses?.length) {
    const s = filter.statuses
    out = out.filter(n => s.includes(n.status))
  }
  if (filter?.nameContains) {
    const needle = filter.nameContains.toLowerCase()
    out = out.filter(n => n.name.toLowerCase().includes(needle))
  }
  return paginate(out, filter?.limit, filter?.offset)
}

function applyEdgeFilter(edges: GraphEdge[], filter?: GraphEdgeFilter): GraphEdge[] {
  let out = edges
  if (filter?.types?.length) {
    const t = filter.types
    out = out.filter(e => t.includes(e.type))
  }
  if (filter?.fromNodeId !== undefined) {
    const from = filter.fromNodeId
    out = out.filter(e => e.fromNodeId === from)
  }
  if (filter?.toNodeId !== undefined) {
    const to = filter.toNodeId
    out = out.filter(e => e.toNodeId === to)
  }
  return paginate(out, filter?.limit, filter?.offset)
}
