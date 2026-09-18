import type { SkillRegistry, Workspace } from '@braidhq/core'
import type { AbsolutePath, BlockId, SkillRunId, UserId } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeAgentBinding } from '@braidhq/agent-claude-code'
import { SkillManifest } from '@braidhq/core'
import { makeRunRecord, makeSkillManifestData } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { FsRunRepository } from '../../../src/infrastructure/skill/FsRunRepository.js'
import { SubprocessSkillRunner } from '../../../src/infrastructure/skill/SubprocessSkillRunner.js'
import { DEFAULT_AGENT_BINDING, makeWorkspace } from '../../helpers/fakes.js'
import { createMockSpawn } from '../../helpers/mockSpawn.js'
import { waitUntilIdle } from '../../helpers/settle.js'

const AUTHOR = 'user-1' as UserId

/** A manifest whose skill owes a `showTrace` it is about to not render. */
function askOwingATrace(): SkillManifest {
  const data = makeSkillManifestData({ id: 'braid:ask', path: '/abs/SKILL.md' as AbsolutePath })
  return new SkillManifest({
    ...data,
    frontmatter: {
      ...data.frontmatter,
      braid: {
        ...data.frontmatter.braid,
        output: { requiredCalls: ['showTrace'], maxRetries: 1 },
      },
    },
  })
}

const SESSION_LINE = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-1' })

async function runWith(stdoutPerSpawn: readonly string[][], options: {
  /** An earlier turn of the same conversation, already on the page. */
  readonly seedEarlierTurn?: (workspace: Workspace, runRepository: FsRunRepository) => Promise<void>
  readonly resumeSessionId?: string
} = {}) {
  const rootPath = (await mkdtemp(join(tmpdir(), 'braid-contract-'))) as AbsolutePath
  const workspace = makeWorkspace({ rootPath })
  const manifest = askOwingATrace()
  const skillRegistry: SkillRegistry = {
    list: async () => [manifest],
    listUnloadable: async () => [],
    find: async () => manifest,
    get: async () => manifest,
  }
  const { spawn, invocations } = createMockSpawn(
    stdoutPerSpawn.map(stdoutLines => ({ stdoutLines, exitCode: 0 })),
  )
  const runRepository = new FsRunRepository()
  const runner = new SubprocessSkillRunner({
    skillRegistry,
    buildAgentBinding: descriptor => new ClaudeCodeAgentBinding(descriptor),
    defaultAgent: DEFAULT_AGENT_BINDING,
    apiUrl: 'http://localhost:4321',
    runRepository,
    spawn,
  })
  await options.seedEarlierTurn?.(workspace, runRepository)
  await runner.start(workspace, manifest.id, 'a question', {
    startedBy: AUTHOR,
    ...(options.resumeSessionId ? { resumeSessionId: options.resumeSessionId } : {}),
  })
  // A correction spawns after the first run's drain,
  // so waiting for that one run is not enough.
  // Nothing left running is the point where the spawn count settles,
  // which is what every case here asserts on.
  await waitUntilIdle(
    () => !runner.hasActiveRun(workspace.id),
    'the run and any correction it spawned to settle',
  )
  return { invocations, workspace, runRepository }
}

describe('output contract retry', () => {
  it('resumes the session once when the run never made a required call', async () => {
    const { invocations } = await runWith([[SESSION_LINE], [SESSION_LINE]])

    expect(invocations).toHaveLength(2)
    const correction = invocations[1]?.args.join(' ') ?? ''
    expect(correction).toContain('--resume')
    expect(correction).toContain('showTrace')
  })

  it('attributes the correction to whoever asked the original question', async () => {
    const { invocations, workspace, runRepository } = await runWith([[SESSION_LINE], [SESSION_LINE]])

    expect(invocations).toHaveLength(2)
    const records = await runRepository.listRecords(workspace)
    expect(records).toHaveLength(2)
    expect(records.every(record => record.startedBy === AUTHOR)).toBe(true)
  })

  it('does not correct twice, so a stubborn agent cannot loop', async () => {
    const { invocations } = await runWith([[SESSION_LINE], [SESSION_LINE], [SESSION_LINE]])

    expect(invocations).toHaveLength(2)
  })

  it('leaves a run alone when it never opened a session to resume', async () => {
    const { invocations } = await runWith([[]])

    expect(invocations).toHaveLength(1)
  })

  it('owes nothing a turn before it in the same conversation already rendered', async () => {
    const { invocations } = await runWith([[SESSION_LINE], [SESSION_LINE]], {
      resumeSessionId: 'session-1',
      seedEarlierTurn: async (workspace, runRepository) => {
        const earlier = makeRunRecord({
          runId: 'run-earlier' as SkillRunId,
          workspaceId: workspace.id,
          sessionId: 'session-1',
        })
        await runRepository.saveRecord(workspace, earlier)
        await runRepository.appendEvent(workspace, earlier.runId, {
          type: 'block',
          id: 'block-earlier' as BlockId,
          block: { call: 'showTrace', audiences: [], searched: [], read: [], cited: [], skipped: [] },
        })
      },
    })

    expect(invocations).toHaveLength(1)
  })
})
