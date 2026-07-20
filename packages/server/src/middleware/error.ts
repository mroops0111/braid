import type { BraidProblemJson } from '@braidhq/schema'
import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  BraidError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '@braidhq/core'
import { ZodError } from 'zod'

const PROBLEM_BASE_URL = 'https://braid.dev/errors'

function statusFor(error: BraidError): number {
  if (error instanceof ValidationError)
    return 400
  if (error instanceof NotFoundError)
    return 404
  if (error instanceof ConflictError)
    return 409
  if (error instanceof ForbiddenError)
    return 403
  if (error instanceof UnauthorizedError)
    return 401
  if (error instanceof ServiceUnavailableError)
    return 503
  return 500
}

function problemFromBraidError(error: BraidError): BraidProblemJson {
  const problem: BraidProblemJson = {
    type: `${PROBLEM_BASE_URL}/${error.code.toLowerCase()}` as BraidProblemJson['type'],
    title: error.name,
    status: statusFor(error),
    code: error.code,
    detail: error.message,
  }
  if (error instanceof ValidationError && error.issues)
    problem.issues = [...error.issues]
  return problem
}

function problemFromZodError(error: ZodError): BraidProblemJson {
  return {
    type: `${PROBLEM_BASE_URL}/braid-val` as BraidProblemJson['type'],
    title: 'ValidationError',
    status: 400,
    code: 'BRAID-VALIDATION',
    detail: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '),
  }
}

const PROBLEM_JSON_HEADERS = { 'Content-Type': 'application/problem+json' } as const

export const errorHandler: ErrorHandler = (error, context) => {
  if (error instanceof BraidError) {
    const problem = problemFromBraidError(error)
    return context.json(problem, problem.status as ContentfulStatusCode, PROBLEM_JSON_HEADERS)
  }

  if (error instanceof ZodError) {
    const problem = problemFromZodError(error)
    return context.json(problem, problem.status as ContentfulStatusCode, PROBLEM_JSON_HEADERS)
  }

  return context.json({
    type: `${PROBLEM_BASE_URL}/internal`,
    title: 'InternalError',
    status: 500,
    code: 'BRAID-INTERNAL',
    detail: error instanceof Error ? error.message : 'unknown error',
  }, 500, PROBLEM_JSON_HEADERS)
}
