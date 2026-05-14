import type { IngestReport, SourceLoader, SyncReport } from '@telos/core'
import type { AbsolutePath, LoaderKind, PluginId } from '@telos/schema'
import { mkdir, rm } from 'node:fs/promises'
import process from 'node:process'
import { simpleGit } from 'simple-git'
import { z } from 'zod'

export const GitLoaderConfig = z.object({
  /** Remote URL. Supports `${VAR}` interpolation for tokens (e.g. `https://x-access-token:${GH_TOKEN}@github.com/...`). */
  url: z.string().min(1),
  /** Branch to track. Defaults to whatever the remote's HEAD points at. */
  branch: z.string().min(1).optional(),
  /** Subdirectory inside the cloned repo to use as the source content root. The loader still clones the full repo; you choose what claude sees by pointing the source `path` deeper. */
  subdir: z.string().optional(),
  /** Shallow clone depth. Defaults to 1 — we only need the working tree. */
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
export class GitLoader implements SourceLoader {
  readonly id = 'source-loader-git' as PluginId
  readonly type = 'source-loader' as const
  readonly kind = 'git' as LoaderKind
  readonly configSchema = GitLoaderConfig

  async ingest(rawConfig: unknown, destination: AbsolutePath): Promise<IngestReport> {
    // GitLoader doesn't need the per-source context: auth is in env / ${VAR}.
    const config = GitLoaderConfig.parse(rawConfig)
    const url = interpolateEnv(config.url)
    await rm(destination, { recursive: true, force: true })
    await mkdir(destination, { recursive: true })
    const git = simpleGit({ baseDir: destination })
    const cloneOptions: string[] = ['--depth', String(config.depth)]
    if (config.branch) {
      cloneOptions.push('--branch', config.branch)
    }
    await git.clone(url, destination, cloneOptions)
    const sha = (await git.revparse(['HEAD'])).trim()
    return {
      localPath: destination,
      metadata: { url: config.url, branch: config.branch ?? null, sha },
      fetchedAt: new Date().toISOString() as never,
    }
  }

  async sync(rawConfig: unknown, destination: AbsolutePath): Promise<SyncReport> {
    // GitLoader doesn't need the per-source context: auth is in env / ${VAR}.
    const config = GitLoaderConfig.parse(rawConfig)
    const git = simpleGit({ baseDir: destination })
    const before = (await git.revparse(['HEAD'])).trim()
    await git.fetch('origin', config.branch ?? 'HEAD', ['--depth', String(config.depth)])
    await git.reset(['--hard', `origin/${config.branch ?? 'HEAD'}`])
    const after = (await git.revparse(['HEAD'])).trim()
    return {
      changed: before !== after,
      metadata: { url: config.url, branch: config.branch ?? null, sha: after, previousSha: before },
      fetchedAt: new Date().toISOString() as never,
    }
  }
}

function interpolateEnv(input: string): string {
  return input.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name: string) => {
    const value = process.env[name]
    if (value === undefined) {
      throw new Error(`GitLoader: environment variable "${name}" referenced in URL is not set`)
    }
    return value
  })
}
