import type { SourceLoaderContext } from '@braidhq/core'
import type { AbsolutePath, SourceId, WorkspaceId } from '@braidhq/schema'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitLoader } from '../src/GitSourceLoaderPlugin.js'

const ctx: SourceLoaderContext = {
  workspaceId: 'ws-test' as WorkspaceId,
  sourceId: 'src-test' as SourceId,
}

/**
 * Integration test: clones a *local* bare repo, not the public internet.
 * Keeps the test fast and offline. Real git binary on PATH is required.
 */
describe('GitLoader', () => {
  let scratch: string
  let remoteDir: string
  let remoteUrl: string

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'braid-git-loader-'))
    remoteDir = join(scratch, 'remote')
    // Build a tiny git repo we can clone from.
    const seedDir = join(scratch, 'seed')
    await mkdir(seedDir, { recursive: true })
    const seed = simpleGit({ baseDir: seedDir })
    await seed.init(['--initial-branch=main'])
    await seed.addConfig('user.name', 'tester')
    await seed.addConfig('user.email', 't@example.com')
    await writeFile(join(seedDir, 'README.md'), '# v1\n', 'utf-8')
    await seed.add('.').commit('v1', ['--no-gpg-sign'])
    // Clone --bare so we have a remote URL.
    await simpleGit().clone(seedDir, remoteDir, ['--bare'])
    remoteUrl = `file://${remoteDir}`
  })

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true })
  })

  it('provision does a shallow clone into the destination', async () => {
    const loader = gitLoader
    const dest = join(scratch, 'workspace-source') as AbsolutePath
    const report = await loader.provision({ url: remoteUrl, branch: 'main' }, dest, ctx)
    expect(report.localPath).toBe(dest)
    expect(report.metadata?.sha).toMatch(/^[0-9a-f]{40}$/)
    const readme = await readFile(join(dest, 'README.md'), 'utf-8')
    expect(readme).toBe('# v1\n')
  })

  it('sync pulls new commits and reports changed=true; second sync reports changed=false', async () => {
    const loader = gitLoader
    const dest = join(scratch, 'workspace-source') as AbsolutePath
    await loader.provision({ url: remoteUrl, branch: 'main' }, dest, ctx)

    // Push a new commit to the remote via a working clone.
    const upstream = join(scratch, 'upstream')
    await simpleGit().clone(remoteUrl, upstream)
    const up = simpleGit({ baseDir: upstream })
    await up.addConfig('user.name', 'tester')
    await up.addConfig('user.email', 't@example.com')
    await writeFile(join(upstream, 'README.md'), '# v2\n', 'utf-8')
    await up.add('.').commit('v2', ['--no-gpg-sign'])
    await up.push('origin', 'HEAD')

    const first = await loader.sync!({ url: remoteUrl, branch: 'main' }, dest, ctx)
    expect(first.changed).toBe(true)
    // README modified, no adds or removes, so updated=1, added=0, removed=0.
    expect(first).toMatchObject({ added: 0, updated: 1, removed: 0 })
    const readme = await readFile(join(dest, 'README.md'), 'utf-8')
    expect(readme).toBe('# v2\n')

    const second = await loader.sync!({ url: remoteUrl, branch: 'main' }, dest, ctx)
    expect(second.changed).toBe(false)
    expect(second).toMatchObject({ added: 0, updated: 0, removed: 0 })
  })

  it('sync counts added / removed files (not just modified) for the unified per-file report', async () => {
    const loader = gitLoader
    const dest = join(scratch, 'workspace-source') as AbsolutePath
    await loader.provision({ url: remoteUrl, branch: 'main' }, dest, ctx)

    // Add one file + delete the existing README via an upstream clone.
    const upstream = join(scratch, 'upstream')
    await simpleGit().clone(remoteUrl, upstream)
    const up = simpleGit({ baseDir: upstream })
    await up.addConfig('user.name', 'tester')
    await up.addConfig('user.email', 't@example.com')
    await up.rm(['README.md'])
    await writeFile(join(upstream, 'NEW.md'), 'fresh\n', 'utf-8')
    await up.add('.').commit('add NEW.md, drop README', ['--no-gpg-sign'])
    await up.push('origin', 'HEAD')

    const report = await loader.sync!({ url: remoteUrl, branch: 'main' }, dest, ctx)
    expect(report).toMatchObject({ added: 1, updated: 0, removed: 1, changed: true })
  })

  // eslint-disable-next-line no-template-curly-in-string -- intentional: testing literal ${VAR} interpolation
  it('throws on unset env var when URL contains ${VAR}', async () => {
    const loader = gitLoader
    const dest = join(scratch, 'should-not-be-created') as AbsolutePath
    delete process.env.BRAID_GITLOADER_TEST_TOKEN
    // eslint-disable-next-line no-template-curly-in-string -- literal placeholder
    const url = 'https://x:${BRAID_GITLOADER_TEST_TOKEN}@example.invalid/repo.git'
    await expect(loader.provision({ url }, dest, ctx)).rejects.toThrow(/BRAID_GITLOADER_TEST_TOKEN/)
  })
})

