import { describe, expect, it } from 'vitest'
import { ApiError } from '../../src/lib/api'
import { type ErrorCase, humaniseApiError } from '../../src/lib/errors'

describe('humaniseApiError', () => {
  it('returns empty string for null / undefined', () => {
    expect(humaniseApiError(null)).toBe('')
    expect(humaniseApiError(undefined)).toBe('')
  })

  it('falls through to ApiError.message when no case matches', () => {
    const error = new ApiError('boom', 500)
    expect(humaniseApiError(error)).toBe('boom')
  })

  it('returns the first matching case message', () => {
    const cases: readonly ErrorCase[] = [
      { match: e => e.status === 404, message: 'not found' },
      { match: e => e.status === 500, message: 'server bad' },
    ]
    expect(humaniseApiError(new ApiError('original', 404), cases)).toBe('not found')
    expect(humaniseApiError(new ApiError('original', 500), cases)).toBe('server bad')
  })

  it('ignores non-ApiError when matching cases', () => {
    const cases: readonly ErrorCase[] = [
      { match: () => true, message: 'should not be used' },
    ]
    expect(humaniseApiError(new Error('plain'), cases)).toBe('plain')
  })

  it('stringifies unknown errors', () => {
    expect(humaniseApiError('boom')).toBe('boom')
    expect(humaniseApiError(42)).toBe('42')
  })
})
