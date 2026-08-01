import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Per-scope JSON secret storage on the local filesystem.
 * One file per `(namespace, key)` under `<root>/<namespace>/<key>.json`.
 * Files are written with mode 0600 so only the running user can read them,
 * the containing directory is mode 0700.
 *
 * This is NOT an encrypted-at-rest store.
 * It suits local, single-user Braid installs (the OSS target).
 * A hosted SaaS deployment would swap this for a vault adapter,
 * such as AWS Secrets Manager or Vault, behind the same interface.
 *
 * Layout, one tokens file per source under a per-provider namespace,
 * so Google tokens live at `<root>/oauth-google/<workspaceId>--<sourceId>.json`,
 * and GitHub tokens at `<root>/oauth-github/<workspaceId>--<sourceId>.json`.
 */
export interface SecretRecord {
  readonly value: unknown
  readonly updatedAt: string
}

export interface SecretStore {
  read: <T>(namespace: string, key: string) => Promise<T | undefined>
  write: (namespace: string, key: string, value: unknown) => Promise<void>
  delete: (namespace: string, key: string) => Promise<void>
}

export class FsSecretStore implements SecretStore {
  constructor(private readonly root: string) {}

  async read<T>(namespace: string, key: string): Promise<T | undefined> {
    const path = this.pathFor(namespace, key)
    try {
      const raw = await readFile(path, 'utf-8')
      const record = JSON.parse(raw) as SecretRecord
      return record.value as T
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return undefined
      throw error
    }
  }

  async write(namespace: string, key: string, value: unknown): Promise<void> {
    const path = this.pathFor(namespace, key)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const record: SecretRecord = { value, updatedAt: new Date().toISOString() }
    await writeFile(path, JSON.stringify(record, null, 2), { encoding: 'utf-8', mode: 0o600 })
    // mkdir's mode arg is ignored on some platforms,
    // so chmod the dir and file explicitly to keep perms stable across reboots and restores.
    await chmod(dirname(path), 0o700)
    await chmod(path, 0o600)
  }

  async delete(namespace: string, key: string): Promise<void> {
    const path = this.pathFor(namespace, key)
    await rm(path, { force: true })
  }

  private pathFor(namespace: string, key: string): string {
    return join(this.root, sanitize(namespace), `${sanitize(key)}.json`)
  }
}

// Conservative allowlist of ASCII letters, digits, `-`, `_`, and `.`.
// Anything else becomes `_` so a hostile workspaceId can't escape the dir.
function sanitize(input: string): string {
  return input.replace(/[^\w.-]/g, '_')
}
