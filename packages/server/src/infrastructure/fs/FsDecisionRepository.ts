import type { AbsolutePath, Decision, DecisionFilter, DecisionId, WorkspaceId } from '@braidhq/schema'
import { join } from 'node:path'
import { type DecisionRepository, NotFoundError } from '@braidhq/core'
import { Decision as DecisionSchema } from '@braidhq/schema'
import { listJsonFiles, readJsonFile, writeJsonFile } from './jsonFileStore.js'
import { decisionsDir } from './paths.js'

export interface FsDecisionRepositoryOptions {
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

export class FsDecisionRepository implements DecisionRepository {
  constructor(private readonly options: FsDecisionRepositoryOptions) {}

  async append(decision: Decision): Promise<void> {
    const roots = await this.options.workspaceRoots()
    const root = roots.get(decision.workspaceId)
    if (!root)
      throw new NotFoundError(`Workspace "${decision.workspaceId}" not registered`)
    const targetPath = join(decisionsDir(root), `${decision.id}.json`)
    await writeJsonFile(targetPath, decision)
  }

  async list(filter?: DecisionFilter): Promise<Decision[]> {
    const roots = await this.options.workspaceRoots()
    const candidateWorkspaces = filter?.workspaceId
      ? new Map([[filter.workspaceId, roots.get(filter.workspaceId)]].filter(([, path]) => path) as [WorkspaceId, AbsolutePath][])
      : roots

    let decisions: Decision[] = []
    for (const [, root] of candidateWorkspaces) {
      const files = await listJsonFiles(decisionsDir(root))
      for (const file of files) {
        const data = await readJsonFile<unknown>(file)
        decisions.push(DecisionSchema.parse(data))
      }
    }
    if (filter?.actions && filter.actions.length > 0) {
      const actions = filter.actions
      decisions = decisions.filter(decision => actions.includes(decision.action))
    }
    const start = filter?.offset ?? 0
    const end = filter?.limit !== undefined ? start + filter.limit : undefined
    return decisions.slice(start, end)
  }

  async load(decisionId: DecisionId): Promise<Decision> {
    const roots = await this.options.workspaceRoots()
    for (const [, root] of roots) {
      const path = join(decisionsDir(root), `${decisionId}.json`)
      try {
        const data = await readJsonFile<unknown>(path)
        return DecisionSchema.parse(data)
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error
      }
    }
    throw new NotFoundError(`Decision "${decisionId}" not found`)
  }
}
