import { describe, expect, it } from 'vitest'
import { cosineSimilarity, fuseByRank } from '../../src/application/vectorSearch.js'

describe('cosineSimilarity', () => {
  it('scores an identical direction at one', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
  })

  it('scores an opposite direction at minus one', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('ignores magnitude, since only direction carries meaning', () => {
    expect(cosineSimilarity([1, 1], [10, 10])).toBeCloseTo(1)
  })

  it('returns zero for a vector with no magnitude, rather than dividing by zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('fuseByRank', () => {
  const identify = (item: string): string => item

  it('ranks an item found by both lists above one found by a single list', () => {
    const lexical = ['a', 'b', 'c']
    const semantic = ['c', 'd', 'e']
    expect(fuseByRank([lexical, semantic], identify)[0]).toBe('c')
  })

  it('keeps every item from every list, since either retriever may be the right one', () => {
    const fused = fuseByRank([['a'], ['b']], identify)
    expect(fused.sort()).toEqual(['a', 'b'])
  })

  it('prefers the earlier rank when only one list found each item', () => {
    expect(fuseByRank([['a', 'b']], identify)).toEqual(['a', 'b'])
  })

  it('returns nothing for no lists', () => {
    expect(fuseByRank([], identify)).toEqual([])
  })
})
