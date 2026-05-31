import type { HistoryService } from '@braidhq/core'
import { NotFoundError } from '@braidhq/core'
import { CommitSha, UserId } from '@braidhq/schema'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getWorkspaceId } from '../middleware/workspaceId.js'

const RestoreBody = z.object({
  userId: UserId,
})

const TagBody = z.object({
  sha: CommitSha,
  name: z.string().min(1).max(120),
  note: z.string().max(2000).optional(),
})

const ListQuery = z.object({
  since: CommitSha.optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
})

export interface HistoryRouterDeps {
  historyService: HistoryService
}

export function createHistoryRouter(deps: HistoryRouterDeps): Hono {
  const router = new Hono()

  router.get('/', zValidator('query', ListQuery), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { since, limit } = context.req.valid('query')
    const items = await deps.historyService.listCommits(workspaceId, {
      ...(since ? { since } : {}),
      ...(limit ? { limit } : {}),
    })
    return context.json({ items })
  })

  router.get('/tags', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const items = await deps.historyService.listTags(workspaceId)
    return context.json({ items })
  })

  router.post('/tags', zValidator('json', TagBody), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { sha, name, note } = context.req.valid('json')
    const tag = await deps.historyService.createTag(workspaceId, sha, name, note)
    return context.json(tag, 201)
  })

  router.delete('/tags/:name', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const name = context.req.param('name')
    if (!name)
      throw new NotFoundError('tag name is required')
    await deps.historyService.deleteTag(workspaceId, name)
    return context.body(null, 204)
  })

  router.post('/:sha/restore', zValidator('json', RestoreBody), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const sha = CommitSha.parse(context.req.param('sha'))
    const { userId } = context.req.valid('json')
    const newSha = await deps.historyService.restore(workspaceId, sha, userId)
    return context.json({ newCommit: newSha, restoredTo: sha })
  })

  router.get('/:sha', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const sha = CommitSha.parse(context.req.param('sha'))
    const commit = await deps.historyService.getCommit(workspaceId, sha)
    if (!commit)
      throw new NotFoundError(`commit ${sha} not found in workspace ${workspaceId}`)
    const diff = await deps.historyService.getCommitDiff(workspaceId, sha)
    return context.json({ ...commit, diff })
  })

  return router
}
