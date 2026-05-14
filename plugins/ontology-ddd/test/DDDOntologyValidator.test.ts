import type { EdgeId, EdgeTypeId, ModelSnapshot, NodeId, NodeStatus, NodeTypeId } from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { DDDOntology } from '../src/DDDOntology.js'
import { DDDOntologyValidator } from '../src/DDDOntologyValidator.js'

const draft = 'draft' as NodeStatus

function snapshot(nodes: ModelSnapshot['nodes'], edges: ModelSnapshot['edges'] = []): ModelSnapshot {
  return { nodes, edges }
}

describe('DDDOntologyValidator', () => {
  const validator = new DDDOntologyValidator(new DDDOntology())

  it('accepts canonical DDD types', async () => {
    const issues = await validator.validate(snapshot(
      [
        { id: 'a' as NodeId, type: 'boundedContext' as NodeTypeId, name: 'cart', status: draft, metadata: { sourceReferences: [] } },
        { id: 'b' as NodeId, type: 'aggregate' as NodeTypeId, name: 'Cart', status: draft, metadata: { sourceReferences: [] } },
      ],
      [{ id: 'e1' as EdgeId, type: 'contains' as EdgeTypeId, fromNodeId: 'a' as NodeId, toNodeId: 'b' as NodeId, metadata: { sourceReferences: [] } }],
    ))
    expect(issues).toEqual([])
  })

  it('rejects unknown node type (the "context" vs "boundedContext" case)', async () => {
    const issues = await validator.validate(snapshot([
      { id: 'a' as NodeId, type: 'context' as NodeTypeId, name: 'cart', status: draft, metadata: { sourceReferences: [] } },
    ]))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      code: 'ontology.unknown-node-type',
      severity: 'error',
      nodeId: 'a',
    })
  })

  it('rejects unknown edge type (the "CONTAINS" uppercase case)', async () => {
    const issues = await validator.validate(snapshot(
      [
        { id: 'a' as NodeId, type: 'boundedContext' as NodeTypeId, name: 'cart', status: draft, metadata: { sourceReferences: [] } },
        { id: 'b' as NodeId, type: 'aggregate' as NodeTypeId, name: 'Cart', status: draft, metadata: { sourceReferences: [] } },
      ],
      [{ id: 'e1' as EdgeId, type: 'CONTAINS' as EdgeTypeId, fromNodeId: 'a' as NodeId, toNodeId: 'b' as NodeId, metadata: { sourceReferences: [] } }],
    ))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'ontology.unknown-edge-type', edgeId: 'e1' })
  })
})
