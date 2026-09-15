import type { NodeTypeDescriptor } from '@braidhq/core'
import type { ModelSnapshot, NodeId, NodeTypeId } from '@braidhq/schema'
import { makeEdge, makeNode } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { containerTypesOf, projectDocument } from '../src/material.js'

function type(id: string, renderHint?: NodeTypeDescriptor['renderHint']): NodeTypeDescriptor {
  return { id: id as NodeTypeId, label: id, ...(renderHint ? { renderHint } : {}) }
}

const NODE_TYPES: readonly NodeTypeDescriptor[] = [
  type('boundedContext', { container: true }),
  { ...type('aggregate', { expandedUnder: 'boundedContext' as NodeTypeId }), label: { 'en': 'Aggregate', 'zh-Hant': '聚合' } },
  type('actor', { section: 'Actors' }),
  type('note'),
]

const MODEL: ModelSnapshot = {
  nodes: [
    makeNode('ctx', { type: 'boundedContext' as NodeTypeId, name: 'Checkout', description: 'Taking money', status: 'completed' }),
    makeNode('agg.basket', { type: 'aggregate' as NodeTypeId, name: 'Basket', status: 'unclear' }),
    makeNode('agg.order', { type: 'aggregate' as NodeTypeId, name: 'Aardvark', status: 'completed' }),
    makeNode('who', { type: 'actor' as NodeTypeId, name: 'Shopper', status: 'completed' }),
    makeNode('n1', { type: 'note' as NodeTypeId, name: 'Note', status: 'completed' }),
  ],
  edges: [
    makeEdge('e1', 'ctx', 'agg.basket'),
    makeEdge('e2', 'ctx', 'agg.order'),
    makeEdge('e3', 'ctx', 'who'),
    makeEdge('e4', 'ctx', 'n1'),
  ],
}

function project(subject = 'ctx') {
  return projectDocument({ model: MODEL, nodeTypes: NODE_TYPES, subject: subject as NodeId })
}

describe('projectDocument', () => {
  it('answers nothing for a node the graph does not hold', () => {
    expect(project('gone')).toBeUndefined()
  })

  it('carries the container itself, with the type label as the ontology gave it', () => {
    const material = project()
    expect(material).toMatchObject({ subject: 'ctx', title: 'Checkout', description: 'Taking money', typeLabel: 'boundedContext' })
  })

  it('keeps a translated type label whole rather than flattening it', () => {
    expect(project()?.holds[0]?.typeLabel).toEqual({ 'en': 'Aggregate', 'zh-Hant': '聚合' })
  })

  it('lists a sectioned type under its own heading', () => {
    expect(project()?.sections).toEqual([
      { label: 'Actors', nodes: [expect.objectContaining({ id: 'who' })] },
    ])
  })

  it('orders what it holds by name, so the same graph writes the same document', () => {
    expect(project()?.holds.map(node => node.name)).toEqual(['Aardvark', 'Basket'])
  })

  it('names every unsettled node as a concern, and no settled one', () => {
    expect(project()?.concerns).toEqual([{ id: 'agg.basket', name: 'Basket', status: 'unclear' }])
  })

  it('traces to every node in scope, including the ones kept out of the body', () => {
    expect(project()?.sourceNodeIds).toEqual(['agg.basket', 'agg.order', 'ctx', 'n1', 'who'])
  })

  it('leaves out a description the graph does not hold, rather than writing an empty one', () => {
    expect(Object.keys(project()?.holds[0] ?? {})).not.toContain('description')
  })

  it('produces the same bytes twice over for the same graph', () => {
    expect(JSON.stringify(project())).toBe(JSON.stringify(project()))
  })
})

describe('containerTypesOf', () => {
  it('names the types a document can be written out of', () => {
    expect(containerTypesOf(NODE_TYPES)).toEqual(['boundedContext'])
  })
})
