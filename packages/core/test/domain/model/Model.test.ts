import type { GraphOperation, NewGraphNode, NodeId } from '@braidhq/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, Model, NotFoundError } from '../../../src/index.js'

function newNode(overrides: Partial<NewGraphNode> = {}): NewGraphNode {
  return {
    type: 'command',
    name: 'voidTask',
    ...overrides,
  } as NewGraphNode
}

describe('Model', () => {
  let model: Model

  beforeEach(() => {
    model = new Model()
  })

  describe('constructor', () => {
    it('starts empty', () => {
      const snapshot = model.toSnapshot()
      expect(snapshot.nodes).toEqual([])
      expect(snapshot.edges).toEqual([])
    })

    it('hydrates from a snapshot', () => {
      const seeded = new Model({
        nodes: [{
          id: 'n-1' as NodeId,
          type: 'command',
          name: 'voidTask',
          status: 'draft',
          metadata: { sourceReferences: [] },
        }],
        edges: [],
      })
      expect(seeded.toSnapshot().nodes).toHaveLength(1)
    })
  })

  describe('addNode', () => {
    it('returns the assigned id', () => {
      const id = model.addNode(newNode())
      expect(id).toBeTruthy()
      expect(model.toSnapshot().nodes).toHaveLength(1)
    })

    it('preserves explicit id', () => {
      const id = model.addNode(newNode({ id: 'my-node' as NodeId }))
      expect(id).toBe('my-node')
    })

    it('throws ConflictError on duplicate id', () => {
      model.addNode(newNode({ id: 'dup' as NodeId }))
      expect(() => model.addNode(newNode({ id: 'dup' as NodeId }))).toThrow(ConflictError)
    })
  })

  describe('addNodes (batch)', () => {
    it('adds all and returns ids in order', () => {
      const ids = model.addNodes([newNode(), newNode()])
      expect(ids).toHaveLength(2)
      expect(model.toSnapshot().nodes).toHaveLength(2)
    })

    it('rolls back if any duplicate (atomic)', () => {
      model.addNode(newNode({ id: 'dup' as NodeId }))
      expect(() =>
        model.addNodes([newNode(), newNode({ id: 'dup' as NodeId })]),
      ).toThrow(ConflictError)
      expect(model.toSnapshot().nodes).toHaveLength(1)
    })
  })

  describe('removeNode', () => {
    it('removes the node', () => {
      const id = model.addNode(newNode())
      model.removeNode(id)
      expect(model.toSnapshot().nodes).toEqual([])
    })

    it('cascades to connected edges', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      const b = model.addNode(newNode({ id: 'b' as NodeId }))
      model.addEdge({ type: 'contains', fromNodeId: a, toNodeId: b })
      model.removeNode(a)
      expect(model.toSnapshot().edges).toEqual([])
    })

    it('throws NotFoundError if missing', () => {
      expect(() => model.removeNode('missing' as NodeId)).toThrow(NotFoundError)
    })
  })

  describe('removeNodes (batch)', () => {
    it('removes all atomically', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      const b = model.addNode(newNode({ id: 'b' as NodeId }))
      model.removeNodes([a, b])
      expect(model.toSnapshot().nodes).toEqual([])
    })

    it('rolls back if any missing', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      expect(() => model.removeNodes([a, 'missing' as NodeId])).toThrow(NotFoundError)
      expect(model.toSnapshot().nodes).toHaveLength(1)
    })
  })

  describe('updateNode', () => {
    it('applies patch', () => {
      const id = model.addNode(newNode())
      model.updateNode(id, { name: 'newName' })
      expect(model.toSnapshot().nodes[0]?.name).toBe('newName')
    })

    it('throws if missing', () => {
      expect(() => model.updateNode('missing' as NodeId, { name: 'x' })).toThrow(NotFoundError)
    })
  })

  describe('addEdge', () => {
    it('adds an edge between existing nodes', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      const b = model.addNode(newNode({ id: 'b' as NodeId }))
      model.addEdge({ type: 'contains', fromNodeId: a, toNodeId: b })
      expect(model.toSnapshot().edges).toHaveLength(1)
    })

    it('rejects edge to missing source node', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      expect(() =>
        model.addEdge({ type: 'contains', fromNodeId: 'missing' as NodeId, toNodeId: a }),
      ).toThrow(NotFoundError)
    })

    it('rejects edge to missing target node', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      expect(() =>
        model.addEdge({ type: 'contains', fromNodeId: a, toNodeId: 'missing' as NodeId }),
      ).toThrow(NotFoundError)
    })
  })

  describe('applyOperations (mixed batch)', () => {
    it('applies node + edge operations in one transaction', () => {
      const ops: GraphOperation[] = [
        { operation: 'addNode', payload: newNode({ id: 'a' as NodeId }) },
        { operation: 'addNode', payload: newNode({ id: 'b' as NodeId }) },
        { operation: 'addEdge', payload: { type: 'contains', fromNodeId: 'a' as NodeId, toNodeId: 'b' as NodeId } },
      ]
      model.applyOperations(ops)
      const snapshot = model.toSnapshot()
      expect(snapshot.nodes).toHaveLength(2)
      expect(snapshot.edges).toHaveLength(1)
    })

    it('rolls back the entire batch when one op fails', () => {
      const ops: GraphOperation[] = [
        { operation: 'addNode', payload: newNode({ id: 'a' as NodeId }) },
        { operation: 'removeNode', nodeId: 'missing' as NodeId },
      ]
      expect(() => model.applyOperations(ops)).toThrow(NotFoundError)
      expect(model.toSnapshot().nodes).toEqual([])
    })

    it('supports batch ops (addNodes / removeNodes)', () => {
      model.applyOperations([
        { operation: 'addNodes', payloads: [newNode({ id: 'a' as NodeId }), newNode({ id: 'b' as NodeId })] },
      ])
      expect(model.toSnapshot().nodes).toHaveLength(2)

      model.applyOperations([
        { operation: 'removeNodes', nodeIds: ['a' as NodeId, 'b' as NodeId] },
      ])
      expect(model.toSnapshot().nodes).toEqual([])
    })
  })

  describe('edge updates and removal', () => {
    it('updateEdge applies patch', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      const b = model.addNode(newNode({ id: 'b' as NodeId }))
      const edgeId = model.addEdge({ type: 'contains', fromNodeId: a, toNodeId: b })
      model.applyOperations([{ operation: 'updateEdge', edgeId, patch: { type: 'triggers' } }])
      expect(model.toSnapshot().edges[0]?.type).toBe('triggers')
    })

    it('updateEdge throws NotFoundError if edge missing', () => {
      expect(() => model.applyOperations([
        { operation: 'updateEdge', edgeId: 'missing' as never, patch: { type: 'contains' } },
      ])).toThrow()
    })

    it('removeEdge removes a single edge', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      const b = model.addNode(newNode({ id: 'b' as NodeId }))
      const edgeId = model.addEdge({ type: 'contains', fromNodeId: a, toNodeId: b })
      model.applyOperations([{ operation: 'removeEdge', edgeId }])
      expect(model.toSnapshot().edges).toEqual([])
    })

    it('updateNodes applies multiple patches atomically', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      const b = model.addNode(newNode({ id: 'b' as NodeId }))
      model.applyOperations([{
        operation: 'updateNodes',
        updates: [
          { nodeId: a, patch: { name: 'AA' } },
          { nodeId: b, patch: { name: 'BB' } },
        ],
      }])
      const snapshot = model.toSnapshot()
      expect(snapshot.nodes.find(node => node.id === a)?.name).toBe('AA')
      expect(snapshot.nodes.find(node => node.id === b)?.name).toBe('BB')
    })

    it('updateEdges applies multiple patches atomically', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      const b = model.addNode(newNode({ id: 'b' as NodeId }))
      const c = model.addNode(newNode({ id: 'c' as NodeId }))
      const e1 = model.addEdge({ type: 'contains', fromNodeId: a, toNodeId: b })
      const e2 = model.addEdge({ type: 'contains', fromNodeId: a, toNodeId: c })
      model.applyOperations([{
        operation: 'updateEdges',
        updates: [
          { edgeId: e1, patch: { type: 'triggers' } },
          { edgeId: e2, patch: { type: 'emits' } },
        ],
      }])
      const snapshot = model.toSnapshot()
      expect(snapshot.edges.find(edge => edge.id === e1)?.type).toBe('triggers')
      expect(snapshot.edges.find(edge => edge.id === e2)?.type).toBe('emits')
    })

    it('addEdges batch + removeEdges batch', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      const b = model.addNode(newNode({ id: 'b' as NodeId }))
      const c = model.addNode(newNode({ id: 'c' as NodeId }))
      model.applyOperations([{
        operation: 'addEdges',
        payloads: [
          { type: 'contains', fromNodeId: a, toNodeId: b, id: 'e1' as never },
          { type: 'contains', fromNodeId: a, toNodeId: c, id: 'e2' as never },
        ],
      }])
      expect(model.toSnapshot().edges).toHaveLength(2)
      model.applyOperations([{ operation: 'removeEdges', edgeIds: ['e1' as never, 'e2' as never] }])
      expect(model.toSnapshot().edges).toEqual([])
    })
  })

  describe('queries', () => {
    it('findNode returns node or undefined', () => {
      const id = model.addNode(newNode())
      expect(model.findNode(id)?.name).toBe('voidTask')
      expect(model.findNode('missing' as NodeId)).toBeUndefined()
    })

    it('findEdgesFromNode lists outgoing', () => {
      const a = model.addNode(newNode({ id: 'a' as NodeId }))
      const b = model.addNode(newNode({ id: 'b' as NodeId }))
      const c = model.addNode(newNode({ id: 'c' as NodeId }))
      model.addEdge({ type: 'contains', fromNodeId: a, toNodeId: b })
      model.addEdge({ type: 'emits', fromNodeId: a, toNodeId: c })
      expect(model.findEdgesFromNode(a)).toHaveLength(2)
    })
  })

  describe('Model.preview (pure projection)', () => {
    it('returns a new snapshot without mutating the input', () => {
      const original = { nodes: [], edges: [] }
      const ops: GraphOperation[] = [
        { operation: 'addNode', payload: { type: 'command', name: 'x', id: 'n-1' as NodeId } as never },
      ]
      const next = Model.preview(original, ops)
      expect(next.nodes).toHaveLength(1)
      expect(original.nodes).toEqual([])
    })

    it('throws when operations are invalid (e.g. removing missing node)', () => {
      expect(() => Model.preview({ nodes: [], edges: [] }, [
        { operation: 'removeNode', nodeId: 'missing' as NodeId },
      ])).toThrow(NotFoundError)
    })
  })
})
