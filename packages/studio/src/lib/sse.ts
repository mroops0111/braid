import type { SkillEvent } from '@telos/schema'

export interface SseRunOptions {
  readonly url: string
  readonly args: string
  readonly signal?: AbortSignal
  readonly onEvent: (event: SkillEvent) => void
  readonly onError?: (error: Error) => void
}

/**
 * Streams Skill SSE events from `POST :url` and invokes `onEvent` per event.
 * Resolves when the stream closes (subprocess exits or aborted).
 */
export async function runSkillStream(options: SseRunOptions): Promise<void> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args: options.args }),
  }
  if (options.signal)
    init.signal = options.signal
  const response = await fetch(options.url, init)
  if (!response.ok || !response.body) {
    throw new Error(`Skill run failed: ${response.status} ${response.statusText}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done)
        break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const block of events) {
        const parsed = parseSseBlock(block)
        if (parsed)
          options.onEvent(parsed)
      }
    }
  }
  catch (error) {
    options.onError?.(error as Error)
  }
}

function parseSseBlock(block: string): SkillEvent | undefined {
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('data:'))
      data += line.slice(5).trimStart()
  }
  if (!data)
    return undefined
  try {
    return JSON.parse(data) as SkillEvent
  }
  catch {
    return undefined
  }
}
