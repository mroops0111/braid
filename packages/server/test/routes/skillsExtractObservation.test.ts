import type { SkillRegistry } from '@braidhq/core'
import type { AbsolutePath, SkillId, SkillRunId, SourceId, SourceUnitSha, WorkspaceId } from '@braidhq/schema'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { ClaudeCodeAgentBinding } from '@braidhq/agent-claude-code'
import { PluginRegistry } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composition.js'
import { SubprocessSkillRunner } from '../../src/infrastructure/agent/SubprocessSkillRunner.js'
import { FsRunRepository } from '../../src/infrastructure/fs/FsRunRepository.js'
import { DEFAULT_AGENT_BINDING, makeOntology, makeSkillManifest, makeWorkspace } from '../helpers/fakes.js'
import { createMockSpawn } from '../helpers/mockSpawn.js'

const SOURCE_ID = 'issues' as SourceId
const UNIT_PATH = 'issues/27.md'

function makeMultiSkillRegistry(skillIds: readonly string[]): SkillRegistry {
  const manifests = skillIds.map(id =>
    makeSkillManifest({ id: id as SkillId, path: `/abs/skills/${id}/SKILL.md` as AbsolutePath }),
  )
  return {
    list: async () => manifests,
    find: async (_workspace, id) => manifests.find(m => m.toData().id === id),
    get: async (_workspace, id) => {
      const found = manifests.find(m => m.toData().id === id)
      if (!found)
        throw new Error(`unknown skill ${id}`)
      return found
    },
  }
}

function ontologyWithPerUnit(skillId: string) {
  return makeOntology({
    batch: {
      perUnit: { skillId: skillId as SkillId, label: 'Extract' },
    },
  })
}

async function buildAppForExtract(opts: { exitCode: number, perUnitSkillId?: string }) {
  const rootPath = (await mkdtemp(join(tmpdir(), 'braid-skill-extract-'))) as AbsolutePath
  const workspace = makeWorkspace({
    rootPath,
    sources: [{
      kind: 'filesystem',
      id: SOURCE_ID,
      role: 'intent',
      name: 'issues',
      path: rootPath,
    }],
  })
  const { spawn } = createMockSpawn([{
    stdoutLines: [JSON.stringify({ type: 'text', text: 'done' })],
    exitCode: opts.exitCode,
  }])
  const skillRegistry = makeMultiSkillRegistry(['braid-extract', 'braid-ask'])
  const skillRunner = new SubprocessSkillRunner({
    skillRegistry,
    agentBinding: new ClaudeCodeAgentBinding(DEFAULT_AGENT_BINDING),
    apiUrl: 'http://localhost:4321',
    runRepository: new FsRunRepository(),
    spawn,
  })
  // Register an ontology whose batch.perUnit.skillId matches the
  // workspace's ontologyId so the route knows which skill is allowed
  // to carry sourceUnit. Default keeps the production wiring (extract
  // is the per-unit skill); a test that wants the active ontology to
  // disagree (or have no perUnit at all) can override.
  const pluginRegistry = new PluginRegistry()
  pluginRegistry.register(ontologyWithPerUnit(opts.perUnitSkillId ?? 'braid-extract'))
  const deps = composeApp({
    skillRegistry,
    skillRunner,
    pluginRegistry,
    sourceUnitDigest: { computeSha: async () => 'sha-fake' as SourceUnitSha },
  })
  await deps.workspaceRepository.save(workspace)
  return { app: createApp(deps), workspace, deps }
}

async function waitForObservation(
  deps: Awaited<ReturnType<typeof buildAppForExtract>>['deps'],
  workspaceId: WorkspaceId,
  maxMs = 2000,
) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const states = await deps.sourceUnitStateService.listByWorkspace(workspaceId)
    const observation = states.find(s => s.sourceId === SOURCE_ID && s.path === UNIT_PATH)
    if (observation)
      return observation
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return null
}

async function waitForRunSettled(deps: Awaited<ReturnType<typeof buildAppForExtract>>['deps'], runId: string) {
  const start = Date.now()
  while (Date.now() - start < 2000) {
    if (!deps.skillRunner!.isActive(runId as never))
      return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

/**
 * Fake child process that does nothing until killed. On `kill(signal)`
 * it emits the `close` event with `(code=null, signal)` so the
 * runner's exitCode mapping (line 256-264 of SubprocessSkillRunner)
 * sees a signal-terminated exit.
 */
function createCancellableChild(): ChildProcess {
  const stdout = new Readable({ read() {} })
  const stderr = new Readable({ read() {} })
  const fake = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    kill: (signal?: NodeJS.Signals | number) => {
      const sig = typeof signal === 'string' ? signal : 'SIGTERM'
      setImmediate(() => {
        stdout.push(null)
        stderr.push(null)
        fake.emit('close', null, sig)
      })
      return true
    },
  })
  return fake as unknown as ChildProcess
}

