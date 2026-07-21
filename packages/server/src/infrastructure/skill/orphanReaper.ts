import type { Clock, RunRepository, WorkspaceRepository } from '@braidhq/core'
import type { SkillEvent } from '@braidhq/schema'

/**
 * Run records survive across server restarts,
 * but the subprocess that was driving each run does not.
 * On startup any run without a `completedAt` timestamp is an orphan,
 * nobody is going to drain its events.
 * We tag those with a synthetic `error` event,
 * so the UI can show why the transcript is truncated.
 * A `completed` event then makes the run leave the active list.
 *
 * Idempotent: runs that are already marked completed are skipped.
 */
export async function reapOrphanRuns(deps: {
  workspaceRepository: WorkspaceRepository
  runRepository: RunRepository
  clock: Clock
}): Promise<{ reaped: number }> {
  const workspaces = await deps.workspaceRepository.list()
  let reaped = 0
  for (const workspace of workspaces) {
    const records = await deps.runRepository.listRecords(workspace)
    for (const record of records) {
      if (record.completedAt !== undefined)
        continue
      const at = deps.clock.now()
      const error: SkillEvent = {
        type: 'error',
        message: 'Run aborted: server restarted before the subprocess finished.',
        at,
      }
      const completed: SkillEvent = {
        type: 'completed',
        runId: record.runId,
        exitCode: -1,
        at,
      }
      await deps.runRepository.appendEvent(workspace, record.runId, error)
      await deps.runRepository.appendEvent(workspace, record.runId, completed)
      await deps.runRepository.saveRecord(workspace, {
        ...record,
        completedAt: at,
        exitCode: -1,
      })
      reaped++
    }
  }
  return { reaped }
}
