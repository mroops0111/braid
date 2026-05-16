import type { EdgeId, EdgeTypeId, ModelSnapshot, NodeId, NodeStatus, NodeTypeId, OntologyId, PluginId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { OntologyTypeValidator } from '../../../src/infrastructure/validation/OntologyTypeValidator.js'

const draft = 'draft' as NodeStatus

function snapshot(nodes: ModelSnapshot['nodes'], edges: ModelSnapshot['edges'] = []): ModelSnapshot {
  return { nodes, edges }
}

/**
 * Build a tiny custom ontology directly so the test proves the validator
 * works against any ontology, not just DDD. (The DDD plugin uses the
 * SDK builder, which is tested separately.)
 */
const tinyOntology = {
  id: 'ontology.tiny' as PluginId,
  type: 'ontology' as const,
  configSchema: z.object({}),
  ontologyId: 'tiny' as OntologyId,
  nodeTypes: [
    { id: 'page' as NodeTypeId, label: 'Page', description: 'A page.' },
    { id: 'widget' as NodeTypeId, label: 'Widget', description: 'A widget.' },
  ],
  edgeTypes: [
    { id: 'mounts' as EdgeTypeId, fromTypes: ['page'] as NodeTypeId[], toTypes: ['widget'] as NodeTypeId[] },
  ],
}

describe('OntologyTypeValidator', () => {
  const validator = new OntologyTypeValidator(tinyOntology)

  it('accepts node and edge types declared in the ontology', async () => {
    const issues = await validator.validate(snapshot(
      [
        { id: 'n1' as NodeId, type: 'page' as NodeTypeId, name: 'home', status: draft, metadata: { sourceReferences: [] } },
        { id: 'n2' as NodeId, type: 'widget' as NodeTypeId, name: 'banner', status: draft, metadata: { sourceReferences: [] } },
      ],
      [
        { id: 'e1' as EdgeId, type: 'mounts' as EdgeTypeId, fromNodeId: 'n1' as NodeId, toNodeId: 'n2' as NodeId, metadata: { sourceReferences: [] } },
      ],
    ))
    expect(issues).toEqual([])
  })

  it('rejects unknown node types with namespaced code', async () => {
    const issues = await validator.validate(snapshot([
      { id: 'n1' as NodeId, type: 'unknown-type' as NodeTypeId, name: 'x', status: draft, metadata: { sourceReferences: [] } },
    ]))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      code: 'ontology.unknown-node-type',
      severity: 'error',
      nodeId: 'n1',
    })
  })

  it('rejects unknown edge types case-sensitively', async () => {
    const issues = await validator.validate(snapshot(
      [
        { id: 'n1' as NodeId, type: 'page' as NodeTypeId, name: 'home', status: draft, metadata: { sourceReferences: [] } },
        { id: 'n2' as NodeId, type: 'widget' as NodeTypeId, name: 'banner', status: draft, metadata: { sourceReferences: [] } },
      ],
      [
        { id: 'e1' as EdgeId, type: 'MOUNTS' as EdgeTypeId, fromNodeId: 'n1' as NodeId, toNodeId: 'n2' as NodeId, metadata: { sourceReferences: [] } },
      ],
    ))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'ontology.unknown-edge-type', edgeId: 'e1' })
  })

  it('uses the ontology id in error messages so users know which validator complained', async () => {
    const issues = await validator.validate(snapshot([
      { id: 'n1' as NodeId, type: 'unknown' as NodeTypeId, name: 'x', status: draft, metadata: { sourceReferences: [] } },
    ]))
    expect(issues[0]?.message).toContain('tiny ontology')
  })
})
