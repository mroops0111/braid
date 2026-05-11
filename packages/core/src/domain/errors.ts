export class TelosError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = this.constructor.name
    this.code = code
  }
}

export class ValidationError extends TelosError {
  readonly issues?: unknown

  constructor(message: string, issues?: unknown, options?: { cause?: unknown }) {
    super('TELOS-VAL', message, options)
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
