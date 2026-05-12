import type {
  AgentBinding,
  SkillRegistry,
  SkillRunner,
  Workspace,
} from '@telos/core'
import type { AbsolutePath, SkillEvent, SkillId, SkillRunId } from '@telos/schema'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { tmpdir } from 'node:os'
import { newSkillRunId, NotFoundError } from '@telos/core'
import { SkillEvent as SkillEventSchema, SkillRunId as SkillRunIdSchema } from '@telos/schema'
import { writeMcpConfigFile } from './mcpConfig.js'
import { LineBuffer, parseJsonLine } from './streamJsonParser.js'

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

export interface SubprocessSkillRunnerDeps {
  readonly skillRegistry: SkillRegistry
  readonly agentBinding: AgentBinding
  readonly apiUrl: string
  readonly spawn?: SpawnFn
  readonly clock?: () => string
  readonly tempDir?: string
}

export class SubprocessSkillRunner implements SkillRunner {
  private readonly running = new Map<SkillRunId, ChildProcess>()

  constructor(private readonly deps: SubprocessSkillRunnerDeps) {}

  async *run(workspace: Workspace, skillId: SkillId, args: string): AsyncIterable<SkillEvent> {
    const manifest = await this.deps.skillRegistry.get(workspace, skillId)
    const mcpConfigFile = await writeMcpConfigFile(
      workspace,
      this.deps.tempDir ?? tmpdir(),
    )
    const invocation = this.deps.agentBinding.resolveSpawn({
      skillId,
      args,
      workspace,
      manifest,
      apiUrl: this.deps.apiUrl,
      mcpConfigFile: mcpConfigFile as unknown as AbsolutePath,
    })

    const runId = newSkillRunId()
    const spawnFn = this.deps.spawn ?? (await defaultSpawn())
    const child = spawnFn(invocation.bin, [...invocation.args], {
      env: invocation.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.running.set(runId, child)

    yield SkillEventSchema.parse({
      type: 'started',
      runId,
      skillId,
      at: this.now(),
    })

    const events: SkillEvent[] = []
    const buffer = new LineBuffer((line) => {
      const parsed = parseJsonLine(line)
      if (parsed === undefined)
        return
      const mapped = mapSubprocessEvent(parsed, runId)
      if (mapped)
        events.push(mapped)
    })

    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => buffer.append(chunk))

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', code => resolve(code ?? 0))
    })
    buffer.flush()
    this.running.delete(runId)

    for (const event of events) {
      yield event
    }

    yield SkillEventSchema.parse({
      type: 'completed',
      runId,
      exitCode,
      at: this.now(),
    })
  }

  async *resume(_workspace: Workspace, runId: SkillRunId): AsyncIterable<SkillEvent> {
    const child = this.running.get(runId)
    if (!child) {
      throw new NotFoundError(`SkillRun "${runId}" not active`)
    }
    yield SkillEventSchema.parse({
      type: 'message',
      text: `Resumed run "${runId}" — streaming live output not implemented`,
    })
  }

  async cancel(runId: SkillRunId): Promise<void> {
    const validated = SkillRunIdSchema.parse(runId)
    const child = this.running.get(validated)
    if (!child)
      throw new NotFoundError(`SkillRun "${validated}" not active`)
    child.kill('SIGTERM')
    this.running.delete(validated)
  }

  private now(): string {
    return (this.deps.clock ?? (() => new Date().toISOString()))()
  }
}

function mapSubprocessEvent(raw: { type: string, [key: string]: unknown }, _runId: SkillRunId): SkillEvent | undefined {
  if (raw.type === 'text' && typeof raw.text === 'string') {
    return SkillEventSchema.parse({ type: 'message', text: raw.text })
  }
  if (raw.type === 'tool_use' && typeof raw.name === 'string') {
    return SkillEventSchema.parse({ type: 'tool-call', tool: raw.name, args: raw.input ?? null })
  }
  if (raw.type === 'artifact-written' && typeof raw.artifactKind === 'string') {
    return SkillEventSchema.parse({
      type: 'artifact-written',
      artifactKind: raw.artifactKind,
      artifactId: raw.artifactId,
      path: raw.path,
    })
  }
  if (raw.type === 'error' && typeof raw.message === 'string') {
    return SkillEventSchema.parse({
      type: 'error',
      message: raw.message,
      at: new Date().toISOString(),
    })
  }
  return undefined
}

async function defaultSpawn(): Promise<SpawnFn> {
  const mod = await import('node:child_process')
  return (command, args, options) => mod.spawn(command, [...args], options)
}