/**
 * A source that omits `branch` must still follow its remote.
 * Fetching `origin HEAD` writes only FETCH_HEAD,
 * leaving the tracking ref at the clone-time commit,
 * so a reset against it freezes the mirror while every sync reports success.
 * These cover the branch defaulting that avoids that.
 */
describe('GitLoader default branch', () => {
  let scratch: string
  let remoteUrl: string
  let upstream: ReturnType<typeof simpleGit>

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'braid-git-default-branch-'))
    const seedDir = join(scratch, 'seed')
    await mkdir(seedDir, { recursive: true })
    const seed = simpleGit({ baseDir: seedDir })
    await seed.init(['--initial-branch=master'])
    await seed.addConfig('user.name', 'tester')
    await seed.addConfig('user.email', 't@example.com')
    await writeFile(join(seedDir, 'README.md'), '# v1\n', 'utf-8')
    await seed.add('.').commit('v1', ['--no-gpg-sign'])
    const remoteDir = join(scratch, 'remote')
    await simpleGit().clone(seedDir, remoteDir, ['--bare'])
    remoteUrl = `file://${remoteDir}`
    const upstreamDir = join(scratch, 'upstream')
    await simpleGit().clone(remoteUrl, upstreamDir)
    upstream = simpleGit({ baseDir: upstreamDir })
    await upstream.addConfig('user.name', 'tester')
    await upstream.addConfig('user.email', 't@example.com')
  })

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true })
  })

  it('picks up upstream commits when branch is omitted', async () => {
    const dest = join(scratch, 'workspace-source') as AbsolutePath
    await gitLoader.provision({ url: remoteUrl }, dest, ctx)
    expect(await readFile(join(dest, 'README.md'), 'utf-8')).toBe('# v1\n')

    await writeFile(join(scratch, 'upstream', 'README.md'), '# v2\n', 'utf-8')
    await upstream.add('.').commit('v2', ['--no-gpg-sign'])
    await upstream.push('origin', 'HEAD')

    const report = await gitLoader.sync!({ url: remoteUrl }, dest, ctx)
    expect(report.changed).toBe(true)
    expect(await readFile(join(dest, 'README.md'), 'utf-8')).toBe('# v2\n')
  })

  it('follows a force-push that rewrites the tracked branch', async () => {
    const dest = join(scratch, 'workspace-source') as AbsolutePath
    await gitLoader.provision({ url: remoteUrl }, dest, ctx)

    await writeFile(join(scratch, 'upstream', 'README.md'), '# rewritten\n', 'utf-8')
    await upstream.add('.')
    await upstream.commit('rewrite', ['--amend', '--no-gpg-sign'])
    await upstream.push(['--force', 'origin', 'master'])

    const report = await gitLoader.sync!({ url: remoteUrl }, dest, ctx)
    expect(report.changed).toBe(true)
    expect(await readFile(join(dest, 'README.md'), 'utf-8')).toBe('# rewritten\n')
  })

  it('fails at provision when the default misses, rather than mirroring nothing', async () => {
    const mainOnly = join(scratch, 'main-only')
    await mkdir(mainOnly, { recursive: true })
    const seed = simpleGit({ baseDir: mainOnly })
    await seed.init(['--initial-branch=main'])
    await seed.addConfig('user.name', 'tester')
    await seed.addConfig('user.email', 't@example.com')
    await writeFile(join(mainOnly, 'README.md'), '# main\n', 'utf-8')
    await seed.add('.').commit('c1', ['--no-gpg-sign'])
    const bare = join(scratch, 'main-only-remote')
    await simpleGit().clone(mainOnly, bare, ['--bare'])

    const dest = join(scratch, 'never-mirrored') as AbsolutePath
    await expect(gitLoader.provision({ url: `file://${bare}` }, dest, ctx)).rejects.toThrow(/master/)
  })
})

