import type { AbsolutePath } from '@telos/schema'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitLoader } from '../src/GitLoader.js'

/**
 * Integration test: clones a *local* bare repo, not the public internet.
 * Keeps the test fast and offline. Real git binary on PATH is required.
 */
describe('GitLoader', () => {
  let scratch: string
  let remoteDir: string
  let remoteUrl: string

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'telos-git-loader-'))
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

  it('ingest does a shallow clone into the destination', async () => {
    const loader = new GitLoader()
    const dest = join(scratch, 'workspace-source') as AbsolutePath
    const report = await loader.ingest({ url: remoteUrl, branch: 'main' }, dest)
    expect(report.localPath).toBe(dest)
    expect(report.metadata?.sha).toMatch(/^[0-9a-f]{40}$/)
    const readme = await readFile(join(dest, 'README.md'), 'utf-8')
    expect(readme).toBe('# v1\n')
  })

  it('sync pulls new commits and reports changed=true; second sync reports changed=false', async () => {
    const loader = new GitLoader()
    const dest = join(scratch, 'workspace-source') as AbsolutePath
    await loader.ingest({ url: remoteUrl, branch: 'main' }, dest)

    // Push a new commit to the remote via a working clone.
    const upstream = join(scratch, 'upstream')
    await simpleGit().clone(remoteUrl, upstream)
    const up = simpleGit({ baseDir: upstream })
    await up.addConfig('user.name', 'tester')
    await up.addConfig('user.email', 't@example.com')
    await writeFile(join(upstream, 'README.md'), '# v2\n', 'utf-8')
    await up.add('.').commit('v2', ['--no-gpg-sign'])
    await up.push('origin', 'HEAD')

    const first = await loader.sync({ url: remoteUrl, branch: 'main' }, dest)
    expect(first.changed).toBe(true)
    const readme = await readFile(join(dest, 'README.md'), 'utf-8')
    expect(readme).toBe('# v2\n')

    const second = await loader.sync({ url: remoteUrl, branch: 'main' }, dest)
    expect(second.changed).toBe(false)
  })

  // eslint-disable-next-line no-template-curly-in-string -- intentional: testing literal ${VAR} interpolation
  it('throws on unset env var when URL contains ${VAR}', async () => {
    const loader = new GitLoader()
    const dest = join(scratch, 'should-not-be-created') as AbsolutePath
    delete process.env.TELOS_GITLOADER_TEST_TOKEN
    // eslint-disable-next-line no-template-curly-in-string -- literal placeholder
    const url = 'https://x:${TELOS_GITLOADER_TEST_TOKEN}@example.invalid/repo.git'
    await expect(loader.ingest({ url }, dest)).rejects.toThrow(/TELOS_GITLOADER_TEST_TOKEN/)
  })
})
