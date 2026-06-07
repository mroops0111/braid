import type { UserAuthor, UserDirectory } from '@braidhq/core'
import type { UserId } from '@braidhq/schema'
import type { UserRegistryFile } from './UserRegistryFile.js'

/**
 * Adapt the file-backed user roster to the core `UserDirectory` port.
 * Returns `null` for unknown ids (bootstrap / `braid-skill` etc.) so
 * the git layer falls back to its synthetic author for those rows.
 */
export class UserDirectoryFromRegistry implements UserDirectory {
  constructor(private readonly registry: UserRegistryFile) {}

  async resolve(userId: UserId): Promise<UserAuthor | null> {
    const user = await this.registry.get(userId)
    if (!user)
      return null
    return {
      displayName: user.displayName,
      ...(user.email ? { email: user.email } : {}),
    }
  }
}
