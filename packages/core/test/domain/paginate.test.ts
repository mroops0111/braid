import { describe, expect, it } from 'vitest'
import { paginate } from '../../src/index.js'

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5]

  it('returns the full list when no limit and no offset', () => {
    expect(paginate(items)).toEqual([1, 2, 3, 4, 5])
  })

  it('applies offset only', () => {
    expect(paginate(items, undefined, 2)).toEqual([3, 4, 5])
  })

  it('applies limit only', () => {
    expect(paginate(items, 2)).toEqual([1, 2])
  })

  it('applies offset then limit', () => {
    expect(paginate(items, 2, 1)).toEqual([2, 3])
  })

  it('returns an empty array when offset is past the end', () => {
    expect(paginate(items, 10, 99)).toEqual([])
  })
})