describe('GitLoader webhook capability', () => {
  it('parses host and path from an https url', () => {
    expect(gitLoader.webhook?.upstream({ url: 'https://github.com/mroops0111/braid.git' }))
      .toEqual({ host: 'github.com', path: 'mroops0111/braid' })
    expect(gitLoader.webhook?.upstream({ url: 'https://github.com/mroops0111/braid' }))
      .toEqual({ host: 'github.com', path: 'mroops0111/braid' })
  })

  it('parses host and path from an ssh url', () => {
    expect(gitLoader.webhook?.upstream({ url: 'git@github.com:mroops0111/braid.git' }))
      .toEqual({ host: 'github.com', path: 'mroops0111/braid' })
  })

  it('reports any host, leaving the receiver to decide which it can speak for', () => {
    expect(gitLoader.webhook?.upstream({ url: 'https://gitlab.com/foo/bar.git' }))
      .toEqual({ host: 'gitlab.com', path: 'foo/bar' })
    expect(gitLoader.webhook?.upstream({ url: 'https://gitlab.internal/team/sub/billing.git' }))
      .toEqual({ host: 'gitlab.internal', path: 'team/sub/billing' })
  })

  it('dispatches a push to the tracked branch', () => {
    const config = { url: 'https://github.com/o/r.git', branch: 'main' }
    expect(gitLoader.webhook?.shouldDispatch?.(config, { event: 'push', payload: { ref: 'refs/heads/main' } })).toBe(true)
  })

  it('skips a push to a different branch so we do not waste a fetch', () => {
    const config = { url: 'https://github.com/o/r.git', branch: 'main' }
    expect(gitLoader.webhook?.shouldDispatch?.(config, { event: 'push', payload: { ref: 'refs/heads/feature-x' } })).toBe(false)
  })

  it('resolves the master default when branch is unset, rather than guessing at the payload', () => {
    const config = { url: 'https://github.com/o/r.git' }
    expect(gitLoader.webhook?.shouldDispatch?.(config, { event: 'push', payload: { ref: 'refs/heads/master' } })).toBe(true)
    expect(gitLoader.webhook?.shouldDispatch?.(config, { event: 'push', payload: { ref: 'refs/heads/main' } })).toBe(false)
    expect(gitLoader.webhook?.shouldDispatch?.(config, { event: 'push', payload: { ref: 'refs/heads/develop' } })).toBe(false)
  })

  it('tolerates URL shapes the loader accepts: trailing slash, uppercase host, git+https, ssh-with-port, query string', () => {
    expect(gitLoader.webhook?.upstream({ url: 'https://github.com/foo/bar/' }))
      .toEqual({ host: 'github.com', path: 'foo/bar' })
    expect(gitLoader.webhook?.upstream({ url: 'https://GitHub.com/foo/bar.git' }))
      .toEqual({ host: 'github.com', path: 'foo/bar' })
    expect(gitLoader.webhook?.upstream({ url: 'git+https://github.com/foo/bar.git' }))
      .toEqual({ host: 'github.com', path: 'foo/bar' })
    expect(gitLoader.webhook?.upstream({ url: 'https://github.com/foo/bar?token=x' }))
      .toEqual({ host: 'github.com', path: 'foo/bar' })
  })

  it('does NOT interpolate env vars, so a missing env never crashes the receiver', () => {
    delete process.env.SHOULD_NOT_NEED_TO_BE_SET
    // eslint-disable-next-line no-template-curly-in-string -- literal placeholder
    const url = 'https://x:${SHOULD_NOT_NEED_TO_BE_SET}@github.com/foo/bar.git'
    expect(gitLoader.webhook?.upstream({ url }))
      .toEqual({ host: 'github.com', path: 'foo/bar' })
  })

  it('always dispatches ping so wire-up smoke tests succeed', () => {
    const config = { url: 'https://github.com/o/r.git' }
    expect(gitLoader.webhook?.shouldDispatch?.(config, { event: 'ping', payload: {} })).toBe(true)
  })

  it('skips events the git mirror does not consume', () => {
    const config = { url: 'https://github.com/o/r.git' }
    expect(gitLoader.webhook?.shouldDispatch?.(config, { event: 'issues', payload: {} })).toBe(false)
    expect(gitLoader.webhook?.shouldDispatch?.(config, { event: 'pull_request', payload: {} })).toBe(false)
  })
})
