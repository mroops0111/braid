import type {
  AgentBinding,
  RunRepository,
  SkillEventListener,
  SkillManifest,
  SkillRegistry,
  SkillRunner,
  SkillRunOptions,
  SkillRunSubscription,
  Workspace,
  WorkspaceEventBus,
} from '@braidhq/core'
import type { AbsolutePath, AgentBindingDescriptor, AudienceDescriptor, EmittedBlock, McpServerConfig, OutputForm, RenderBlock, RenderCallName, RunRecord, SkillAgentOverride, SkillCategory, SkillEvent, SkillId, SkillRunId, SourceRoleDescriptor, WorkspaceId } from '@braidhq/schema'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type { AgentCredentialBroker } from '../agent/AgentCredentialBroker.js'
import type { RunOutputGate } from './RunOutputGate.js'
import type { RunTokenRegistry } from './RunTokenRegistry.js'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertSkillCanStart, carriedEvents, ConflictError, describeViolations, newBlockId, newSkillRunId, NotFoundError, restateRunId, runScope, ServiceUnavailableError, validateOutput } from '@braidhq/core'
import { AbsolutePath as AbsolutePathSchema, localize, McpServerId, rendersBlocks, settleOutputForm, settleRenderCalls, SkillEvent as SkillEventSchema, SkillRunId as SkillRunIdSchema, splitSkillId } from '@braidhq/schema'
import { sessionDirPath } from '../_shared/paths.js'
import { type AsyncQueue, createAsyncQueue } from './asyncQueue.js'
import { BUILTIN_SKILL_NAMESPACE } from './FsSkillRegistry.js'
import { attachOutputBuffers, type LineParser } from './subprocessEventStream.js'

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

/**
 * Reference docs a skill Reads but never invokes,
 * such as core's shared formats or an ontology's concept doc.
 * Each mounts inside its own namespace's bundle, keyed by that namespace alone,
 * so a mount can never be named out of step with its skills.
 */
export interface SkillReferenceDir {
  readonly skillNamespace: string
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
  // Reference-doc dirs mounted inside their own namespace's bundle.
  readonly referenceDirs?: readonly SkillReferenceDir[]
  // Delete the per-run session directory after the run. Default `true`.
  readonly cleanupSession?: boolean
  /**
   * Lends a run the credential its author resolved to.
   *
   * Absent on a deployment that models no users,
   * where the agent's own configuration is the only credential there is.
   */
  readonly agentCredentials?: AgentCredentialBroker
  // Enables the built-in `braid-core` MCP gateway.
  // When set, every spawned skill gets a stdio MCP server entry,
  // running `<uvxBin> openapi-mcp-gateway --spec <specUrl> --transport stdio`.
  // claude spawns the gateway as a per-session child.
  // The gateway fetches the OpenAPI spec from `specUrl`,
  // and exposes the REST surface as MCP tools such as `braid_search_nodes`.
  //
  // `specUrlFor` names the spec for one run,
  // so a run's tools are only the operations that run may call,
  // narrowed by its kind and by the form its output takes.
  // Narrowing the spec is what narrows the tools,
  // since an operation absent from it never reaches the model at all,
  // and costs neither a place in the tool list nor the tokens to describe.
  // `uvxBin` defaults to `'uvx'`, resolved against PATH.
  // The composeFsApp step preflight-checks for its presence at boot.
  //
  // Leave undefined to skip the entry entirely,
  // and a skill needing `braid-core` then fails its gateway preflight.
  readonly coreGateway?: {
    readonly specUrlFor: (category: SkillCategory, form: OutputForm, calls: readonly RenderCallName[]) => string
    readonly uvxBin?: string
  }
  /**
   * Mints the credential a run calls back with.
   * Wired, a run's identity rides its bearer token,
   * and nothing has to be told which run is calling.
   * Absent, the run carries its caller's own token as before.
   */
  readonly runTokens?: RunTokenRegistry
  /**
   * Holds each run to one outcome, a question or a proposal.
   * Absent, a run may do both, which is the batch's mode rather than a person's.
   */
  readonly outputGate?: RunOutputGate
  // Optional pub/sub for workspace-scoped notifications.
  // Studio uses it to invalidate run and proposal lists live, without polling.
  // Tests can leave this undefined.
  readonly eventBus?: WorkspaceEventBus
  // Resolves the active ontology's declared source roles for a workspace.
  // The runner serialises the result into `BRAID_SOURCE_ROLES` for every skill,
  // so a generic prompt reads the role vocabulary rather than naming role ids.
  // Composition wires this from the PluginRegistry, keeping the runner ontology-agnostic.
  readonly resolveSourceRoles?: (workspace: Workspace) => readonly SourceRoleDescriptor[]
  /**
   * The workspace ontology's declared audiences,
   * serialised for the prompt and used to check the output contract.
   * Absent means a product whose readers do not split,
   * and then nothing about audiences is required or injected.
   */
  readonly resolveAudiences?: (workspace: Workspace) => readonly AudienceDescriptor[]
}

