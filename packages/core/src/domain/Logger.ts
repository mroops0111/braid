/**
 * Structured logging port. Each call merges `bindings` into the log record,
 * then writes `message`.
 * The shape matches pino, so the composition root can pass a pino child in.
 */
export interface Logger {
  info: (bindings: Record<string, unknown>, message: string) => void
  warn: (bindings: Record<string, unknown>, message: string) => void
  error: (bindings: Record<string, unknown>, message: string) => void
}
