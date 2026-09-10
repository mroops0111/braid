import type { NodeId, NodeTypeId, SkillEvent, SourceId } from '@braidhq/schema'
import type { createApp } from '../../src/app.js'
import type { FsRunRepository } from '../../src/infrastructure/skill/FsRunRepository.js'
import { UserId } from '@braidhq/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { RunTokenRegistry } from '../../src/infrastructure/skill/RunTokenRegistry.js'
import { buildRunnerApp, endAllSpawned } from '../helpers/runnerApp.js'
import { waitForRunToEnd } from '../helpers/settle.js'

/** The one node the graph holds, for a ref that says it came from there. */
const CITED = 'node-signing' as NodeId

async function buildApp() {
  const runTokens = new RunTokenRegistry()
  // The run must outlive the request that posts a block,
  // so the scripted process holds its stdout open until the test releases it.
  const built = await buildRunnerApp({
    spawns: [{ stdoutLines: [], hold: true }],
    runTokens,
    compose: { accessTokenVerifiers: [runTokens] },
  })
  const { deps, workspace, runRepository, skillRunner, endAll } = built
  // A ref claiming the graph is checked against it, so a test citing a node
  // needs that node to exist, the same as a real run does.
  await deps.modelRepository.applyOperations(workspace.id, [
    {
      operation: 'addNode',
      payload: {
        type: 'aggregate' as NodeTypeId,
        name: 'Signing',
        id: CITED,
        status: 'draft',
        // Every node must show where it came from, and a proposal filed later
        // is validated against the whole graph, this node included.
        metadata: { sourceReferences: [{ sourceId: 'spec' as SourceId, location: { uri: 'a/b.md', startLine: 1 } }] },
      },
    },
  ])
  return { app: built.app, workspace, runRepository, skillRunner, runTokens, startedBy: UserId.parse('local-user'), endAll }
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
  // A held process outlives a test that threw before releasing it, and its
  // drain promise never settles. Released here so one failure cannot leave a
  // handle open for the rest of the worker.
  afterEach(endAllSpawned)

  it('records a showAnswer call on the run that made it', async () => {
    const { app, workspace, runRepository, skillRunner, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience: 'business', markdown: 'A shared template is a state of @node:ctx.documentTemplate.' }),
    })

    expect(response.status).toBe(201)
    // The id is the one thing the caller could not already know.
    expect(await response.json()).toEqual({ blockId: expect.stringMatching(/^block-/) })

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
        sides: [
          { summary: 'The spec says Admin is mandatory.', refs: [] },
          { summary: 'The default is false for all three.', refs: [] },
        ],
      }),
    })

    expect(response.status).toBe(201)
    const recorded = await response.json() as { support?: string }

    endAll()
    await waitForRunToEnd(skillRunner, runId)
    const events = await readEvents(runRepository, workspace, runId)
    const block = events.find(event => event.type === 'block')
    expect(block?.type === 'block' && block.block.call).toBe('showFinding')
    expect(block?.type === 'block' && block.block.call === 'showFinding' && block.block.sides).toHaveLength(2)
    // Neither side carried a reference, so the derived support is the weakest.
    expect(block?.type === 'block' && block.block.call === 'showFinding' && block.block.support).toBe('thin')
    // The skill is told what was derived, since it cannot compute this itself
    // and its own wording should match the strength the reader is shown.
    expect(recorded).toMatchObject({ support: 'thin' })
  })

  it('derives corroborated support when every side cites the graph', async () => {
    const { app, workspace, runRepository, skillRunner, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)
    const ref = (provenance: string) => ({
      provenance,
      ...(provenance === 'graph' ? { nodeId: CITED } : {}),
      reference: { sourceId: 'spec', location: { uri: 'docs/spec.md', startLine: 3 } },
    })

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/finding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statement: 'Both sides are cited by a node.',
        verdict: 'conflict',
        sides: [
          { summary: 'The spec says one thing.', refs: [ref('graph')] },
          { summary: 'The code does another.', refs: [ref('graph')] },
        ],
      }),
    })
    expect(response.status).toBe(201)

    endAll()
    await waitForRunToEnd(skillRunner, runId)
    const events = await readEvents(runRepository, workspace, runId)
    const block = events.find(event => event.type === 'block')
    expect(block?.type === 'block' && block.block.call === 'showFinding' && block.block.support).toBe('corroborated')
  })

  it('derives partial support when a side rests on what the run read itself', async () => {
    const { app, workspace, runRepository, skillRunner, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)
    const ref = (provenance: string) => ({
      provenance,
      ...(provenance === 'graph' ? { nodeId: CITED } : {}),
      reference: { sourceId: 'spec', location: { uri: 'docs/spec.md', startLine: 3 } },
    })

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/finding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statement: 'One side is unrecorded.',
        verdict: 'conflict',
        sides: [
          { summary: 'The spec says one thing.', refs: [ref('graph')] },
          { summary: 'The code does another.', refs: [ref('agent')] },
        ],
      }),
    })
    expect(response.status).toBe(201)

    endAll()
    await waitForRunToEnd(skillRunner, runId)
    const events = await readEvents(runRepository, workspace, runId)
    const block = events.find(event => event.type === 'block')
    expect(block?.type === 'block' && block.block.call === 'showFinding' && block.block.support).toBe('partial')
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
        sides: [{ summary: 'Alone.', refs: [] }],
      }),
    })

    expect(response.status).toBe(400)
    endAll()
  })

  // The declaration creates nothing and decides nothing, so it has nothing to
  // send back, and a body saying "success" would be paid for in the run's own
  // context to repeat the status line.
  it('answers the no-clarification declaration with no content at all', async () => {
    const { app, workspace, runTokens, startedBy, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)
    const token = runTokens.issue(runId as never, startedBy)

    const response = await app.request(`/workspaces/${workspace.id}/clarifications/none`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    endAll()
  })

  // A ref saying it came from the graph is the one claim this side can settle,
  // so it is settled here rather than left for a reader to trip over.
  it('refuses a block citing the graph for a node the model does not hold', async () => {
    const { app, workspace, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refs: [{
          provenance: 'graph',
          nodeId: 'node-never-existed',
          reference: { sourceId: 'spec', location: { uri: 'a/b.md', startLine: 1 } },
        }],
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('node-never-existed')
    endAll()
  })

  // Claiming the graph while naming nothing makes the same claim and withholds
  // the only thing that would let anyone test it.
  it('refuses a block claiming the graph without naming what it took', async () => {
    const { app, workspace, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refs: [{
          provenance: 'graph',
          reference: { sourceId: 'spec', location: { uri: 'a/b.md', startLine: 1 } },
        }],
      }),
    })

    expect(response.status).toBe(400)
    endAll()
  })

  // The run's own reading rests on nothing but itself, so there is nothing for
  // the graph to settle and refusing it would refuse the ordinary case.
  it('records a ref the run read for itself, which the graph cannot settle', async () => {
    const { app, workspace, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refs: [{
          provenance: 'agent',
          reference: { sourceId: 'spec', location: { uri: 'a/b.md', startLine: 1 } },
        }],
      }),
    })

    expect(response.status).toBe(201)
    endAll()
  })

  // The run id is a fact the server holds, so nothing is asked for it. A
  // resumed run once read the id off the record it was answering and
  // attributed its work to the finished run that had asked.
  it('attributes a proposal to the run whose credential created it', async () => {
    const { app, workspace, runTokens, startedBy, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)
    const token = runTokens.issue(runId as never, startedBy)

    const response = await app.request(`/workspaces/${workspace.id}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ operations: [], generatedBy: 'ddd:extract', rationale: 'from a live run' }),
    })

    expect(response.status).toBe(201)
    expect((await response.json() as { skillRunId?: string }).skillRunId).toBe(runId)
    endAll()
  })

  it('leaves a proposal a person filed unattributed', async () => {
    const { app, workspace, endAll } = await buildApp()

    const response = await app.request(`/workspaces/${workspace.id}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [], generatedBy: 'ddd:extract', rationale: 'filed by hand' }),
    })

    expect(response.status).toBe(201)
    expect((await response.json() as { skillRunId?: string }).skillRunId).toBeUndefined()
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

    expect(response.status).toBe(201)

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

    expect(response.status).toBe(201)

    endAll()
    await waitForRunToEnd(skillRunner, runId)
    const events = await readEvents(runRepository, workspace, runId)
    const block = events.find(event => event.type === 'block')
    expect(block?.type === 'block' && block.block.call).toBe('showTrace')
  })

  it('records a showSubgraph call with its edges', async () => {
    const { app, workspace, runRepository, skillRunner, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)

    const response = await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/subgraph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: ['agg.template', 'agg.publicForm'],
        edges: [{ from: 'agg.template', to: 'agg.publicForm', label: 'gates' }],
      }),
    })

    expect(response.status).toBe(201)

    endAll()
    await waitForRunToEnd(skillRunner, runId)
    const events = await readEvents(runRepository, workspace, runId)
    const block = events.find(event => event.type === 'block')
    expect(block?.type === 'block' && block.block.call).toBe('showSubgraph')
  })

  it('defaults a block to every reader when it names no audience', async () => {
    const { app, workspace, runRepository, skillRunner, endAll } = await buildApp()
    const runId = await startRun(app, workspace.id)

    await app.request(`/workspaces/${workspace.id}/runs/${runId}/blocks/diagram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mermaid: 'flowchart LR\n A --> B' }),
    })

    endAll()
    await waitForRunToEnd(skillRunner, runId)
    const events = await readEvents(runRepository, workspace, runId)
    const block = events.find(event => event.type === 'block')
    expect(block?.type === 'block' && block.block.audiences).toEqual([])
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
    expect(operationIds).toContain('showDiagram')
    expect(operationIds).toContain('showSubgraph')
    endAll()
  })
})
