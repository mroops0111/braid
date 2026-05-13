import type {
  AbsolutePath,
  AgentBindingDescriptor,
  AgentId,
  ProductManifest,
  SkillId,
  SkillManifest as SkillManifestData,
  SourceId,
  StorageKind,
  WorkspaceId,
} from '@telos/schema'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillManifest, type SkillRegistry, Workspace } from '@telos/core'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeAgentBinding } from '../../../src/infrastructure/agent/ClaudeCodeAgentBinding.js'
import { mapSubprocessEvents, SubprocessSkillRunner } from '../../../src/infrastructure/agent/SubprocessSkillRunner.js'
import { FsRunRepository } from '../../../src/infrastructure/fs/FsRunRepository.js'
import { createMockSpawn } from '../../helpers/mockSpawn.js'

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
      spawn,
      clock: () => '2026-05-12T00:00:00+00:00',
    })

    const events: Array<{ type: string }> = []
    for await (const event of runner.run(makeWorkspace(rootPath), 'telos-ask' as SkillId, '')) {
      events.push(event)
    }

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
      spawn,
      cleanupSession: false,
      referenceDirs: [{ name: 'shared', path: sharedDir as AbsolutePath }],
    })

    const events: Array<{ type: string }> = []
    for await (const event of runner.run(makeWorkspace(rootPath), 'telos-ask' as SkillId, '')) {
      events.push(event)
    }

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
      spawn,
    })

    const events: Array<{ type: string, exitCode?: number }> = []
    for await (const event of runner.run(makeWorkspace(rootPath), 'telos-ask' as SkillId, '')) {
      events.push(event as never)
    }
    const completed = events.find(e => e.type === 'completed')
    expect(completed?.exitCode).toBe(137)
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
      spawn,
      clock: () => '2026-05-12T00:00:00+00:00',
    })

    const events: Array<{ type: string, text?: string, tool?: string }> = []
    for await (const event of runner.run(makeWorkspace(rootPath), 'telos-ask' as SkillId, '')) {
      events.push(event as never)
    }

    expect(events.map(e => e.type)).toEqual([
      'started',
      'message',
      'tool-call',
      'message',
      'completed',
    ])
    expect(events[1]?.text).toBe('Found 3 nodes.')
    expect(events[2]?.tool).toBe('Read')
    expect(events[3]?.text).toBe('This workspace tracks the order pipeline.')
  })

  it('started event carries args and defaults resumed=false', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-runner-'))) as AbsolutePath
    const { spawn } = createMockSpawn([{ stdoutLines: [], exitCode: 0 }])

    const runner = new SubprocessSkillRunner({
      skillRegistry: await makeSkillRegistry(rootPath),
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      spawn,
    })

    const events: Array<{ type: string, args?: string, resumed?: boolean }> = []
    for await (const event of runner.run(makeWorkspace(rootPath), 'telos-ask' as SkillId, 'what is X')) {
      events.push(event as never)
    }
    const started = events.find(e => e.type === 'started')
    expect(started?.args).toBe('what is X')
    expect(started?.resumed).toBe(false)
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
      spawn,
      cleanupSession: false,
    })

    // First turn: claude reports session sess-1, runner captures the dir.
    for await (const _ of runner.run(makeWorkspace(rootPath), 'telos-ask' as SkillId, 'first')) {
      // drain
    }
    const firstCwd = invocations[0]!.options.cwd as string
    expect(firstCwd).toContain('.telos-sessions/')

    // Second turn: resumeSessionId = sess-1 must spawn from the same cwd.
    for await (const _ of runner.run(
      makeWorkspace(rootPath),
      'telos-ask' as SkillId,
      'follow up',
      { resumeSessionId: 'sess-1' },
    )) {
      // drain
    }
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

    // Build runner A, run first turn so the dir + record exist on disk.
    const runnerA = new SubprocessSkillRunner({
      skillRegistry,
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      spawn,
      cleanupSession: false,
      runRepository,
    })
    let firstRunId: string | undefined
    for await (const event of runnerA.run(workspace, 'telos-ask' as SkillId, 'first')) {
      if (event.type === 'started')
        firstRunId = event.runId
    }
    expect(firstRunId).toBeTruthy()
    // Simulate the route writing the record back to the repo after seeing
    // started + session-started. Without this the runner has nothing to scan.
    await runRepository.saveRecord(workspace, {
      runId: firstRunId! as never,
      workspaceId: workspace.id,
      skillId: 'telos-ask' as SkillId,
      args: 'first',
      resumed: false,
      sessionId: 'sess-r',
      startedAt: '2026-05-12T00:00:00+00:00',
    })

    // Build runner B with an empty in-memory map (server restart).
    const runnerB = new SubprocessSkillRunner({
      skillRegistry,
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      spawn,
      cleanupSession: false,
      runRepository,
    })
    for await (const _ of runnerB.run(
      workspace,
      'telos-ask' as SkillId,
      'follow up',
      { resumeSessionId: 'sess-r' },
    )) {
      // drain
    }

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
      spawn,
    })

    const events: Array<{ type: string, resumed?: boolean }> = []
    for await (const event of runner.run(
      makeWorkspace(rootPath),
      'telos-ask' as SkillId,
      'follow up',
      { resumeSessionId: 'abc-123' },
    )) {
      events.push(event as never)
    }

    const started = events.find(e => e.type === 'started')
    expect(started?.resumed).toBe(true)

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
      spawn,
      clock: () => '2026-05-12T00:00:00+00:00',
    })

    const events: Array<{ type: string, message?: string }> = []
    for await (const event of runner.run(makeWorkspace(rootPath), 'telos-ask' as SkillId, '')) {
      events.push(event as never)
    }

    expect(events.map(e => e.type)).toEqual(['started', 'error', 'completed'])
    expect(events[1]?.message).toBe('Unknown command: /telos-ask')
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
