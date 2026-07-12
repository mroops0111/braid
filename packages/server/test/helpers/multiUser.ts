import type { Timestamp, User } from '@braidhq/schema'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UserId, WorkspaceId } from '@braidhq/schema'
import { createApp } from '../../src/app.js'
import { composeFsApp } from '../../src/composeFs.js'

const TEST_TIMESTAMP = '2026-01-01T00:00:00.000Z' as Timestamp

function makeUser(id: string, displayName: string, serverRole: 'admin' | 'user'): User {
  return {
    id: UserId.parse(id),
    displayName,
    serverRole,
    createdAt: TEST_TIMESTAMP,
  }
}

/**
 * Fixed test users covering every permission axis. Reused across
 * route tests so assertions can speak in terms of `users.owner`
 * rather than freshly-minted ids per test file.
 */
export const TEST_USERS = {
  admin: makeUser('usr-admin', 'Admin', 'admin'),
  owner: makeUser('usr-owner', 'Owner', 'user'),
  maintainer: makeUser('usr-maint', 'Maintainer', 'user'),
  guest: makeUser('usr-guest', 'Guest', 'user'),
  outsider: makeUser('usr-outsider', 'Outsider', 'user'),
} as const

export const DEFAULT_WORKSPACE_NAME = 'multiuser-demo'
export const DEFAULT_WORKSPACE_ID: WorkspaceId = WorkspaceId.parse(DEFAULT_WORKSPACE_NAME)

export interface MultiUserAppHandle {
  readonly app: OpenAPIHono
  readonly braidHome: string
  readonly workspaceId: WorkspaceId
  readonly workspaceRootPath: string
  readonly users: typeof TEST_USERS
}

export interface BuildMultiUserAppOptions {
  /**
   * Members seeded into the workspace registry. The `owner` user is
   * always included as owner unless `omitOwner` is set; `maintainer`
   * and `guest` are optional convenience flags. Pass `extra` for any
   * other shape.
   */
  readonly members?: {
    omitOwner?: boolean
    maintainer?: boolean
    guest?: boolean
    extra?: ReadonlyArray<{ userId: User['id'], role: 'owner' | 'maintainer' | 'guest' }>
  }
}

/**
 * Build a server app backed by a real `~/.braid`-style filesystem
 * layout with seeded users + a canonical workspace. composeFsApp
 * defaults `localTrust: true`, so callers pass `X-Braid-User`
 * (see `asUser`) to act as a specific identity.
 */
export async function buildMultiUserApp(
  options: BuildMultiUserAppOptions = {},
): Promise<MultiUserAppHandle> {
  const braidHome = await mkdtemp(join(tmpdir(), 'braid-multiuser-'))
  await writeUsersJson(braidHome)
  const workspaceRootPath = await seedCanonicalWorkspace(braidHome, DEFAULT_WORKSPACE_NAME)
  await writeWorkspacesJson(braidHome, workspaceRootPath, options.members ?? { maintainer: true, guest: true })
  const deps = await composeFsApp({ braidHome })
  const app = createApp(deps)
  return {
    app,
    braidHome,
    workspaceId: DEFAULT_WORKSPACE_ID,
    workspaceRootPath,
    users: TEST_USERS,
  }
}

/**
 * Request init that acts as the given user via `X-Braid-User`. Use
 * with `app.request(path, asUser(users.owner.id))` for GETs, or spread
 * into a larger init via `{ ...asUser(id), method: 'POST', ... }`.
 */
export function asUser(userId: User['id']): { headers: Record<string, string> } {
  return { headers: { 'X-Braid-User': userId } }
}

/**
 * JSON-bodied request init that acts as the given user.
 */
export function asUserJson<T>(userId: User['id'], method: 'POST' | 'PATCH' | 'DELETE', body?: T): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Braid-User': userId,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
}

async function writeUsersJson(braidHome: string): Promise<void> {
  const path = join(braidHome, 'users.json')
  const content = { users: Object.values(TEST_USERS) }
  await writeFile(path, JSON.stringify(content, null, 2), 'utf-8')
}

async function seedCanonicalWorkspace(braidHome: string, name: string): Promise<string> {
  const dir = join(braidHome, 'workspaces', name)
  await mkdir(dir, { recursive: true })
  const manifest = `---
name: ${name}
storage:
  kind: in-memory
  config: {}
---
# Test workspace`
  await writeFile(join(dir, 'PRODUCT.md'), manifest, 'utf-8')
  await mkdir(join(dir, 'artifacts'), { recursive: true })
  return dir
}

async function writeWorkspacesJson(
  braidHome: string,
  rootPath: string,
  members: NonNullable<BuildMultiUserAppOptions['members']>,
): Promise<void> {
  const seeded: Array<{ userId: User['id'], role: 'owner' | 'maintainer' | 'guest', joinedAt: Timestamp }> = []
  if (!members.omitOwner)
    seeded.push({ userId: TEST_USERS.owner.id, role: 'owner', joinedAt: TEST_TIMESTAMP })
  if (members.maintainer)
    seeded.push({ userId: TEST_USERS.maintainer.id, role: 'maintainer', joinedAt: TEST_TIMESTAMP })
  if (members.guest)
    seeded.push({ userId: TEST_USERS.guest.id, role: 'guest', joinedAt: TEST_TIMESTAMP })
  for (const extra of members.extra ?? [])
    seeded.push({ ...extra, joinedAt: TEST_TIMESTAMP })

  const path = join(braidHome, 'workspaces.json')
  const content = { workspaces: [{ rootPath, members: seeded }] }
  await writeFile(path, JSON.stringify(content, null, 2), 'utf-8')
}
