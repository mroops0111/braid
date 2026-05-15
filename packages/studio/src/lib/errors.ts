import { ApiError } from './api'

export interface ErrorCase {
  match: (error: ApiError) => boolean
  message: string
}

export function humaniseApiError(error: unknown, cases: readonly ErrorCase[] = []): string {
  if (error == null)
    return ''
  if (error instanceof ApiError) {
    for (const c of cases) {
      if (c.match(error))
        return c.message
    }
    return error.message
  }
  if (error instanceof Error)
    return error.message
  return String(error)
}
