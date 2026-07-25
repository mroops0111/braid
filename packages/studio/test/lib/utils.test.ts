import { describe, expect, it } from 'vitest'
import { cn } from '../../src/lib/utils'

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('px-2', 'text-sm')).toBe('px-2 text-sm')
  })

  it('drops falsy values from conditionals', () => {
    expect(cn('a', false && 'b', null, undefined, 'c')).toBe('a c')
  })

  it('flattens array inputs', () => {
    expect(cn(['a', 'b'], 'c')).toBe('a b c')
  })

  it('lets a later Tailwind class win over an earlier conflicting one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})
