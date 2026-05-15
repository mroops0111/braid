import type { SkillEvent } from '@telos/schema'
import { api } from './api'

export type RunPhase = 'streaming' | 'done' | 'error'

export interface RunState {
  readonly workspaceId: string
  readonly runId: string
  readonly skillId: string
  readonly events: readonly SkillEvent[]
  readonly phase: RunPhase
  readonly error?: string
  readonly sessionId?: string
}

function runKey(workspaceId: string, runId: string): string {
  return `${workspaceId}|${runId}`
}

function turnsKey(workspaceId: string, skillId: string): string {
  return `${workspaceId}|${skillId}`
}

/**
 * Centralised, App-level state for in-flight + completed skill runs.
 *
 * Why a module-level store rather than per-component React state: tab and
 * skill switches unmount the Skills page, which would otherwise tear down
 * the SSE consumer and stop appending events even though the subprocess
 * keeps running server-side. Hoisting state out of the React tree means a
 * remount picks up exactly where it left off.
 *
 * One stream per `(workspaceId, runId)`. Components subscribe via
 * `useSyncExternalStore`; the store itself owns the `fetch` lifecycle.
 */
class RunStore {
  private readonly runs = new Map<string, RunState>()
  private readonly streams = new Map<string, AbortController>()
  private readonly listeners = new Set<() => void>()
  /**
   * Per (workspaceId, skillId): ordered list of run ids that make up the
   *  currently-displayed conversation. Multi-turn resume appends, "New
   *  Conversation" clears.
   */
  private readonly currentTurns = new Map<string, readonly string[]>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  getRun(workspaceId: string, runId: string): RunState | undefined {
    return this.runs.get(runKey(workspaceId, runId))
  }

  getTurns(workspaceId: string, skillId: string): readonly string[] {
    return this.currentTurns.get(turnsKey(workspaceId, skillId)) ?? []
  }

  /**
   * Replace the current turn list for `(workspaceId, skillId)`. Used when
   * the user clicks "Continue Conversation" from the Runs tab and we want
   * to hydrate a past session.
   */
  setTurns(workspaceId: string, skillId: string, runIds: readonly string[]): void {
    this.currentTurns.set(turnsKey(workspaceId, skillId), [...runIds])
    this.notify()
    for (const runId of runIds) this.openStream(workspaceId, runId, skillId)
  }

  /**
   * Append a new turn id to the current conversation. Called when the
   * user submits a new turn via POST /skills/:id/run.
   */
  pushTurn(workspaceId: string, skillId: string, runId: string): void {
    const existing = this.currentTurns.get(turnsKey(workspaceId, skillId)) ?? []
    this.currentTurns.set(turnsKey(workspaceId, skillId), [...existing, runId])
    this.notify()
    this.openStream(workspaceId, runId, skillId)
  }

  /**
   * Reset the current conversation slot. The persisted runs stay in
   * `artifacts/runs/`; only the in-memory display state for this skill is
   * cleared.
   */
  clearTurns(workspaceId: string, skillId: string): void {
    this.currentTurns.delete(turnsKey(workspaceId, skillId))
    this.notify()
  }

  /**
   * Idempotently ensure a run is loaded into the store. Used by the Runs
   * tab to replay past runs without touching the Skills tab's current
   * conversation slot. No-op if already loaded.
   */
  loadRun(workspaceId: string, runId: string, skillId: string): void {
    this.openStream(workspaceId, runId, skillId)
  }

  /**
   * Tear down everything tied to a workspace. Used when the user removes a
   * workspace; we don't keep stale streams or display state around.
   */
  resetWorkspace(workspaceId: string): void {
    for (const [key, controller] of this.streams) {
      if (key.startsWith(`${workspaceId}|`)) {
        controller.abort()
        this.streams.delete(key)
      }
    }
    for (const key of this.runs.keys()) {
      if (key.startsWith(`${workspaceId}|`))
        this.runs.delete(key)
    }
    for (const key of this.currentTurns.keys()) {
      if (key.startsWith(`${workspaceId}|`))
        this.currentTurns.delete(key)
    }
    this.notify()
  }

  private openStream(workspaceId: string, runId: string, skillId: string): void {
    const key = runKey(workspaceId, runId)
    if (this.streams.has(key))
      return
    if (!this.runs.has(key)) {
      this.runs.set(key, { workspaceId, runId, skillId, events: [], phase: 'streaming' })
    }
    const controller = new AbortController()
    this.streams.set(key, controller)
    void this.consumeStream(workspaceId, runId, controller.signal)
  }

  private async consumeStream(workspaceId: string, runId: string, signal: AbortSignal): Promise<void> {
    const key = runKey(workspaceId, runId)
    try {
      const response = await fetch(api.runEventsUrl(workspaceId, runId), { signal })
      if (!response.ok || !response.body) {
        this.markPhase(workspaceId, runId, 'error', `${response.status} ${response.statusText}`)
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done)
          break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const block of parts) {
          const event = parseSseBlock(block)
          if (event)
            this.appendEvent(workspaceId, runId, event)
        }
      }
      // If we exit the loop without an explicit `completed`/`error` event the
      // server closed the stream early — treat as done so the UI unblocks.
      const state = this.runs.get(key)
      if (state && state.phase === 'streaming')
        this.markPhase(workspaceId, runId, 'done')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('aborted'))
        return
      this.markPhase(workspaceId, runId, 'error', message)
    }
    finally {
      this.streams.delete(key)
    }
  }

  private appendEvent(workspaceId: string, runId: string, event: SkillEvent): void {
    const key = runKey(workspaceId, runId)
    const state = this.runs.get(key)
    if (!state)
      return
    const next: RunState = {
      ...state,
      events: [...state.events, event],
      ...(event.type === 'session-started' ? { sessionId: event.sessionId } : {}),
      ...(event.type === 'completed' ? { phase: 'done' as const } : {}),
      ...(event.type === 'error' ? { phase: 'error' as const, error: event.message } : {}),
    }
    this.runs.set(key, next)
    this.notify()
  }

  private markPhase(workspaceId: string, runId: string, phase: RunPhase, error?: string): void {
    const key = runKey(workspaceId, runId)
    const state = this.runs.get(key)
    if (!state)
      return
    this.runs.set(key, { ...state, phase, ...(error ? { error } : {}) })
    this.notify()
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

export const runStore = new RunStore()
