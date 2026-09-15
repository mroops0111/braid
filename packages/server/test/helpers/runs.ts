import type { WorkspaceId } from '@braidhq/schema'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface SeedRun {
  readonly runId: string
  readonly startedBy: string
  readonly sessionId?: string
  /** Defaults to a fixed instant, set it when a test needs a run order. */
  readonly startedAt?: string
}

/**
 * Seed the append-only index the run repository reads.
 * Writing the file directly keeps the test independent of the runner,
 * which would otherwise have to spawn a subprocess per record.
 */
export async function seedRuns(
  workspaceRootPath: string,
  workspaceId: WorkspaceId,
  records: readonly SeedRun[],
): Promise<void> {
  const dir = join(workspaceRootPath, 'artifacts', 'runs')
  await mkdir(dir, { recursive: true })
  const lines = records.map(record => JSON.stringify({
    runId: record.runId,
    workspaceId,
    skillId: 'braid:ask',
    args: 'a question',
    resumed: false,
    startedAt: record.startedAt ?? '2026-05-21T10:00:00.000Z',
    startedBy: record.startedBy,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
  }))
  await writeFile(join(dir, 'index.jsonl'), `${lines.join('\n')}\n`, 'utf-8')
}

/** A one-event transcript, so a readable run has something to answer with. */
export async function seedEvents(workspaceRootPath: string, runId: string, text: string): Promise<void> {
  const dir = join(workspaceRootPath, 'artifacts', 'runs')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${runId}.jsonl`),
    `${JSON.stringify({ type: 'message', text, role: 'agent' })}\n`,
    'utf-8',
  )
}
