import { describe, expect, it } from 'vitest'
import {
  EdgeCardinality,
  EdgeTypeDescriptor,
  EdgeTypeId,
  NodeStatus,
  NodeTypeDescriptor,
  NodeTypeId,
  OntologyResponse,
} from '../src/index.js'

describe('Node status', () => {
  it('has 4 states matching ReDoc', () => {
    expect(NodeStatus.options).toEqual(['draft', 'completed', 'unclear', 'deprecated'])
  })
  it('rejects unknown status', () => {
    expect(NodeStatus.safeParse('approved').success).toBe(false)
  })
})

describe('NodeTypeId / EdgeTypeId (open at runtime — concrete sets live in ontology plugins)', () => {
  it('NodeTypeId accepts any non-empty string', () => {
    expect(NodeTypeId.parse('boundedContext')).toBe('boundedContext')
    expect(NodeTypeId.parse('myCustomNodeType')).toBe('myCustomNodeType')
  })
  it('EdgeTypeId accepts any non-empty string', () => {
    expect(EdgeTypeId.parse('contains')).toBe('contains')
    expect(EdgeTypeId.parse('myCustomEdgeType')).toBe('myCustomEdgeType')
  })
  it('rejects empty', () => {
    expect(NodeTypeId.safeParse('').success).toBe(false)
    expect(EdgeTypeId.safeParse('').success).toBe(false)
  })
})

describe('EdgeCardinality', () => {
  it('has the four multiplicities', () => {
    expect(EdgeCardinality.options).toEqual(['1:1', '1:N', 'N:1', 'N:N'])
  })
})

describe('NodeTypeDescriptor', () => {
  it('parses id plus label and carries a render hint', () => {
    const d = NodeTypeDescriptor.parse({ id: 'boundedContext', label: 'Bounded Context', renderHint: { container: true, section: 'core' } })
    expect(d.renderHint?.container).toBe(true)
  })
  it('rejects an empty label', () => {
    expect(NodeTypeDescriptor.safeParse({ id: 'x', label: '' }).success).toBe(false)
  })
  it('rejects a label past 40 chars', () => {
    expect(NodeTypeDescriptor.safeParse({ id: 'x', label: 'a'.repeat(41) }).success).toBe(false)
  })
})

describe('EdgeTypeDescriptor', () => {
  it('parses with from and to type lists plus cardinality', () => {
    const d = EdgeTypeDescriptor.parse({ id: 'contains', label: 'Contains', fromTypes: ['a'], toTypes: ['b'], cardinality: '1:N' })
    expect(d.cardinality).toBe('1:N')
  })
  it('rejects a label past 40 chars', () => {
    expect(EdgeTypeDescriptor.safeParse({ id: 'x', label: 'a'.repeat(41), fromTypes: [], toTypes: [] }).success).toBe(false)
  })
})

describe('OntologyResponse', () => {
  it('preserves the author order of node types', () => {
    const res = OntologyResponse.parse({
      ontologyId: 'ddd',
      nodeTypes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edgeTypes: [],
    })
    expect(res.nodeTypes.map(t => t.id)).toEqual(['a', 'b'])
  })
})
