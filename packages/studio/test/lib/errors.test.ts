import { describe, expect, it } from 'vitest'
import { ApiError } from '../../src/lib/api'
import { type ErrorCase, humaniseApiError } from '../../src/lib/errors'

describe('humaniseApiError', () => {
  it('returns an empty string for null / undefined', () => {
    expect(humaniseApiError(null)).toBe('')
    expect(humaniseApiError(undefined)).toBe('')
  })

  it('falls through to ApiError.message when no case matches', () => {
    expect(humaniseApiError(new ApiError('boom', 500))).toBe('boom')
  })

  it('returns the first matching case message and stops scanning', () => {
    const cases: readonly ErrorCase[] = [
      { match: e => e.status === 404, message: 'not found' },
      { match: e => e.status === 500, message: 'server bad' },
    ]

    expect(humaniseApiError(new ApiError('original', 404), cases)).toBe('not found')
    expect(humaniseApiError(new ApiError('original', 500), cases)).toBe('server bad')
  })

  it('returns the case message even when the ApiError itself has an empty message', () => {
    const cases: readonly ErrorCase[] = [
      { match: e => e.status === 404, message: 'not found' },
    ]

    expect(humaniseApiError(new ApiError('', 404), cases)).toBe('not found')
  })

  it('does not apply cases to plain Error instances; returns their message verbatim', () => {
    const cases: readonly ErrorCase[] = [
      { match: () => true, message: 'should not appear' },
    ]

    expect(humaniseApiError(new Error('plain'), cases)).toBe('plain')
  })

  it('returns the empty Error.message verbatim (preserves empty)', () => {
    // eslint-disable-next-line unicorn/error-message -- empty message is the value under test
    const empty = new Error('')
    expect(humaniseApiError(empty)).toBe('')
  })

  it('stringifies non-Error inputs', () => {
    expect(humaniseApiError('boom')).toBe('boom')
    expect(humaniseApiError(42)).toBe('42')
  })

  it('stringifies plain object errors via Object.prototype.toString', () => {
    // fetch error shapes occasionally come through as plain { code, detail }
    // objects (non-Error). We don't pretty-print these — at least the type
    // tag is visible so users see "not just empty string".
    expect(humaniseApiError({ code: 'X', detail: 'oops' })).toBe('[object Object]')
  })
})
