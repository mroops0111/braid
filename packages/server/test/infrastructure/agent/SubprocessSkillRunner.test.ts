import type {
  AbsolutePath,
  AgentBindingDescriptor,
  AgentId,
  ProductManifest,
  SkillEvent,
  SkillId,
  SkillManifest as SkillManifestData,
  SourceId,
  StorageKind,
  WorkspaceId,
} from '@telos/schema'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SkillManifest,
  type SkillRegistry,
  type SkillRunner as SkillRunnerPort,
  Workspace,
  type WorkspaceEvent,
  type WorkspaceEventBus,
} from '@telos/core'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeAgentBinding } from '../../../src/infrastructure/agent/ClaudeCodeAgentBinding.js'
import { mapSubprocessEvents, SubprocessSkillRunner } from '../../../src/infrastructure/agent/SubprocessSkillRunner.js'
import { FsRunRepository } from '../../../src/infrastructure/fs/FsRunRepository.js'
import { createMockSpawn } from '../../helpers/mockSpawn.js'

/**
 * Drive a run to completion the way the route handler would: subscribe
 * before the run starts emitting, collect events until completed/error.
 */
async function collectRunEvents(
  runner: SkillRunnerPort,
  workspace: Workspace,
  skillId: SkillId,
  args: string,
  options?: { resumeSessionId?: string },
): Promise<{ runId: string, events: SkillEvent[] }> {
  const runId = await runner.start(workspace, skillId, args, options)
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

const descriptor: AgentBindingDescriptor = {
  id: 'claude-default' as AgentId,
  kind: 'claude-code' as never,
  model: 'opus',
  effort: 'high',
  extraArgs: [],
  env: {},
}

function makeWorkspace(rootPath: AbsolutePath): Workspace {
  const manifest: ProductManifest = {
    name: 'demo',
    version: '0.0.0',
    ontologyId: 'ddd' as never,
    agents: { default: 'claude-default', tasks: {} },
    agentBindings: [descriptor],
    sources: [{
      kind: 'filesystem',
      id: 'code-a' as SourceId,
      role: 'code',
      name: 'a',
      path: rootPath,
    }],
    mcpServers: [],
    storage: { kind: 'in-memory' as StorageKind, config: {} },
    channels: [],
  }
  return new Workspace({
    id: 'ws-1' as WorkspaceId,
    rootPath,
    productManifest: manifest,
    pluginConfig: { plugins: [] },
  })
}

async function makeSkillRegistry(skillSourceParent: AbsolutePath): Promise<SkillRegistry> {
  const skillDir = join(skillSourceParent, 'telos-ask')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: telos-ask\ndescription: a\n---\n', 'utf-8')
  const data: SkillManifestData = {
    id: 'telos-ask' as SkillId,
    origin: 'builtin',
    path: join(skillDir, 'SKILL.md') as AbsolutePath,
    frontmatter: {
      name: 'telos-ask',
      description: 'a',
      disableModelInvocation: false,
      telos: {
        requiredEnv: [],
        requiredPaths: [],
        requiredMcpServers: [],
      },
    },
  }
  const manifest = new SkillManifest(data)
  return {
    list: async () => [manifest],
    find: async () => manifest,
    get: async () => manifest,
  }
}

describe('SubprocessSkillRunner', () => {
  it('emits started → mapped events → completed', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
    const { spawn, invocations } = createMockSpawn([{
      stdoutLines: [
        JSON.stringify({ type: 'text', text: 'hi' }),
        JSON.stringify({ type: 'tool_use', name: 'Read', input: { path: '/x' } }),
      ],
      exitCode: 0,
    }])

    const runner = new SubprocessSkillRunner({
      skillRegistry: await makeSkillRegistry(rootPath),
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      runRepository: new FsRunRepository(),
      spawn,
      clock: () => '2026-05-12T00:00:00+00:00',
    })

    const { events } = await collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, '')

    expect(events.map(e => e.type)).toEqual([
      'started',
      'message',
      'tool-call',
      'completed',
    ])
    expect(invocations).toHaveLength(1)
    expect(invocations[0]?.command).toBe('claude')
  })

  it('spawns with cwd at a session dir containing every registered skill + reference dirs', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
    const sharedDir = join(rootPath, 'shared')
    await mkdir(sharedDir, { recursive: true })
    await writeFile(join(sharedDir, 'api-routes.md'), '# API routes', 'utf-8')

    const { spawn, invocations } = createMockSpawn([{ stdoutLines: [], exitCode: 0 }])

    const runner = new SubprocessSkillRunner({
      skillRegistry: await makeSkillRegistry(rootPath),
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      runRepository: new FsRunRepository(),
      spawn,
      cleanupSession: false,
      referenceDirs: [{ name: 'shared', path: sharedDir as AbsolutePath }],
    })

    await collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, '')

    const sessionCwd = invocations[0]?.options.cwd as string
    expect(sessionCwd).toBeTruthy()
    expect(sessionCwd).toContain('.telos-sessions/')
    expect(sessionCwd.startsWith(rootPath)).toBe(true)

    const skillsRoot = join(sessionCwd, '.claude', 'skills')
    const skillNames = await readdir(skillsRoot)
    expect(skillNames).toContain('telos-ask')
    expect(skillNames).toContain('shared')
  })

  it('exitCode non-zero propagates into completed event', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
    const { spawn } = createMockSpawn([{ stdoutLines: [], exitCode: 137 }])

    const runner = new SubprocessSkillRunner({
      skillRegistry: await makeSkillRegistry(rootPath),
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      runRepository: new FsRunRepository(),
      spawn,
    })

    const { events } = await collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, '')
    const completed = events.find(e => e.type === 'completed')
    expect(completed && 'exitCode' in completed ? completed.exitCode : undefined).toBe(137)
  })

  it('maps claude nested stream-json (assistant + result) into message + tool-call events', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
    const { spawn } = createMockSpawn([{
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
    }])

    const runner = new SubprocessSkillRunner({
      skillRegistry: await makeSkillRegistry(rootPath),
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      runRepository: new FsRunRepository(),
      spawn,
      clock: () => '2026-05-12T00:00:00+00:00',
    })

    const { events } = await collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, '')

    expect(events.map(e => e.type)).toEqual([
      'started',
      'message',
      'tool-call',
      'message',
      'completed',
    ])
    const second = events[1]
    expect(second && 'text' in second ? second.text : undefined).toBe('Found 3 nodes.')
    const third = events[2]
    expect(third && 'tool' in third ? third.tool : undefined).toBe('Read')
    const fourth = events[3]
    expect(fourth && 'text' in fourth ? fourth.text : undefined).toBe('This workspace tracks the order pipeline.')
  })

  it('started event carries args and defaults resumed=false', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
    const { spawn } = createMockSpawn([{ stdoutLines: [], exitCode: 0 }])

    const runner = new SubprocessSkillRunner({
      skillRegistry: await makeSkillRegistry(rootPath),
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      runRepository: new FsRunRepository(),
      spawn,
    })

    const { events } = await collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, 'what is X')
    const started = events.find(e => e.type === 'started')
    expect(started && 'args' in started ? started.args : undefined).toBe('what is X')
    expect(started && 'resumed' in started ? started.resumed : undefined).toBe(false)
  })

  it('reuses the same session dir when resuming an existing claude session', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
    const { spawn, invocations } = createMockSpawn([
      { stdoutLines: [JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' })], exitCode: 0 },
      { stdoutLines: [], exitCode: 0 },
    ])

    const runner = new SubprocessSkillRunner({
      skillRegistry: await makeSkillRegistry(rootPath),
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      runRepository: new FsRunRepository(),
      spawn,
      cleanupSession: false,
    })

    await collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, 'first')
    const firstCwd = invocations[0]!.options.cwd as string
    expect(firstCwd).toContain('.telos-sessions/')

    await collectRunEvents(
      runner,
      makeWorkspace(rootPath),
      'telos-ask' as SkillId,
      'follow up',
      { resumeSessionId: 'sess-1' },
    )
    const secondCwd = invocations[1]!.options.cwd as string
    expect(secondCwd).toBe(firstCwd)
  })

  it('recovers session dir from RunRepository after the in-memory map is lost', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
    const { spawn, invocations } = createMockSpawn([
      { stdoutLines: [JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-r' })], exitCode: 0 },
      { stdoutLines: [], exitCode: 0 },
    ])

    const runRepository = new FsRunRepository()
    const workspace = makeWorkspace(rootPath)
    const skillRegistry = await makeSkillRegistry(rootPath)

    const runnerA = new SubprocessSkillRunner({
      skillRegistry,
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      spawn,
      cleanupSession: false,
      runRepository,
    })
    const { runId: firstRunId } = await collectRunEvents(runnerA, workspace, 'telos-ask' as SkillId, 'first')
    expect(firstRunId).toBeTruthy()

    // Build runner B with an empty in-memory map (server restart).
    const runnerB = new SubprocessSkillRunner({
      skillRegistry,
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      spawn,
      cleanupSession: false,
      runRepository,
    })
    await collectRunEvents(
      runnerB,
      workspace,
      'telos-ask' as SkillId,
      'follow up',
      { resumeSessionId: 'sess-r' },
    )

    const firstCwd = invocations[0]!.options.cwd as string
    const secondCwd = invocations[1]!.options.cwd as string
    expect(secondCwd).toBe(firstCwd)
  })

  it('resumeSessionId option flows to agent binding and started.resumed=true', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
    const { spawn, invocations } = createMockSpawn([{ stdoutLines: [], exitCode: 0 }])

    const runner = new SubprocessSkillRunner({
      skillRegistry: await makeSkillRegistry(rootPath),
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      runRepository: new FsRunRepository(),
      spawn,
    })

    const { events } = await collectRunEvents(
      runner,
      makeWorkspace(rootPath),
      'telos-ask' as SkillId,
      'follow up',
      { resumeSessionId: 'abc-123' },
    )

    const started = events.find(e => e.type === 'started')
    expect(started && 'resumed' in started ? started.resumed : undefined).toBe(true)

    const spawnArgs = invocations[0]!.args
    const resumeIdx = spawnArgs.indexOf('--resume')
    expect(resumeIdx).toBeGreaterThan(-1)
    expect(spawnArgs[resumeIdx + 1]).toBe('abc-123')
    // The prompt arg drops the leading "/skill-name" when resuming.
    expect(spawnArgs[1]).toBe('follow up')
  })

  it('maps claude result with is_error=true into an error event', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
    const { spawn } = createMockSpawn([{
      stdoutLines: [
        JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Unknown command: /telos-ask' }),
      ],
      exitCode: 0,
    }])

    const runner = new SubprocessSkillRunner({
      skillRegistry: await makeSkillRegistry(rootPath),
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      runRepository: new FsRunRepository(),
      spawn,
      clock: () => '2026-05-12T00:00:00+00:00',
    })

    const { events } = await collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, '')

    // 'error' arrives mid-stream, our helper stops on it. Subsequent 'completed' may not be observed here.
    expect(events.map(e => e.type).slice(0, 2)).toEqual(['started', 'error'])
    const errEvent = events.find(e => e.type === 'error')
    expect(errEvent && 'message' in errEvent ? errEvent.message : undefined).toBe('Unknown command: /telos-ask')
  })

  it('subscribe returns positionAtSubscribe equal to events already emitted', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
    const { spawn } = createMockSpawn([{
      stdoutLines: [JSON.stringify({ type: 'text', text: 'hi' })],
      exitCode: 0,
    }])

    const runner = new SubprocessSkillRunner({
      skillRegistry: await makeSkillRegistry(rootPath),
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      runRepository: new FsRunRepository(),
      spawn,
    })

    // Run to completion.
    const { runId } = await collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, '')

    // After completion the runner forgets active state but the position
    // counter persists, so a late subscriber sees the final count.
    const late = runner.subscribe(runId, () => {})
    expect(late.positionAtSubscribe).toBeGreaterThan(0)
    late.unsubscribe()
    expect(runner.isActive(runId)).toBe(false)
  })

  describe('WorkspaceEventBus integration', () => {
    function makeRecordingBus() {
      const events: WorkspaceEvent[] = []
      const waiters: Array<{ predicate: (events: readonly WorkspaceEvent[]) => boolean, resolve: () => void }> = []
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
      const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
      const { spawn } = createMockSpawn([{ stdoutLines: [], exitCode: 0 }])
      const { bus, events: busEvents, waitFor } = makeRecordingBus()

      const runner = new SubprocessSkillRunner({
        skillRegistry: await makeSkillRegistry(rootPath),
        agentBinding: new ClaudeCodeAgentBinding(descriptor),
        apiUrl: 'http://localhost:4321',
        runRepository: new FsRunRepository(),
        spawn,
        eventBus: bus,
      })

      await collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, '')
      await waitFor(events => events.some(e => e.type === 'run.completed'))

      const types = busEvents.map(e => e.type)
      expect(types).toEqual(['run.started', 'run.completed'])
      const completed = busEvents[1]!
      expect(completed.type).toBe('run.completed')
      if (completed.type === 'run.completed')
        expect(completed.outcome).toBe('success')
    })

    it('publishes outcome:error when the subprocess exits non-zero', async () => {
      const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
      const { spawn } = createMockSpawn([{ stdoutLines: [], exitCode: 137 }])
      const { bus, events: busEvents, waitFor } = makeRecordingBus()

      const runner = new SubprocessSkillRunner({
        skillRegistry: await makeSkillRegistry(rootPath),
        agentBinding: new ClaudeCodeAgentBinding(descriptor),
        apiUrl: 'http://localhost:4321',
        runRepository: new FsRunRepository(),
        spawn,
        eventBus: bus,
      })

      await collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, '')
      await waitFor(events => events.some(e => e.type === 'run.completed'))

      const completed = busEvents.find(e => e.type === 'run.completed')!
      if (completed.type === 'run.completed')
        expect(completed.outcome).toBe('error')
    })

    it('publishes outcome:error when an error event fired during the run, even on exit 0', async () => {
      // Simulates an error.result with is_error=true followed by a clean
      // process exit. Wire-level: claude prints the error event before
      // closing stdio. We expect outcome=error because business logic
      // failed, not just because the OS-level exit was non-zero.
      const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
      const { spawn } = createMockSpawn([{
        stdoutLines: [
          JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'oops' }),
        ],
        exitCode: 0,
      }])
      const { bus, events: busEvents, waitFor } = makeRecordingBus()

      const runner = new SubprocessSkillRunner({
        skillRegistry: await makeSkillRegistry(rootPath),
        agentBinding: new ClaudeCodeAgentBinding(descriptor),
        apiUrl: 'http://localhost:4321',
        runRepository: new FsRunRepository(),
        spawn,
        eventBus: bus,
      })

      await collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, '')
      await waitFor(events => events.some(e => e.type === 'run.completed'))

      const completed = busEvents.find(e => e.type === 'run.completed')!
      if (completed.type === 'run.completed')
        expect(completed.outcome).toBe('error')
    })

    it('runs cleanly when no eventBus is injected (legacy callers)', async () => {
      // Pre-Theme-2 callers don't pass eventBus. The runner must not crash.
      const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
      const { spawn } = createMockSpawn([{ stdoutLines: [], exitCode: 0 }])

      const runner = new SubprocessSkillRunner({
        skillRegistry: await makeSkillRegistry(rootPath),
        agentBinding: new ClaudeCodeAgentBinding(descriptor),
        apiUrl: 'http://localhost:4321',
        runRepository: new FsRunRepository(),
        spawn,
      })

      await expect(collectRunEvents(runner, makeWorkspace(rootPath), 'telos-ask' as SkillId, ''))
        .resolves
        .toBeDefined()
    })
  })
})

