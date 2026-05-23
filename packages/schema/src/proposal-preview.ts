import type { EdgeId, ExternalReference, NodeId, SourceReference } from './common.js'
import type { GraphEdge, GraphNode, ModelSnapshot, NewGraphEdge, NewGraphNode } from './model.js'
import type { GraphOperation } from './proposal.js'

export type ChangeKind = 'added' | 'updated' | 'removed'

export interface ProposalDiff {
  readonly nodes: ReadonlyMap<NodeId, ChangeKind>
  readonly edges: ReadonlyMap<EdgeId, ChangeKind>
}

export interface ProposalPreview {
  readonly snapshot: ModelSnapshot
  readonly diff: ProposalDiff
}

/**
 * Pure shape transform: given the current snapshot and a list of proposed
 * operations, return the projected snapshot plus a per-id change
 * classification suitable for UI overlays.
 *
 * This is a *lenient* apply: invalid operations (e.g. removing a node
 * that does not exist) are silently no-op'd so the preview never throws
 * mid-render. The server's `Model` enforces strict semantics at the
 * point the proposal is actually applied; that's where rejection
 * surfaces to the user.
 *
 * The diff is derived by comparing snapshots, not by walking ops, so
 * cascade-deleted edges from a `removeNode` are correctly classified as
 * `removed` even though no explicit edge op was issued.
 */
export function previewProposal(
  current: ModelSnapshot,
  operations: readonly GraphOperation[],
): ProposalPreview {
  const next = applyOperations(current, operations)
  return { snapshot: next, diff: diffSnapshots(current, next) }
}

