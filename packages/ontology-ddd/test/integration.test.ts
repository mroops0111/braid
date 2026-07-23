import type { ModelSnapshot } from '@braidhq/schema'
import { StructuralValidator } from '@braidhq/core'
import { EdgeId, EdgeTypeId, NodeId, NodeStatus, NodeTypeId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { dddOntology } from '../src/DDDOntology.js'

const draft = NodeStatus.parse('draft')

function node(id: string, type: string): ModelSnapshot['nodes'][number] {
  return {
    id: NodeId.parse(id),
    type: NodeTypeId.parse(type),
    name: id,
    status: draft,
    metadata: { sourceReferences: [] },
  }
}

function edge(id: string, type: string, from: string, to: string): ModelSnapshot['edges'][number] {
  return {
    id: EdgeId.parse(id),
    type: EdgeTypeId.parse(type),
    fromNodeId: NodeId.parse(from),
    toNodeId: NodeId.parse(to),
    metadata: { sourceReferences: [] },
  }
}

describe('dddOntology + StructuralValidator integration', () => {
  const validator = new StructuralValidator(dddOntology)

  describe('policy flow', () => {
    it('accepts event --triggers--> policy --enacts--> command', async () => {
      const issues = await validator.validate({
        nodes: [
          node('agg.a', 'aggregate'),
          node('cmd.do', 'command'),
          node('evt.happened', 'event'),
          node('policy.react', 'policy'),
          node('cmd.followup', 'command'),
        ],
        edges: [
          edge('e1', 'emits', 'agg.a', 'evt.happened'),
          edge('e2', 'triggers', 'evt.happened', 'policy.react'),
          edge('e3', 'enacts', 'policy.react', 'cmd.followup'),
        ],
      })
      expect(issues).toEqual([])
    })

    it('rejects aggregate --triggers--> policy because triggers needs an event source', async () => {
      const issues = await validator.validate({
        nodes: [node('agg.a', 'aggregate'), node('policy.react', 'policy')],
        edges: [edge('bad', 'triggers', 'agg.a', 'policy.react')],
      })
      expect(issues.map(i => i.code)).toContain('structural.endpoint-type-from')
    })

    it('rejects policy --enacts--> aggregate because enacts targets commands', async () => {
      const issues = await validator.validate({
        nodes: [node('policy.react', 'policy'), node('agg.b', 'aggregate')],
        edges: [edge('bad', 'enacts', 'policy.react', 'agg.b')],
      })
      expect(issues.map(i => i.code)).toContain('structural.endpoint-type-to')
    })
  })

  describe('context mapping edges', () => {
    const contextMappingEdges = [
      'partnership',
      'customerSupplier',
      'conformist',
      'sharedKernel',
      'anticorruptionLayer',
      'openHostService',
      'publishedLanguage',
    ] as const

    it.each(contextMappingEdges)('accepts %s between two BoundedContexts', async (edgeType) => {
      const issues = await validator.validate({
        nodes: [node('bc.a', 'boundedContext'), node('bc.b', 'boundedContext')],
        edges: [edge('e1', edgeType, 'bc.a', 'bc.b')],
      })
      expect(issues).toEqual([])
    })

    it.each(contextMappingEdges)('rejects %s when from is not a BoundedContext', async (edgeType) => {
      const issues = await validator.validate({
        nodes: [node('agg.a', 'aggregate'), node('bc.b', 'boundedContext')],
        edges: [edge('bad', edgeType, 'agg.a', 'bc.b')],
      })
      expect(issues.map(i => i.code)).toContain('structural.endpoint-type-from')
    })
  })

  describe('canonical tactical edges', () => {
    it('accepts the aggregate-rooted shape (bc contains agg accepts cmd emits evt)', async () => {
      const issues = await validator.validate({
        nodes: [
          node('bc.root', 'boundedContext'),
          node('agg.x', 'aggregate'),
          node('cmd.do', 'command'),
          node('qry.read', 'query'),
          node('evt.happened', 'event'),
        ],
        edges: [
          edge('e1', 'contains', 'bc.root', 'agg.x'),
          edge('e2', 'accepts', 'agg.x', 'cmd.do'),
          edge('e3', 'accepts', 'agg.x', 'qry.read'),
          edge('e4', 'emits', 'agg.x', 'evt.happened'),
        ],
      })
      expect(issues).toEqual([])
    })

    it('rejects bc --contains--> command (non-aggregate target) per the narrowed contains rule', async () => {
      const issues = await validator.validate({
        nodes: [node('bc.root', 'boundedContext'), node('cmd.orphan', 'command')],
        edges: [edge('bad', 'contains', 'bc.root', 'cmd.orphan')],
      })
      expect(issues.map(i => i.code)).toContain('structural.endpoint-type-to')
    })

    it('accepts command --emits--> event (CQRS / EventStorming reading: cmd produces evt)', async () => {
      const issues = await validator.validate({
        nodes: [node('cmd.do', 'command'), node('evt.happened', 'event')],
        edges: [edge('e1', 'emits', 'cmd.do', 'evt.happened')],
      })
      expect(issues).toEqual([])
    })

    it('accepts aggregate --emits--> event (Vernon IDDD structural reading: agg is the source)', async () => {
      const issues = await validator.validate({
        nodes: [node('agg.x', 'aggregate'), node('evt.happened', 'event')],
        edges: [edge('e1', 'emits', 'agg.x', 'evt.happened')],
      })
      expect(issues).toEqual([])
    })

    it('rejects query --emits--> event (queries do not change state, so cannot source events)', async () => {
      const issues = await validator.validate({
        nodes: [node('qry.read', 'query'), node('evt.happened', 'event')],
        edges: [edge('bad', 'emits', 'qry.read', 'evt.happened')],
      })
      expect(issues.map(i => i.code)).toContain('structural.endpoint-type-from')
    })

    it('accepts aggregate --constrainedBy--> rule (aggregate-wide invariant)', async () => {
      const issues = await validator.validate({
        nodes: [node('agg.x', 'aggregate'), node('rule.r', 'rule')],
        edges: [edge('e1', 'constrainedBy', 'agg.x', 'rule.r')],
      })
      expect(issues).toEqual([])
    })
  })
})

describe('dddOntology descriptions', () => {
  it('declares a description on every node type so /ontology consumers can explain each entry', () => {
    for (const node of dddOntology.nodeTypes) {
      expect(node.description, `node ${node.id} missing description`).toBeTruthy()
    }
  })

  it('declares a description on every edge type so /ontology consumers can explain each entry', () => {
    for (const edge of dddOntology.edgeTypes) {
      expect(edge.description, `edge ${edge.id} missing description`).toBeTruthy()
    }
  })
})
