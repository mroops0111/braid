import type { RunRepository, SessionShareRepository, Workspace } from '@braidhq/core'
import type { RunRecord, SkillRunId } from '@braidhq/schema'
import type { Context } from 'hono'
import { NotFoundError } from '@braidhq/core'
import { getUserId } from '../middleware/auth.js'
import { getViewerContext } from '../middleware/workspaceAccess.js'
import { defaultPermissionRegistry } from '../policy/index.js'

/**
 * Which runs this caller started, and so may act on.
 *
 * A conversation is personal, so it stays with whoever started it.
 * `workspace.manage` is the one standing that reaches everybody else's,
 * which is what makes a workspace answerable to whoever runs it.
 *
 * Every write on a run rests on this rather than on `visibleToCaller`,
 * because a conversation lent to you is yours to read and nothing else.
 */
export function ownedByCaller(context: Context): (record: RunRecord) => boolean {
  const viewer = getViewerContext(context)
  // No viewer is an open composition (in-memory), which applies no filter.
  if (!viewer || defaultPermissionRegistry.can('workspace.manage', viewer))
    return () => true
  const userId = getUserId(context)
  return record => record.startedBy === userId
}

/** Sessions somebody let this caller read. Empty when they reach everything anyway. */
async function sessionsSharedWithCaller(
  context: Context,
  workspace: Workspace,
  sessionShareRepository: SessionShareRepository,
): Promise<ReadonlySet<string>> {
  const viewer = getViewerContext(context)
  if (!viewer || defaultPermissionRegistry.can('workspace.manage', viewer))
    return new Set()
  const userId = getUserId(context)
  const shares = await sessionShareRepository.listSessionShares(workspace)
  return new Set(
    shares
      .filter(share => share.grantee === userId && share.revokedAt === undefined)
      .map(share => share.sessionId),
  )
}

/**
 * Which runs this caller may read, meaning their own plus what was lent.
 *
 * A grant names a session, never a run,
 * so a run takes its answer from the conversation it belongs to.
 * Sharing per run would leave a resumed conversation half readable.
 */
export async function visibleToCaller(
  context: Context,
  workspace: Workspace,
  sessionShareRepository: SessionShareRepository,
): Promise<(record: RunRecord) => boolean> {
  const ownsRecord = ownedByCaller(context)
  const sharedSessionIds = await sessionsSharedWithCaller(context, workspace, sessionShareRepository)
  if (sharedSessionIds.size === 0)
    return ownsRecord
  return record => ownsRecord(record)
    || (record.sessionId !== undefined && sharedSessionIds.has(record.sessionId))
}

/**
 * Refuse a run this caller may not read.
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
  sessionShareRepository: SessionShareRepository,
): Promise<void> {
  const records = await runRepository.listRecords(workspace)
  const record = records.find(candidate => candidate.runId === runId)
  const canSee = await visibleToCaller(context, workspace, sessionShareRepository)
  if (record && !canSee(record))
    throw new NotFoundError(`Run "${runId}" not found`)
}

/**
 * Refuse a run this caller did not start.
 *
 * Same 404 as above, and deliberately a narrower rule,
 * since cancelling or deleting what was only lent to you is not a read.
 */
export async function requireOwnedRun(
  context: Context,
  workspace: Workspace,
  runId: SkillRunId,
  runRepository: RunRepository,
): Promise<void> {
  const records = await runRepository.listRecords(workspace)
  const record = records.find(candidate => candidate.runId === runId)
  if (record && !ownedByCaller(context)(record))
    throw new NotFoundError(`Run "${runId}" not found`)
}

/** Writing to a session needs authorship, not the read a grant carries. */
export async function requireOwnedSession(
  context: Context,
  workspace: Workspace,
  sessionId: string,
  runRepository: RunRepository,
): Promise<void> {
  const records = await runRepository.listRecords(workspace)
  const runsUnderSession = records.filter(record => record.sessionId === sessionId)
  const ownsRecord = ownedByCaller(context)
  if (runsUnderSession.length > 0 && !runsUnderSession.some(ownsRecord))
    throw new NotFoundError(`Session "${sessionId}" not found`)
}

/**
 * Who opened a conversation, taken from its earliest run.
 *
 * Undefined for a session nothing was ever recorded under,
 * which the share gate then treats the same as somebody else's,
 * so a probe cannot tell an absent session from one it may not touch.
 */
export async function sessionAuthor(
  workspace: Workspace,
  sessionId: string,
  runRepository: RunRepository,
): Promise<RunRecord['startedBy'] | undefined> {
  const records = await runRepository.listRecords(workspace)
  const runsUnderSession = records
    .filter(record => record.sessionId === sessionId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  return runsUnderSession[0]?.startedBy
}
