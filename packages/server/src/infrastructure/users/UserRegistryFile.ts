import type { UserId as UserIdType, UserUpdate as UserPatchType, User as UserType } from '@braidhq/schema'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { NotFoundError, ValidationError } from '@braidhq/core'
import { User } from '@braidhq/schema'
import { z } from 'zod'

const RegistryContent = z.object({
  users: z.array(User).default([]),
})

type RegistryContent = z.infer<typeof RegistryContent>

/**
 * Persists the user registry to a JSON file at `${BRAID_HOME}/users.json`. Source of truth across server restarts,
 * in-memory data is a derivation.
 *
 * Auth and ACL are server-side concerns. They never enter a workspace's git history. Keep this file under `~/.braid/`,
 * not inside any workspace dir.
 */
export class UserRegistryFile {
  constructor(private readonly filePath: string) {}

  async list(): Promise<UserType[]> {
    const content = await this.read()
    return content.users
  }

  async get(id: UserIdType): Promise<UserType | undefined> {
    const content = await this.read()
    return content.users.find(u => u.id === id)
  }

  async getByGoogleSub(sub: string): Promise<UserType | undefined> {
    const content = await this.read()
    return content.users.find(u => u.googleSub === sub)
  }

  async getByEmail(email: string): Promise<UserType | undefined> {
    const content = await this.read()
    const lowered = email.toLowerCase()
    return content.users.find(u => u.email?.toLowerCase() === lowered)
  }

  async create(user: UserType): Promise<UserType> {
    const content = await this.read()
    if (content.users.some(existing => existing.id === user.id))
      throw new ValidationError(`User "${user.id}" already exists`)
    if (user.googleSub && content.users.some(existing => existing.googleSub === user.googleSub))
      throw new ValidationError(`User with googleSub "${user.googleSub}" already exists`)
    content.users.push(user)
    await this.write(content)
    return user
  }

  async update(id: UserIdType, patch: UserPatchType): Promise<UserType> {
    const content = await this.read()
    const idx = content.users.findIndex(u => u.id === id)
    if (idx < 0)
      throw new NotFoundError(`User "${id}" not found`)
    const current = content.users[idx]!
    // Drop undefined keys, so `{ displayName: undefined }` doesn't blow away the existing displayName.
    // Zod's `.partial()` widens every field to optional,
    // but the persisted User schema still requires the non-optional fields.
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as Partial<UserType>
    const merged: UserType = { ...current, ...defined }
    content.users[idx] = merged
    await this.write(content)
    return merged
  }

  async delete(id: UserIdType): Promise<void> {
    const content = await this.read()
    const filtered = content.users.filter(u => u.id !== id)
    if (filtered.length === content.users.length)
      return
    await this.write({ users: filtered })
  }

  private async read(): Promise<RegistryContent> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = RegistryContent.safeParse(JSON.parse(raw))
      if (!parsed.success)
        throw new ValidationError(`Invalid user registry at "${this.filePath}": ${parsed.error.message}`)
      return parsed.data
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { users: [] }
      throw error
    }
  }

  private async write(content: RegistryContent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf-8')
  }
}
