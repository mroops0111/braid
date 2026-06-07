import type { AbsolutePath, UserId, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { NotFoundError, ValidationError } from '@braidhq/core'
import {
  AbsolutePath as AbsolutePathSchema,
  WorkspaceMember as WorkspaceMemberSchema,
} from '@braidhq/schema'
import { z } from 'zod'

/**
 * The registry stores a per-workspace `members[]` list alongside
 * `rootPath`. Old shapes (pre-Phase-C, with only `rootPath`) are
 * accepted by `.default([])` and lazily upgraded the next time we
 * write — `ensureLocalOwner` in `composeFs` seeds `local-user` as
 * owner so the single-tenant install keeps working without manual
 * migration.
 */
const RegistryEntry = z.object({
  rootPath: AbsolutePathSchema,
  members: z.array(WorkspaceMemberSchema).default([]),
})

const RegistryContent = z.object({
  workspaces: z.array(RegistryEntry).default([]),
})

type RegistryEntry = z.infer<typeof RegistryEntry>
type RegistryContent = z.infer<typeof RegistryContent>

/**
 * Persists the list of registered workspace rootPaths to a JSON file.
 * Default location is `${BRAID_HOME}/workspaces.json` (set by the caller).
 * Acts as the source of truth across server restarts — the in-memory
 * `FsWorkspaceRepository` cache is rebuilt from this file on cold start.
 */
export class WorkspaceRegistryFile {
  constructor(private readonly filePath: string) {}

  async list(): Promise<AbsolutePath[]> {
    const content = await this.read()
    return content.workspaces.map(entry => entry.rootPath)
  }

  async add(rootPath: AbsolutePath, initialOwner?: WorkspaceMember): Promise<void> {
    const content = await this.read()
    if (content.workspaces.some(entry => entry.rootPath === rootPath))
      return
    content.workspaces.push({
      rootPath,
      members: initialOwner ? [initialOwner] : [],
    })
    await this.write(content)
  }

  async remove(rootPath: AbsolutePath): Promise<void> {
    const content = await this.read()
    const filtered = content.workspaces.filter(entry => entry.rootPath !== rootPath)
    if (filtered.length === content.workspaces.length)
      return
    await this.write({ workspaces: filtered })
  }

  async listMembers(rootPath: AbsolutePath): Promise<WorkspaceMember[]> {
    const entry = await this.requireEntry(rootPath)
    return entry.members
  }

  /**
   * All entries with their members in one read. Lets admin views invert
   * to user → workspaces without N+1 reads of workspaces.json.
   */
  async listAllWithMembers(): Promise<ReadonlyArray<{ rootPath: AbsolutePath, members: readonly WorkspaceMember[] }>> {
    const content = await this.read()
    return content.workspaces.map(e => ({ rootPath: e.rootPath, members: e.members }))
  }

  async getMember(rootPath: AbsolutePath, userId: UserId): Promise<WorkspaceMember | undefined> {
    const entry = await this.requireEntry(rootPath)
    return entry.members.find(m => m.userId === userId)
  }

  async addMember(rootPath: AbsolutePath, member: WorkspaceMember): Promise<void> {
    const content = await this.read()
    const entry = content.workspaces.find(e => e.rootPath === rootPath)
    if (!entry)
      throw new NotFoundError(`Workspace at "${rootPath}" not registered`)
    if (entry.members.some(m => m.userId === member.userId))
      throw new ValidationError(`User "${member.userId}" is already a member of this workspace`)
    if (member.role === 'owner' && entry.members.some(m => m.role === 'owner'))
      throw new ValidationError(`Workspace already has an owner; use transferOwnership instead`)
    entry.members.push(member)
    await this.write(content)
  }

  async updateMember(
    rootPath: AbsolutePath,
    userId: UserId,
    patch: { role?: WorkspaceRole, skillOverrides?: WorkspaceMember['skillOverrides'] },
  ): Promise<WorkspaceMember> {
    const content = await this.read()
    const entry = content.workspaces.find(e => e.rootPath === rootPath)
    if (!entry)
      throw new NotFoundError(`Workspace at "${rootPath}" not registered`)
    const idx = entry.members.findIndex(m => m.userId === userId)
    if (idx < 0)
      throw new NotFoundError(`User "${userId}" is not a member of this workspace`)
    if (patch.role === 'owner' && entry.members.some(m => m.role === 'owner' && m.userId !== userId))
      throw new ValidationError(`Workspace already has an owner; use transferOwnership to swap`)
    const next: WorkspaceMember = { ...entry.members[idx]! }
    if (patch.role !== undefined)
      next.role = patch.role
    if (patch.skillOverrides !== undefined)
      next.skillOverrides = patch.skillOverrides
    entry.members[idx] = next
    await this.write(content)
    return next
  }

  async removeMember(rootPath: AbsolutePath, userId: UserId): Promise<void> {
    const content = await this.read()
    const entry = content.workspaces.find(e => e.rootPath === rootPath)
    if (!entry)
      return
    const target = entry.members.find(m => m.userId === userId)
    if (!target)
      return
    if (target.role === 'owner')
      throw new ValidationError(`Cannot remove the workspace owner; transfer ownership first`)
    entry.members = entry.members.filter(m => m.userId !== userId)
    await this.write(content)
  }

  /**
   * Demote the current owner to maintainer + promote `newOwnerId` to
   * owner in one atomic write. Throws if `newOwnerId` isn't a maintainer
   * of this workspace (we don't auto-add — the caller should add them
   * first if needed).
   */
  async transferOwnership(rootPath: AbsolutePath, newOwnerId: UserId): Promise<void> {
    const content = await this.read()
    const entry = content.workspaces.find(e => e.rootPath === rootPath)
    if (!entry)
      throw new NotFoundError(`Workspace at "${rootPath}" not registered`)
    const currentOwner = entry.members.find(m => m.role === 'owner')
    const target = entry.members.find(m => m.userId === newOwnerId)
    if (!target)
      throw new NotFoundError(`User "${newOwnerId}" is not a member of this workspace`)
    if (target.userId === currentOwner?.userId)
      return
    if (currentOwner)
      currentOwner.role = 'maintainer'
    target.role = 'owner'
    await this.write(content)
  }

  private async requireEntry(rootPath: AbsolutePath): Promise<RegistryEntry> {
    const content = await this.read()
    const entry = content.workspaces.find(e => e.rootPath === rootPath)
    if (!entry)
      throw new NotFoundError(`Workspace at "${rootPath}" not registered`)
    return entry
  }

  private async read(): Promise<RegistryContent> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = RegistryContent.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        throw new ValidationError(`Invalid workspace registry at "${this.filePath}": ${parsed.error.message}`)
      }
      return parsed.data
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { workspaces: [] }
      throw error
    }
  }

  private async write(content: RegistryContent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf-8')
  }
}
