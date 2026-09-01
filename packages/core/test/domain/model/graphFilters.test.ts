import type { GraphNode, NodeTypeId } from '@braidhq/schema'
import { NodeId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { applyNodeFilter } from '../../../src/domain/model/graphFilters.js'

function node(input: { id: string, name: string, description?: string }): GraphNode {
  return {
    id: NodeId.parse(input.id),
    type: 'command' as NodeTypeId,
    name: input.name,
    status: 'draft',
    metadata: { sourceReferences: [] },
    ...(input.description ? { description: input.description } : {}),
  } as GraphNode
}

describe('applyNodeFilter', () => {
  const nodes = [
    node({ id: 'a', name: 'Apply Watermark' }),
    node({ id: 'b', name: 'Seal Document', description: 'Stamps a watermark onto every page.' }),
    node({ id: 'c', name: 'Send Reminder', description: 'Emails the pending signer.' }),
  ]

  it('matches a node whose name carries the term', () => {
    expect(applyNodeFilter(nodes, { textContains: 'watermark' }).map(n => n.id)).toContain('a')
  })

  it('matches a node whose description carries the term but whose name does not', () => {
    expect(applyNodeFilter(nodes, { textContains: 'watermark' }).map(n => n.id)).toContain('b')
  })

  it('leaves out a node that carries the term in neither', () => {
    expect(applyNodeFilter(nodes, { textContains: 'watermark' }).map(n => n.id)).not.toContain('c')
  })

  it('ignores case on both sides', () => {
    expect(applyNodeFilter(nodes, { textContains: 'STAMPS' }).map(n => n.id)).toEqual(['b'])
  })

  it('tolerates a node with no description at all', () => {
    expect(() => applyNodeFilter([node({ id: 'a', name: 'Apply' })], { textContains: 'x' })).not.toThrow()
  })
})