describe('POST /skills/braid-extract/run with sourceUnit (issue #31)', () => {
  it('records a SourceUnitState observation after a successful run', async () => {
    const { app, workspace, deps } = await buildAppForExtract({ exitCode: 0 })

    const response = await app.request(`/workspaces/${workspace.id}/skills/braid-extract/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        args: UNIT_PATH,
        sourceUnit: { sourceId: SOURCE_ID, path: UNIT_PATH },
      }),
    })

    expect(response.status).toBe(202)
    const observation = await waitForObservation(deps, workspace.id)
    expect(observation).not.toBeNull()
    expect(observation?.lastObservedSha).toBe('sha-fake')
    expect(observation?.lastObservedByRunId).toBeDefined()
  })

  it('does not record when the run exits with a non-zero code', async () => {
    const { app, workspace, deps } = await buildAppForExtract({ exitCode: 1 })

    const response = await app.request(`/workspaces/${workspace.id}/skills/braid-extract/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        args: UNIT_PATH,
        sourceUnit: { sourceId: SOURCE_ID, path: UNIT_PATH },
      }),
    })

    expect(response.status).toBe(202)
    const body = await response.json() as { runId: string }
    await waitForRunSettled(deps, body.runId)
    // Give the post-completion hook a tick in case it would record incorrectly.
    await new Promise(resolve => setTimeout(resolve, 50))
    const states = await deps.sourceUnitStateService.listByWorkspace(workspace.id)
    expect(states).toEqual([])
  })

  it('does not record when no sourceUnit is provided even for braid-extract', async () => {
    const { app, workspace, deps } = await buildAppForExtract({ exitCode: 0 })

    const response = await app.request(`/workspaces/${workspace.id}/skills/braid-extract/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: UNIT_PATH }),
    })

    expect(response.status).toBe(202)
    const body = await response.json() as { runId: string }
    await waitForRunSettled(deps, body.runId)
    await new Promise(resolve => setTimeout(resolve, 50))
    const states = await deps.sourceUnitStateService.listByWorkspace(workspace.id)
    expect(states).toEqual([])
  })

  it('does not record when the run is cancelled mid-flight', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'braid-skill-cancel-'))) as AbsolutePath
    const workspace = makeWorkspace({
      rootPath,
      sources: [{
        kind: 'filesystem',
        id: SOURCE_ID,
        role: 'intent',
        name: 'issues',
        path: rootPath,
      }],
    })
    // A child that never finishes on its own; only the runner's cancel
    // (kill SIGTERM) wakes it up. After the fix in SubprocessSkillRunner
    // the close event carries the signal and exitCode 128, so the
    // observation hook treats it as a failure and skips recordObservation.
    const spawnFn = (() => createCancellableChild()) as unknown as (
      command: string,
      args: readonly string[],
      options: SpawnOptions,
    ) => ChildProcess
    const skillRegistry = makeMultiSkillRegistry(['braid-extract'])
    const skillRunner = new SubprocessSkillRunner({
      skillRegistry,
      agentBinding: new ClaudeCodeAgentBinding(DEFAULT_AGENT_BINDING),
      apiUrl: 'http://localhost:4321',
      runRepository: new FsRunRepository(),
      spawn: spawnFn,
    })
    const pluginRegistry = new PluginRegistry()
    pluginRegistry.register(ontologyWithPerUnit('braid-extract'))
    const deps = composeApp({
      skillRegistry,
      skillRunner,
      pluginRegistry,
      sourceUnitDigest: { computeSha: async () => 'sha-fake' as SourceUnitSha },
    })
    await deps.workspaceRepository.save(workspace)
    const app = createApp(deps)

    const response = await app.request(`/workspaces/${workspace.id}/skills/braid-extract/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        args: UNIT_PATH,
        sourceUnit: { sourceId: SOURCE_ID, path: UNIT_PATH },
      }),
    })

    expect(response.status).toBe(202)
    const body = await response.json() as { runId: string }
    // Tick once so the runner finishes start() and our background
    // subscription has a chance to attach before we cancel.
    await new Promise(resolve => setTimeout(resolve, 10))
    await deps.skillRunner!.cancel(body.runId as SkillRunId)
    await waitForRunSettled(deps, body.runId)
    await new Promise(resolve => setTimeout(resolve, 50))
    const states = await deps.sourceUnitStateService.listByWorkspace(workspace.id)
    expect(states).toEqual([])
  })

  it('rejects sourceUnit whose sourceId does not name an intent source in the workspace', async () => {
    const { app, workspace, deps } = await buildAppForExtract({ exitCode: 0 })

    const response = await app.request(`/workspaces/${workspace.id}/skills/braid-extract/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        args: UNIT_PATH,
        sourceUnit: { sourceId: 'no-such-source' as SourceId, path: UNIT_PATH },
      }),
    })

    expect(response.status).toBe(400)
    const states = await deps.sourceUnitStateService.listByWorkspace(workspace.id)
    expect(states).toEqual([])
  })

  it('rejects sourceUnit for skills the active ontology does not name as its per-unit step', async () => {
    const { app, workspace, deps } = await buildAppForExtract({ exitCode: 0 })

    const response = await app.request(`/workspaces/${workspace.id}/skills/braid-ask/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        args: 'what?',
        sourceUnit: { sourceId: SOURCE_ID, path: UNIT_PATH },
      }),
    })

    expect(response.status).toBe(400)
    const states = await deps.sourceUnitStateService.listByWorkspace(workspace.id)
    expect(states).toEqual([])
  })
})
