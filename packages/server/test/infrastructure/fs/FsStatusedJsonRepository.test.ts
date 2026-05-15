import type { AbsolutePath, WorkspaceId } from '@telos/schema'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundError } from '@telos/core'
import { describe, expect, it } from 'vitest'
import { FsStatusedJsonRepository } from '../../../src/infrastructure/fs/FsStatusedJsonRepository.js'

type Status = 'pending' | 'done'

interface Item {
  id: string
  status: Status
  workspaceId: WorkspaceId
  payload: string
}

async function makeRoot(): Promise<AbsolutePath> {
  return await mkdtemp(join(tmpdir(), 'telos-fs-statused-')) as AbsolutePath
}

function makeRepository(roots: ReadonlyMap<WorkspaceId, AbsolutePath>) {
  return new FsStatusedJsonRepository<Item, Status, string>(
    {
      entityName: 'Item',
      statuses: ['pending', 'done'],
      dirFor: (root, status) => join(root, 'items', status),
      parse: raw => raw as Item,
      serialize: item => item,
      idOf: item => item.id,
      statusOf: item => item.status,
      workspaceIdOf: item => item.workspaceId,
    },
    async () => roots,
  )
}

describe('FsStatusedJsonRepository', () => {
  it('round-trips an entity through save → load', async () => {
    const root = await makeRoot()
    const workspaceId = 'ws-1' as WorkspaceId
    const repository = makeRepository(new Map([[workspaceId, root]]))
    await repository.save({ id: 'a', status: 'pending', workspaceId, payload: 'hi' })
    const reloaded = await repository.load('a')
    expect(reloaded).toEqual({ id: 'a', status: 'pending', workspaceId, payload: 'hi' })
  })

  it('moves the file when status transitions', async () => {
    const root = await makeRoot()
    const workspaceId = 'ws-1' as WorkspaceId
    const repository = makeRepository(new Map([[workspaceId, root]]))
    await repository.save({ id: 'a', status: 'pending', workspaceId, payload: 'x' })
    await repository.save({ id: 'a', status: 'done', workspaceId, payload: 'x' })

    const donePath = join(root, 'items/done/a.json')
    const parsed = JSON.parse(await readFile(donePath, 'utf-8'))
    expect(parsed.status).toBe('done')
  })

  it('filters list by workspaceId and statuses', async () => {
    const root = await makeRoot()
    const workspaceId = 'ws-1' as WorkspaceId
    const repository = makeRepository(new Map([[workspaceId, root]]))
    await repository.save({ id: 'a', status: 'pending', workspaceId, payload: '1' })
    await repository.save({ id: 'b', status: 'done', workspaceId, payload: '2' })

    const pending = await repository.list({ workspaceId, statuses: ['pending'] })
    expect(pending.map(item => item.id)).toEqual(['a'])
  })

  it('load throws NotFoundError when missing', async () => {
    const repository = makeRepository(new Map([['ws-1' as WorkspaceId, await makeRoot()]]))
    await expect(repository.load('missing')).rejects.toThrow(NotFoundError)
  })

  it('remove deletes the on-disk file', async () => {
    const root = await makeRoot()
    const workspaceId = 'ws-1' as WorkspaceId
    const repository = makeRepository(new Map([[workspaceId, root]]))
    await repository.save({ id: 'a', status: 'pending', workspaceId, payload: 'x' })
    await repository.remove('a')
    await expect(repository.load('a')).rejects.toThrow(NotFoundError)
  })

  it('save throws when the workspace is not registered', async () => {
    const repository = makeRepository(new Map())
    await expect(
      repository.save({ id: 'a', status: 'pending', workspaceId: 'ws-x' as WorkspaceId, payload: 'x' }),
    ).rejects.toThrow(/Workspace "ws-x"/)
  })
})
