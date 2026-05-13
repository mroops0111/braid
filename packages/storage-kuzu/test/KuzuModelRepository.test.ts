import type {
  EdgeId,
  EdgeTypeId,
  NodeId,
  NodeStatus,
  NodeTypeId,
  WorkspaceId,
} from '@telos/schema'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KuzuModelRepository } from '../src/KuzuModelRepository.js'

const wsId = 'ws-test' as WorkspaceId
const aggregateType = 'Aggregate' as NodeTypeId
const entityType = 'Entity' as NodeTypeId
const containsType = 'contains' as EdgeTypeId
const draft = 'draft' as NodeStatus
const finalStatus = 'final' as NodeStatus

describe('KuzuModelRepository', () => {
  let tmp: string
  let repo: KuzuModelRepository

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'telos-kuzu-test-'))
    repo = new KuzuModelRepository({
      resolveDbPath: id => join(tmp, id, 'model.kuzu'),
    })
  })

  afterEach(async () => {
    await repo.close()
    await rm(tmp, { recursive: true, force: true })
  })

  it('round-trips a node through applyOperations + load', async () => {
    await repo.applyOperations(wsId, [
      { operation: 'addNode', payload: { id: 'n1' as NodeId, type: aggregateType, name: 'Cart', status: draft } },
    ])
    const snapshot = await repo.load(wsId)
    expect(snapshot.nodes).toHaveLength(1)
    expect(snapshot.nodes[0]).toMatchObject({ id: 'n1', type: 'Aggregate', name: 'Cart', status: 'draft' })
    expect(snapshot.edges).toEqual([])
  })

  it('creates an edge between two nodes', async () => {
    await repo.applyOperations(wsId, [
      { operation: 'addNodes', payloads: [
        { id: 'n1' as NodeId, type: aggregateType, name: 'Cart', status: draft },
        { id: 'n2' as NodeId, type: entityType, name: 'CartItem', status: draft },
      ] },
      { operation: 'addEdge', payload: {
        id: 'e1' as EdgeId,
        type: containsType,
        fromNodeId: 'n1' as NodeId,
        toNodeId: 'n2' as NodeId,
      } },
    ])
    const snapshot = await repo.load(wsId)
    expect(snapshot.edges).toHaveLength(1)
    expect(snapshot.edges[0]).toMatchObject({
      id: 'e1',
      type: 'contains',
      fromNodeId: 'n1',
      toNodeId: 'n2',
    })
  })

  it('persists across a re-opened repo (server restart simulation)', async () => {
    await repo.applyOperations(wsId, [
      { operation: 'addNode', payload: { id: 'persisted' as NodeId, type: aggregateType, name: 'X', status: draft } },
    ])
    await repo.close()

    const reopened = new KuzuModelRepository({ resolveDbPath: id => join(tmp, id, 'model.kuzu') })
    try {
      const snapshot = await reopened.load(wsId)
      expect(snapshot.nodes.map(n => n.id)).toEqual(['persisted'])
    }
    finally {
      await reopened.close()
    }
  })

  it('updates node fields without touching others', async () => {
    await repo.applyOperations(wsId, [
      { operation: 'addNode', payload: {
        id: 'n1' as NodeId,
        type: aggregateType,
        name: 'Cart',
        description: 'old desc',
        status: draft,
      } },
    ])
    await repo.applyOperations(wsId, [
      { operation: 'updateNode', nodeId: 'n1' as NodeId, patch: { status: finalStatus, description: 'new desc' } },
    ])
    const n = await repo.getNode(wsId, 'n1' as NodeId)
    expect(n.status).toBe('final')
    expect(n.description).toBe('new desc')
    expect(n.name).toBe('Cart')
  })

  it('removeNode cascades to connected edges', async () => {
    await repo.applyOperations(wsId, [
      { operation: 'addNodes', payloads: [
        { id: 'n1' as NodeId, type: aggregateType, name: 'A', status: draft },
        { id: 'n2' as NodeId, type: entityType, name: 'B', status: draft },
      ] },
      { operation: 'addEdge', payload: {
        id: 'e1' as EdgeId,
        type: containsType,
        fromNodeId: 'n1' as NodeId,
        toNodeId: 'n2' as NodeId,
      } },
      { operation: 'removeNode', nodeId: 'n1' as NodeId },
    ])
    const snapshot = await repo.load(wsId)
    expect(snapshot.nodes.map(n => n.id)).toEqual(['n2'])
    expect(snapshot.edges).toEqual([])
  })

  it('findNodes filters by type, status, and name substring', async () => {
    await repo.applyOperations(wsId, [
      { operation: 'addNodes', payloads: [
        { id: 'a' as NodeId, type: aggregateType, name: 'Cart', status: draft },
        { id: 'b' as NodeId, type: entityType, name: 'CartItem', status: finalStatus },
        { id: 'c' as NodeId, type: entityType, name: 'Order', status: draft },
      ] },
    ])
    expect((await repo.findNodes(wsId, { types: [entityType] })).map(n => n.id).sort()).toEqual(['b', 'c'])
    expect((await repo.findNodes(wsId, { statuses: [finalStatus] })).map(n => n.id)).toEqual(['b'])
    expect((await repo.findNodes(wsId, { nameContains: 'cart' })).map(n => n.id).sort()).toEqual(['a', 'b'])
  })

  it('getNode throws NotFoundError for unknown id', async () => {
    await expect(repo.getNode(wsId, 'missing' as NodeId)).rejects.toThrow(/not found/)
  })

  it('scopeOf returns BFS neighbourhood up to depth', async () => {
    await repo.applyOperations(wsId, [
      { operation: 'addNodes', payloads: [
        { id: 'a' as NodeId, type: aggregateType, name: 'A', status: draft },
        { id: 'b' as NodeId, type: entityType, name: 'B', status: draft },
        { id: 'c' as NodeId, type: entityType, name: 'C', status: draft },
        { id: 'd' as NodeId, type: entityType, name: 'D', status: draft },
      ] },
      { operation: 'addEdges', payloads: [
        { id: 'e1' as EdgeId, type: containsType, fromNodeId: 'a' as NodeId, toNodeId: 'b' as NodeId },
        { id: 'e2' as EdgeId, type: containsType, fromNodeId: 'b' as NodeId, toNodeId: 'c' as NodeId },
        { id: 'e3' as EdgeId, type: containsType, fromNodeId: 'c' as NodeId, toNodeId: 'd' as NodeId },
      ] },
    ])
    const oneHop = await repo.scopeOf(wsId, 'a' as NodeId, 1)
    expect(oneHop.nodes.map(n => n.id).sort()).toEqual(['a', 'b'])

    const twoHop = await repo.scopeOf(wsId, 'a' as NodeId, 2)
    expect(twoHop.nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('isolates workspaces by db path', async () => {
    const otherWs = 'ws-other' as WorkspaceId
    await repo.applyOperations(wsId, [
      { operation: 'addNode', payload: { id: 'in-ws-test' as NodeId, type: aggregateType, name: 'X', status: draft } },
    ])
    await repo.applyOperations(otherWs, [
      { operation: 'addNode', payload: { id: 'in-ws-other' as NodeId, type: aggregateType, name: 'Y', status: draft } },
    ])
    expect((await repo.load(wsId)).nodes.map(n => n.id)).toEqual(['in-ws-test'])
    expect((await repo.load(otherWs)).nodes.map(n => n.id)).toEqual(['in-ws-other'])
  })
})
