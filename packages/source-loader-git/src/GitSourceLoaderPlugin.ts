import type { SourceLoaderPlugin } from '@braidhq/core'
import { mkdir, rm } from 'node:fs/promises'
import process from 'node:process'
import { defineSourceLoaderPlugin } from '@braidhq/sdk'
import { simpleGit } from 'simple-git'
import { z } from 'zod'

export const GitLoaderConfig = z.object({
  /** Remote URL. Supports `${VAR}` interpolation for tokens (e.g. `https://x-access-token:${GH_TOKEN}@github.com/...`). */
  url: z.string().min(1),
  /**
   * Branch to track. Always concrete, so fetch and reset name a real ref.
   * Resolving the remote's HEAD instead would be silent when it is wrong,
   * whereas a default that misses fails loudly at clone time.
   */
  branch: z.string().min(1).default('master'),
  /** Subdirectory inside the cloned repo to use as the source content root. The loader still clones the full repo; you choose what claude sees by pointing the source `path` deeper. */
  subdir: z.string().optional(),
  /** Shallow clone depth. Defaults to 1; we only need the working tree. */
  depth: z.number().int().positive().default(1),
})
export type GitLoaderConfig = z.infer<typeof GitLoaderConfig>

/**
 * Source loader for git remotes.
 * The `destination` is the full git working tree,
 * so an initial `provision` shallow-clones there and `sync` does fetch plus reset --hard,
 * so the user's local edits never drift the source content silently.
 * When that is not the behaviour you want,
 * pick the `manual` loader and manage the directory yourself.
 *
 * Auth: the loader does not handle credential helpers or SSH agent set-up.
 * Use a token in the URL (`https://x-access-token:${GH_TOKEN}@...`),
 * with `${VAR}` interpolation against the server's process env.
 * Tokens never land in PRODUCT.md.
 */
export const gitLoader: SourceLoaderPlugin = defineSourceLoaderPlugin({
  kind: 'git',
  configSchema: GitLoaderConfig,
  provision: async (config, destination) => {
    const url = interpolateEnv(config.url)
    await rm(destination, { recursive: true, force: true })
    await mkdir(destination, { recursive: true })
    const git = simpleGit({ baseDir: destination })
    const cloneOptions: string[] = ['--depth', String(config.depth), '--branch', config.branch]
    await git.clone(url, destination, cloneOptions)
    // Clone leaves the interpolated credential in `.git/config`,
    // so put the uninterpolated form back.
    // A token read from the environment then never sits on disk,
    // and sync re-interpolates before every fetch.
    await git.remote(['set-url', 'origin', config.url])
    const sha = (await git.revparse(['HEAD'])).trim()
    return {
      localPath: destination,
      revision: sha,
      metadata: { url: config.url, branch: config.branch, sha },
      fetchedAt: new Date().toISOString() as never,
    }
  },
  sync: async (config, destination) => {
    const git = simpleGit({ baseDir: destination })
    // Clone wrote the interpolated credential into `.git/config`,
    // so a rotated token leaves the mirror holding the old one.
    // Every fetch then fails as "Access denied",
    // which reads like a permission problem rather than a stale copy.
    // Re-interpolate here, so the environment stays authoritative.
    await git.remote(['set-url', 'origin', interpolateEnv(config.url)])
    const trackingRef = `refs/remotes/origin/${config.branch}`
    const before = (await git.revparse(['HEAD'])).trim()
    // An explicit refspec,
    // since a bare `git fetch origin <branch>` leaves the tracking ref alone,
    // and the reset below would be a silent no-op.
    // The leading `+` makes a force-push upstream still land.
    await git.fetch('origin', `+refs/heads/${config.branch}:${trackingRef}`, ['--depth', String(config.depth)])
    await git.reset(['--hard', trackingRef])
    const after = (await git.revparse(['HEAD'])).trim()
    const counts = before === after
      ? { added: 0, updated: 0, removed: 0 }
      : await countChangedFiles(git, before, after)
    return {
      changed: before !== after,
      added: counts.added,
      updated: counts.updated,
      removed: counts.removed,
      revision: after,
      metadata: { url: config.url, branch: config.branch, sha: after, previousSha: before },
      fetchedAt: new Date().toISOString() as never,
    }
  },
  webhook: {
    // Host and path come from the literal URL, never the credential portion.
    // `${VAR}` placeholders are deliberately left uninterpolated,
    // since resolving them would couple this to credential rotation,
    // and a missing env var would throw on every anonymous probe,
    // leaking the var name.
    upstream: config => parseRemoteUrl(config.url),
    // We track a single ref.
    // `push` events on other refs are guaranteed no-ops for `git fetch && reset --hard origin/<branch>`,
    // so skip them to avoid wasting a network round-trip.
    // `ping` always dispatches,
    // so the user sees `lastObservedSha` populate on first wire-up.
    // Other event types (issues, deploy, and so on) are unrelated to the code mirror and are skipped.
    shouldDispatch: (config, delivery) => {
      if (delivery.event === 'ping')
        return true
      if (delivery.event !== 'push')
        return false
      const ref = typeof delivery.payload === 'object' && delivery.payload !== null
        ? (delivery.payload as { ref?: unknown }).ref
        : undefined
      return ref === `refs/heads/${config.branch}`
    },
  },
})

