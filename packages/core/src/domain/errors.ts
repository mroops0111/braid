import type { ValidationIssue } from '@braidhq/schema'

export class BraidError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = this.constructor.name
    this.code = code
  }
}

export class ValidationError extends BraidError {
  readonly issues?: readonly ValidationIssue[]

  constructor(message: string, issues?: readonly ValidationIssue[], options?: { cause?: unknown }) {
    super('BRAID-VAL', message, options)
    if (issues)
      this.issues = issues
  }
}

export class NotFoundError extends BraidError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('BRAID-NOT-FOUND', message, options)
  }
}

export class ConflictError extends BraidError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('BRAID-CONFLICT', message, options)
  }
}
