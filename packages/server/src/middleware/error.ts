import type { BraidErrorCode, BraidProblemJson } from '@braidhq/schema'
import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { BraidError, ValidationError } from '@braidhq/core'
import { ZodError } from 'zod'

const PROBLEM_BASE_URL = 'https://braid.dev/errors'

// The HTTP status per error code, keyed by the closed BraidErrorCode enum,
// so a new code fails to compile until it is mapped here.
const STATUS_BY_CODE: Record<BraidErrorCode, number> = {
  'BRAID-VALIDATION': 400,
  'BRAID-UNAUTHORIZED': 401,
  'BRAID-NOT-FOUND': 404,
  'BRAID-CONFLICT': 409,
  'BRAID-FORBIDDEN': 403,
  'BRAID-UNAVAILABLE': 503,
  'BRAID-INTERNAL': 500,
}

function problemFromBraidError(error: BraidError): BraidProblemJson {
  const problem: BraidProblemJson = {
    type: `${PROBLEM_BASE_URL}/${error.code.toLowerCase()}` as BraidProblemJson['type'],
    title: error.name,
    status: STATUS_BY_CODE[error.code],
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
