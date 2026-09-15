import type { ModelSnapshot, NodeId, NodeTypeId } from '@braidhq/schema'
import type { NodeTypeDescriptor } from '../../../src/domain/plugin/OntologyPlugin.js'
import { makeEdge, makeNode } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { documentTreeOf, renderTaxonomyOf } from '../../../src/domain/view/renderTaxonomy.js'

function type(id: string, renderHint?: NodeTypeDescriptor['renderHint']): NodeTypeDescriptor {
  return { id: id as NodeTypeId, label: id, ...(renderHint ? { renderHint } : {}) }
}

const NODE_TYPES: readonly NodeTypeDescriptor[] = [
  type('boundedContext', { container: true }),
  type('aggregate', { expandedUnder: 'boundedContext' as NodeTypeId }),
  type('command', { expandedUnder: 'aggregate' as NodeTypeId }),
  type('rule', { expandedUnder: 'command' as NodeTypeId }),
  type('actor', { section: 'Actors' }),
  type('note'),
]

function snapshot(nodes: ReturnType<typeof makeNode>[], edges: ReturnType<typeof makeEdge>[]): ModelSnapshot {
  return { nodes, edges }
}

describe('renderTaxonomyOf', () => {
  it('reads containers, chains, and sections off renderHint alone', () => {
    const taxonomy = renderTaxonomyOf(NODE_TYPES)
    expect(taxonomy.containerTypes).toEqual(['boundedContext'])
    expect(taxonomy.parentOf.get('aggregate' as NodeTypeId)).toBe('boundedContext')
    expect(taxonomy.parentOf.get('command' as NodeTypeId)).toBe('aggregate')
    expect(taxonomy.sectionOf.get('actor' as NodeTypeId)).toBe('Actors')
  })

  it('treats a type with no hint as a leaf, and a hinted one as not', () => {
    const taxonomy = renderTaxonomyOf(NODE_TYPES)
    expect(taxonomy.leafTypes.has('note' as NodeTypeId)).toBe(true)
    expect(taxonomy.leafTypes.has('aggregate' as NodeTypeId)).toBe(false)
  })

  it('keeps a nesting type out of the sections, so it is not drawn twice', () => {
    const taxonomy = renderTaxonomyOf([
      type('boundedContext', { container: true }),
      type('aggregate', { expandedUnder: 'boundedContext' as NodeTypeId, section: 'Aggregates' }),
    ])
    expect(taxonomy.sectionOf.has('aggregate' as NodeTypeId)).toBe(false)
  })

  it('keeps a container out of the sections, so siblings are not listed inside one', () => {
    const taxonomy = renderTaxonomyOf([type('boundedContext', { container: true, section: 'Use cases' })])
    expect(taxonomy.sectionOf.has('boundedContext' as NodeTypeId)).toBe(false)
    expect(taxonomy.containerTypes).toEqual(['boundedContext'])
  })
})

