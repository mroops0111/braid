import type { SkillEvent } from '@braidhq/schema'
import type { AguiTurn } from './agui/aguiTransport'
import { EventType } from '@ag-ui/client'
import { readAguiRun, runViaAgui } from './agui/aguiTransport'
import { AguiEventReader } from './agui/fromAguiEvents'

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

const NO_TURNS: readonly string[] = Object.freeze([])

/** What a graph-wide step is told, since it names no document. */
const WHOLE_GRAPH = 'Run against the whole graph.'

function turnsKey(workspaceId: string, skillId: string): string {
  return `${workspaceId}|${skillId}`
}

/**
 * Centralised, app-level state for in-flight and completed skill runs.
 *
 * It is a module-level store rather than per-component React state,
 * because a tab or skill switch unmounts the Skills page,
 * which would otherwise tear down the SSE consumer,
 * and stop appending events even though the subprocess runs server-side.
 * Hoisting state out of the React tree survives a remount.
 * The transcript picks up exactly where it left off.
 *
 * One stream per `(workspaceId, runId)`.
 * Components subscribe via `useSyncExternalStore`,
 * and the store itself owns the `fetch` lifecycle.
 */
class RunStore {
  private readonly runs = new Map<string, RunState>()
  private readonly streams = new Map<string, AbortController>()
  private readonly listeners = new Set<() => void>()
  /**
   * Per (workspaceId, skillId), the ordered run ids in the conversation.
   * A multi-turn resume appends, and "New Conversation" clears.
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

  /**
   * Which skills have a run going right now, in this workspace.
   *
   * Skill ids rather than run ids, because the reader who wants this is
   * deciding whether a surface has work under way, not which run it is. The
   * server's run list answers the same question one refetch later, and a
   * reader who has just pressed a button should not have to wait for it.
   */
  runningSkills(workspaceId: string): readonly string[] {
    const running = new Set<string>()
    for (const state of this.runs.values()) {
      if (state.workspaceId === workspaceId && state.phase === 'streaming')
        running.add(state.skillId)
    }
    return [...running].sort()
  }

  getTurns(workspaceId: string, skillId: string): readonly string[] {
    // One shared empty array, never a fresh one. A subscriber compares
    // snapshots by identity, so returning a new `[]` each call reads as a
    // change on every render and loops forever.
    return this.currentTurns.get(turnsKey(workspaceId, skillId)) ?? NO_TURNS
  }

  /**
   * Replace the current turn list for `(workspaceId, skillId)`.
   * Used when the user clicks "Continue Conversation" from the Runs tab,
   * to hydrate a past session.
   */
  setTurns(workspaceId: string, skillId: string, runIds: readonly string[]): void {
    this.currentTurns.set(turnsKey(workspaceId, skillId), [...runIds])
    this.notify()
    for (const runId of runIds) this.openStream(workspaceId, runId, skillId)
  }

  /**
   * Append a new turn id to the current conversation.
   * Called when the user submits a new turn via POST /skills/:id/run.
   */
  pushTurn(workspaceId: string, skillId: string, runId: string): void {
    const existing = this.currentTurns.get(turnsKey(workspaceId, skillId)) ?? NO_TURNS
    this.currentTurns.set(turnsKey(workspaceId, skillId), [...existing, runId])
    this.notify()
    this.openStream(workspaceId, runId, skillId)
  }

  /**
   * Reset the current conversation slot.
   * The persisted runs stay in `artifacts/runs/`,
   * only the in-memory display state for this skill is cleared.
   */
  clearTurns(workspaceId: string, skillId: string): void {
    this.currentTurns.delete(turnsKey(workspaceId, skillId))
    this.notify()
  }

  /**
   * Idempotently ensure a run is loaded into the store.
   * Used by the Runs tab to replay past runs,
   * without touching the Skills tab's current conversation slot.
   * No-op if already loaded.
   */
  loadRun(workspaceId: string, runId: string, skillId: string): void {
    this.openStream(workspaceId, runId, skillId)
  }

