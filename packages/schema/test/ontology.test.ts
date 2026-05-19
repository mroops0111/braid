import { describe, expect, it } from 'vitest'
import { EdgeTypeId, NodeStatus, NodeTypeId } from '../src/index.js'

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
