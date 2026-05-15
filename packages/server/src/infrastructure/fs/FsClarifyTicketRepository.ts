import type {
  AbsolutePath,
  ClarifyFilter,
  ClarifyStatus,
  ClarifyTicketId,
  WorkspaceId,
} from '@telos/schema'
import { join } from 'node:path'
import { ClarifyTicket, type ClarifyTicketRepository, NotFoundError, paginate } from '@telos/core'
import { ClarifyTicket as ClarifyTicketSchema } from '@telos/schema'
import { listJsonFiles, moveFile, readJsonFile, writeJsonFile } from './jsonFileStore.js'
import { CLARIFY_STATUSES, clarifyDir } from './paths.js'

export interface FsClarifyTicketRepositoryOptions {
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

export class FsClarifyTicketRepository implements ClarifyTicketRepository {
  constructor(private readonly options: FsClarifyTicketRepositoryOptions) {}

  async list(filter?: ClarifyFilter): Promise<ClarifyTicket[]> {
    const roots = await this.options.workspaceRoots()
    const candidateWorkspaces = filter?.workspaceId
      ? new Map([[filter.workspaceId, roots.get(filter.workspaceId)]].filter(([, path]) => path) as [WorkspaceId, AbsolutePath][])
      : roots
    const statuses = filter?.statuses && filter.statuses.length > 0
      ? filter.statuses
      : CLARIFY_STATUSES

    const tickets: ClarifyTicket[] = []
    for (const [, root] of candidateWorkspaces) {
      for (const status of statuses) {
        const files = await listJsonFiles(clarifyDir(root, status))
        for (const file of files) {
          const data = await readJsonFile<unknown>(file)
          tickets.push(new ClarifyTicket(ClarifyTicketSchema.parse(data)))
        }
      }
    }
    return paginate(tickets, filter?.limit, filter?.offset)
  }

  async load(clarifyTicketId: ClarifyTicketId): Promise<ClarifyTicket> {
    const found = await this.locate(clarifyTicketId)
    if (!found)
      throw new NotFoundError(`ClarifyTicket "${clarifyTicketId}" not found`)
    const data = await readJsonFile<unknown>(found.path)
    return new ClarifyTicket(ClarifyTicketSchema.parse(data))
  }

  async save(ticket: ClarifyTicket): Promise<void> {
    const roots = await this.options.workspaceRoots()
    const root = roots.get(ticket.workspaceId)
    if (!root)
      throw new NotFoundError(`Workspace "${ticket.workspaceId}" not registered`)
    const data = ticket.toData()
    const targetPath = join(clarifyDir(root, data.status), `${data.id}.json`)
    const existing = await this.locate(ticket.id)
    if (existing && existing.path !== targetPath) {
      await moveFile(existing.path, targetPath)
    }
    await writeJsonFile(targetPath, data)
  }

  private async locate(ticketId: ClarifyTicketId): Promise<{ path: string, status: ClarifyStatus } | undefined> {
    const roots = await this.options.workspaceRoots()
    for (const [, root] of roots) {
      for (const status of CLARIFY_STATUSES) {
        const candidatePath = join(clarifyDir(root, status), `${ticketId}.json`)
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