/**
 * Split a clone URL into its host and the path identifying the repository.
 * Any host, since git speaks to all of them,
 * and this loader has no business deciding which platforms exist.
 *
 * Accepts the URL shapes git itself accepts:
 *   - `https://host/owner/repo`
 *   - `https://host/owner/repo.git`
 *   - `https://host/owner/repo/` (trailing slash)
 *   - `https://user:token@host/owner/repo.git` (creds inline)
 *   - `https://x:${GH_TOKEN}@host/owner/repo.git` (env placeholder)
 *   - `git+https://host/owner/repo` (npm-style)
 *   - `git@host:owner/repo[.git]` (ssh)
 *   - nested groups, which self-hosted forges use (`host/group/sub/repo`)
 *
 * The host is lowercased so `GitHub.com` and `github.com` compare equal.
 * Query and fragment portions are dropped, they never identify the repo.
 */
function parseRemoteUrl(url: string): { host: string, path: string } | undefined {
  // Strip an optional `git+` prefix, trim, drop query or fragment,
  // and normalise a trailing slash plus .git suffix.
  let trimmed = url.trim().replace(/^git\+/, '')
  const queryAt = trimmed.search(/[?#]/)
  if (queryAt >= 0)
    trimmed = trimmed.slice(0, queryAt)
  trimmed = trimmed.replace(/\/$/, '').replace(/\.git$/, '')
  const httpsMatch = trimmed.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/)
  if (httpsMatch)
    return { host: httpsMatch[1]!.toLowerCase(), path: httpsMatch[2]! }
  const sshMatch = trimmed.match(/^[^@\s]+@([^:]+):(.+)$/)
  if (sshMatch)
    return { host: sshMatch[1]!.toLowerCase(), path: sshMatch[2]! }
  return undefined
}

/**
 * Parse `git diff --name-status <before>..<after>` into add, update,
 * and remove counts.
 * Status letters: A=added, M=modified, D=deleted,
 * R=renamed (treated as 1 update), C=copied (treated as 1 add).
 * Anything else we conservatively classify as updated.
 */
async function countChangedFiles(
  git: ReturnType<typeof simpleGit>,
  before: string,
  after: string,
): Promise<{ added: number, updated: number, removed: number }> {
  const raw = await git.raw(['diff', '--name-status', `${before}..${after}`])
  let added = 0
  let updated = 0
  let removed = 0
  for (const line of raw.split('\n')) {
    const status = line.trim().split(/\s+/)[0]
    if (!status)
      continue
    const code = status[0]
    if (code === 'A' || code === 'C')
      added++
    else if (code === 'D')
      removed++
    else
      updated++
  }
  return { added, updated, removed }
}

function interpolateEnv(input: string): string {
  return input.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name: string) => {
    const value = process.env[name]
    if (value === undefined)
      throw new Error(`gitLoader: environment variable "${name}" referenced in URL is not set`)
    return value
  })
}