interface ActiveRun {
  readonly workspace: Workspace
  /** What the skill is for, so a caller can ask about one kind of run. */
  readonly category: SkillCategory | undefined
  readonly child: ChildProcess
  /**
   * The form this run produces, settled when it started.
   *
   * Held beside the process rather than read back off the record,
   * because it is consulted once per render call
   * and the answer cannot change while the run is alive.
   */
  readonly outputForm: OutputForm
  /**
   * The run's own event queue.
   * A render call arrives out of band over HTTP while the subprocess writes,
   * so it joins here rather than at `emit`,
   * keeping one consumer and therefore one order.
   */
  readonly queue: AsyncQueue<SkillEvent>
}

export class SubprocessSkillRunner implements SkillRunner {
  private readonly running = new Map<SkillRunId, ActiveRun>()
  // Maps sessionId to cwd for resuming. claude needs the same cwd per turn.
  private readonly sessionDirs = new Map<string, string>()
  private readonly subscribers = new Map<SkillRunId, Set<SkillEventListener>>()
  // How many events have been emitted (and persisted) per run so far.
  private readonly positions = new Map<SkillRunId, number>()
  // Memoised braid-core gateway pre-flight per spec URL.
  // Only the first run of a session pays the check, a failed probe is not cached,
  // so a later run re-probes once the spec or gateway is fixed.
  private readonly gatewayReadyBySpec = new Map<string, Promise<void>>()

  constructor(private readonly deps: SubprocessSkillRunnerDeps) {}

