import type {
  AgentBinding,
  RunRepository,
  SkillEventListener,
  SkillRegistry,
  SkillRunner,
  SkillRunOptions,
  SkillRunSubscription,
  Workspace,
} from '@telos/core'
import type { AbsolutePath, RunRecord, SkillEvent, SkillId, SkillRunId } from '@telos/schema'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { mkdir, rm, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { newSkillRunId, NotFoundError } from '@telos/core'
import { SkillEvent as SkillEventSchema, SkillRunId as SkillRunIdSchema } from '@telos/schema'
import { sessionDirPath } from '../fs/paths.js'
import { createAsyncQueue } from './asyncQueue.js'
import { writeMcpConfigFile } from './mcpConfig.js'
import { LineBuffer, parseJsonLine } from './streamJsonParser.js'

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

/**
 * Additional directories to expose under the session's `.claude/skills/`
 * tree. Typically used for non-skill reference content (e.g. `shared/`
 * that builtin SKILL.md files reference via `.claude/skills/shared/...`).
 */
export interface SkillReferenceDir {
  readonly name: string
  readonly path: AbsolutePath
}

export interface SubprocessSkillRunnerDeps {
  readonly skillRegistry: SkillRegistry
  readonly agentBinding: AgentBinding
  readonly apiUrl: string
  /** Required: runs persist their event log here as the source of truth for replays. */
  readonly runRepository: RunRepository
  readonly spawn?: SpawnFn
  readonly clock?: () => string
  /** Extra directories symlinked alongside skills (e.g. shared reference docs). */
  readonly referenceDirs?: readonly SkillReferenceDir[]
  /** Delete the per-run session directory after the run. Default `true`. */
  readonly cleanupSession?: boolean
}

interface ActiveRun {
  readonly workspace: Workspace
  readonly child: ChildProcess
}

/**
 * Spawns a claude subprocess per run and tees its event stream to:
 *   1. The persisted JSONL log via `RunRepository.appendEvent`.
 *   2. In-memory subscribers (HTTP /runs/:id/events tailers, tests).
 *
 * The HTTP client connection is decoupled from the subprocess lifecycle:
 * `start()` returns the runId immediately, the drain runs as a background
 * task, and the event stream survives any number of client reconnects.
 */
export class SubprocessSkillRunner implements SkillRunner {
  private readonly running = new Map<SkillRunId, ActiveRun>()
  /** sessionId → cwd for resuming. claude needs the same cwd between turns. */
  private readonly sessionDirs = new Map<string, string>()
  private readonly subscribers = new Map<SkillRunId, Set<SkillEventListener>>()
  /** How many events have been emitted (and persisted) per run so far. */
  private readonly positions = new Map<SkillRunId, number>()

  constructor(private readonly deps: SubprocessSkillRunnerDeps) {}

  async start(
    workspace: Workspace,
    skillId: SkillId,
    args: string,
    options?: SkillRunOptions,
  ): Promise<SkillRunId> {
    const manifest = await this.deps.skillRegistry.get(workspace, skillId)
    const runId = newSkillRunId()
    const sessionDir = await this.resolveSessionDir(workspace, runId, options?.resumeSessionId)
    const mcpConfigFile = await writeMcpConfigFile(workspace, sessionDir)
    const invocation = this.deps.agentBinding.resolveSpawn({
      skillId,
      args,
      workspace,
      manifest,
      apiUrl: this.deps.apiUrl,
      mcpConfigFile: mcpConfigFile as unknown as AbsolutePath,
      ...(options?.resumeSessionId ? { resumeSessionId: options.resumeSessionId } : {}),
    })

    const spawnFn = this.deps.spawn ?? (await defaultSpawn())
    // TELOS_SESSION_DIR resolves ambiguity in SKILL.md paths: claude sees
    // both `TELOS_WORKSPACE` and a cwd that lives inside it, and would
    // otherwise guess wrong about which one `.claude/skills/...` is rooted in.
    const child = spawnFn(invocation.bin, [...invocation.args], {
      cwd: sessionDir,
      env: { ...invocation.env, TELOS_SESSION_DIR: sessionDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.running.set(runId, { workspace, child })

    // Persist the started record up front so listing endpoints see the run
    // immediately, even before any subprocess output.
    const startedAt = this.now()
    const initialRecord: RunRecord = {
      runId,
      workspaceId: workspace.id,
      skillId,
      args,
      resumed: options?.resumeSessionId !== undefined,
      startedAt,
      ...(options?.resumeSessionId ? { sessionId: options.resumeSessionId } : {}),
    }
    await this.deps.runRepository.saveRecord(workspace, initialRecord)

    // Fire-and-forget the drain so the HTTP request that called start()
    // can return immediately.
    void this.drain({
      workspace,
      runId,
      child,
      skillId,
      args,
      sessionDir,
      resumeSessionId: options?.resumeSessionId,
      startedAt,
      initialRecord,
    })

    return runId
  }

  subscribe(runId: SkillRunId, listener: SkillEventListener): SkillRunSubscription {
    const set = this.subscribers.get(runId) ?? new Set<SkillEventListener>()
    set.add(listener)
    this.subscribers.set(runId, set)
    return {
      unsubscribe: () => {
        set.delete(listener)
        if (set.size === 0)
          this.subscribers.delete(runId)
      },
      positionAtSubscribe: this.positions.get(runId) ?? 0,
    }
  }

  isActive(runId: SkillRunId): boolean {
    return this.running.has(runId)
  }

  async cancel(runId: SkillRunId): Promise<void> {
    const validated = SkillRunIdSchema.parse(runId)
    const active = this.running.get(validated)
    if (!active)
      throw new NotFoundError(`SkillRun "${validated}" not active`)
    active.child.kill('SIGTERM')
  }

  async forgetSession(sessionId: string): Promise<void> {
    const dir = this.sessionDirs.get(sessionId)
    if (!dir)
      return
    this.sessionDirs.delete(sessionId)
    if (this.deps.cleanupSession !== false)
      await rm(dir, { recursive: true, force: true })
  }

  private async drain(input: {
    workspace: Workspace
    runId: SkillRunId
    child: ChildProcess
    skillId: SkillId
    args: string
    sessionDir: string
    resumeSessionId: string | undefined
    startedAt: string
    initialRecord: RunRecord
  }): Promise<void> {
    let record = input.initialRecord
    let capturedSessionId: string | null = input.resumeSessionId ?? null

    try {
      await this.emit(input.workspace, input.runId, SkillEventSchema.parse({
        type: 'started',
        runId: input.runId,
        skillId: input.skillId,
        args: input.args,
        resumed: input.resumeSessionId !== undefined,
        at: input.startedAt,
      }))

      const queue = createAsyncQueue<SkillEvent>()
      const buffers = attachOutputBuffers(input.child, queue.push, () => this.now())

      input.child.on('close', (code) => {
        buffers.flush()
        queue.push(SkillEventSchema.parse({
          type: 'completed',
          runId: input.runId,
          exitCode: code ?? 0,
          at: this.now(),
        }))
        queue.end()
      })

      for await (const event of queue.iterate()) {
        if (event.type === 'session-started') {
          capturedSessionId = event.sessionId
          this.sessionDirs.set(event.sessionId, input.sessionDir)
          record = { ...record, sessionId: event.sessionId }
          await this.deps.runRepository.saveRecord(input.workspace, record)
        }
        if (event.type === 'completed') {
          record = { ...record, completedAt: event.at, exitCode: event.exitCode }
          await this.deps.runRepository.saveRecord(input.workspace, record)
        }
        await this.emit(input.workspace, input.runId, event)
      }
    }
    finally {
      this.running.delete(input.runId)
      // Drop subscribers once the run is fully drained so they can finish their
      // own loops (e.g. SSE writers waiting on iteration end).
      this.subscribers.delete(input.runId)
      // Keep the session dir on disk if a session id was captured: claude
      // stores conversation state per-cwd, so the dir must survive between
      // turns. The dir is GC'd when the user starts a New Conversation via
      // `forgetSession(sessionId)`.
      const keepForResume = capturedSessionId !== null
      if (this.deps.cleanupSession !== false && !keepForResume) {
        await rm(input.sessionDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  /**
   * Persist the event to JSONL, then broadcast to live subscribers.
   * Persistence happens first so a subscriber that arrived just before this
   * emit is guaranteed to receive an event whose `position` is strictly
   * greater than `positionAtSubscribe`.
   */
  private async emit(workspace: Workspace, runId: SkillRunId, event: SkillEvent): Promise<void> {
    await this.deps.runRepository.appendEvent(workspace, runId, event)
    const next = (this.positions.get(runId) ?? 0) + 1
    this.positions.set(runId, next)
    const listeners = this.subscribers.get(runId)
    if (!listeners)
      return
    for (const listener of listeners) {
      try {
        listener(event)
      }
      catch {
        // A buggy listener mustn't break delivery to others.
      }
    }
  }

  private async resolveSessionDir(
    workspace: Workspace,
    runId: SkillRunId,
    resumeSessionId: string | undefined,
  ): Promise<string> {
    if (resumeSessionId) {
      const cached = this.sessionDirs.get(resumeSessionId)
      if (cached)
        return cached
      const recovered = await this.recoverSessionDir(workspace, resumeSessionId)
      if (recovered) {
        this.sessionDirs.set(resumeSessionId, recovered)
        return recovered
      }
    }
    return this.buildSessionDir(workspace, runId)
  }

  private async recoverSessionDir(workspace: Workspace, sessionId: string): Promise<string | undefined> {
    const records = await this.deps.runRepository.listRecords(workspace)
    const first = records
      .filter(r => r.sessionId === sessionId && !r.resumed)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0]
    return first ? sessionDirPath(workspace.rootPath, first.runId) : undefined
  }

  private async buildSessionDir(workspace: Workspace, runId: SkillRunId): Promise<string> {
    const sessionDir = sessionDirPath(workspace.rootPath, runId)
    const skillsDir = join(sessionDir, '.claude', 'skills')
    await mkdir(skillsDir, { recursive: true })

    const manifests = await this.deps.skillRegistry.list(workspace)
    const linked = new Set<string>()
    for (const manifest of manifests) {
      const slashName = manifest.frontmatter.name
      if (linked.has(slashName))
        continue
      linked.add(slashName)
      await symlink(dirname(manifest.path), join(skillsDir, slashName), 'dir')
    }

    for (const reference of this.deps.referenceDirs ?? []) {
      if (linked.has(reference.name))
        continue
      linked.add(reference.name)
      await symlink(reference.path, join(skillsDir, reference.name), 'dir')
    }

    return sessionDir
  }

  private now(): string {
    return (this.deps.clock ?? (() => new Date().toISOString()))()
  }
}

/**
 * Wires a spawned child's stdout / stderr into a callback that receives one
 * mapped SkillEvent per emitted line. stdout is parsed as JSON (claude
 * stream-json); stderr is wrapped verbatim into a `[stderr]` message event
 * so it shows up in the transcript alongside model output.
 *
 * Returns a `flush` you call from the child's `close` handler so the last
 * line without a trailing newline still reaches the consumer.
 */
function attachOutputBuffers(
  child: ChildProcess,
  onEvent: (event: SkillEvent) => void,
  now: () => string,
): { flush: () => void } {
  const stdout = new LineBuffer((line) => {
    const parsed = parseJsonLine(line)
    if (parsed === undefined)
      return
    for (const event of mapSubprocessEvents(parsed, now()))
      onEvent(event)
  })
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

interface RawEvent { readonly type: string, readonly [key: string]: unknown }
interface RawContentPart { readonly type?: string, readonly [key: string]: unknown }

/**
 * Maps a single line of `claude --output-format stream-json` into zero or
 * more `SkillEvent`s. Claude emits five envelope shapes:
 *
 *   - `type=system`         → startup/init meta. Ignored.
 *   - `type=assistant`      → `message.content[]` of text / tool_use / thinking.
 *   - `type=user`           → echoed tool_result; we only surface `is_error`.
 *   - `type=rate_limit_*`   → informational. Ignored.
 *   - `type=result`         → final outcome (`is_error` + `result` string).
 *
 * Plus the legacy flat shapes used by older tests: `type=text`, `type=tool_use`,
 * `type=artifact-written`, `type=error`. Kept for backward compatibility.
 */
export function mapSubprocessEvents(raw: RawEvent, now: string): SkillEvent[] {
  const out: SkillEvent[] = []

  if (raw.type === 'system' && raw.subtype === 'init' && typeof raw.session_id === 'string') {
    out.push(SkillEventSchema.parse({ type: 'session-started', sessionId: raw.session_id }))
    return out
  }

  if (raw.type === 'assistant') {
    const content = readContent(raw)
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
        out.push(SkillEventSchema.parse({ type: 'message', text: part.text }))
      }
      else if (part?.type === 'tool_use' && typeof part.name === 'string') {
        const event: Record<string, unknown> = {
          type: 'tool-call',
          tool: part.name,
          args: part.input ?? null,
        }
        if (typeof part.id === 'string' && part.id.length > 0)
          event.toolCallId = part.id
        out.push(SkillEventSchema.parse(event))
      }
    }
    return out
  }

  if (raw.type === 'user') {
    const content = readContent(raw)
    for (const part of content) {
      if (part?.type === 'tool_result' && typeof part.tool_use_id === 'string') {
        const output = typeof part.content === 'string'
          ? part.content
          : JSON.stringify(part.content ?? '')
        out.push(SkillEventSchema.parse({
          type: 'tool-result',
          toolCallId: part.tool_use_id,
          output,
          isError: part.is_error === true,
        }))
      }
    }
    return out
  }

  if (raw.type === 'result') {
    const isError = raw.is_error === true
    const text = typeof raw.result === 'string' ? raw.result : ''
    if (isError) {
      out.push(SkillEventSchema.parse({ type: 'error', message: text || 'skill run failed', at: now }))
    }
    else if (text.length > 0) {
      out.push(SkillEventSchema.parse({ type: 'message', text }))
    }
    return out
  }

  // Legacy / flat fixtures (kept for tests and any tool that emits a simpler shape).
  if (raw.type === 'text' && typeof raw.text === 'string') {
    return [SkillEventSchema.parse({ type: 'message', text: raw.text })]
  }
  if (raw.type === 'tool_use' && typeof raw.name === 'string') {
    return [SkillEventSchema.parse({ type: 'tool-call', tool: raw.name, args: raw.input ?? null })]
  }
  if (raw.type === 'artifact-written' && typeof raw.artifactKind === 'string') {
    return [SkillEventSchema.parse({
      type: 'artifact-written',
      artifactKind: raw.artifactKind,
      artifactId: raw.artifactId,
      path: raw.path,
    })]
  }
  if (raw.type === 'error' && typeof raw.message === 'string') {
    return [SkillEventSchema.parse({ type: 'error', message: raw.message, at: now })]
  }

  return out
}

function readContent(raw: RawEvent): RawContentPart[] {
  const message = raw.message as { content?: unknown } | undefined
  if (!message || !Array.isArray(message.content))
    return []
  return message.content as RawContentPart[]
}

async function defaultSpawn(): Promise<SpawnFn> {
  const mod = await import('node:child_process')
  return (command, args, options) => mod.spawn(command, [...args], options)
}
