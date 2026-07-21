import type { AbsolutePath, AgentBindingDescriptor, SkillAgentOverride, SkillEvent, SkillId, SkillRunId, WorkspaceEvent } from '@braidhq/schema'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeAgentBinding } from '@braidhq/agent-claude-code'
import {
  type AgentBinding,
  SkillManifest,
  type SkillRegistry,
  type SkillRunner as SkillRunnerPort,
  type Workspace,
  type WorkspaceEventBus,
} from '@braidhq/core'
import { T0 } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { FsRunRepository } from '../../../src/infrastructure/skill/FsRunRepository.js'
import { SubprocessSkillRunner } from '../../../src/infrastructure/skill/SubprocessSkillRunner.js'
import { DEFAULT_AGENT_BINDING, makeWorkspace } from '../../helpers/fakes.js'
import { createMockSpawn, type MockSpawnRecord, type MockSpawnScript } from '../../helpers/mockSpawn.js'
import { makeSkillFileContents } from '../../helpers/skillFixtures.js'

const SKILL_ID = 'braid-ask' as SkillId

interface BuildRunnerInput {
  readonly rootPath: AbsolutePath
  readonly sequence?: readonly MockSpawnScript[]
  readonly cleanupSession?: boolean
  readonly referenceDirs?: readonly { name: string, path: AbsolutePath }[]
  readonly eventBus?: WorkspaceEventBus
  readonly clock?: () => string
  readonly runRepository?: FsRunRepository
  readonly skillRegistry?: SkillRegistry
  readonly skillAgent?: SkillAgentOverride
  readonly buildAgentBinding?: (descriptor: AgentBindingDescriptor) => AgentBinding
}

interface BuiltRunner {
  readonly runner: SubprocessSkillRunner
  readonly workspace: Workspace
  readonly invocations: readonly MockSpawnRecord[]
  readonly skillRegistry: SkillRegistry
  readonly runRepository: FsRunRepository
}

async function buildRunner(input: BuildRunnerInput): Promise<BuiltRunner> {
  const skillRegistry = input.skillRegistry ?? await makeSkillRegistry(input.rootPath, input.skillAgent)
  const runRepository = input.runRepository ?? new FsRunRepository()
  const { spawn, invocations } = createMockSpawn(input.sequence ?? [{ stdoutLines: [], exitCode: 0 }])
  const runner = new SubprocessSkillRunner({
    skillRegistry,
    buildAgentBinding: input.buildAgentBinding ?? (descriptor => new ClaudeCodeAgentBinding(descriptor)),
    defaultAgent: DEFAULT_AGENT_BINDING,
    apiUrl: 'http://localhost:4321',
    runRepository,
    spawn,
    ...(input.cleanupSession !== undefined ? { cleanupSession: input.cleanupSession } : {}),
    ...(input.referenceDirs ? { referenceDirs: [...input.referenceDirs] } : {}),
    ...(input.eventBus ? { eventBus: input.eventBus } : {}),
    ...(input.clock ? { clock: input.clock } : {}),
  })
  const workspace = makeWorkspace({ rootPath: input.rootPath })
  return { runner, workspace, invocations, skillRegistry, runRepository }
}

async function makeWorkspaceRoot(): Promise<AbsolutePath> {
  return (await mkdtemp(join(tmpdir(), 'braid-runner-'))) as AbsolutePath
}

async function makeSkillRegistry(skillSourceParent: AbsolutePath, agent?: SkillAgentOverride): Promise<SkillRegistry> {
  // Materialise a real SKILL.md so the runner's session-dir builder can symlink it.
  // Tests that don't care about the session-dir layout still get a valid manifest.
  const skillDir = join(skillSourceParent, 'braid-ask')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), makeSkillFileContents({ name: 'braid-ask' }), 'utf-8')
  const manifest = new SkillManifest({
    id: SKILL_ID,
    origin: 'builtin',
    path: join(skillDir, 'SKILL.md') as AbsolutePath,
    frontmatter: {
      name: 'braid-ask',
      description: 'a',
      disableModelInvocation: false,
      braid: {
        requiredEnv: [],
        requiredMcpServers: [],
        allowedRoles: ['owner', 'maintainer'],
        ...(agent ? { agent } : {}),
      },
    },
  })
  return {
    list: async () => [manifest],
    find: async () => manifest,
    get: async () => manifest,
  }
}