  async start(
    workspace: Workspace,
    skillId: SkillId,
    args: string,
    options: SkillRunOptions,
  ): Promise<SkillRunId> {
    const manifest = await this.deps.skillRegistry.get(workspace, skillId)
    const category = manifest.frontmatter.braid?.category
    // The graph only accumulates, so two builds running against it race,
    // each reading a snapshot the other is still changing,
    // and whichever applies second proposes against a graph that has moved.
    // Refused here rather than in a caller,
    // because every path that starts a run comes through this one,
    // and a guard anywhere else can be walked around.
    if (category === 'build' && this.hasActiveRun(workspace.id, 'build')) {
      throw new ConflictError(
        `Workspace "${workspace.id}" is already building. The graph only accumulates, so one build runs at a time. Wait for it to finish, or stop it first.`,
      )
    }
    const runId = newSkillRunId()
    const { sessionDir, fresh: freshSessionDir } = await this.resolveSessionDir(workspace, runId, options.resumeSessionId)
    const skillBundleDirs = await this.skillBundleDirsFor(workspace, sessionDir)
    // The run's own credential, so what it creates is attributed from the request,
    // rather than from a field an agent had to fill in correctly.
    const runToken = this.deps.runTokens?.issue(runId, options.startedBy) ?? options.callerToken
    const unattended = options.unattended === true
    this.deps.outputGate?.open(runId, { unattended })
    // A skill that says nothing about what it does gets the reading surface.
    // Writing to the graph is a claim a skill has to make for itself.
    const toolSurface = category ?? 'ask'
    // Nothing outside a skill's own list can be reached by asking,
    // so a request it never offered renders as usual,
    // rather than making a run with no way to say anything.
    const outputForm = settleOutputForm({
      declaredForms: manifest.frontmatter.braid.output?.forms,
      requestedForm: options.outputForm,
      unattended,
    })
    // Settled here rather than in the spec route,
    // so the record and the gateway agree on what this run was offered.
    const renderCalls = settleRenderCalls({
      category: toolSurface,
      form: outputForm,
      declaredCalls: manifest.frontmatter.braid.output?.calls,
    })
    const gatewayArgs = [
      'openapi-mcp-gateway',
      '--spec',
      this.deps.coreGateway?.specUrlFor(toolSurface, outputForm, renderCalls) ?? '',
      '--transport',
      'stdio',
      '--name',
      'braid-core',
      // The spec's `servers[]` block names the public URL,
      // which a host behind a proxy cannot always reach by its own name.
      // The gateway calls back on loopback like the rest of the subprocess.
      '--base-url',
      this.deps.apiUrl,
      // Forward the caller's Bearer token so the gateway authenticates its outgoing API calls.
      // The gateway resolves `${BRAID_TOKEN}` against its process env at startup.
      // Without this the server's auth middleware rejects every callback with 401.
      // eslint-disable-next-line no-template-curly-in-string
      ...(runToken ? ['--auth-type', 'bearer', '--auth-token', '${BRAID_TOKEN}'] : []),
    ]
    // Compose the MCP server list, the built-in gateway plus any declared.
    // The binding writes whatever config its CLI needs from this.
    const gatewayServers: McpServerConfig[] = this.deps.coreGateway
      ? [{
          id: McpServerId.parse('braid-core'),
          transport: 'stdio',
          command: this.deps.coreGateway.uvxBin ?? 'uvx',
          args: gatewayArgs,
        }]
      : []
    const binding = this.bindingFor(manifest.frontmatter.braid.agent)
    // A caller holding the exchange supplies it.
    // Otherwise this turn is the whole conversation,
    // which is every run that did not come from a client keeping its history.
    // A continued run is a new run inside an old conversation,
    // and the conversation still holds the closed run's id.
    // Correcting it here is what keeps its render calls landing somewhere.
    const prompt = options.continues ? `${args}\n\n${restateRunId(runId)}` : args
    const messages = options.messages
      ? [...options.messages.slice(0, -1), { role: 'user' as const, content: prompt }]
      : [{ role: 'user' as const, content: prompt }]
    const invocation = await binding.resolveSpawn({
      skillId,
      messages,
      workspace,
      manifest,
      apiUrl: this.deps.apiUrl,
      mcpServers: [...gatewayServers, ...workspace.mcpServers],
      sessionDir: AbsolutePathSchema.parse(sessionDir),
      skillBundleDirs,
      ...(options.resumeSessionId ? { conversationId: options.resumeSessionId } : {}),
    })

    // Resolved before the process exists,
    // so a run with nothing to spend is refused here,
    // rather than reaching an upstream rejection nobody can act on.
    const lease = this.deps.agentCredentials
      ? await this.deps.agentCredentials.lease(runId, options.startedBy, binding.descriptor.kind)
      : { source: 'server' as const, env: {} }
    if (lease.source === 'none') {
      throw new ServiceUnavailableError(
        'No agent credential is available for this run. '
        + 'Add yours under Settings, or ask an admin to configure one for this server.',
      )
    }

    const spawnFn = this.deps.spawn ?? (await defaultSpawn())
    // BRAID_SESSION_DIR resolves ambiguity in SKILL.md paths.
    // claude sees both `BRAID_WORKSPACE` and a cwd inside it,
    // and would otherwise guess which one `.claude/skills/...` is rooted in.
    const runEnv = {
      ...invocation.env,
      BRAID_SESSION_DIR: sessionDir,
      // The run a render call posts back to.
      // Without it a skill reaches the render tools,
      // but cannot name which run they belong to.
      BRAID_RUN_ID: runId,
      // The active ontology's declared source roles, as JSON.
      // A generic prompt reads this instead of naming role ids.
      ...this.sourceRolesEnv(workspace),
      // The readers this ontology splits for,
      // so a builtin prompt reads the vocabulary,
      // rather than naming any product's own facets.
      ...this.audiencesEnv(workspace),
      // Absolute paths to the reference docs a prompt may Read,
      // so no SKILL.md carries a location of its own.
      ...this.referenceEnv(workspace, skillId, sessionDir),
      // The form this run was settled on, told rather than left to be inferred.
      // The spec is what enforces it, since the operations are genuinely absent.
      // A prompt left to notice their absence goes looking for them,
      // and where tools are searched rather than listed,
      // that search spends several calls to reach what this states.
      BRAID_OUTPUT_FORM: outputForm,
      // Read by a prompt deciding whether to stop and ask.
      // A run nobody is watching files its question and carries on,
      // since holding its work back waits on an answer that is not coming.
      ...(unattended ? { BRAID_UNATTENDED: 'true' } : {}),
      // BRAID_TOKEN is read by the braid-core MCP gateway,
      // and by any shell-level callback (curl in a SKILL.md),
      // so the subprocess can authenticate against the running server.
      ...(runToken ? { BRAID_TOKEN: runToken } : {}),
      // After the agent's own environment, so a run's credential wins.
      // A configured key would otherwise take precedence,
      // and the broker would go unused.
      ...lease.env,
      ...(options.extraEnv ?? {}),
    }

    // Both preflights fail before a process exists,
    // rather than letting an agent discover mid-run,
    // that a tool or a variable was never there.
    // This is the first moment the injected variables exist to be checked.
    //
    // The token, gate, and lease above are already live by this point,
    // and nothing past here runs drain()'s finally block to release them.
    // A preflight failure is released here,
    // for the same reason drain() releases one on exit,
    // since an unrecognised token must stop opening doors,
    // not outlive the run that never started.
    try {
      assertSkillCanStart({ skillId, frontmatter: manifest.frontmatter, env: runEnv })
      // Fail fast when the braid-core gateway cannot turn the spec into tools,
      // rather than spawning an agent that discovers the missing tools mid-run.
      await this.ensureGatewayReady(spawnFn, toolSurface, outputForm, renderCalls)
    }
    catch (error) {
      this.deps.agentCredentials?.release(runId)
      this.deps.runTokens?.revoke(runId)
      this.deps.outputGate?.close(runId)
      // A reused directory belongs to the run it was resumed from,
      // and must outlive this failed attempt.
      if (freshSessionDir && this.deps.cleanupSession !== false)
        await rm(sessionDir, { recursive: true, force: true }).catch(() => {})
      throw error
    }

    const child = spawnFn(invocation.bin, [...invocation.args], {
      cwd: sessionDir,
      env: runEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const queue = createAsyncQueue<SkillEvent>()
    this.running.set(runId, { workspace, category, child, outputForm, queue })

    // Persist the started record up front,
    // so listing endpoints see the run immediately, before any output.
    const startedAt = this.now()
    const initialRecord: RunRecord = {
      runId,
      workspaceId: workspace.id,
      skillId,
      args: prompt,
      // Held apart only when they differ, which is a continued run,
      // told to carry on and still reading what the run before it was reading.
      ...(options.scope !== undefined && options.scope !== prompt ? { scope: options.scope } : {}),
      ...(options.continues ? { continues: options.continues } : {}),
      resumed: options.resumeSessionId !== undefined,
      startedAt,
      startedBy: options.startedBy,
      // The form settled above rather than the one asked for,
      // so a record never claims a run held back tools it was in fact offered.
      outputForm,
      // Recorded rather than kept in memory,
      // because what this run's questions mean outlives the process.
      ...(unattended ? { unattended: true } : {}),
      ...(options.resumeSessionId ? { sessionId: options.resumeSessionId } : {}),
    }
    await this.deps.runRepository.saveRecord(workspace, initialRecord)
    if (options.continues)
      await this.carryOver(workspace, options.continues, runId)
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
      queue,
      // A retry inherits the remaining budget,
      // so one correction cannot become a loop spending a subscription.
      retriesLeft: options.retriesLeft ?? manifest.frontmatter.braid.output?.maxRetries ?? 0,
      parseLine: binding.parseLine,
      skillId,
      args,
      sessionDir,
      resumeSessionId: options.resumeSessionId,
      startedAt,
      initialRecord,
      ...(options.continues ? { continues: options.continues } : {}),
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

  /** Whether any run currently holds this workspace's sources. */
  hasActiveRun(workspaceId: WorkspaceId, category?: SkillCategory): boolean {
    for (const active of this.running.values()) {
      if (active.workspace.id !== workspaceId)
        continue
      if (category === undefined || active.category === category)
        return true
    }
    return false
  }

  async emitBlock(runId: SkillRunId, block: RenderBlock): Promise<EmittedBlock> {
    const validated = SkillRunIdSchema.parse(runId)
    const active = this.running.get(validated)
    if (!active)
      throw new NotFoundError(`SkillRun "${validated}" not active`)
    // The spec a non-rendering run reads holds no render operation,
    // so this is unreachable through the gateway and is refused here
    // for anything that arrives with the run's token by another route.
    // Without it, "this run has no blocks" would be a convention,
    // and a surface cannot fall back on a convention.
    if (!rendersBlocks(active.outputForm)) {
      throw new ConflictError(
        `SkillRun "${validated}" produces ${active.outputForm}, so it renders no blocks. Write the answer out instead.`,
      )
    }
    const emitted: EmittedBlock = { id: newBlockId(), block }
    active.queue.push(SkillEventSchema.parse({ type: 'block', ...emitted }))
    return emitted
  }

  /**
   * Hand a run the account of the one it continues.
   *
   * The alternative was a link between two logs,
   * and a reader then has to know there is a second one and go and open it.
   * One piece of work reads as one thread,
   * so the thread is copied rather than pointed at,
   * and the run that produced it still holds its own copy for what points there.
   */
  private async carryOver(workspace: Workspace, from: SkillRunId, to: SkillRunId): Promise<void> {
    const earlier: SkillEvent[] = []
    for await (const event of this.deps.runRepository.readEvents(workspace, from))
      earlier.push(event)
    for (const event of carriedEvents(earlier))
      await this.emit(workspace, to, event)
  }

  async cancel(runId: SkillRunId): Promise<void> {
    const validated = SkillRunIdSchema.parse(runId)
    const active = this.running.get(validated)
    if (!active)
      throw new NotFoundError(`SkillRun "${validated}" not active`)
    active.child.kill('SIGTERM')
  }

  async sessionIdFor(workspace: Workspace, runId: SkillRunId): Promise<string | undefined> {
    const records = await this.deps.runRepository.listRecords(workspace)
    return records.find(record => record.runId === runId)?.sessionId
  }

  async forgetSession(sessionId: string): Promise<void> {
    const dir = this.sessionDirs.get(sessionId)
    if (!dir)
      return
    this.sessionDirs.delete(sessionId)
    if (this.deps.cleanupSession !== false)
      await rm(dir, { recursive: true, force: true })
  }

  /**
   * Pre-flight the braid-core gateway before an agent runs.
   * Runs `openapi-mcp-gateway --dry-run`, memoised per spec,
   * so only the first run pays it.
   */
  private async ensureGatewayReady(spawnFn: SpawnFn, category: SkillCategory, form: OutputForm, calls: readonly RenderCallName[]): Promise<void> {
    const gateway = this.deps.coreGateway
    if (!gateway)
      return
    const specUrl = gateway.specUrlFor(category, form, calls)
    let pending = this.gatewayReadyBySpec.get(specUrl)
    if (!pending) {
      pending = this.probeGateway(spawnFn, gateway.uvxBin ?? 'uvx', specUrl)
      this.gatewayReadyBySpec.set(specUrl, pending)
    }
    try {
      await pending
    }
    catch (error) {
      this.gatewayReadyBySpec.delete(specUrl)
      throw error
    }
  }

  private probeGateway(spawnFn: SpawnFn, uvxBin: string, specUrl: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawnFn(uvxBin, ['openapi-mcp-gateway', '--spec', specUrl, '--dry-run'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      const collect = (chunk: string): void => {
        output += chunk
      }
      child.stdout?.setEncoding('utf-8')
      child.stdout?.on('data', collect)
      child.stderr?.setEncoding('utf-8')
      child.stderr?.on('data', collect)
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new ServiceUnavailableError(`The braid-core gateway pre-flight timed out after 60s against the spec at ${specUrl}.`))
      }, 60_000)
      child.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(new ServiceUnavailableError(`The braid-core gateway pre-flight could not run "${uvxBin}". ${err.message}`))
      })
      child.on('close', (code: number | null) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve()
          return
        }
        reject(new ServiceUnavailableError(
          `The braid-core gateway is not ready. The openapi-mcp-gateway command could not turn the spec at ${specUrl} into MCP tools. `
          + `Fix the spec or the gateway, then retry.\n\n${output.trim().slice(-1200)}`,
        ))
      })
    })
  }

  private async drain(input: {
    workspace: Workspace
    runId: SkillRunId
    child: ChildProcess
    queue: AsyncQueue<SkillEvent>
    retriesLeft: number
    parseLine: LineParser
    skillId: SkillId
    args: string
    sessionDir: string
    resumeSessionId: string | undefined
    startedAt: string
    initialRecord: RunRecord
    continues?: SkillRunId
  }): Promise<void> {
    let record = input.initialRecord
    let capturedSessionId: string | null = input.resumeSessionId ?? null
    let sawError = false
    let exitCode = 0
    const rendered: EmittedBlock[] = []

    try {
      await this.emit(input.workspace, input.runId, SkillEventSchema.parse({
        type: 'started',
        runId: input.runId,
        skillId: input.skillId,
        args: input.args,
        resumed: input.resumeSessionId !== undefined,
        // The link travels on the event as well as on the record,
        // since the stream alone cannot tell a correction from a typed follow-up.
        ...(input.continues ? { continues: input.continues } : {}),
        at: input.startedAt,
      }))

      const queue = input.queue
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
        if (event.type === 'block')
          rendered.push({ id: event.id, block: event.block })
        if (event.type === 'error')
          sawError = true
        await this.emit(input.workspace, input.runId, event)
      }
    }
    finally {
      this.running.delete(input.runId)
      this.deps.agentCredentials?.release(input.runId)
      this.deps.runTokens?.revoke(input.runId)
      this.deps.outputGate?.close(input.runId)
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

      // A correction is a new run,
      // so it starts only once this one has been announced finished and torn down.
      // Started inside the teardown it could be refused for colliding with itself,
      // and the refusal would escape a promise nobody is holding.
      void this.correctOutput(input, rendered, capturedSessionId, exitCode, sawError).catch(() => {
        // A run whose output missed its contract, and was not corrected,
        // is already recorded as it happened. Nothing here can improve it.
      })
    }
  }

  /**
   * Hands a finished run's contract gap back to the agent for one more turn.
   *
   * A skill prompt asking for something is not the same as getting it,
   * and a run that stopped early looks like one that had nothing left to say.
   * The check runs after the stream drains,
   * and the correction resumes the same claude session,
   * so the agent still has everything it just read.
   *
   * Silent on a failed or cancelled run,
   * because a gap there is a symptom of the failure,
   * rather than something the agent can fix by trying again.
   *
   * Silent on a prose run too.
   * Its contract names calls whose tools it was never given,
   * so every one of them reads as missing,
   * and the correction would be a whole extra turn
   * spent asking for what the run was deliberately not offered.
   */
  private async correctOutput(
    input: { workspace: Workspace, runId: SkillRunId, skillId: SkillId, retriesLeft: number, initialRecord: RunRecord },
    rendered: readonly EmittedBlock[],
    sessionId: string | null,
    exitCode: number,
    sawError: boolean,
  ): Promise<void> {
    if (sawError || exitCode !== 0 || input.retriesLeft <= 0 || sessionId === null)
      return
    if (!rendersBlocks(input.initialRecord.outputForm))
      return
    const manifest = await this.deps.skillRegistry.get(input.workspace, input.skillId)
    const contract = manifest.frontmatter.braid.output
    if (!contract)
      return
    const declared = (this.deps.resolveAudiences?.(input.workspace) ?? []).map(audience => audience.id)
    if (validateOutput(contract, rendered, declared).length === 0)
      return
    // A conversation is read as one answer,
    // so a turn owes only what no turn before it rendered.
    // Judged on its own, a follow-up owes the whole contract again,
    // and the correction then repeats an answer already on the page.
    const outstanding = validateOutput(
      contract,
      [...await this.conversationBlocks(input.workspace, input.initialRecord, sessionId), ...rendered],
      declared,
    )
    if (outstanding.length === 0)
      return

    await this.start(input.workspace, input.skillId, describeViolations(outstanding), {
      resumeSessionId: sessionId,
      scope: runScope(input.initialRecord),
      continues: input.runId,
      retriesLeft: input.retriesLeft - 1,
      // A correction belongs to whoever asked the original question,
      // so run history never grows an entry with nobody behind it.
      startedBy: input.initialRecord.startedBy,
    })
  }

  /**
   * What the earlier turns of this conversation already put on the page.
   *
   * Read only once a run has been found wanting on its own,
   * so a conversation that never needs correcting never pays for the walk.
   * A continued run holds a copy of the account it carried on,
   * which is why a block is taken once by id rather than once per log.
   */
  private async conversationBlocks(
    workspace: Workspace,
    record: RunRecord,
    sessionId: string,
  ): Promise<readonly EmittedBlock[]> {
    const records = await this.deps.runRepository.listRecords(workspace)
    const earlier = records.filter(entry => entry.sessionId === sessionId && entry.runId !== record.runId)
    const blocks: EmittedBlock[] = []
    const seen = new Set<string>()
    for (const entry of earlier) {
      for await (const event of this.deps.runRepository.readEvents(workspace, entry.runId)) {
        if (event.type !== 'block' || seen.has(event.id))
          continue
        seen.add(event.id)
        blocks.push({ id: event.id, block: event.block })
      }
    }
    return blocks
  }

  // Persist first, then broadcast.
  // This guarantees a just-subscribed listener receives every event strictly past its positionAtSubscribe.
  //
  // A delta is the exception, broadcast without being kept.
  // Its whole arrives moments later, so keeping both would say it twice,
  // and leave a replayed run stuttering through text it already holds.
  // Out of the position count too, since a missed fragment is nothing missed.
  private async emit(workspace: Workspace, runId: SkillRunId, event: SkillEvent): Promise<void> {
    if (event.type === 'message-delta') {
      this.broadcast(runId, event)
      return
    }
    await this.deps.runRepository.appendEvent(workspace, runId, event)
    const next = (this.positions.get(runId) ?? 0) + 1
    this.positions.set(runId, next)
    this.broadcast(runId, event)
  }

  private broadcast(runId: SkillRunId, event: SkillEvent): void {
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

  /**
   * `fresh` tells a caller whether this run built the directory just now,
   * as opposed to reusing one an earlier, resumed run already owns.
   * Only a fresh directory is this call's own to remove on a later failure,
   * a reused one holds a resumed conversation's state and must outlive this run.
   */
  private async resolveSessionDir(
    workspace: Workspace,
    runId: SkillRunId,
    resumeSessionId: string | undefined,
  ): Promise<{ sessionDir: string, fresh: boolean }> {
    if (resumeSessionId) {
      const cached = this.sessionDirs.get(resumeSessionId)
      if (cached)
        return { sessionDir: cached, fresh: false }
      const recovered = await this.recoverSessionDir(workspace, resumeSessionId)
      if (recovered) {
        this.sessionDirs.set(resumeSessionId, recovered)
        return { sessionDir: recovered, fresh: false }
      }
    }
    return { sessionDir: await this.buildSessionDir(workspace, runId), fresh: true }
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

    // Reference docs mount inside their own namespace's bundle,
    // so a namespace owns one directory and its docs cannot drift from its skills.
    // An agent loads components only from the names its plugin format defines,
    // so `reference` stays inert there and is reached by the injected path.
    const linkedRefs = new Set<string>()
    for (const reference of this.deps.referenceDirs ?? []) {
      if (linkedRefs.has(reference.skillNamespace))
        continue
      linkedRefs.add(reference.skillNamespace)
      const mount = this.referenceDir(sessionDir, reference.skillNamespace)
      await mkdir(dirname(mount), { recursive: true })
      await symlink(reference.path, mount, 'dir')
    }

    // Invokable skills stage as one claude plugin per namespace,
    // since a plugin is claude's only mechanism for `/namespace:verb`.
    // The runner synthesises that bundle per run as an adapter alone,
    // so an author ships a braid plugin and never writes a claude one.
    // The colon lives in the invocation token, never in a path.
    const byNamespace = new Map<string, SkillManifest[]>()
    for (const manifest of await this.deps.skillRegistry.list(workspace)) {
      const { namespace } = splitSkillId(manifest.id)
      const bucket = byNamespace.get(namespace) ?? []
      bucket.push(manifest)
      byNamespace.set(namespace, bucket)
    }
    for (const [namespace, skills] of byNamespace) {
      const pluginDir = this.skillBundleDir(sessionDir, namespace)
      await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true })
      const manifest = { name: namespace, version: '0.0.0', description: `Braid ${namespace} skills` }
      await writeFile(join(pluginDir, '.claude-plugin', 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
      const skillsDir = join(pluginDir, 'skills')
      await mkdir(skillsDir, { recursive: true })
      const linked = new Set<string>()
      for (const skill of skills) {
        const { verb } = splitSkillId(skill.id)
        if (linked.has(verb))
          continue
        linked.add(verb)
        await symlink(dirname(skill.path), join(skillsDir, verb), 'dir')
      }
    }

    return sessionDir
  }

  private skillBundleDir(sessionDir: string, namespace: string): string {
    return join(sessionDir, '.skill-bundles', namespace)
  }

  // Where a namespace's reference docs mount, inside that namespace's bundle,
  // so everything one namespace owns lives under a single directory.
  private referenceDir(sessionDir: string, namespace: string): string {
    return join(this.skillBundleDir(sessionDir, namespace), 'reference')
  }

  // The plugin bundle dir for every namespace present in the workspace.
  // Deterministic from the session dir, so it works on a resumed session,
  // whose bundles were staged on the first run, without restaging.
  private async skillBundleDirsFor(workspace: Workspace, sessionDir: string): Promise<string[]> {
    const manifests = await this.deps.skillRegistry.list(workspace)
    const namespaces = [...new Set(manifests.map(manifest => splitSkillId(manifest.id).namespace))]
    return namespaces.map(namespace => this.skillBundleDir(sessionDir, namespace))
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

  /**
   * Absolute paths to the mounted reference dirs,
   * `BRAID_SHARED_REFERENCE` for framework contracts,
   * `BRAID_ONTOLOGY_REFERENCE` for the active ontology,
   * and `BRAID_SKILL_REFERENCE` for whatever plugin ships the running skill.
   * A variable is set only when that namespace ships reference docs,
   * so a prompt can branch on absence instead of reading a dangling path.
   * Paths derive from the session dir, so a resumed run resolves them unchanged.
   */
  private referenceEnv(workspace: Workspace, skillId: SkillId, sessionDir: string): Record<string, string> {
    const mounted = new Set((this.deps.referenceDirs ?? []).map(reference => reference.skillNamespace))
    const ontologyNamespace = workspace.productManifest.ontologyId
    const own = splitSkillId(skillId).namespace
    return {
      ...(mounted.has(BUILTIN_SKILL_NAMESPACE)
        ? { BRAID_SHARED_REFERENCE: this.referenceDir(sessionDir, BUILTIN_SKILL_NAMESPACE) }
        : {}),
      ...(mounted.has(ontologyNamespace)
        ? { BRAID_ONTOLOGY_REFERENCE: this.referenceDir(sessionDir, ontologyNamespace) }
        : {}),
      // Named for the running skill rather than for one plugin axis,
      // so a plugin of any kind reaches its own docs,
      // without the runner learning what kind it is.
      ...(mounted.has(own) && own !== BUILTIN_SKILL_NAMESPACE && own !== ontologyNamespace
        ? { BRAID_SKILL_REFERENCE: this.referenceDir(sessionDir, own) }
        : {}),
    }
  }

  // Serialise the workspace ontology's source roles into a `BRAID_SOURCE_ROLES` env pair.
  // Labels resolve to English so a prompt renders them without a locale map.
  // Returns an empty object when no resolver is wired or the ontology declares no roles,
  // so a skill that never reads the var is unaffected.
  private sourceRolesEnv(workspace: Workspace): Record<string, string> {
    const roles = this.deps.resolveSourceRoles?.(workspace) ?? []
    if (roles.length === 0)
      return {}
    const wire = roles.map(role => ({
      id: role.id,
      label: localize(role.label, 'en'),
      ...(role.pathSegment ? { pathSegment: role.pathSegment } : {}),
      unitBearing: role.unitBearing === true,
    }))
    return { BRAID_SOURCE_ROLES: JSON.stringify(wire) }
  }

  /** The readers this workspace splits an answer for, as the prompt's vocabulary. */
  private audiencesEnv(workspace: Workspace): Record<string, string> {
    const audiences = this.deps.resolveAudiences?.(workspace) ?? []
    if (audiences.length === 0)
      return {}
    const wire = audiences.map(audience => ({
      id: audience.id,
      label: localize(audience.label, 'en'),
      ...(audience.description ? { description: audience.description } : {}),
      evidenceDetail: audience.evidenceDetail,
    }))
    return { BRAID_AUDIENCES: JSON.stringify(wire) }
  }

  private now(): string {
    return (this.deps.clock ?? (() => new Date().toISOString()))()
  }
}

async function defaultSpawn(): Promise<SpawnFn> {
  const mod = await import('node:child_process')
  return (command, args, options) => mod.spawn(command, [...args], options)
}
