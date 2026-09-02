import type { WorkspaceId } from '@braidhq/schema'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REACTOR_USER_ID } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { asUser, buildMultiUserApp } from '../helpers/multiUser.js'

interface RunList {
  items: ReadonlyArray<{ runId: string }>
}

/**
 * Seed the append-only index the run repository reads.
 * Writing the file directly keeps the test independent of the runner,
 * which would otherwise have to spawn a subprocess per record.
 */
async function seedRuns(
  workspaceRootPath: string,
  workspaceId: WorkspaceId,
  records: ReadonlyArray<{ runId: string, startedBy: string, sessionId?: string }>,
): Promise<void> {
  const dir = join(workspaceRootPath, 'artifacts', 'runs')
  await mkdir(dir, { recursive: true })
  const lines = records.map(record => JSON.stringify({
    runId: record.runId,
    workspaceId,
    skillId: 'braid:ask',
    args: 'a question',
    resumed: false,
    startedAt: '2026-05-21T10:00:00.000Z',
    startedBy: record.startedBy,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
  }))
  await writeFile(join(dir, 'index.jsonl'), `${lines.join('\n')}\n`, 'utf-8')
}

async function listRuns(app: OpenAPIHono, workspaceId: WorkspaceId, userId: string): Promise<string[]> {
  const response = await app.request(`/workspaces/${workspaceId}/runs`, asUser(userId as never))
  expect(response.status).toBe(200)
  const body = await response.json() as RunList
  return body.items.map(item => item.runId)
}

describe('run history visibility', () => {
  it('shows an owner every run, including the ones the reactor started', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedRuns(workspaceRootPath, workspaceId, [
      { runId: 'run-reactor', startedBy: REACTOR_USER_ID },
      { runId: 'run-owner', startedBy: users.owner.id },
      { runId: 'run-maintainer', startedBy: users.maintainer.id },
    ])

    expect((await listRuns(app, workspaceId, users.owner.id)).sort())
      .toEqual(['run-maintainer', 'run-owner', 'run-reactor'])
  })

  it('shows a maintainer only their own runs', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedRuns(workspaceRootPath, workspaceId, [
      { runId: 'run-reactor', startedBy: REACTOR_USER_ID },
      { runId: 'run-owner', startedBy: users.owner.id },
      { runId: 'run-maintainer', startedBy: users.maintainer.id },
    ])

    expect(await listRuns(app, workspaceId, users.maintainer.id)).toEqual(['run-maintainer'])
  })

  it('reports another person\'s transcript as absent rather than forbidden', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedRuns(workspaceRootPath, workspaceId, [
      { runId: 'run-owner', startedBy: users.owner.id },
    ])

    const response = await app.request(
      `/workspaces/${workspaceId}/runs/run-owner/events`,
      asUser(users.maintainer.id as never),
    )
    // Absent, not forbidden, so the answer never confirms the run exists.
    expect(response.status).toBe(404)
  })

  it('hides a session title belonging to someone else', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedRuns(workspaceRootPath, workspaceId, [
      { runId: 'run-owner', startedBy: users.owner.id, sessionId: 'sess-owner' },
    ])
    await writeFile(
      join(workspaceRootPath, 'artifacts', 'runs', 'sessions.jsonl'),
      `${JSON.stringify({ sessionId: 'sess-owner', title: 'private', updatedAt: '2026-05-21T10:00:00.000Z' })}\n`,
      'utf-8',
    )

    const response = await app.request(`/workspaces/${workspaceId}/runs/sessions`, asUser(users.maintainer.id as never))
    expect(response.status).toBe(200)
    const body = await response.json() as { items: readonly unknown[] }
    expect(body.items).toEqual([])
  })
})