  /**
   * Tear down everything tied to a workspace.
   * Used when the user removes a workspace,
   * so no stale streams or display state are kept around.
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
    // Anything already in the store is already being fed. A settled run is
    // whole, and a streaming one has a live POST behind it that is not
    // registered here, so replaying either appends a second copy of every
    // event on top of the first.
    if (this.runs.has(key))
      return
    this.runs.set(key, { workspaceId, runId, skillId, events: [], phase: 'streaming' })
    const controller = new AbortController()
    this.streams.set(key, controller)
    void this.hydrate(workspaceId, runId, controller)
  }

  /**
   * Ask, in the protocol's own shape.
   *
   * The POST is the stream, so the run's id arrives inside it rather than from
   * a separate call, and this run is therefore never hydrated a second time.
   * The exchange travels with the request, because in AG-UI the client holds
   * the conversation and hands it over whole on every run.
   */
  /**
   * Run one build step against one document.
   *
   * A board action is not a conversation. Nothing was said before it and
   * nothing follows, so it carries a single message and a thread of its own,
   * keyed by the document, rather than joining whatever exchange the skill's
   * own surface happens to be holding.
   */
  async startUnit(options: {
    readonly workspaceId: string
    readonly skillId: string
    /** Empty for a step that works on the graph as a whole. */
    readonly unitPath: string
  }): Promise<void> {
    const { workspaceId, skillId, unitPath } = options
    this.currentTurns.delete(turnsKey(workspaceId, skillId))
    // A run is started by naming what it is to work on, and a graph-wide step
    // names nothing. An empty message is no message at all, so the step says
    // what it is instead, which is also what the record then reads as.
    const question = unitPath === '' ? WHOLE_GRAPH : unitPath
    await this.startTurn({ workspaceId, skillId, question, threadId: `${workspaceId}|${skillId}|${unitPath}` })
  }

  async startTurn(options: {
    readonly workspaceId: string
    readonly skillId: string
    readonly question: string
    readonly resumeSessionId?: string
    /** Overrides the per-skill thread, for a run that stands on its own. */
    readonly threadId?: string
  }): Promise<void> {
    const { workspaceId, skillId, question } = options
    const messages: AguiTurn[] = [...this.conversationFor(workspaceId, skillId), { role: 'user', content: question }]
    const reader = new AguiEventReader()
    let runId: string | null = null
    // Resolves once the run exists, not once it ends. A run takes minutes,
    // and the caller is asking whether it started, so awaiting the whole
    // stream would leave the composer disabled for the length of the answer.
    const started = Promise.withResolvers<void>()

    const streaming = runViaAgui({
      workspaceId,
      skillId,
      threadId: options.threadId ?? options.resumeSessionId ?? `${workspaceId}|${skillId}`,
      messages,
      ...(options.resumeSessionId ? { resumeSessionId: options.resumeSessionId } : {}),
      onEvent: (event) => {
        if (event.type === EventType.RUN_STARTED) {
          runId = String((event as unknown as { runId: string }).runId)
          const key = runKey(workspaceId, runId)
          // A run that carries another on opens holding that run's account, so
          // a second start arrives mid-stream. Only the first one opens a
          // slot, otherwise the account it was handed is thrown away.
          if (!this.runs.has(key))
            this.runs.set(key, { workspaceId, runId, skillId, events: [], phase: 'streaming' })
          // Claimed so a later `openStream` for the same run does not open a
          // second reader onto a stream this call is already draining.
          this.streams.set(key, new AbortController())
          const existing = this.currentTurns.get(turnsKey(workspaceId, skillId)) ?? NO_TURNS
          this.currentTurns.set(turnsKey(workspaceId, skillId), [...existing, runId])
          this.notify()
          started.resolve()
          return
        }
        if (runId === null)
          return
        for (const translated of reader.read(event))
          this.appendEvent(workspaceId, runId, translated)
        if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR)
          this.markPhase(workspaceId, runId, event.type === EventType.RUN_FINISHED ? 'done' : 'error')
      },
    })

