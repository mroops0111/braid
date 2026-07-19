import type { ValidationIssue } from '@braidhq/schema'
import { ValidationCode } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import {
  BraidError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../src/index.js'

describe('BraidError base', () => {
  it('carries code + message + name', () => {
    const error = new BraidError('BRAID-INTERNAL', 'something broke')
    expect(error.code).toBe('BRAID-INTERNAL')
    expect(error.message).toBe('something broke')
    expect(error.name).toBe('BraidError')
    expect(error).toBeInstanceOf(Error)
  })

  it('preserves cause via standard Error options', () => {
    const cause = new Error('underlying')
    const error = new BraidError('BRAID-INTERNAL', 'wrapped', { cause })
    expect(error.cause).toBe(cause)
  })
})

describe('ValidationError', () => {
  it('uses BRAID-VALIDATION code and reports issues', () => {
    const issues: ValidationIssue[] = [
      { code: ValidationCode.parse('x-required'), severity: 'error', message: 'x is required' },
    ]
    const error = new ValidationError('bad input', issues)
    expect(error.code).toBe('BRAID-VALIDATION')
    expect(error.name).toBe('ValidationError')
    expect(error.issues).toEqual(issues)
    expect(error).toBeInstanceOf(BraidError)
  })

  it('omits issues when none are supplied', () => {
    const error = new ValidationError('bad input')
    expect(error.issues).toBeUndefined()
  })
})

describe('NotFoundError', () => {
  it('uses BRAID-NOT-FOUND code', () => {
    const error = new NotFoundError('Node 123 not found')
    expect(error.code).toBe('BRAID-NOT-FOUND')
    expect(error.name).toBe('NotFoundError')
  })
})

describe('ConflictError', () => {
  it('uses BRAID-CONFLICT code', () => {
    const error = new ConflictError('duplicate id')
    expect(error.code).toBe('BRAID-CONFLICT')
    expect(error.name).toBe('ConflictError')
  })
})

describe('ForbiddenError', () => {
  it('uses BRAID-FORBIDDEN code', () => {
    const error = new ForbiddenError('You can only update your own profile.')
    expect(error.code).toBe('BRAID-FORBIDDEN')
    expect(error.name).toBe('ForbiddenError')
    expect(error).toBeInstanceOf(BraidError)
  })
})
