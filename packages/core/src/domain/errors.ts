import type { BraidErrorCode, ValidationIssue } from '@braidhq/schema'

export class BraidError extends Error {
  readonly code: BraidErrorCode

  constructor(code: BraidErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = this.constructor.name
    this.code = code
  }
}

export class ValidationError extends BraidError {
  readonly issues?: readonly ValidationIssue[]

  constructor(message: string, issues?: readonly ValidationIssue[], options?: { cause?: unknown }) {
    super('BRAID-VALIDATION', message, options)
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

export class ForbiddenError extends BraidError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('BRAID-FORBIDDEN', message, options)
  }
}

export class UnauthorizedError extends BraidError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('BRAID-UNAUTHORIZED', message, options)
  }
}

export class ServiceUnavailableError extends BraidError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('BRAID-UNAVAILABLE', message, options)
  }
}
