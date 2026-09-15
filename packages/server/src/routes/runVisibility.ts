import type { RunRepository, Workspace } from '@braidhq/core'
import type { RunRecord, SkillRunId } from '@braidhq/schema'
import type { Context } from 'hono'
import { NotFoundError } from '@braidhq/core'
import { getUserId } from '../middleware/auth.js'
import { getViewerContext } from '../middleware/workspaceAccess.js'
import { defaultPermissionRegistry } from '../policy/index.js'

/**
 * Which runs this caller may read or act on.
 *
 * A conversation is personal, so it stays with whoever started it.
 * `workspace.manage` is the one standing that reaches everybody else's,
 * which is what makes a workspace answerable to whoever runs it.
 */
export function visibleToCaller(context: Context): (record: RunRecord) => boolean {
  const viewer = getViewerContext(context)
  // No viewer is an open composition (in-memory), which applies no filter.
  if (!viewer || defaultPermissionRegistry.can('workspace.manage', viewer))
    return () => true
  const userId = getUserId(context)
  return record => record.startedBy === userId
}

/**
 * Refuse a run belonging to somebody else.
 *
 * Reported as absent rather than forbidden,
 * so the answer never confirms that another person's run exists.
 * An id with no record is left alone,
 * since the endpoints already answer for a run they cannot find.
 */
export async function requireVisibleRun(
  context: Context,
  workspace: Workspace,
  runId: SkillRunId,
  runRepository: RunRepository,
): Promise<void> {
  const records = await runRepository.listRecords(workspace)
  const record = records.find(candidate => candidate.runId === runId)
  if (record && !visibleToCaller(context)(record))
    throw new NotFoundError(`Run "${runId}" not found`)
}

/** The same rule for a session, which is visible through any run under it. */
export async function requireVisibleSession(
  context: Context,
  workspace: Workspace,
  sessionId: string,
  runRepository: RunRepository,
): Promise<void> {
  const records = await runRepository.listRecords(workspace)
  const under = records.filter(record => record.sessionId === sessionId)
  const canSee = visibleToCaller(context)
  if (under.length > 0 && !under.some(canSee))
    throw new NotFoundError(`Session "${sessionId}" not found`)
}
