import type { SkillEvent } from '@telos/schema'

export type ToolCallEvent = Extract<SkillEvent, { type: 'tool-call' }>
export type ToolResultEvent = Extract<SkillEvent, { type: 'tool-result' }>

export interface PairedCall {
  call: ToolCallEvent
  result?: ToolResultEvent
}

export type TranscriptItem =
  | { kind: 'event', event: SkillEvent, key: string }
  | { kind: 'tool-group', calls: PairedCall[], key: string }

/**
 * Walks the raw event stream and merges consecutive tool-call / tool-result
 * events into a single TranscriptItem. Pairing is by toolCallId; a tool-result
 * whose id matches no preceding call becomes a synthetic "(unknown tool)" row.
 *
 * Any non-tool event (message / started / completed / error / artifact-written)
 * passes through as its own item, breaking the current group.
 */
export function groupTranscript(events: readonly SkillEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  let i = 0
  while (i < events.length) {
    const ev = events[i]!
    if (ev.type === 'tool-call' || ev.type === 'tool-result') {
      const startIndex = i
      const calls: PairedCall[] = []
      const byId = new Map<string, PairedCall>()
      while (i < events.length) {
        const cur = events[i]!
        if (cur.type === 'tool-call') {
          const paired: PairedCall = { call: cur }
          calls.push(paired)
          if (cur.toolCallId)
            byId.set(cur.toolCallId, paired)
          i++
        }
        else if (cur.type === 'tool-result') {
          const matched = byId.get(cur.toolCallId)
          if (matched) {
            matched.result = cur
          }
          else {
            calls.push({
              call: { type: 'tool-call', tool: '(unknown tool)', args: null, toolCallId: cur.toolCallId },
              result: cur,
            })
          }
          i++
        }
        else {
          break
        }
      }
      items.push({ kind: 'tool-group', calls, key: `g${startIndex}` })
    }
    else {
      items.push({ kind: 'event', event: ev, key: `e${i}` })
      i++
    }
  }
  return items
}
