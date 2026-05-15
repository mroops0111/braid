import type { TelosProblemJson } from '@telos/schema'
import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  ConflictError,
  NotFoundError,
  TelosError,
  ValidationError,
} from '@telos/core'
import { ZodError } from 'zod'

const PROBLEM_BASE_URL = 'https://telos.dev/errors'

function statusFor(error: TelosError): number {
  if (error instanceof ValidationError)
    return 400
  if (error instanceof NotFoundError)
    return 404
  if (error instanceof ConflictError)
    return 409
  return 500
}

function problemFromTelosError(error: TelosError): TelosProblemJson {
  const problem: TelosProblemJson = {
    type: `${PROBLEM_BASE_URL}/${error.code.toLowerCase()}` as TelosProblemJson['type'],
    title: error.name,
    status: statusFor(error),
    code: error.code,
    detail: error.message,
  }
  if (error instanceof ValidationError && error.issues)
    problem.issues = [...error.issues]
  return problem
}

function problemFromZodError(error: ZodError): TelosProblemJson {
  return {
    type: `${PROBLEM_BASE_URL}/telos-val` as TelosProblemJson['type'],
    title: 'ValidationError',
    status: 400,
    code: 'TELOS-VAL',
    detail: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '),
  }
}

const PROBLEM_JSON_HEADERS = { 'Content-Type': 'application/problem+json' } as const

export const errorHandler: ErrorHandler = (error, context) => {
  if (error instanceof TelosError) {
    const problem = problemFromTelosError(error)
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
    code: 'TELOS-INTERNAL',
    detail: error instanceof Error ? error.message : 'unknown error',
  }, 500, PROBLEM_JSON_HEADERS)
}
