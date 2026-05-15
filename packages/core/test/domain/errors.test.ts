import type { ValidationIssue } from '@telos/schema'
import { ValidationCode } from '@telos/schema'
import { describe, expect, it } from 'vitest'
import {
  ConflictError,
  NotFoundError,
  TelosError,
  ValidationError,
} from '../../src/index.js'

describe('TelosError base', () => {
  it('carries code + message + name', () => {
    const error = new TelosError('TELOS-X', 'something broke')
    expect(error.code).toBe('TELOS-X')
    expect(error.message).toBe('something broke')
    expect(error.name).toBe('TelosError')
    expect(error).toBeInstanceOf(Error)
  })

  it('preserves cause via standard Error options', () => {
    const cause = new Error('underlying')
    const error = new TelosError('TELOS-X', 'wrapped', { cause })
    expect(error.cause).toBe(cause)
  })
})

describe('ValidationError', () => {
  it('uses TELOS-VAL code and reports issues', () => {
    const issues: ValidationIssue[] = [
      { code: ValidationCode.parse('x-required'), severity: 'error', message: 'x is required' },
    ]
    const error = new ValidationError('bad input', issues)
    expect(error.code).toBe('TELOS-VAL')
    expect(error.name).toBe('ValidationError')
    expect(error.issues).toEqual(issues)
    expect(error).toBeInstanceOf(TelosError)
  })

  it('omits issues when none are supplied', () => {
    const error = new ValidationError('bad input')
    expect(error.issues).toBeUndefined()
  })
})

describe('NotFoundError', () => {
  it('uses TELOS-NOT-FOUND code', () => {
    const error = new NotFoundError('Node 123 not found')
    expect(error.code).toBe('TELOS-NOT-FOUND')
    expect(error.name).toBe('NotFoundError')
  })
})

describe('ConflictError', () => {
  it('uses TELOS-CONFLICT code', () => {
    const error = new ConflictError('duplicate id')
    expect(error.code).toBe('TELOS-CONFLICT')
    expect(error.name).toBe('ConflictError')
  })
})
