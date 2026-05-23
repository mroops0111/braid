import { describe, expect, it } from 'vitest'
import { optional } from '@/lib/optional'

describe('optional', () => {
  it('strips undefined keys', () => {
    expect(optional({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' })
  })

  it('keeps falsy values that are not undefined', () => {
    expect(optional({ a: 0, b: '', c: false, d: null, e: undefined })).toEqual({
      a: 0,
      b: '',
      c: false,
      d: null,
    })
  })

  it('returns an empty object for an all-undefined input', () => {
    expect(optional({ a: undefined, b: undefined })).toEqual({})
  })

  it('returns a new object (does not mutate the input)', () => {
    const input = { a: 1, b: undefined }
    const out = optional(input)
    expect(out).not.toBe(input)
    expect(input).toEqual({ a: 1, b: undefined })
  })
})
