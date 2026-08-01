import type { EdgeTypeId, NodeTypeId } from '@braidhq/schema'
import { ConflictError, ValidationError } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { defineOntologyPlugin } from '../src/defineOntologyPlugin.js'

function minimalNode(id: string, description = `${id} description`): { id: NodeTypeId, label: string, description: string } {
  return {
    id: id as NodeTypeId,
    label: id,
    description,
  }
}

function minimalEdge(id: string, from: string[], to: string[]): { id: EdgeTypeId, fromTypes: NodeTypeId[], toTypes: NodeTypeId[], description: string } {
  return {
    id: id as EdgeTypeId,
    fromTypes: from as NodeTypeId[],
    toTypes: to as NodeTypeId[],
    description: `${id} edge description`,
  }
}

describe('defineOntologyPlugin', () => {
  it('builds a frozen ontology with the declared types', () => {
    const ontology = defineOntologyPlugin({
      ontologyId: 'tiny',
      nodeTypes: [minimalNode('a'), minimalNode('b')],
      edgeTypes: [minimalEdge('connects', ['a'], ['b'])],
    })
    expect(ontology.ontologyId).toBe('tiny')
    expect(ontology.nodeTypes.map(n => n.id)).toEqual(['a', 'b'])
    expect(ontology.edgeTypes.map(e => e.id)).toEqual(['connects'])
    expect(Object.isFrozen(ontology)).toBe(true)
  })

  it('uses ontology.<id> as the default plugin id', () => {
    const ontology = defineOntologyPlugin({
      ontologyId: 'tiny',
      nodeTypes: [minimalNode('a')],
      edgeTypes: [],
    })
    expect(ontology.id).toBe('ontology.tiny')
  })

  describe('extends', () => {
    const base = defineOntologyPlugin({
      ontologyId: 'base',
      nodeTypes: [minimalNode('a'), minimalNode('b')],
      edgeTypes: [minimalEdge('connects', ['a'], ['b'])],
    })

    it('concatenates node and edge types from the base', () => {
      const extended = defineOntologyPlugin({
        ontologyId: 'extended',
        extends: base,
        nodeTypes: [minimalNode('c')],
        edgeTypes: [minimalEdge('related', ['a'], ['c'])],
      })
      expect(extended.nodeTypes.map(n => n.id)).toEqual(['a', 'b', 'c'])
      expect(extended.edgeTypes.map(e => e.id)).toEqual(['connects', 'related'])
    })

    it('lets edges in the extension reference base-ontology node types', () => {
      expect(() => defineOntologyPlugin({
        ontologyId: 'extended',
        extends: base,
        nodeTypes: [minimalNode('c')],
        edgeTypes: [minimalEdge('toBase', ['c'], ['b'])],
      })).not.toThrow()
    })

    it('throws ConflictError when extension duplicates a base node id', () => {
      expect(() => defineOntologyPlugin({
        ontologyId: 'extended',
        extends: base,
        nodeTypes: [minimalNode('a')],
        edgeTypes: [],
      })).toThrow(ConflictError)
    })
  })

  describe('validation', () => {
    it('throws ValidationError when an edge endpoint references unknown node type', () => {
      expect(() => defineOntologyPlugin({
        ontologyId: 'tiny',
        nodeTypes: [minimalNode('a')],
        edgeTypes: [minimalEdge('broken', ['a'], ['missing'])],
      })).toThrow(ValidationError)
    })

    it('throws ValidationError when a node descriptor lacks description', () => {
      expect(() => defineOntologyPlugin({
        ontologyId: 'tiny',
        nodeTypes: [{ id: 'a' as NodeTypeId, label: 'a', description: '' }],
        edgeTypes: [],
      })).toThrow(ValidationError)
    })

    it('throws ValidationError for an unrecognised CSS colour string', () => {
      expect(() => defineOntologyPlugin({
        ontologyId: 'tiny',
        nodeTypes: [{ ...minimalNode('a'), color: 'tomato' }],
        edgeTypes: [],
      })).toThrow(ValidationError)
    })

    it('accepts oklch, hex, rgb, and hsl colours', () => {
      expect(() => defineOntologyPlugin({
        ontologyId: 'tiny',
        nodeTypes: [
          { ...minimalNode('a'), color: 'oklch(0.7 0.15 155)' },
          { ...minimalNode('b'), color: '#7c3aed' },
          { ...minimalNode('c'), color: 'rgb(124, 58, 237)' },
          { ...minimalNode('d'), color: 'hsl(258 90% 58%)' },
        ],
        edgeTypes: [],
      })).not.toThrow()
    })
  })

  it('exposes plugin skills declared in the spec', () => {
    const ontology = defineOntologyPlugin({
      ontologyId: 'tiny',
      nodeTypes: [minimalNode('a')],
      edgeTypes: [],
      skills: [{ directory: '/abs/path' }],
    })
    expect(ontology.skills).toHaveLength(1)
    expect(ontology.skillNamespace).toBe('tiny')
  })
})