describe('documentTreeOf', () => {
  const taxonomy = renderTaxonomyOf(NODE_TYPES)

  it('nests each node under the neighbour whose type its chain names', () => {
    const model = snapshot(
      [
        makeNode('ctx', { type: 'boundedContext' as NodeTypeId }),
        makeNode('agg', { type: 'aggregate' as NodeTypeId }),
        makeNode('cmd', { type: 'command' as NodeTypeId }),
      ],
      [makeEdge('e1', 'ctx', 'agg'), makeEdge('e2', 'agg', 'cmd')],
    )

    const tree = documentTreeOf({ taxonomy, model, containerId: 'ctx' as NodeId })
    expect(tree?.branches.map(branch => branch.node.id)).toEqual(['agg'])
    expect(tree?.branches[0]?.children.map(child => child.node.id)).toEqual(['cmd'])
  })

  it('lists a sectioned type flat rather than nesting it', () => {
    const model = snapshot(
      [
        makeNode('ctx', { type: 'boundedContext' as NodeTypeId }),
        makeNode('who', { type: 'actor' as NodeTypeId }),
      ],
      [makeEdge('e1', 'ctx', 'who')],
    )

    const tree = documentTreeOf({ taxonomy, model, containerId: 'ctx' as NodeId })
    expect(tree?.sections).toEqual([{ label: 'Actors', nodes: [expect.objectContaining({ id: 'who' })] }])
    expect(tree?.branches).toEqual([])
  })

  it('records an unhinted type for the footer rather than the body', () => {
    const model = snapshot(
      [
        makeNode('ctx', { type: 'boundedContext' as NodeTypeId }),
        makeNode('n1', { type: 'note' as NodeTypeId }),
      ],
      [makeEdge('e1', 'ctx', 'n1')],
    )

    const tree = documentTreeOf({ taxonomy, model, containerId: 'ctx' as NodeId })
    expect(tree?.leafNodeIds).toEqual(['n1'])
    expect(tree?.branches).toEqual([])
  })

  it('holds a node whose chain skips a link, rather than dropping it', () => {
    // A command hanging straight off the context, with no aggregate between.
    const model = snapshot(
      [
        makeNode('ctx', { type: 'boundedContext' as NodeTypeId }),
        makeNode('cmd', { type: 'command' as NodeTypeId }),
      ],
      [makeEdge('e1', 'ctx', 'cmd')],
    )

    const tree = documentTreeOf({ taxonomy, model, containerId: 'ctx' as NodeId })
    expect(tree?.branches.map(branch => branch.node.id)).toEqual(['cmd'])
  })

  it('takes a node attached further up its own chain than the chain names', () => {
    // ddd lets an invariant of a whole aggregate hang off the aggregate,
    // while `rule` declares `command` as what holds it.
    const model = snapshot(
      [
        makeNode('ctx', { type: 'boundedContext' as NodeTypeId }),
        makeNode('agg', { type: 'aggregate' as NodeTypeId }),
        makeNode('rule', { type: 'rule' as NodeTypeId }),
      ],
      [makeEdge('e1', 'ctx', 'agg'), makeEdge('e2', 'agg', 'rule')],
    )

    const tree = documentTreeOf({ taxonomy, model, containerId: 'ctx' as NodeId })
    expect(tree?.branches[0]?.children.map(child => child.node.id)).toEqual(['rule'])
  })

  it('leaves out a node whose chain does not run through anything in scope', () => {
    // A second aggregate hanging off ours belongs to the context holding it,
    // and `aggregate` is not above `aggregate` on any chain.
    const model = snapshot(
      [
        makeNode('ctx', { type: 'boundedContext' as NodeTypeId }),
        makeNode('agg', { type: 'aggregate' as NodeTypeId }),
        makeNode('theirs', { type: 'aggregate' as NodeTypeId }),
      ],
      [makeEdge('e1', 'ctx', 'agg'), makeEdge('e2', 'agg', 'theirs')],
    )

    const tree = documentTreeOf({ taxonomy, model, containerId: 'ctx' as NodeId })
    expect(JSON.stringify(tree)).not.toContain('theirs')
  })

  it('never reaches a sibling container, however close it is', () => {
    const model = snapshot(
      [
        makeNode('ctx', { type: 'boundedContext' as NodeTypeId }),
        makeNode('agg', { type: 'aggregate' as NodeTypeId }),
        makeNode('other', { type: 'boundedContext' as NodeTypeId }),
      ],
      [makeEdge('e1', 'ctx', 'agg'), makeEdge('e2', 'agg', 'other')],
    )

    const tree = documentTreeOf({ taxonomy, model, containerId: 'ctx' as NodeId })
    expect(JSON.stringify(tree)).not.toContain('other')
  })

  it('answers nothing for a container the graph does not hold', () => {
    expect(documentTreeOf({ taxonomy, model: snapshot([], []), containerId: 'gone' as NodeId })).toBeUndefined()
  })

  it('takes an unhinted leaf hanging off the chain, and stops there', () => {
    const model = snapshot(
      [
        makeNode('ctx', { type: 'boundedContext' as NodeTypeId }),
        makeNode('agg', { type: 'aggregate' as NodeTypeId }),
        makeNode('n1', { type: 'note' as NodeTypeId }),
        makeNode('beyond', { type: 'note' as NodeTypeId }),
      ],
      [makeEdge('e1', 'ctx', 'agg'), makeEdge('e2', 'agg', 'n1'), makeEdge('e3', 'n1', 'beyond')],
    )

    const tree = documentTreeOf({ taxonomy, model, containerId: 'ctx' as NodeId })
    expect(tree?.leafNodeIds).toEqual(['n1'])
  })

  it('follows a chain as deep as the ontology declares it', () => {
    const model = snapshot(
      [
        makeNode('ctx', { type: 'boundedContext' as NodeTypeId }),
        makeNode('agg', { type: 'aggregate' as NodeTypeId }),
        makeNode('cmd', { type: 'command' as NodeTypeId }),
      ],
      [makeEdge('e1', 'ctx', 'agg'), makeEdge('e2', 'agg', 'cmd')],
    )

    const tree = documentTreeOf({ taxonomy, model, containerId: 'ctx' as NodeId })
    expect(tree?.branches[0]?.children.map(child => child.node.id)).toEqual(['cmd'])
  })
})