function applyOperations(snapshot: ModelSnapshot, operations: readonly GraphOperation[]): ModelSnapshot {
  const nodes = new Map<NodeId, GraphNode>(snapshot.nodes.map(n => [n.id, n]))
  const edges = new Map<EdgeId, GraphEdge>(snapshot.edges.map(e => [e.id, e]))

  function removeNode(id: NodeId): void {
    if (!nodes.delete(id))
      return
    for (const [eid, edge] of edges) {
      if (edge.fromNodeId === id || edge.toNodeId === id)
        edges.delete(eid)
    }
  }

  for (const op of operations) {
    switch (op.operation) {
      case 'addNode': {
        const n = materializeNode(op.payload)
        if (!nodes.has(n.id))
          nodes.set(n.id, n)
        break
      }
      case 'addNodes':
        for (const payload of op.payloads) {
          const n = materializeNode(payload)
          if (!nodes.has(n.id))
            nodes.set(n.id, n)
        }
        break
      case 'removeNode':
        removeNode(op.nodeId)
        break
      case 'removeNodes':
        for (const id of op.nodeIds) removeNode(id)
        break
      case 'updateNode': {
        const existing = nodes.get(op.nodeId)
        if (existing)
          nodes.set(op.nodeId, applyPatch(existing, op.patch))
        break
      }
      case 'updateNodes':
        for (const u of op.updates) {
          const existing = nodes.get(u.nodeId)
          if (existing)
            nodes.set(u.nodeId, applyPatch(existing, u.patch))
        }
        break
      case 'addEdge': {
        const e = materializeEdge(op.payload)
        if (!edges.has(e.id))
          edges.set(e.id, e)
        break
      }
      case 'addEdges':
        for (const payload of op.payloads) {
          const e = materializeEdge(payload)
          if (!edges.has(e.id))
            edges.set(e.id, e)
        }
        break
      case 'removeEdge':
        edges.delete(op.edgeId)
        break
      case 'removeEdges':
        for (const id of op.edgeIds) edges.delete(id)
        break
      case 'updateEdge': {
        const existing = edges.get(op.edgeId)
        if (existing)
          edges.set(op.edgeId, applyPatch(existing, op.patch))
        break
      }
      case 'updateEdges':
        for (const u of op.updates) {
          const existing = edges.get(u.edgeId)
          if (existing)
            edges.set(u.edgeId, applyPatch(existing, u.patch))
        }
        break
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

// NewGraphNode/Edge payloads carry optional id/metadata fields. For
// preview we must produce concrete GraphNode/Edge values; missing ids
// degrade to a synthetic placeholder so the preview doesn't collide
// with real ids.
/**
 * Apply a patch object to an existing entity. `undefined` keys in the
 * patch are skipped so the merge matches the server's "undefined =
 * leave unchanged" semantics — a plain `{ ...existing, ...patch }`
 * spread would overwrite the existing value with `undefined`.
 *
 * The entity's `id` is always preserved regardless of what the patch
 * carries; allowing a patch to rename an id would break the map keys
 * the caller is updating in place.
 */
function applyPatch<T extends { id: unknown }>(existing: T, patch: Record<string, unknown>): T {
  const next: Record<string, unknown> = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'id' || value === undefined)
      continue
    next[key] = value
  }
  return next as T
}

function materializeNode(payload: NewGraphNode): GraphNode {
  const node: GraphNode = {
    id: (payload.id ?? `preview:${crypto.randomUUID()}`) as NodeId,
    type: payload.type,
    name: payload.name,
    status: payload.status,
    metadata: payload.metadata ?? { sourceReferences: [] },
  }
  if (payload.description !== undefined)
    node.description = payload.description
  if (payload.embedding !== undefined)
    node.embedding = payload.embedding
  return node
}

function materializeEdge(payload: NewGraphEdge): GraphEdge {
  return {
    id: (payload.id ?? `preview:${crypto.randomUUID()}`) as EdgeId,
    type: payload.type,
    fromNodeId: payload.fromNodeId,
    toNodeId: payload.toNodeId,
    metadata: payload.metadata ?? { sourceReferences: [] },
  }
}

function diffSnapshots(prev: ModelSnapshot, next: ModelSnapshot): ProposalDiff {
  const prevNodes = new Map(prev.nodes.map(n => [n.id, n]))
  const nextNodes = new Map(next.nodes.map(n => [n.id, n]))
  const prevEdges = new Map(prev.edges.map(e => [e.id, e]))
  const nextEdges = new Map(next.edges.map(e => [e.id, e]))
  return {
    nodes: classify(prevNodes, nextNodes, nodesEqual),
    edges: classify(prevEdges, nextEdges, edgesEqual),
  }
}

function classify<K, V>(
  prev: ReadonlyMap<K, V>,
  next: ReadonlyMap<K, V>,
  equal: (a: V, b: V) => boolean,
): ReadonlyMap<K, ChangeKind> {
  const out = new Map<K, ChangeKind>()
  for (const [id, n] of next) {
    const p = prev.get(id)
    if (!p)
      out.set(id, 'added')
    else if (!equal(p, n))
      out.set(id, 'updated')
  }
  for (const id of prev.keys()) {
    if (!next.has(id))
      out.set(id, 'removed')
  }
  return out
}

function nodesEqual(a: GraphNode, b: GraphNode): boolean {
  return a.type === b.type
    && a.name === b.name
    && a.description === b.description
    && a.status === b.status
    && a.metadata.intentMissing === b.metadata.intentMissing
    && a.metadata.intentConflict === b.metadata.intentConflict
    && a.metadata.implementationMissing === b.metadata.implementationMissing
    && a.metadata.lastTouchedBy === b.metadata.lastTouchedBy
    && sourceRefsEqual(a.metadata.sourceReferences, b.metadata.sourceReferences)
    && externalRefsEqual(a.metadata.externalReferences, b.metadata.externalReferences)
}

function edgesEqual(a: GraphEdge, b: GraphEdge): boolean {
  return a.type === b.type
    && a.fromNodeId === b.fromNodeId
    && a.toNodeId === b.toNodeId
    && a.metadata.lastTouchedBy === b.metadata.lastTouchedBy
    && sourceRefsEqual(a.metadata.sourceReferences, b.metadata.sourceReferences)
    && externalRefsEqual(a.metadata.externalReferences, b.metadata.externalReferences)
}

// Structural comparisons keep the diff classification stable across
// object-key ordering and avoid the O(n) JSON.stringify cost on large
// snapshots. Order within an array is treated as significant since
// skills typically append to the end.
function sourceRefsEqual(a: readonly SourceReference[], b: readonly SourceReference[]): boolean {
  if (a.length !== b.length)
    return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.sourceId !== y.sourceId || x.snippet !== y.snippet)
      return false
    if (x.location.uri !== y.location.uri
      || x.location.startLine !== y.location.startLine
      || x.location.endLine !== y.location.endLine
      || x.location.anchor !== y.location.anchor) {
      return false
    }
  }
  return true
}

function externalRefsEqual(
  a: readonly ExternalReference[] | undefined,
  b: readonly ExternalReference[] | undefined,
): boolean {
  if (a === undefined && b === undefined)
    return true
  if (a === undefined || b === undefined)
    return false
  if (a.length !== b.length)
    return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.kind !== y.kind || x.url !== y.url || x.label !== y.label)
      return false
  }
  return true
}
