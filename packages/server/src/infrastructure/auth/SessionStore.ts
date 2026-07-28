import type { UserId } from '@braidhq/schema'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ValidationError } from '@braidhq/core'
import { z } from 'zod'

const SessionRow = z.object({
  // SHA-256 hex of the actual token.
  // The plaintext is shown to the client once at issuance time,
  // the server only ever sees the hash thereafter.
  // Constant-time compare is unnecessary for a pre-image lookup on hex strings,
  // which is what `findByToken` does.
  tokenHash: z.string().length(64),
  userId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  lastUsedAt: z.string().datetime({ offset: true }).optional(),
})

type SessionRow = z.infer<typeof SessionRow>

const StoreContent = z.object({
  sessions: z.array(SessionRow).default([]),
})
type StoreContent = z.infer<typeof StoreContent>

export interface IssuedSession {
  readonly token: string
  readonly userId: UserId
  readonly expiresAt?: string
}

export interface ResolvedSession {
  readonly userId: UserId
  readonly expiresAt?: string
}

/**
 * The port. A hosted deployment swaps the file-backed impl for a shared store,
 * such as Redis or Postgres, behind this interface.
 */
export interface SessionStore {
  issue: (userId: UserId, options?: { ttlSeconds?: number }) => Promise<IssuedSession>
  resolve: (token: string) => Promise<ResolvedSession | null>
  revoke: (token: string) => Promise<void>
  revokeAllForUser: (userId: UserId) => Promise<void>
}

/**
 * Hashed session tokens persisted to `${BRAID_HOME}/sessions.json`.
 * Token format is 32 random bytes encoded as `base64url` (43 chars).
 * The plain text is returned once at issuance time, the server stores SHA-256 of it.
 * A leaked sessions.json therefore cannot be replayed as a Bearer header.
 *
 * No rotation, no rolling expiry, no per-device tracking,
 * this is the minimum useful surface for v0.2.
 * Future remote-server work can revisit if needed.
 */
export class FsSessionStore implements SessionStore {
  constructor(private readonly filePath: string) {}

  async issue(userId: UserId, options: { ttlSeconds?: number } = {}): Promise<IssuedSession> {
    const content = await this.read()
    const token = randomBytes(32).toString('base64url')
    const tokenHash = sha256Hex(token)
    const createdAt = new Date().toISOString()
    const expiresAt = options.ttlSeconds
      ? new Date(Date.now() + options.ttlSeconds * 1000).toISOString()
      : undefined
    content.sessions.push({ tokenHash, userId, createdAt, ...(expiresAt ? { expiresAt } : {}) })
    await this.write(content)
    return { token, userId, ...(expiresAt ? { expiresAt } : {}) }
  }

  /**
   * Resolve a Bearer token to its session.
   * Updates `lastUsedAt` as a side effect,
   * not required for correctness but useful for the future "active sessions" admin view.
   */
  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!token || token.length === 0)
      return null
    const tokenHash = sha256Hex(token)
    const content = await this.read()
    const row = content.sessions.find(s => s.tokenHash === tokenHash)
    if (!row)
      return null
    if (row.expiresAt && Date.parse(row.expiresAt) < Date.now())
      return null
    row.lastUsedAt = new Date().toISOString()
    await this.write(content)
    return { userId: row.userId as UserId, ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}) }
  }

  async revoke(token: string): Promise<void> {
    const tokenHash = sha256Hex(token)
    const content = await this.read()
    const filtered = content.sessions.filter(s => s.tokenHash !== tokenHash)
    if (filtered.length === content.sessions.length)
      return
    await this.write({ sessions: filtered })
  }

  async revokeAllForUser(userId: UserId): Promise<void> {
    const content = await this.read()
    const filtered = content.sessions.filter(s => s.userId !== userId)
    if (filtered.length === content.sessions.length)
      return
    await this.write({ sessions: filtered })
  }

  private async read(): Promise<StoreContent> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = StoreContent.safeParse(JSON.parse(raw))
      if (!parsed.success)
        throw new ValidationError(`Invalid session store at "${this.filePath}": ${parsed.error.message}`)
      return parsed.data
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { sessions: [] }
      throw error
    }
  }

  private async write(content: StoreContent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf-8')
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
