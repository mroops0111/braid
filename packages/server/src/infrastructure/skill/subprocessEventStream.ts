import type { SkillEvent } from '@braidhq/schema'
import type { ChildProcess } from 'node:child_process'
import { SkillEvent as SkillEventSchema } from '@braidhq/schema'
import { LineBuffer } from './lineBuffer.js'

/**
 * Maps one stdout line to zero or more SkillEvents.
 * The agent binding owns this, since the line format is the agent's own.
 */
export type LineParser = (line: string, now: string) => SkillEvent[]

/**
 * Wires a child's stdout and stderr to a single SkillEvent callback.
 * `parseLine` comes from the agent binding, so this stays format-agnostic.
 * Returns `flush` so callers can drain the final un-terminated line on `close`.
 */
export function attachOutputBuffers(
  child: ChildProcess,
  parseLine: LineParser,
  onEvent: (event: SkillEvent) => void,
  now: () => string,
): { flush: () => void } {
  const stdout = new LineBuffer((line) => {
    for (const event of parseLine(line, now()))
      onEvent(event)
  })
  // stderr is wrapped verbatim into a `[stderr]` message event,
  // so it shows up in the transcript alongside model output.
  const stderr = new LineBuffer((line) => {
    onEvent(SkillEventSchema.parse({ type: 'message', text: `[stderr] ${line}` }))
  })

  child.stdout?.setEncoding('utf-8')
  child.stdout?.on('data', (chunk: string) => stdout.append(chunk))
  child.stderr?.setEncoding('utf-8')
  child.stderr?.on('data', (chunk: string) => stderr.append(chunk))

  return {
    flush: () => {
      stdout.flush()
      stderr.flush()
    },
  }
}
