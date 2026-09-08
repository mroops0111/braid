import type { BaseEvent } from '@ag-ui/client'
import { EventSchemas, HttpAgent } from '@ag-ui/client'
import { getAuthToken } from '../authToken'
import { getServerUrl } from '../serverUrl'

export interface AguiTurn {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

function aguiUrl(workspaceId: string): string {
  return `${getServerUrl()}/workspaces/${encodeURIComponent(workspaceId)}/agui`
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Ask a question, as the protocol means it.
 *
 * A stock `HttpAgent` against our own endpoint, which is the point. If this
 * works, the endpoint is AG-UI rather than something shaped like it, and any
 * other client of the protocol reaches Braid the same way.
 */
export async function runViaAgui(options: {
  readonly workspaceId: string
  /** Omitted when resuming, where the server reads it off the run being continued. */
  readonly skillId?: string
  readonly threadId: string
  readonly messages: readonly AguiTurn[]
  readonly resumeSessionId?: string
  /**
   * The interrupts this run answers. The server looks up which run to continue
   * and which conversation it holds, so a caller names only what it resolved.
   */
  readonly resume?: readonly { readonly interruptId: string, readonly status: 'resolved' | 'cancelled' }[]
  readonly onEvent: (event: BaseEvent) => void
}): Promise<void> {
  // The conversation is the agent's own state, the protocol's model being
  // that the client holds the exchange and hands it over whole on every run.
  const agent = new HttpAgent({
    url: aguiUrl(options.workspaceId),
    headers: authHeaders(),
    threadId: options.threadId,
    initialMessages: options.messages.map((turn, index) => ({
      id: `${options.threadId}-${index}`,
      role: turn.role,
      content: turn.content,
    })),
  })
  await agent.runAgent(
    {
      ...(options.resume ? { resume: options.resume.map(entry => ({ ...entry })) } : {}),
      forwardedProps: {
        ...(options.skillId ? { skillId: options.skillId } : {}),
        ...(options.resumeSessionId ? { resumeSessionId: options.resumeSessionId } : {}),
      },
    },
    { onEvent: ({ event }) => options.onEvent(event) },
  )
}

/**
 * Read a run that is already under way, or already over.
 *
 * The protocol standardises the events, not an endpoint for fetching a past
 * one, so this is Braid's own route emitting the protocol's events. Every
 * event is parsed by the protocol's schemas before it is believed, so a
 * malformed frame is caught here rather than deep in a renderer.
 */
export async function readAguiRun(options: {
  readonly workspaceId: string
  readonly runId: string
  readonly threadId: string
  readonly signal: AbortSignal
  readonly onEvent: (event: BaseEvent) => void
}): Promise<void> {
  const url = `${aguiUrl(options.workspaceId)}/runs/${encodeURIComponent(options.runId)}?threadId=${encodeURIComponent(options.threadId)}`
  const response = await fetch(url, { headers: authHeaders(), signal: options.signal })
  if (!response.ok || !response.body)
    throw new Error(`${response.status} ${response.statusText}`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done)
      break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const event = parseFrame(frame)
      if (event)
        options.onEvent(event)
    }
  }
}

/** One SSE frame, believed only once the protocol's own schema accepts it. */
function parseFrame(frame: string): BaseEvent | null {
  const line = frame.split('\n').find(part => part.startsWith('data:'))
  if (!line)
    return null
  const parsed = EventSchemas.safeParse(JSON.parse(line.slice('data:'.length).trim()))
  return parsed.success ? parsed.data as BaseEvent : null
}
