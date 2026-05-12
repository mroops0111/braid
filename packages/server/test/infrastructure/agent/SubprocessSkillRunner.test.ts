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
import { SubprocessSkillRunner } from '../../../src/infrastructure/agent/SubprocessSkillRunner.js'
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
      tempDir: rootPath,
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
      tempDir: rootPath,
      cleanupSession: false,
      referenceDirs: [{ name: 'shared', path: sharedDir as AbsolutePath }],
    })

    const events: Array<{ type: string }> = []
    for await (const event of runner.run(makeWorkspace(rootPath), 'telos-ask' as SkillId, '')) {
      events.push(event)
    }

    const sessionCwd = invocations[0]?.options.cwd as string
    expect(sessionCwd).toBeTruthy()
    expect(sessionCwd).toContain('telos-session-')

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
      tempDir: rootPath,
    })

    const events: Array<{ type: string, exitCode?: number }> = []
    for await (const event of runner.run(makeWorkspace(rootPath), 'telos-ask' as SkillId, '')) {
      events.push(event as never)
    }
    const completed = events.find(e => e.type === 'completed')
    expect(completed?.exitCode).toBe(137)
  })
})
