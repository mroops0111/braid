import type { SkillRegistry } from '@braidhq/core'
import type { AbsolutePath } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeAgentBinding } from '@braidhq/agent-claude-code'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composeApp.js'
import { SubprocessSkillRunner } from '../../src/infrastructure/agent/SubprocessSkillRunner.js'
import { FsRunRepository } from '../../src/infrastructure/fs/FsRunRepository.js'
import { DEFAULT_AGENT_BINDING, makeSkillManifest, makeWorkspace } from '../helpers/fakes.js'
import { createMockSpawn } from '../helpers/mockSpawn.js'

function makeSkillRegistry(): SkillRegistry {
  const manifest = makeSkillManifest({ id: 'ask', path: '/abs/SKILL.md' as AbsolutePath })
  return {
    list: async () => [manifest],
    find: async () => manifest,
    get: async () => manifest,
  }
}

async function buildApp(stdoutLines: string[] = []) {
  const rootPath = (await mkdtemp(join(tmpdir(), 'braid-skill-route-'))) as AbsolutePath
  const workspace = makeWorkspace({ rootPath })
  const { spawn } = createMockSpawn(stdoutLines.length > 0
    ? [{ stdoutLines, exitCode: 0 }]
    : [])
  const skillRegistry = makeSkillRegistry()
  const skillRunner = new SubprocessSkillRunner({
    skillRegistry,
    buildAgentBinding: descriptor => new ClaudeCodeAgentBinding(descriptor),
    defaultAgent: DEFAULT_AGENT_BINDING,
    apiUrl: 'http://localhost:4321',
    runRepository: new FsRunRepository(),
    spawn,
  })
  const deps = composeApp({ skillRegistry, skillRunner })
  await deps.workspaceRepository.save(workspace)
  return { app: createApp(deps), workspace }
}

describe('skill routes', () => {
  it('GET /workspaces/:ws/skills returns the registered manifests', async () => {
    const { app, workspace } = await buildApp()

    const response = await app.request(`/workspaces/${workspace.id}/skills`)

    expect(response.status).toBe(200)
    const body = await response.json() as { items: Array<{ id: string }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.id).toBe('ask')
  })

  it('POST /workspaces/:ws/skills/:id/run accepts the request and returns a fresh run id', async () => {
    const { app, workspace } = await buildApp([JSON.stringify({ type: 'text', text: 'hello' })])

    const response = await app.request(`/workspaces/${workspace.id}/skills/ask/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: 'what is voidTask' }),
    })

    expect(response.status).toBe(202)
    const body = await response.json() as { runId: string }
    expect(typeof body.runId).toBe('string')
    expect(body.runId.length).toBeGreaterThan(0)
  })

  it('returns 404 when the workspace is not registered', async () => {
    const skillRegistry = makeSkillRegistry()
    const { spawn } = createMockSpawn([])
    const skillRunner = new SubprocessSkillRunner({
      skillRegistry,
      buildAgentBinding: descriptor => new ClaudeCodeAgentBinding(descriptor),
      defaultAgent: DEFAULT_AGENT_BINDING,
      apiUrl: 'http://localhost:4321',
      runRepository: new FsRunRepository(),
      spawn,
    })
    const deps = composeApp({ skillRegistry, skillRunner })

    const response = await createApp(deps).request('/workspaces/missing-ws/skills')

    expect(response.status).toBe(404)
  })
})
