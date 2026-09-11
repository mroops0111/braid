import type { SkillManifest, SkillRegistry } from '@braidhq/core'
import type { AbsolutePath } from '@braidhq/schema'
import type { AppDependencies, ComposeOptions } from '../../src/composeApp.js'
import type { RunTokenRegistry } from '../../src/infrastructure/skill/RunTokenRegistry.js'
import type { MockSpawnScript } from './mockSpawn.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeAgentBinding } from '@braidhq/agent-claude-code'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composeApp.js'
import { FsRunRepository } from '../../src/infrastructure/skill/FsRunRepository.js'
import { SubprocessSkillRunner } from '../../src/infrastructure/skill/SubprocessSkillRunner.js'
import { DEFAULT_AGENT_BINDING, makeSkillManifest, makeWorkspace } from './fakes.js'
import { createMockSpawn } from './mockSpawn.js'

/** A registry serving one skill, which is what a route test needs. */
export function makeSingleSkillRegistry(manifest: SkillManifest = defaultManifest()): SkillRegistry {
  return {
    list: async () => [manifest],
    find: async () => manifest,
    get: async () => manifest,
  }
}

function defaultManifest(): SkillManifest {
  return makeSkillManifest({ id: 'braid:ask', path: '/abs/SKILL.md' as AbsolutePath })
}

/**
 * Every held process this file has opened,
 * so a failing test cannot leave one behind.
 *
 * A scripted process opened with `hold` keeps its stdout open,
 * until the test releases it,
 * and the runner's drain promise settles only when it closes.
 * A test releasing it on its last line releases nothing when a check throws,
 * and the open handle outlives the test that made it.
 * Which is why this is a list rather than a return value,
 * since the cleanup has to reach processes the test never got as far as naming.
 */
const held: Array<() => void> = []

export function endAllSpawned(): void {
  for (const end of held.splice(0))
    end()
}

export interface RunnerAppOptions {
  /** One entry per spawn, in order. A run past the end gets an empty one. */
  spawns?: readonly MockSpawnScript[]
  skillRegistry?: SkillRegistry
  /** Needed by a test whose run authenticates back with its own credential. */
  runTokens?: RunTokenRegistry
  /** Anything the composition root takes that this app needs on top. */
  compose?: ComposeOptions
}

/**
 * An app whose runs are scripted rather than real.
 *
 * Four route tests each assembled this by hand,
 * so the runner's constructor had four places to be kept in step,
 * and they had already drifted apart.
 */
export async function buildRunnerApp(options: RunnerAppOptions = {}): Promise<{
  app: ReturnType<typeof createApp>
  deps: AppDependencies
  workspace: ReturnType<typeof makeWorkspace>
  skillRunner: SubprocessSkillRunner
  runRepository: FsRunRepository
  invocations: ReturnType<typeof createMockSpawn>['invocations']
  endAll: () => void
}> {
  const rootPath = (await mkdtemp(join(tmpdir(), 'braid-runner-app-'))) as AbsolutePath
  const workspace = makeWorkspace({ rootPath })
  const runRepository = new FsRunRepository()
  const { spawn, invocations, endAll } = createMockSpawn(options.spawns ?? [])
  held.push(endAll)
  const skillRegistry = options.skillRegistry ?? makeSingleSkillRegistry()
  const skillRunner = new SubprocessSkillRunner({
    ...(options.runTokens ? { runTokens: options.runTokens } : {}),
    skillRegistry,
    buildAgentBinding: descriptor => new ClaudeCodeAgentBinding(descriptor),
    defaultAgent: DEFAULT_AGENT_BINDING,
    apiUrl: 'http://localhost:4321',
    runRepository,
    spawn,
  })
  const deps = composeApp({ skillRegistry, skillRunner, runRepository, ...options.compose })
  await deps.workspaceRepository.save(workspace)
  return { app: createApp(deps), deps, workspace, skillRunner, runRepository, invocations, endAll }
}
