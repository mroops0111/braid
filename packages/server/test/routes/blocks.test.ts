import type { SkillRegistry } from '@braidhq/core'
import type { AbsolutePath, SkillEvent } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeAgentBinding } from '@braidhq/agent-claude-code'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composeApp.js'
import { FsRunRepository } from '../../src/infrastructure/skill/FsRunRepository.js'
import { SubprocessSkillRunner } from '../../src/infrastructure/skill/SubprocessSkillRunner.js'
import { DEFAULT_AGENT_BINDING, makeSkillManifest, makeWorkspace } from '../helpers/fakes.js'
import { createMockSpawn } from '../helpers/mockSpawn.js'

function makeSkillRegistry(): SkillRegistry {
  const manifest = makeSkillManifest({ id: 'braid:ask', path: '/abs/SKILL.md' as AbsolutePath })
  return {
    list: async () => [manifest],
    find: async () => manifest,
    get: async () => manifest,
  }
}

async function buildApp() {
  const rootPath = (await mkdtemp(join(tmpdir(), 'braid-blocks-route-'))) as AbsolutePath
  const workspace = makeWorkspace({ rootPath })
  const runRepository = new FsRunRepository()
  // The run must outlive the request that posts a block,
  // so the scripted process holds its stdout open until the test releases it.
  const { spawn, endAll } = createMockSpawn([{ stdoutLines: [], hold: true }])
  const skillRegistry = makeSkillRegistry()
  const skillRunner = new SubprocessSkillRunner({
    skillRegistry,
    buildAgentBinding: descriptor => new ClaudeCodeAgentBinding(descriptor),
    defaultAgent: DEFAULT_AGENT_BINDING,
    apiUrl: 'http://localhost:4321',
    runRepository,
    spawn,
  })
  const deps = composeApp({ skillRegistry, skillRunner })
  await deps.workspaceRepository.save(workspace)
  return { app: createApp(deps), workspace, runRepository, skillRunner, endAll }
}

async function startRun(app: ReturnType<typeof createApp>, workspaceId: string): Promise<string> {
  const response = await app.request(`/workspaces/${workspaceId}/skills/braid:ask/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args: 'how do templates differ' }),
  })
  const body = await response.json() as { runId: string }
  return body.runId
}

/**
 * The run drains asynchronously, so a fixed sleep flakes under load.
 * Poll the runner instead, which is the same condition the route checks.
 */
async function waitForRunToEnd(
  skillRunner: Awaited<ReturnType<typeof buildApp>>['skillRunner'],
  runId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!skillRunner.isActive(runId as never))
      return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Run "${runId}" never finished draining`)
}

async function readEvents(
  runRepository: FsRunRepository,
  workspace: Awaited<ReturnType<typeof buildApp>>['workspace'],
  runId: string,
): Promise<SkillEvent[]> {
  const events: SkillEvent[] = []
  for await (const event of runRepository.readEvents(workspace, runId as never))
    events.push(event)
  return events
}

describe('render routes', () => {
  it('records a showAnswer call on the run that made it', async () => {
    const { app, workspace, runRepository, skillRunner, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience: 'business', markdown: 'A shared template is a state of @node:ctx.documentTemplate.' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    endAll()
    await waitForRunToEnd(skillRunner, runId)
    const events = await readEvents(runRepository, workspace, runId)
    const block = events.find(event => event.type === 'block')
    expect(block).toBeDefined()
    expect(block?.type === 'block' && block.block.call).toBe('showAnswer')
    expect(block?.type === 'block' && block.id.startsWith('block-')).toBe(true)
  })

  it('records a showFinding call with both of its sides', async () => {
    const { app, workspace, runRepository, skillRunner, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/finding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audience: 'business',
        statement: 'The spec makes Admin mandatory, the code never enforces it.',
        verdict: 'conflict',
        confidence: 0.8,
        sides: [
          { summary: 'The spec says Admin is mandatory.', refs: [] },
          { summary: 'The default is false for all three.', refs: [] },
        ],
      }),
    })

    expect(response.status).toBe(200)

    endAll()
    await waitForRunToEnd(skillRunner, runId)
    const events = await readEvents(runRepository, workspace, runId)
    const block = events.find(event => event.type === 'block')
    expect(block?.type === 'block' && block.block.call).toBe('showFinding')
    expect(block?.type === 'block' && block.block.call === 'showFinding' && block.block.sides).toHaveLength(2)
  })

  it('rejects a finding carrying fewer than two sides', async () => {
    const { app, workspace, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/finding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audience: 'business',
        statement: 'Only one side.',
        verdict: 'conflict',
        confidence: 0.5,
        sides: [{ summary: 'Alone.', refs: [] }],
      }),
    })

    expect(response.status).toBe(400)
    endAll()
  })

  it('reports a run that is no longer active as absent', async () => {
    const { app, workspace, skillRunner, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)
    endAll()
    await waitForRunToEnd(skillRunner, runId)

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience: 'business', markdown: 'Too late.' }),
    })

    expect(response.status).toBe(404)
  })

  it('records a showMatrix call with per-cell tone and evidence', async () => {
    const { app, workspace, runRepository, skillRunner, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/matrix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audience: 'business',
        rowAxis: { label: 'Actor', items: [{ id: 'owner', label: 'Owner' }] },
        columnAxis: { label: 'Capability', items: [{ id: 'edit', label: 'Edit' }] },
        cells: [{ row: 'owner', column: 'edit', state: 'allowed', tone: 'affirmed', refs: [] }],
      }),
    })

    expect(response.status).toBe(200)

    endAll()
    await waitForRunToEnd(skillRunner, runId)
    const events = await readEvents(runRepository, workspace, runId)
    const block = events.find(event => event.type === 'block')
    expect(block?.type === 'block' && block.block.call).toBe('showMatrix')
  })

  it('records a showTrace call including what the run declined to use', async () => {
    const { app, workspace, runRepository, skillRunner, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audience: 'both',
        searched: [{ query: 'template sharing', hits: 12 }],
        read: [],
        cited: [],
        skipped: [],
      }),
    })

    expect(response.status).toBe(200)

    endAll()
    await waitForRunToEnd(skillRunner, runId)
    const events = await readEvents(runRepository, workspace, runId)
    const block = events.find(event => event.type === 'block')
    expect(block?.type === 'block' && block.block.call).toBe('showTrace')
  })

  it('publishes the render operations in the OpenAPI document', async () => {
    const { app, endAll } = await buildApp()

    const document = await (await app.request('/openapi.json')).json() as {
      paths: Record<string, Record<string, { operationId?: string }>>
    }
    const operationIds = Object.values(document.paths)
      .flatMap(methods => Object.values(methods))
      .map(operation => operation.operationId)

    expect(operationIds).toContain('showAnswer')
    expect(operationIds).toContain('showEvidence')
    expect(operationIds).toContain('showFinding')
    expect(operationIds).toContain('showMatrix')
    expect(operationIds).toContain('showTrace')
    endAll()
  })
})
