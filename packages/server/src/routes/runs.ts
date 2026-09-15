import type {
  RunRepository,
  SessionShareRepository,
  SkillRunner,
  Workspace,
  WorkspaceRepository,
} from '@braidhq/core'
import type { SessionMetadata, SessionShare, SkillEvent, SkillRunId as SkillRunIdType } from '@braidhq/schema'
import type { Context } from 'hono'
import type { WorkspaceRegistryFile } from '../infrastructure/workspace/WorkspaceRegistryFile.js'
import { ConflictError, NotFoundError, ValidationError } from '@braidhq/core'
import { SkillRunId, UserId } from '@braidhq/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { createAsyncQueue } from '../infrastructure/skill/asyncQueue.js'
import { getUserId } from '../middleware/auth.js'
import { requirePermission } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { loadWorkspaceById } from './helpers.js'
import {
  requireOwnedRun as requireRunOwned,
  requireVisibleRun as requireRunVisible,
  requireOwnedSession as requireSessionOwned,
  sessionAuthor,
  visibleToCaller,
} from './runVisibility.js'

export interface RunsRouterDeps {
  readonly runRepository: RunRepository
  readonly sessionShareRepository: SessionShareRepository
  readonly skillRunner: SkillRunner
  readonly workspaceRepository: WorkspaceRepository
  /**
   * Asked whether the person a grant names is really a member here.
   * Absent in in-memory compositions, which hold no member rows,
   * and those skip every other gate on this router too.
   */
  readonly workspaceRegistry?: WorkspaceRegistryFile
}