    // The stream outlives this call, so a failure before the run exists is the
    // caller's to report and a failure after it belongs on the run itself.
    void streaming
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (runId !== null)
          this.markPhase(workspaceId, runId, 'error', message)
        started.reject(error)
      })
      .finally(() => {
        if (runId !== null)
          this.streams.delete(runKey(workspaceId, runId))
      })
    await started.promise
  }

  /**
   * Carry on the run that asked, now that its question has an answer.
   *
   * The answer is already recorded by the time this is called, so the client
   * names only the interrupt it resolved. Which run to continue, and which
   * conversation that run holds, are the server's to look up, since a caller
   * that could name them could continue a run it never answered for.
   */
  async resumeAfterAnswer(options: {
    readonly workspaceId: string
    readonly skillId: string
    readonly threadId: string
    readonly clarificationId: string
  }): Promise<void> {
    const { workspaceId, skillId, threadId, clarificationId } = options
    const reader = new AguiEventReader()
    let runId: string | null = null

    await runViaAgui({
      workspaceId,
      threadId,
      messages: [],
      resume: [{ interruptId: clarificationId, status: 'resolved' }],
      onEvent: (event) => {
        if (event.type === EventType.RUN_STARTED) {
          runId = String((event as unknown as { runId: string }).runId)
          const key = runKey(workspaceId, runId)
          // Same reason as above: the account it was handed arrives before its
          // own start, so a second start must not clear it.
          if (!this.runs.has(key))
            this.runs.set(key, { workspaceId, runId, skillId, events: [], phase: 'streaming' })
          this.notify()
          return
        }
        if (runId === null)
          return
        for (const translated of reader.read(event))
          this.appendEvent(workspaceId, runId, translated)
        if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR)
          this.markPhase(workspaceId, runId, event.type === EventType.RUN_FINISHED ? 'done' : 'error')
      },
    })
  }

  /**
   * The exchange so far, as the protocol wants it.
   *
   * An assistant turn is the run's prose joined together, which is what the
   * agent actually said. Blocks are Braid's own vocabulary and would mean
   * nothing replayed into another agent's prompt, so they stay out of it.
   */
  private conversationFor(workspaceId: string, skillId: string): AguiTurn[] {
    const turns: AguiTurn[] = []
    for (const runId of this.currentTurns.get(turnsKey(workspaceId, skillId)) ?? NO_TURNS) {
      const state = this.runs.get(runKey(workspaceId, runId))
      if (!state)
        continue
      const started = state.events.find(event => event.type === 'started')
      if (started?.type === 'started' && started.args.length > 0)
        turns.push({ role: 'user', content: started.args })
      const said = state.events.filter(event => event.type === 'message').map(event => event.text).join('\n\n')
      if (said.length > 0)
        turns.push({ role: 'assistant', content: said })
    }
    return turns
  }

  /**
   * Load a run's events, tailing only while there is something left to tail.
   *
   * A finished run is fetched in one response. Replaying history over SSE
   * would pin a connection per run, and a browser allows only a handful per
   * host, so a few opened answers were enough to stall every later request.
   */
  private async hydrate(workspaceId: string, runId: string, controller: AbortController): Promise<void> {
    const key = runKey(workspaceId, runId)
    const reader = new AguiEventReader()
    try {
      await readAguiRun({
        workspaceId,
        runId,
        threadId: runId,
        signal: controller.signal,
        onEvent: (event) => {
          for (const translated of reader.read(event))
            this.appendEvent(workspaceId, runId, translated)
        },
      })
      // The stream can close without a terminal event when the server hangs
      // up early, so a run left mid-flight is settled here rather than
      // leaving the surface waiting on something that will not arrive.
      const state = this.runs.get(key)
      if (state && state.phase === 'streaming')
        this.markPhase(workspaceId, runId, 'done')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('aborted') && !message.includes('AbortError'))
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

export const runStore = new RunStore()
