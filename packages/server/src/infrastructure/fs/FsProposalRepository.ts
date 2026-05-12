import type { AbsolutePath, ProposalFilter, ProposalId, ProposalStatus, WorkspaceId } from '@telos/schema'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { NotFoundError, Proposal, type ProposalRepository } from '@telos/core'
import { Proposal as ProposalSchema } from '@telos/schema'
import { listJsonFiles, moveFile, readJsonFile, writeJsonFile } from './jsonFileStore.js'
import { PROPOSAL_STATUSES, proposalsDir } from './paths.js'

export interface FsProposalRepositoryOptions {
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

export class FsProposalRepository implements ProposalRepository {
  constructor(private readonly options: FsProposalRepositoryOptions) {}

  async list(filter?: ProposalFilter): Promise<Proposal[]> {
    const roots = await this.options.workspaceRoots()
    const candidateWorkspaces = filter?.workspaceId
      ? new Map([[filter.workspaceId, roots.get(filter.workspaceId)]].filter(([, path]) => path) as [WorkspaceId, AbsolutePath][])
      : roots
    const statuses = filter?.statuses && filter.statuses.length > 0
      ? filter.statuses
      : PROPOSAL_STATUSES

    let proposals: Proposal[] = []
    for (const [, workspaceRoot] of candidateWorkspaces) {
      for (const status of statuses) {
        const directory = proposalsDir(workspaceRoot, status)
        const files = await listJsonFiles(directory)
        for (const file of files) {
          const data = await readJsonFile<unknown>(file)
          proposals.push(new Proposal(ProposalSchema.parse(data)))
        }
      }
    }

    if (filter?.generatedBy && filter.generatedBy.length > 0) {
      const skills = filter.generatedBy
      proposals = proposals.filter(proposal => skills.includes(proposal.generatedBy))
    }
    return paginate(proposals, filter?.limit, filter?.offset)
  }

  async load(proposalId: ProposalId): Promise<Proposal> {
    const found = await this.locate(proposalId)
    if (!found)
      throw new NotFoundError(`Proposal "${proposalId}" not found`)
    const data = await readJsonFile<unknown>(found.path)
    return new Proposal(ProposalSchema.parse(data))
  }

  async save(proposal: Proposal): Promise<void> {
    const roots = await this.options.workspaceRoots()
    const root = roots.get(proposal.workspaceId)
    if (!root)
      throw new NotFoundError(`Workspace "${proposal.workspaceId}" not registered`)
    const data = proposal.toData()
    const targetDir = proposalsDir(root, data.status)
    const targetPath = join(targetDir, `${data.id}.json`)
    const existing = await this.locate(proposal.id)
    if (existing && existing.path !== targetPath) {
      await moveFile(existing.path, targetPath)
    }
    await writeJsonFile(targetPath, data)
  }

  async remove(proposalId: ProposalId): Promise<void> {
    const found = await this.locate(proposalId)
    if (!found)
      throw new NotFoundError(`Proposal "${proposalId}" not found`)
    await rm(found.path)
  }

  private async locate(proposalId: ProposalId): Promise<{ path: string, status: ProposalStatus } | undefined> {
    const roots = await this.options.workspaceRoots()
    for (const [, root] of roots) {
      for (const status of PROPOSAL_STATUSES) {
        const candidatePath = join(proposalsDir(root, status), `${proposalId}.json`)
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
}

function paginate<T>(items: readonly T[], limit?: number, offset?: number): T[] {
  const start = offset ?? 0
  const end = limit !== undefined ? start + limit : undefined
  return items.slice(start, end)
}
