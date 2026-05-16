import type {
  EdgeId,
  EdgeTypeId,
  ModelSnapshot,
  NodeId,
  NodeStatus,
  NodeTypeId,
  OntologyId,
  PluginId,
} from '@braidhq/schema'
import type { EdgeTypeDescriptor, Ontology } from '../../../src/domain/plugin/Ontology.js'
import { describe, expect, it } from 'vitest'
import { StructuralValidator } from '../../../src/infrastructure/validation/StructuralValidator.js'

const boundedContext = 'boundedContext' as NodeTypeId
const aggregate = 'aggregate' as NodeTypeId
const command = 'command' as NodeTypeId
const draft = 'draft' as NodeStatus
const contains = 'contains' as EdgeTypeId
const handles = 'handles' as EdgeTypeId

function fakeOntology(edgeTypes: readonly EdgeTypeDescriptor[]): Ontology {
  return {
    id: 'test.ontology' as PluginId,
    type: 'ontology' as const,
    ontologyId: 'test' as OntologyId,
    nodeTypes: [],
    edgeTypes,
  }
}

function node(id: string, type: NodeTypeId): ModelSnapshot['nodes'][number] {
  return { id: id as NodeId, type, name: id, status: draft, metadata: { sourceReferences: [] } }
}

function edge(id: string, type: EdgeTypeId, from: string, to: string): ModelSnapshot['edges'][number] {
  return {
    id: id as EdgeId,
    type,
    fromNodeId: from as NodeId,
    toNodeId: to as NodeId,
    metadata: { sourceReferences: [] },
  }
}

describe('StructuralValidator', () => {
  describe('endpoint types', () => {
    const ontology = fakeOntology([
      { id: contains, fromTypes: [boundedContext], toTypes: [aggregate, command] },
    ])
    const validator = new StructuralValidator(ontology)

    it('passes when source + target types match the descriptor', async () => {
      const issues = await validator.validate({
        nodes: [node('bc1', boundedContext), node('agg1', aggregate)],
        edges: [edge('e1', contains, 'bc1', 'agg1')],
      })

      expect(issues).toEqual([])
    })

    it('flags a reversed contains edge as wrong source type', async () => {
      const issues = await validator.validate({
        nodes: [node('agg1', aggregate), node('bc1', boundedContext)],
        edges: [edge('e1', contains, 'agg1', 'bc1')],
      })

      expect(issues.map(i => i.code)).toEqual([
        'structural.endpoint-type-from',
        'structural.endpoint-type-to',
      ])
      expect(issues.every(i => i.edgeId === 'e1')).toBe(true)
    })

    it('skips edges whose endpoints are missing (OrphanEdgeValidator handles those)', async () => {
      const issues = await validator.validate({
        nodes: [node('bc1', boundedContext)],
        edges: [edge('e1', contains, 'bc1', 'ghost')],
      })

      expect(issues).toEqual([])
    })

    it('skips edges whose type the ontology does not declare (ontology-types validator handles those)', async () => {
      const issues = await validator.validate({
        nodes: [node('bc1', boundedContext), node('agg1', aggregate)],
        edges: [edge('e1', 'unknown' as EdgeTypeId, 'bc1', 'agg1')],
      })

      expect(issues).toEqual([])
    })
  })

  describe('cardinality', () => {
    it('1:1 — rejects a second outgoing AND a second incoming on the same node', async () => {
      const validator = new StructuralValidator(fakeOntology([
        { id: handles, fromTypes: [aggregate], toTypes: [command], cardinality: '1:1' },
      ]))

      const issues = await validator.validate({
        nodes: [node('a1', aggregate), node('c1', command), node('c2', command), node('a2', aggregate)],
        // a1 → c1, a1 → c2 (source duplicates); a2 → c1 (target duplicates)
        edges: [
          edge('e1', handles, 'a1', 'c1'),
          edge('e2', handles, 'a1', 'c2'),
          edge('e3', handles, 'a2', 'c1'),
        ],
      })

      const codes = issues.map(i => i.code).sort()
      expect(codes).toContain('structural.cardinality-source')
      expect(codes).toContain('structural.cardinality-target')
    })

    it('1:N — rejects duplicate incoming on a target but allows many outgoing per source', async () => {
      const validator = new StructuralValidator(fakeOntology([
        { id: contains, fromTypes: [boundedContext], toTypes: [aggregate], cardinality: '1:N' },
      ]))

      const issues = await validator.validate({
        nodes: [node('bc1', boundedContext), node('bc2', boundedContext), node('agg1', aggregate), node('agg2', aggregate)],
        // bc1 → agg1, bc1 → agg2 (fine: one bc fanning out); bc2 → agg1 (violates: agg1 has two bc parents)
        edges: [
          edge('e1', contains, 'bc1', 'agg1'),
          edge('e2', contains, 'bc1', 'agg2'),
          edge('e3', contains, 'bc2', 'agg1'),
        ],
      })

      expect(issues).toHaveLength(1)
      expect(issues[0]?.code).toBe('structural.cardinality-target')
      expect(issues[0]?.nodeId).toBe('agg1')
    })

    it('N:N — never reports a cardinality issue', async () => {
      const validator = new StructuralValidator(fakeOntology([
        { id: 'depends-on' as EdgeTypeId, fromTypes: [boundedContext], toTypes: [boundedContext], cardinality: 'N:N' },
      ]))

      const issues = await validator.validate({
        nodes: [node('a', boundedContext), node('b', boundedContext), node('c', boundedContext)],
        edges: [
          edge('e1', 'depends-on' as EdgeTypeId, 'a', 'b'),
          edge('e2', 'depends-on' as EdgeTypeId, 'a', 'c'),
          edge('e3', 'depends-on' as EdgeTypeId, 'b', 'c'),
          edge('e4', 'depends-on' as EdgeTypeId, 'b', 'a'),
        ],
      })

      expect(issues.filter(i => i.code.startsWith('structural.cardinality'))).toEqual([])
    })

    it('descriptors without cardinality are unconstrained', async () => {
      const validator = new StructuralValidator(fakeOntology([
        { id: contains, fromTypes: [boundedContext], toTypes: [aggregate] },
      ]))

      const issues = await validator.validate({
        nodes: [node('bc1', boundedContext), node('agg1', aggregate)],
        edges: [
          edge('e1', contains, 'bc1', 'agg1'),
          edge('e2', contains, 'bc1', 'agg1'),
          edge('e3', contains, 'bc1', 'agg1'),
        ],
      })

      expect(issues).toEqual([])
    })
  })
})
