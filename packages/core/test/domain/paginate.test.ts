import { describe, expect, it } from 'vitest'
import { paginate } from '../../src/index.js'

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5]

  it('returns the full list when neither limit nor offset is provided', () => {
    expect(paginate(items)).toEqual([1, 2, 3, 4, 5])
  })

  it('returns the tail starting at offset when only offset is provided', () => {
    expect(paginate(items, undefined, 2)).toEqual([3, 4, 5])
  })

  it('returns the first `limit` items when only limit is provided', () => {
    expect(paginate(items, 2)).toEqual([1, 2])
  })

  it('returns at most `limit` items starting at offset', () => {
    expect(paginate(items, 2, 1)).toEqual([2, 3])
  })

  it('returns an empty array when offset is past the end', () => {
    expect(paginate(items, 10, 99)).toEqual([])
  })

  it('returns an empty array when limit is 0', () => {
    expect(paginate(items, 0)).toEqual([])
    expect(paginate(items, 0, 2)).toEqual([])
  })

  it('returns the last items when offset is negative (Array.slice semantics)', () => {
    // Pinned behavior: paginate delegates to Array.prototype.slice, so a
    // negative offset counts from the end. Production routes filter to
    // non-negative via zod, but the helper itself trusts its input.
    expect(paginate(items, undefined, -2)).toEqual([4, 5])
  })

  it('treats a negative limit as a "drop last N" via Array.slice semantics', () => {
    // Pinned behavior: end becomes (offset + limit) which is below offset,
    // so slice(start, negative-end) treats end as `length + end`. Production
    // routes filter to non-negative via zod; this just documents reality.
    expect(paginate(items, -3, 1)).toEqual([2, 3])
  })

  it('treats limit larger than length as "no upper bound"', () => {
    expect(paginate(items, 99, 2)).toEqual([3, 4, 5])
  })
})