describe('mapSubprocessEvents', () => {
  const now = '2026-05-12T00:00:00+00:00'

  it('ignores system without session_id / rate_limit / user-success envelopes', () => {
    expect(mapSubprocessEvents({ type: 'system', subtype: 'init' }, now)).toEqual([])
    expect(mapSubprocessEvents({ type: 'rate_limit_event' }, now)).toEqual([])
    expect(mapSubprocessEvents({
      type: 'user',
      message: { content: [{ type: 'tool_result', is_error: false, content: 'ok' }] },
    }, now)).toEqual([])
  })

  it('maps system/init with session_id to a session-started event', () => {
    const out = mapSubprocessEvents({
      type: 'system',
      subtype: 'init',
      session_id: 'abc-123-uuid',
    }, now)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'session-started', sessionId: 'abc-123-uuid' })
  })

  it('emits user.tool_result as a tool-result event (isError flag mirrors stream)', () => {
    const ok = mapSubprocessEvents({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] },
    }, now)
    expect(ok).toHaveLength(1)
    expect(ok[0]).toMatchObject({ type: 'tool-result', toolCallId: 't1', output: 'ok', isError: false })

    const bad = mapSubprocessEvents({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'bash: cmd not found' }] },
    }, now)
    expect(bad[0]).toMatchObject({ type: 'tool-result', toolCallId: 't2', isError: true })
  })

  it('expands assistant.message.content[] into one event per text / tool_use part with toolCallId', () => {
    const result = mapSubprocessEvents({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 'toolu_abc', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    }, now)
    expect(result.map(e => e.type)).toEqual(['message', 'tool-call'])
    expect(result[1]).toMatchObject({ type: 'tool-call', tool: 'Bash', toolCallId: 'toolu_abc' })
  })
})