async function collectRunEvents(
  runner: SkillRunnerPort,
  workspace: Workspace,
  args: string,
  options?: { resumeSessionId?: string },
): Promise<{ runId: SkillRunId, events: SkillEvent[] }> {
  const runId = await runner.start(workspace, SKILL_ID, args, options)
  const events: SkillEvent[] = []
  await new Promise<void>((resolve) => {
    const sub = runner.subscribe(runId, (event) => {
      events.push(event)
      if (event.type === 'completed' || event.type === 'error') {
        sub.unsubscribe()
        queueMicrotask(resolve)
      }
    })
  })
  return { runId, events }
}

describe('SubprocessSkillRunner', () => {
  it('emits started → mapped stream events → completed in order', async () => {
    const rootPath = await makeWorkspaceRoot()
    const { runner, workspace, invocations } = await buildRunner({
      rootPath,
      sequence: [{
        stdoutLines: [
          JSON.stringify({ type: 'text', text: 'hi' }),
          JSON.stringify({ type: 'tool_use', name: 'Read', input: { path: '/x' } }),
        ],
        exitCode: 0,
      }],
      clock: () => T0,
    })

    const { events } = await collectRunEvents(runner, workspace, '')

    expect(events.map(event => event.type)).toEqual(['started', 'message', 'tool-call', 'completed'])
    expect(invocations).toHaveLength(1)
    expect(invocations[0]?.command).toBe('claude')
  })

  it('merges a skill agent override onto the server default', async () => {
    const rootPath = await makeWorkspaceRoot()
    let captured: AgentBindingDescriptor | undefined
    const { runner, workspace } = await buildRunner({
      rootPath,
      skillAgent: { effort: 'low', model: 'haiku' },
      buildAgentBinding: (descriptor) => {
        captured = descriptor
        return new ClaudeCodeAgentBinding(descriptor)
      },
    })

    await collectRunEvents(runner, workspace, '')

    // Override wins for effort / model, kind inherits the server default.
    expect(captured?.effort).toBe('low')
    expect(captured?.model).toBe('haiku')
    expect(captured?.kind).toBe(DEFAULT_AGENT_BINDING.kind)
  })

  it('spawns inside a session dir that symlinks every registered skill and reference dir', async () => {
    const rootPath = await makeWorkspaceRoot()
    const sharedDir = join(rootPath, 'shared')
    await mkdir(sharedDir, { recursive: true })
    await writeFile(join(sharedDir, 'api-routes.md'), '# API routes', 'utf-8')

    const { runner, workspace, invocations } = await buildRunner({
      rootPath,
      cleanupSession: false,
      referenceDirs: [{ name: 'shared', path: sharedDir as AbsolutePath }],
    })

    await collectRunEvents(runner, workspace, '')

    const sessionCwd = invocations[0]?.options.cwd as string
    expect(sessionCwd).toContain('.braid-sessions/')
    expect(sessionCwd.startsWith(rootPath)).toBe(true)

    const skillNames = await readdir(join(sessionCwd, '.claude', 'skills'))
    expect(skillNames).toContain('braid-ask')
    expect(skillNames).toContain('shared')
  })

  it('forwards non-zero subprocess exit code into the completed event', async () => {
    const rootPath = await makeWorkspaceRoot()
    const { runner, workspace } = await buildRunner({
      rootPath,
      sequence: [{ stdoutLines: [], exitCode: 137 }],
    })

    const { events } = await collectRunEvents(runner, workspace, '')

    const completed = events.find(event => event.type === 'completed')
    expect(completed && 'exitCode' in completed ? completed.exitCode : undefined).toBe(137)
  })

  it('maps nested stream-json (system + assistant + result) into the public SkillEvent shape', async () => {
    const rootPath = await makeWorkspaceRoot()
    const { runner, workspace } = await buildRunner({
      rootPath,
      sequence: [{
        stdoutLines: [
          JSON.stringify({ type: 'system', subtype: 'init', cwd: '/tmp' }),
          JSON.stringify({
            type: 'assistant',
            message: { content: [
              { type: 'thinking', thinking: 'hidden' },
              { type: 'text', text: 'Found 3 nodes.' },
              { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/PRODUCT.md' } },
            ] },
          }),
          JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'This workspace tracks the order pipeline.',
          }),
        ],
        exitCode: 0,
      }],
      clock: () => T0,
    })

    const { events } = await collectRunEvents(runner, workspace, '')

    expect(events.map(event => event.type)).toEqual(['started', 'message', 'tool-call', 'message', 'completed'])
    const messageOne = events[1]
    expect(messageOne && 'text' in messageOne ? messageOne.text : undefined).toBe('Found 3 nodes.')
    const toolCall = events[2]
    expect(toolCall && 'tool' in toolCall ? toolCall.tool : undefined).toBe('Read')
    const messageTwo = events[3]
    expect(messageTwo && 'text' in messageTwo ? messageTwo.text : undefined).toBe('This workspace tracks the order pipeline.')
  })

  it('carries the original args and resumed=false on the started event for a fresh run', async () => {
    const rootPath = await makeWorkspaceRoot()
    const { runner, workspace } = await buildRunner({ rootPath })

    const { events } = await collectRunEvents(runner, workspace, 'what is X')

    const started = events.find(event => event.type === 'started')
    expect(started && 'args' in started ? started.args : undefined).toBe('what is X')
    expect(started && 'resumed' in started ? started.resumed : undefined).toBe(false)
  })

  it('reuses the same session dir on a resumed turn within the same process', async () => {
    const rootPath = await makeWorkspaceRoot()
    const { runner, workspace, invocations } = await buildRunner({
      rootPath,
      cleanupSession: false,
      sequence: [
        { stdoutLines: [JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' })], exitCode: 0 },
        { stdoutLines: [], exitCode: 0 },
      ],
    })

    await collectRunEvents(runner, workspace, 'first')
    await collectRunEvents(runner, workspace, 'follow up', { resumeSessionId: 'sess-1' })

    const firstCwd = invocations[0]!.options.cwd as string
    const secondCwd = invocations[1]!.options.cwd as string
    expect(firstCwd).toContain('.braid-sessions/')
    expect(secondCwd).toBe(firstCwd)
  })

  it('recovers the original session dir from RunRepository when the in-memory map is lost (server restart)', async () => {
    const rootPath = await makeWorkspaceRoot()
    const runRepository = new FsRunRepository()
    const skillRegistry = await makeSkillRegistry(rootPath)

    const before = await buildRunner({
      rootPath,
      cleanupSession: false,
      runRepository,
      skillRegistry,
      sequence: [
        { stdoutLines: [JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-r' })], exitCode: 0 },
      ],
    })
    await collectRunEvents(before.runner, before.workspace, 'first')

    // Fresh runner simulates a restart, the in-memory session map is empty,
    // but the JSONL run records still name the cwd the session came from.
    const after = await buildRunner({
      rootPath,
      cleanupSession: false,
      runRepository,
      skillRegistry,
      sequence: [{ stdoutLines: [], exitCode: 0 }],
    })
    await collectRunEvents(after.runner, after.workspace, 'follow up', { resumeSessionId: 'sess-r' })

    const firstCwd = before.invocations[0]!.options.cwd as string
    const secondCwd = after.invocations[0]!.options.cwd as string
    expect(secondCwd).toBe(firstCwd)
  })

  it('passes --resume to the binding and marks started.resumed=true when resumeSessionId is set', async () => {
    const rootPath = await makeWorkspaceRoot()
    const { runner, workspace, invocations } = await buildRunner({ rootPath })

    const { events } = await collectRunEvents(runner, workspace, 'follow up', { resumeSessionId: 'abc-123' })

    const started = events.find(event => event.type === 'started')
    expect(started && 'resumed' in started ? started.resumed : undefined).toBe(true)

    const spawnArgs = invocations[0]!.args
    const resumeIdx = spawnArgs.indexOf('--resume')
    expect(resumeIdx).toBeGreaterThan(-1)
    expect(spawnArgs[resumeIdx + 1]).toBe('abc-123')
    // On a resumed turn the prompt arg drops the leading `/skill-name`.
    expect(spawnArgs[1]).toBe('follow up')
  })

  it('maps claude result with is_error=true into an error event', async () => {
    const rootPath = await makeWorkspaceRoot()
    const { runner, workspace } = await buildRunner({
      rootPath,
      sequence: [{
        stdoutLines: [
          JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Unknown command: /braid-ask' }),
        ],
        exitCode: 0,
      }],
      clock: () => T0,
    })

    const { events } = await collectRunEvents(runner, workspace, '')

    // collectRunEvents stops once an error arrives, completed may not yet be observed.
    expect(events.map(event => event.type).slice(0, 2)).toEqual(['started', 'error'])
    const errorEvent = events.find(event => event.type === 'error')
    expect(errorEvent && 'message' in errorEvent ? errorEvent.message : undefined).toBe('Unknown command: /braid-ask')
  })

  it('reports positionAtSubscribe matching the events already persisted when a late subscriber arrives', async () => {
    const rootPath = await makeWorkspaceRoot()
    const { runner, workspace } = await buildRunner({
      rootPath,
      sequence: [{ stdoutLines: [JSON.stringify({ type: 'text', text: 'hi' })], exitCode: 0 }],
    })

    const { runId } = await collectRunEvents(runner, workspace, '')

    // After completion the runner forgets active state,
    // but the position counter persists so a late subscriber sees the final count.
    const late = runner.subscribe(runId, () => {})
    expect(late.positionAtSubscribe).toBeGreaterThan(0)
    late.unsubscribe()
    expect(runner.isActive(runId)).toBe(false)
  })

  describe('WorkspaceEventBus integration', () => {
    function makeRecordingBus() {
      const events: WorkspaceEvent[] = []
      const waiters: { predicate: (events: readonly WorkspaceEvent[]) => boolean, resolve: () => void }[] = []
      const bus: WorkspaceEventBus = {
        publish: (event) => {
          events.push(event)
          for (let i = waiters.length - 1; i >= 0; i--) {
            const waiter = waiters[i]!
            if (waiter.predicate(events)) {
              waiters.splice(i, 1)
              waiter.resolve()
            }
          }
        },
        subscribe: () => () => {},
      }
      const waitFor = (predicate: (events: readonly WorkspaceEvent[]) => boolean): Promise<void> => {
        if (predicate(events))
          return Promise.resolve()
        return new Promise<void>((resolve) => {
          waiters.push({ predicate, resolve })
        })
      }
      return { bus, events, waitFor }
    }

    it('publishes run.started + run.completed{outcome:success} on a clean exit', async () => {
      const rootPath = await makeWorkspaceRoot()
      const { bus, events: busEvents, waitFor } = makeRecordingBus()
      const { runner, workspace } = await buildRunner({ rootPath, eventBus: bus })

      await collectRunEvents(runner, workspace, '')
      await waitFor(events => events.some(event => event.type === 'run.completed'))

      expect(busEvents.map(event => event.type)).toEqual(['run.started', 'run.completed'])
      const completed = busEvents[1]!
      if (completed.type === 'run.completed')
        expect(completed.outcome).toBe('success')
    })

    it('publishes outcome:error when the subprocess exits non-zero', async () => {
      const rootPath = await makeWorkspaceRoot()
      const { bus, events: busEvents, waitFor } = makeRecordingBus()
      const { runner, workspace } = await buildRunner({
        rootPath,
        sequence: [{ stdoutLines: [], exitCode: 137 }],
        eventBus: bus,
      })

      await collectRunEvents(runner, workspace, '')
      await waitFor(events => events.some(event => event.type === 'run.completed'))

      const completed = busEvents.find(event => event.type === 'run.completed')!
      if (completed.type === 'run.completed')
        expect(completed.outcome).toBe('error')
    })

    it('publishes outcome:error when a SkillEvent of type error fires, even with exit 0', async () => {
      // Exit code 0 isn't enough to claim success, the skill itself reported a business-level failure mid-stream.
      const rootPath = await makeWorkspaceRoot()
      const { bus, events: busEvents, waitFor } = makeRecordingBus()
      const { runner, workspace } = await buildRunner({
        rootPath,
        sequence: [{
          stdoutLines: [
            JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'oops' }),
          ],
          exitCode: 0,
        }],
        eventBus: bus,
      })

      await collectRunEvents(runner, workspace, '')
      await waitFor(events => events.some(event => event.type === 'run.completed'))

      const completed = busEvents.find(event => event.type === 'run.completed')!
      if (completed.type === 'run.completed')
        expect(completed.outcome).toBe('error')
    })

    it('runs to completion when no eventBus is injected', async () => {
      const rootPath = await makeWorkspaceRoot()
      const { runner, workspace } = await buildRunner({ rootPath })

      await expect(collectRunEvents(runner, workspace, '')).resolves.toBeDefined()
    })
  })
})
