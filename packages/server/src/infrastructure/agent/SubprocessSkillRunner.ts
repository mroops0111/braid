import type {
  AgentBinding,
  SkillRegistry,
  SkillRunner,
  Workspace,
} from '@telos/core'
import type { AbsolutePath, SkillEvent, SkillId, SkillRunId } from '@telos/schema'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { newSkillRunId, NotFoundError } from '@telos/core'
import { SkillEvent as SkillEventSchema, SkillRunId as SkillRunIdSchema } from '@telos/schema'
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
  readonly spawn?: SpawnFn
  readonly clock?: () => string
  readonly tempDir?: string
  /** Extra directories symlinked alongside skills (e.g. shared reference docs). */
  readonly referenceDirs?: readonly SkillReferenceDir[]
  /** Delete the per-run session directory after the run. Default `true`. */
  readonly cleanupSession?: boolean
}

export class SubprocessSkillRunner implements SkillRunner {
  private readonly running = new Map<SkillRunId, ChildProcess>()

  constructor(private readonly deps: SubprocessSkillRunnerDeps) {}

  async *run(workspace: Workspace, skillId: SkillId, args: string): AsyncIterable<SkillEvent> {
    const manifest = await this.deps.skillRegistry.get(workspace, skillId)
    const sessionDir = await this.buildSessionDir(workspace)
    const mcpConfigFile = await writeMcpConfigFile(workspace, sessionDir)
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
      cwd: sessionDir,
      env: invocation.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.running.set(runId, child)

    yield SkillEventSchema.parse({ type: 'started', runId, skillId, at: this.now() })

    const queue: SkillEvent[] = []
    let resolver: (() => void) | null = null
    let finished = false

    const wake = (): void => {
      if (resolver) {
        const r = resolver
        resolver = null
        r()
      }
    }
    const enqueue = (event: SkillEvent): void => {
      queue.push(event)
      wake()
    }

    const stdoutBuffer = new LineBuffer((line) => {
      const parsed = parseJsonLine(line)
      if (parsed === undefined)
        return
      for (const event of mapSubprocessEvents(parsed, this.now())) {
        enqueue(event)
      }
    })
    const stderrBuffer = new LineBuffer((line) => {
      enqueue(SkillEventSchema.parse({ type: 'message', text: `[stderr] ${line}` }))
    })

    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => stdoutBuffer.append(chunk))
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => stderrBuffer.append(chunk))

    child.on('close', (code) => {
      stdoutBuffer.flush()
      stderrBuffer.flush()
      enqueue(SkillEventSchema.parse({
        type: 'completed',
        runId,
        exitCode: code ?? 0,
        at: this.now(),
      }))
      finished = true
      wake()
    })

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!
          continue
        }
        if (finished)
          break
        await new Promise<void>((r) => {
          if (queue.length > 0 || finished) {
            r()
            return
          }
          resolver = r
        })
      }
    }
    finally {
      this.running.delete(runId)
      if (this.deps.cleanupSession !== false) {
        await rm(sessionDir, { recursive: true, force: true })
      }
    }
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

  /**
   * Materialises a per-run session directory containing:
   *
   *   <session>/
   *     .claude/skills/<slash-name>/   → symlink per skill manifest
   *     .claude/skills/<ref-name>/     → symlink per referenceDir (e.g. shared/)
   *
   * The spawn cwd points here so Claude Code's slash command resolver
   * finds every skill registered with the workspace, and SKILL.md files
   * can use `.claude/skills/shared/...` paths reliably.
   */
  private async buildSessionDir(workspace: Workspace): Promise<string> {
    const parentDir = this.deps.tempDir ?? tmpdir()
    await mkdir(parentDir, { recursive: true })
    const sessionDir = await mkdtemp(join(parentDir, 'telos-session-'))
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
