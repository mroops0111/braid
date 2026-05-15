import type { ValidationIssue } from '@telos/schema'

export class TelosError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = this.constructor.name
    this.code = code
  }
}

export class ValidationError extends TelosError {
  readonly issues?: readonly ValidationIssue[]

  constructor(message: string, issues?: readonly ValidationIssue[], options?: { cause?: unknown }) {
    super('TELOS-VAL', message, options)
    if (issues)
      this.issues = issues
  }
}

export class NotFoundError extends TelosError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('TELOS-NOT-FOUND', message, options)
  }
}

export class ConflictError extends TelosError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('TELOS-CONFLICT', message, options)
  }
}
