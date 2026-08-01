import type { AbsolutePath, WorkspaceId } from '@braidhq/schema'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundError } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { StatusedJsonStore } from '../../../src/infrastructure/hitl/StatusedJsonStore.js'

type Status = 'pending' | 'done'

interface Item {
  id: string
  status: Status
  workspaceId: WorkspaceId
  payload: string
}

async function makeRoot(): Promise<AbsolutePath> {
  return await mkdtemp(join(tmpdir(), 'braid-fs-statused-')) as AbsolutePath
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'a',
    status: 'pending',
    workspaceId: 'ws-1' as WorkspaceId,
    payload: 'x',
    ...overrides,
  }
}

function makeRepository(roots: ReadonlyMap<WorkspaceId, AbsolutePath>) {
  return new StatusedJsonStore<Item, Status, string>(
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

async function repositoryWithSingleWorkspace(): Promise<{
  repository: StatusedJsonStore<Item, Status, string>
  root: AbsolutePath
  workspaceId: WorkspaceId
}> {
  const root = await makeRoot()
  const workspaceId = 'ws-1' as WorkspaceId
  return { repository: makeRepository(new Map([[workspaceId, root]])), root, workspaceId }
}

describe('StatusedJsonStore round-trips', () => {
  it('saves then loads an entity back unchanged', async () => {
    const { repository, workspaceId } = await repositoryWithSingleWorkspace()

    await repository.save(makeItem({ id: 'a', payload: 'hi' }))

    const reloaded = await repository.load('a')
    expect(reloaded).toEqual({ id: 'a', status: 'pending', workspaceId, payload: 'hi' })
  })

  it('moves the on-disk file when the entity transitions to a new status', async () => {
    const { repository, root } = await repositoryWithSingleWorkspace()

    await repository.save(makeItem({ status: 'pending' }))
    await repository.save(makeItem({ status: 'done' }))

    const parsed = JSON.parse(await readFile(join(root, 'items/done/a.json'), 'utf-8'))
    expect(parsed.status).toBe('done')
  })

  it('overwrites idempotently when re-saving an entity in the same status', async () => {
    const { repository, root } = await repositoryWithSingleWorkspace()

    await repository.save(makeItem({ payload: 'v1' }))
    await repository.save(makeItem({ payload: 'v2' }))

    const parsed = JSON.parse(await readFile(join(root, 'items/pending/a.json'), 'utf-8'))
    expect(parsed.payload).toBe('v2')
  })

  it('locates an entity that lives in a non-first status directory', async () => {
    const { repository } = await repositoryWithSingleWorkspace()

    await repository.save(makeItem({ status: 'done' }))

    expect((await repository.load('a')).status).toBe('done')
  })
})

describe('StatusedJsonStore list filtering', () => {
  it('filters by workspaceId and statuses combined', async () => {
    const { repository, workspaceId } = await repositoryWithSingleWorkspace()

    await repository.save(makeItem({ id: 'a', status: 'pending' }))
    await repository.save(makeItem({ id: 'b', status: 'done' }))

    const pending = await repository.list({ workspaceId, statuses: ['pending'] })
    expect(pending.map(item => item.id)).toEqual(['a'])
  })

  it('scopes results to one workspace when multiple roots are registered', async () => {
    const rootA = await makeRoot()
    const rootB = await makeRoot()
    const workspaceA = 'ws-a' as WorkspaceId
    const workspaceB = 'ws-b' as WorkspaceId
    const repository = makeRepository(new Map([[workspaceA, rootA], [workspaceB, rootB]]))

    await repository.save(makeItem({ id: 'a-1', workspaceId: workspaceA }))
    await repository.save(makeItem({ id: 'b-1', workspaceId: workspaceB }))

    const onlyA = await repository.list({ workspaceId: workspaceA })
    expect(onlyA.map(item => item.id)).toEqual(['a-1'])

    const both = await repository.list()
    expect(both.map(item => item.id).sort()).toEqual(['a-1', 'b-1'])
  })
})

describe('StatusedJsonStore failure modes', () => {
  it('throws NotFoundError when load() targets an id that does not exist', async () => {
    const { repository } = await repositoryWithSingleWorkspace()

    await expect(repository.load('missing')).rejects.toThrow(NotFoundError)
  })

  it('throws NotFoundError when remove() targets an id that does not exist', async () => {
    const { repository } = await repositoryWithSingleWorkspace()

    await expect(repository.remove('missing')).rejects.toThrow(NotFoundError)
  })

  it('removes the on-disk file when remove() targets an existing entity', async () => {
    const { repository } = await repositoryWithSingleWorkspace()

    await repository.save(makeItem())
    await repository.remove('a')

    await expect(repository.load('a')).rejects.toThrow(NotFoundError)
  })

  it('throws when save() targets a workspace that is not registered', async () => {
    const repository = makeRepository(new Map())

    await expect(
      repository.save(makeItem({ workspaceId: 'ws-x' as WorkspaceId })),
    ).rejects.toThrow(/Workspace "ws-x"/)
  })
})
