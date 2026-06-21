import type { SourceLoaderPlugin } from '@braidhq/core'
import { mkdir, rm } from 'node:fs/promises'
import process from 'node:process'
import { defineSourceLoader } from '@braidhq/sdk'
import { simpleGit } from 'simple-git'
import { z } from 'zod'

export const GitLoaderConfig = z.object({
  /** Remote URL. Supports `${VAR}` interpolation for tokens (e.g. `https://x-access-token:${GH_TOKEN}@github.com/...`). */
  url: z.string().min(1),
  /** Branch to track. Defaults to whatever the remote's HEAD points at. */
  branch: z.string().min(1).optional(),
  /** Subdirectory inside the cloned repo to use as the source content root. The loader still clones the full repo; you choose what claude sees by pointing the source `path` deeper. */
  subdir: z.string().optional(),
  /** Shallow clone depth. Defaults to 1; we only need the working tree. */
  depth: z.number().int().positive().default(1),
})
export type GitLoaderConfig = z.infer<typeof GitLoaderConfig>

/**
 * Source loader for git remotes. The `destination` is treated as the full
 * git working tree: an initial `ingest` does a shallow clone there; `sync`
 * does fetch + reset --hard so the user's local edits don't drift the
 * source content silently. If that's not the behaviour you want, pick the
 * `manual` loader and manage the directory yourself.
 *
 * Auth: the loader does not handle credential helpers or SSH agent set-up.
 * Use a token in the URL (`https://x-access-token:${GH_TOKEN}@...`) with
 * `${VAR}` interpolation against the server's process env. Tokens never
 * land in PRODUCT.md.
 */
export const gitLoader: SourceLoaderPlugin = defineSourceLoader({
  kind: 'git',
  configSchema: GitLoaderConfig,
  ingest: async (config, destination) => {
    const url = interpolateEnv(config.url)
    await rm(destination, { recursive: true, force: true })
    await mkdir(destination, { recursive: true })
    const git = simpleGit({ baseDir: destination })
    const cloneOptions: string[] = ['--depth', String(config.depth)]
    if (config.branch)
      cloneOptions.push('--branch', config.branch)
    await git.clone(url, destination, cloneOptions)
    const sha = (await git.revparse(['HEAD'])).trim()
    return {
      localPath: destination,
      metadata: { url: config.url, branch: config.branch ?? null, sha },
      fetchedAt: new Date().toISOString() as never,
    }
  },
  sync: async (config, destination) => {
    const git = simpleGit({ baseDir: destination })
    const before = (await git.revparse(['HEAD'])).trim()
    await git.fetch('origin', config.branch ?? 'HEAD', ['--depth', String(config.depth)])
    await git.reset(['--hard', `origin/${config.branch ?? 'HEAD'}`])
    const after = (await git.revparse(['HEAD'])).trim()
    const counts = before === after
      ? { added: 0, updated: 0, removed: 0 }
      : await countChangedFiles(git, before, after)
    return {
      changed: before !== after,
      added: counts.added,
      updated: counts.updated,
      removed: counts.removed,
      metadata: { url: config.url, branch: config.branch ?? null, sha: after, previousSha: before },
      fetchedAt: new Date().toISOString() as never,
    }
  },
  webhook: {
    repoIdentity: (config) => {
      const parsed = parseGithubUrl(interpolateEnv(config.url))
      return parsed ? { provider: 'github', owner: parsed.owner, repo: parsed.repo } : undefined
    },
    // We track a single ref. `push` events on other refs are guaranteed
    // no-ops for `git fetch && reset --hard origin/<branch>`; skip them
    // so we don't waste a network round-trip. `ping` always dispatches
    // so the user sees `lastObservedSha` populate on first wire-up.
    // Other event types (issues, deploy, …) are unrelated to the code
    // mirror and are skipped.
    shouldDispatch: (config, delivery) => {
      if (delivery.event === 'ping')
        return true
      if (delivery.event !== 'push')
        return false
      const ref = typeof delivery.payload === 'object' && delivery.payload !== null
        ? (delivery.payload as { ref?: unknown }).ref
        : undefined
      if (typeof ref !== 'string')
        return false
      return ref === `refs/heads/${config.branch ?? 'master'}`
    },
  },
})

/**
 * Pull `owner/repo` out of a GitHub clone URL. Returns undefined for
 * non-github hosts so the receiver rejects the delivery instead of
 * pretending it matches.
 */
function parseGithubUrl(url: string): { owner: string, repo: string } | undefined {
  const trimmed = url.trim().replace(/\.git$/, '')
  const httpsMatch = trimmed.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+)$/)
  if (httpsMatch)
    return { owner: httpsMatch[1]!, repo: httpsMatch[2]! }
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+)$/)
  if (sshMatch)
    return { owner: sshMatch[1]!, repo: sshMatch[2]! }
  return undefined
}

/**
 * Parse `git diff --name-status <before>..<after>` into add / update /
 * remove counts. Status letters: A=added, M=modified, D=deleted,
 * R=renamed (treated as 1 update), C=copied (treated as 1 add). Anything
 * else we conservatively classify as updated.
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