export function createRunsRouter(deps: RunsRouterDeps): Hono {
  const router = new Hono()
  const requireVisibleRun = (context: Context, workspace: Workspace, runId: SkillRunIdType): Promise<void> =>
    requireRunVisible(context, workspace, runId, deps.runRepository, deps.sessionShareRepository)
  const requireOwnedRun = (context: Context, workspace: Workspace, runId: SkillRunIdType): Promise<void> =>
    requireRunOwned(context, workspace, runId, deps.runRepository)
  const requireOwnedSession = (context: Context, workspace: Workspace, sessionId: string): Promise<void> =>
    requireSessionOwned(context, workspace, sessionId, deps.runRepository)

  router.get('/', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const items = await deps.runRepository.listRecords(workspace)
    const canSee = await visibleToCaller(context, workspace, deps.sessionShareRepository)
    return context.json({ items: items.filter(canSee) })
  })

  // The whole persisted log in one response.
  //
  // Replaying history over SSE pins a connection for what is not a stream,
  // and a browser allows only a handful per host,
  // so a few finished runs are enough to stall every request after them.
  // A finished run has nothing left to tail, so it is a plain fetch.
  router.get('/:runId/events.json', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const runId = SkillRunId.parse(context.req.param('runId'))
    await requireVisibleRun(context, workspace, runId)
    const items: SkillEvent[] = []
    for await (const event of deps.runRepository.readEvents(workspace, runId))
      items.push(event)
    return context.json({ items, active: deps.skillRunner.isActive(runId) })
  })

  // Replay the persisted JSONL log,
  // and if the run is still active, tail new events as they arrive.
  // Clients can open, close, and reopen this stream freely,
  // the underlying subprocess and event log are untouched.
  router.get('/:runId/events', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const runId = SkillRunId.parse(context.req.param('runId'))
    await requireVisibleRun(context, workspace, runId)

    return streamSSE(context, async (stream) => {
      if (!deps.skillRunner.isActive(runId)) {
        for await (const event of deps.runRepository.readEvents(workspace, runId)) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
        }
        return
      }

      // Subscribe BEFORE reading JSONL.
      // The positionAtSubscribe count snapshots how many events were persisted,
      // so we read exactly that many from disk,
      // and rely on the live listener for everything after.
      const queue = createAsyncQueue<SkillEvent>()
      const { unsubscribe, positionAtSubscribe } = deps.skillRunner.subscribe(runId, (event) => {
        queue.push(event)
      })

      try {
        let delivered = 0
        for await (const event of deps.runRepository.readEvents(workspace, runId)) {
          if (delivered >= positionAtSubscribe)
            break
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
          delivered++
        }

        for await (const event of queue.iterate()) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
          if (event.type === 'completed' || event.type === 'error') {
            queue.end()
            break
          }
        }
      }
      finally {
        unsubscribe()
      }
    })
  })

  // SIGTERM the underlying claude subprocess.
  // The drain loop emits a `completed` event with the real exit code,
  // which the SSE tailers receive normally. 404 if the run already finished.
  router.post('/:runId/cancel', async (context) => {
    const runId = SkillRunId.parse(context.req.param('runId'))
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    await requireOwnedRun(context, workspace, runId)
    await deps.skillRunner.cancel(runId)
    return context.body(null, 204)
  })

  router.delete('/sessions/:sessionId', async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!sessionId)
      throw new NotFoundError('Query parameter sessionId is required')
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    await requireOwnedSession(context, workspace, sessionId)
    const records = await deps.runRepository.listRecords(workspace)
    const targets = records.filter(record => record.sessionId === sessionId).map(record => record.runId)
    const activeRunId = targets.find(runId => deps.skillRunner.isActive(runId))
    if (activeRunId)
      throw new ConflictError(`Cannot delete session "${sessionId}": run "${activeRunId}" is still active`)
    // The agent's working directory, then everything written about the run.
    // Deleting is one act with one name,
    // so nothing here is conditional on a flag the caller may forget to send.
    await deps.skillRunner.forgetSession(sessionId)
    await deps.runRepository.deleteRecords(workspace, targets)
    // Grants go with the bytes they pointed at.
    // A withdrawn copy would leave the ledger naming a conversation,
    // that no longer has a single run left to read.
    await deps.sessionShareRepository.deleteSessionShares(workspace, sessionId)
    return context.body(null, 204)
  })

  // Single-run delete, used by orphan Conversations rows,
  // that have no sessionId to anchor against.
  // Refuses to touch an in-flight run.
  router.delete('/:runId', async (context) => {
    const runId = SkillRunId.parse(context.req.param('runId'))
    if (deps.skillRunner.isActive(runId))
      throw new ConflictError(`Run "${runId}" is still active`)
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    await requireOwnedRun(context, workspace, runId)
    await deps.runRepository.deleteRecords(workspace, [runId])
    return context.body(null, 204)
  })

  const SessionPatchBody = z.object({
    // `null` clears the custom title (UI falls back to the first prompt).
    title: z.string().min(1).max(200).nullable(),
  })

  router.get('/sessions', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const items = await deps.runRepository.listSessionMetadata(workspace)
    const canSee = await visibleToCaller(context, workspace, deps.sessionShareRepository)
    const readable = new Set(
      (await deps.runRepository.listRecords(workspace))
        .filter(record => record.sessionId !== undefined && canSee(record))
        .map(record => record.sessionId),
    )
    return context.json({ items: items.filter(metadata => readable.has(metadata.sessionId)) })
  })

  router.patch('/sessions/:sessionId', async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!sessionId)
      throw new NotFoundError('Query parameter sessionId is required')
    const body = await context.req.json().catch(() => null)
    const parsed = SessionPatchBody.safeParse(body)
    if (!parsed.success)
      throw new ValidationError(parsed.error.issues.map(i => i.message).join('; '))
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    await requireOwnedSession(context, workspace, sessionId)
    const metadata: SessionMetadata = {
      sessionId,
      title: parsed.data.title,
      updatedAt: new Date().toISOString(),
    }
    await deps.runRepository.saveSessionMetadata(workspace, metadata)
    return context.json(metadata)
  })

  // Only the person who opened a conversation may lend it out.
  // The gate answers 403 for a session that does not exist either,
  // since `sessionAuthor` returns nothing and the check fails the same way.
  const authorOnly = requirePermission('run.share', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const startedBy = await sessionAuthor(workspace, context.req.param('sessionId') ?? '', deps.runRepository)
    return startedBy ? { sessionStartedBy: startedBy } : {}
  })

  const ShareBody = z.object({ userId: UserId })

  /**
   * Every live grant this caller is part of, given or received.
   *
   * Studio reads it twice over,
   * to fill the share dialog with who already holds a conversation,
   * and to mark a row that arrived from somebody else.
   * Grants between two other people are nobody's business here.
   */
  router.get('/shares', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const userId = getUserId(context)
    const shares = await deps.sessionShareRepository.listSessionShares(workspace)
    return context.json({
      items: shares.filter(share =>
        share.revokedAt === undefined
        && (share.grantee === userId || share.grantedBy === userId)),
    })
  })

  // Let one named member read one conversation.
  //
  // The grant carries read and nothing more.
  // Cancel, delete, rename, and resume all sit on authorship,
  // so the recipient reads the transcript and cannot touch the conversation.
  router.post('/sessions/:sessionId/shares', authorOnly, async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!sessionId)
      throw new NotFoundError('Path parameter sessionId is required')
    const body = await context.req.json().catch(() => null)
    const parsed = ShareBody.safeParse(body)
    if (!parsed.success)
      throw new ValidationError(parsed.error.issues.map(issue => issue.message).join('; '))
    const grantee = parsed.data.userId
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const grantedBy = getUserId(context)
    if (grantee === grantedBy)
      throw new ValidationError('A conversation cannot be shared with the person who started it')
    // A grant is only reachable through a member row,
    // since workspace access is refused before any run route runs,
    // so naming an outsider would record one nobody could ever use.
    if (deps.workspaceRegistry) {
      const member = await deps.workspaceRegistry.getMember(workspace.rootPath, grantee)
      if (!member)
        throw new NotFoundError(`User "${grantee}" is not a member of this workspace`)
    }
    const share: SessionShare = {
      sessionId,
      grantee,
      grantedBy,
      grantedAt: new Date().toISOString(),
    }
    await deps.sessionShareRepository.saveSessionShare(workspace, share)
    return context.json(share, 201)
  })

  // Withdraw one grant.
  //
  // Appended as a revoked copy rather than erased,
  // because the file is read in order and last-wins.
  // A stream the recipient already holds open plays out its own run,
  // and every request after this answers as it did before the grant.
  router.delete('/sessions/:sessionId/shares/:granteeUserId', authorOnly, async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!sessionId)
      throw new NotFoundError('Path parameter sessionId is required')
    const grantee = UserId.parse(context.req.param('granteeUserId'))
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const shares = await deps.sessionShareRepository.listSessionShares(workspace)
    const liveShare = shares.find(share =>
      share.sessionId === sessionId
      && share.grantee === grantee
      && share.revokedAt === undefined)
    if (!liveShare)
      throw new NotFoundError(`Session "${sessionId}" is not shared with "${grantee}"`)
    await deps.sessionShareRepository.saveSessionShare(workspace, {
      ...liveShare,
      revokedAt: new Date().toISOString(),
    })
    return context.body(null, 204)
  })

  return router
}
