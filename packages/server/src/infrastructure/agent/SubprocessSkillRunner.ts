import type {
  AgentBinding,
  RunRepository,
  SkillEventListener,
  SkillRegistry,
  SkillRunner,
  SkillRunOptions,
  SkillRunSubscription,
  Workspace,
  WorkspaceEventBus,
} from '@braidhq/core'
import type { AbsolutePath, AgentBindingDescriptor, McpServerConfig, RunRecord, SkillAgentOverride, SkillEvent, SkillId, SkillRunId } from '@braidhq/schema'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { mkdir, rm, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { newSkillRunId, NotFoundError } from '@braidhq/core'
import { AbsolutePath as AbsolutePathSchema, McpServerId, SkillEvent as SkillEventSchema, SkillRunId as SkillRunIdSchema } from '@braidhq/schema'
import { sessionDirPath } from '../fs/paths.js'
import { createAsyncQueue } from './asyncQueue.js'
import { attachOutputBuffers, type LineParser } from './subprocessEventStream.js'

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

/**
 * Additional directories to expose under the session's `.claude/skills/` tree.
 * Typically non-skill reference content,
 * e.g. a `shared/` dir that builtin SKILL.md files reference.
 */
export interface SkillReferenceDir {
  readonly name: string
  readonly path: AbsolutePath
}

export interface SubprocessSkillRunnerDeps {
  readonly skillRegistry: SkillRegistry
  // Builds an agent binding from a resolved descriptor.
  // Composition resolves the plugin by kind.
  // Called per run, so each skill can pick its own agent.
  readonly buildAgentBinding: (descriptor: AgentBindingDescriptor) => AgentBinding
  // Fallback agent config for skills that declare no override.
  readonly defaultAgent: AgentBindingDescriptor
  readonly apiUrl: string
  // Required. The persisted event log is the replay source of truth.
  readonly runRepository: RunRepository
  readonly spawn?: SpawnFn
  readonly clock?: () => string
  // Extra directories symlinked alongside skills (e.g. shared reference docs).
  readonly referenceDirs?: readonly SkillReferenceDir[]
  // Delete the per-run session directory after the run. Default `true`.
  readonly cleanupSession?: boolean
  // Enables the built-in `braid-core` MCP gateway.
  // When set, every spawned skill gets a stdio MCP server entry,
  // running `<uvxBin> openapi-mcp-gateway --spec <specUrl> --transport stdio`.
  // claude spawns the gateway as a per-session child.
  // The gateway fetches the OpenAPI spec from `specUrl`,
  // and exposes the REST surface as MCP tools such as `braid_search_nodes`.
  //
  // `specUrl` is typically `${apiUrl}/openapi.json`.
  // `uvxBin` defaults to `'uvx'`, resolved against PATH.
  // composeFs preflight-checks for its presence at boot.
  //
  // Leave undefined to skip the entry entirely.
  // A skill needing `braid-core` then surfaces as not-ready,
  // via SkillManifest.readinessIssuesFor.
  readonly coreGateway?: {
    readonly specUrl: string
    readonly uvxBin?: string
  }
  // Optional pub/sub for workspace-scoped notifications.
  // Studio uses it to invalidate run and proposal lists live, without polling.
  // Tests can leave this undefined.
  readonly eventBus?: WorkspaceEventBus
}

interface ActiveRun {
  readonly workspace: Workspace
  readonly child: ChildProcess
}

export class SubprocessSkillRunner implements SkillRunner {
  private readonly running = new Map<SkillRunId, ActiveRun>()
  // Maps sessionId to cwd for resuming. claude needs the same cwd per turn.
  private readonly sessionDirs = new Map<string, string>()
  private readonly subscribers = new Map<SkillRunId, Set<SkillEventListener>>()
  // How many events have been emitted (and persisted) per run so far.
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
    const gatewayArgs = [
      'openapi-mcp-gateway',
      '--spec',
      this.deps.coreGateway?.specUrl ?? '',
      '--transport',
      'stdio',
      '--name',
      'braid-core',
      // Forward the caller's Bearer token so the gateway authenticates its outgoing API calls.
      // The gateway resolves `${BRAID_TOKEN}` against its process env at startup.
      // Without this the server's auth middleware rejects every callback with 401.
      // eslint-disable-next-line no-template-curly-in-string
      ...(options?.callerToken ? ['--auth-type', 'bearer', '--auth-token', '${BRAID_TOKEN}'] : []),
    ]
    // Compose the MCP server list, the built-in gateway plus any the workspace
    // declares. The binding writes whatever config its CLI needs from this.
    const gatewayServers: McpServerConfig[] = this.deps.coreGateway
      ? [{
          id: McpServerId.parse('braid-core'),
          transport: 'stdio',
          command: this.deps.coreGateway.uvxBin ?? 'uvx',
          args: gatewayArgs,
        }]
      : []
    const binding = this.bindingFor(manifest.frontmatter.braid.agent)
    const invocation = await binding.resolveSpawn({
      skillId,
      args,
      workspace,
      manifest,
      apiUrl: this.deps.apiUrl,
      mcpServers: [...gatewayServers, ...workspace.mcpServers],
      sessionDir: AbsolutePathSchema.parse(sessionDir),
      ...(options?.resumeSessionId ? { resumeSessionId: options.resumeSessionId } : {}),
    })

    const spawnFn = this.deps.spawn ?? (await defaultSpawn())
    // BRAID_SESSION_DIR resolves ambiguity in SKILL.md paths.
    // claude sees both `BRAID_WORKSPACE` and a cwd inside it,
    // and would otherwise guess which one `.claude/skills/...` is rooted in.
    const child = spawnFn(invocation.bin, [...invocation.args], {
      cwd: sessionDir,
      env: {
        ...invocation.env,
        BRAID_SESSION_DIR: sessionDir,
        // BRAID_TOKEN is read by the braid-core MCP gateway,
        // and by any shell-level callback (curl in a SKILL.md),
        // so the subprocess can authenticate against the running server.
        ...(options?.callerToken ? { BRAID_TOKEN: options.callerToken } : {}),
        ...(options?.extraEnv ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.running.set(runId, { workspace, child })

    // Persist the started record up front,
    // so listing endpoints see the run immediately, before any output.
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
    this.deps.eventBus?.publish({
      type: 'run.started',
      workspaceId: workspace.id,
      runId,
      skillId,
      at: startedAt,
    })

    // Fire-and-forget the drain,
    // so the HTTP request that called start() can return immediately.
    void this.drain({
      workspace,
      runId,
      child,
      parseLine: binding.parseLine,
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
    parseLine: LineParser
    skillId: SkillId
    args: string
    sessionDir: string
    resumeSessionId: string | undefined
    startedAt: string
    initialRecord: RunRecord
  }): Promise<void> {
    let record = input.initialRecord
    let capturedSessionId: string | null = input.resumeSessionId ?? null
    let sawError = false
    let exitCode = 0

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
      const buffers = attachOutputBuffers(input.child, input.parseLine, queue.push, () => this.now())

      input.child.on('close', (code, signal) => {
        buffers.flush()
        queue.push(SkillEventSchema.parse({
          type: 'completed',
          runId: input.runId,
          // A signal-killed run must be reported as non-zero,
          // e.g. cancel via SIGTERM, or OS-level SIGKILL.
          // Downstream consumers then distinguish it from a clean exit.
          // Without this, `code ?? 0` collapses every signal kill to 0,
          // and cancellation looks identical to a clean run.
          exitCode: code ?? (signal ? 128 : 0),
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
          exitCode = event.exitCode
          await this.deps.runRepository.saveRecord(input.workspace, record)
        }
        if (event.type === 'error')
          sawError = true
        await this.emit(input.workspace, input.runId, event)
      }
    }
    finally {
      this.running.delete(input.runId)
      this.deps.eventBus?.publish({
        type: 'run.completed',
        workspaceId: input.workspace.id,
        runId: input.runId,
        skillId: input.skillId,
        outcome: sawError ? 'error' : exitCode === 0 ? 'success' : 'error',
        at: this.now(),
      })
      this.subscribers.delete(input.runId)
      // Keep the session dir on disk if a session id was captured.
      // claude stores conversation state per-cwd, so the dir must survive between turns.
      // GC happens via forgetSession(sessionId).
      const keepForResume = capturedSessionId !== null
      if (this.deps.cleanupSession !== false && !keepForResume)
        await rm(input.sessionDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  // Persist first, then broadcast.
  // This guarantees a just-subscribed listener receives every event strictly past its positionAtSubscribe.
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

  // Merge a skill's agent override onto the server default, then build the binding.
  // Unset override fields inherit the default.
  private bindingFor(override: SkillAgentOverride | undefined): AgentBinding {
    const base = this.deps.defaultAgent
    const effort = override?.effort ?? base.effort
    return this.deps.buildAgentBinding({
      id: base.id,
      kind: override?.kind ?? base.kind,
      model: override?.model ?? base.model,
      ...(effort ? { effort } : {}),
      extraArgs: base.extraArgs,
      env: base.env,
    })
  }

  private now(): string {
    return (this.deps.clock ?? (() => new Date().toISOString()))()
  }
}

async function defaultSpawn(): Promise<SpawnFn> {
  const mod = await import('node:child_process')
  return (command, args, options) => mod.spawn(command, [...args], options)
}
