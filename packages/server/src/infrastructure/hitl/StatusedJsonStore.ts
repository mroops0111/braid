import type { AbsolutePath, WorkspaceId } from '@braidhq/schema'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { NotFoundError } from '@braidhq/core'
import { listJsonFiles, moveFile, readJsonFile, writeJsonFile } from '../_shared/jsonFileStore.js'

export interface StatusedJsonStoreConfig<TEntity, TStatus extends string, TId extends string> {
  // Descriptors.
  // `entityName` names the type in NotFoundError messages, e.g. "Proposal".
  // `statuses` is the exhaustive list `locate` scans across every folder.
  readonly entityName: string
  readonly statuses: readonly TStatus[]

  // Projections, one per axis the store partitions on.
  readonly idOf: (entity: TEntity) => TId
  readonly statusOf: (entity: TEntity) => TStatus
  readonly workspaceIdOf: (entity: TEntity) => WorkspaceId
  // Resolves the directory holding `{id}.json` for a workspace root and status.
  readonly dirFor: (workspaceRoot: AbsolutePath, status: TStatus) => string

  // Disk codec, `parse` validates and class-wraps raw JSON,
  // `serialize` unwraps an entity to the plain shape written back.
  readonly parse: (raw: unknown) => TEntity
  readonly serialize: (entity: TEntity) => unknown
}

export interface StatusedJsonListFilter<TStatus extends string> {
  readonly workspaceId?: WorkspaceId
  readonly statuses?: readonly TStatus[]
}

export class StatusedJsonStore<TEntity, TStatus extends string, TId extends string> {
  constructor(
    private readonly config: StatusedJsonStoreConfig<TEntity, TStatus, TId>,
    private readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>,
  ) {}

  async list(filter?: StatusedJsonListFilter<TStatus>): Promise<TEntity[]> {
    const roots = await this.candidateRoots(filter?.workspaceId)
    const statuses = filter?.statuses?.length ? filter.statuses : this.config.statuses

    const entities: TEntity[] = []
    for (const root of roots.values()) {
      for (const status of statuses) {
        const files = await listJsonFiles(this.config.dirFor(root, status))
        for (const file of files) {
          const data = await readJsonFile<unknown>(file)
          entities.push(this.config.parse(data))
        }
      }
    }
    return entities
  }

  async load(id: TId): Promise<TEntity> {
    const found = await this.locate(id)
    if (!found)
      throw new NotFoundError(`${this.config.entityName} "${id}" not found`)
    const data = await readJsonFile<unknown>(found.path)
    return this.config.parse(data)
  }

  async save(entity: TEntity): Promise<void> {
    const roots = await this.workspaceRoots()
    const workspaceId = this.config.workspaceIdOf(entity)
    const root = roots.get(workspaceId)
    if (!root)
      throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
    const id = this.config.idOf(entity)
    const status = this.config.statusOf(entity)
    const targetPath = join(this.config.dirFor(root, status), `${id}.json`)
    const existing = await this.locate(id)
    if (existing && existing.path !== targetPath)
      await moveFile(existing.path, targetPath)
    await writeJsonFile(targetPath, this.config.serialize(entity))
  }

  async remove(id: TId): Promise<void> {
    const found = await this.locate(id)
    if (!found)
      throw new NotFoundError(`${this.config.entityName} "${id}" not found`)
    await rm(found.path)
  }

  async locate(id: TId): Promise<{ readonly path: string, readonly status: TStatus } | undefined> {
    const roots = await this.workspaceRoots()
    for (const root of roots.values()) {
      for (const status of this.config.statuses) {
        const candidatePath = join(this.config.dirFor(root, status), `${id}.json`)
        try {
          await readJsonFile(candidatePath)
          return { path: candidatePath, status }
        }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw error
        }
      }
    }
    return undefined
  }

  private async candidateRoots(
    workspaceId: WorkspaceId | undefined,
  ): Promise<ReadonlyMap<WorkspaceId, AbsolutePath>> {
    const roots = await this.workspaceRoots()
    if (!workspaceId)
      return roots
    const root = roots.get(workspaceId)
    return root ? new Map([[workspaceId, root]]) : new Map()
  }
}
