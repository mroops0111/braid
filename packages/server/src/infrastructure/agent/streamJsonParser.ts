export type LineHandler = (line: string) => void

/**
 * Splits a chunked text stream into newline-delimited lines,
 * invoking the handler once per complete line.
 * Partial lines are buffered until the next chunk completes them.
 * Call `flush()` after the source closes to release any trailing line without a terminator.
 */
export class LineBuffer {
  private buffer = ''

  constructor(private readonly onLine: LineHandler) {}

  append(chunk: string): void {
    this.buffer += chunk
    let newlineIndex = this.buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex)
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line.length > 0)
        this.onLine(line)
      newlineIndex = this.buffer.indexOf('\n')
    }
  }

  flush(): void {
    if (this.buffer.length === 0)
      return
    const remainder = this.buffer
    this.buffer = ''
    this.onLine(remainder)
  }
}

export interface StreamJsonEvent {
  readonly type: string
  readonly [key: string]: unknown
}

export function parseJsonLine(line: string): StreamJsonEvent | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0)
    return undefined
  try {
    const parsed = JSON.parse(trimmed) as StreamJsonEvent
    return parsed
  }
  catch {
    return undefined
  }
}
