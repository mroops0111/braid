import type { AbsolutePath, SourceLocation } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { gitWebUrl, parseRemote } from '../src/webUrl.js'

const DESTINATION = '/ws/codebases/app' as AbsolutePath

function input(overrides: {
  url: string
  unitPath?: string
  location?: SourceLocation
  revision?: string
  branch?: string
}) {
  return {
    config: { url: overrides.url, ...(overrides.branch ? { branch: overrides.branch } : {}) },
    unitPath: overrides.unitPath ?? 'app/src/a.rb',
    location: overrides.location ?? { uri: 'x', startLine: 10, endLine: 11 },
    destination: DESTINATION,
    ...(overrides.revision ? { revision: overrides.revision } : {}),
  }
}

describe('parseRemote', () => {
  it('reads an https remote, dropping the .git suffix', () => {
    expect(parseRemote('https://github.com/owner/repo.git'))
      .toEqual({ origin: 'https://github.com', path: 'owner/repo' })
  })

  it('reads an ssh remote as its https equivalent', () => {
    expect(parseRemote('git@gitlab.example.com:group/sub/repo.git'))
      .toEqual({ origin: 'https://gitlab.example.com', path: 'group/sub/repo' })
  })

  it('keeps a credential out of the origin it returns', () => {
    const remote = parseRemote('https://oauth2:secret-token@gitlab.example.com/group/repo.git')

    expect(remote?.origin).toBe('https://gitlab.example.com')
    expect(JSON.stringify(remote)).not.toContain('secret-token')
  })

  it('returns null for a remote naming no repository', () => {
    expect(parseRemote('https://github.com/')).toBeNull()
    expect(parseRemote('   ')).toBeNull()
  })
})

describe('gitWebUrl', () => {
  it('pins to the synced revision rather than the branch', () => {
    const url = gitWebUrl(input({ url: 'https://github.com/o/r.git', revision: 'abc123', branch: 'main' }), 'master')

    expect(url).toBe('https://github.com/o/r/blob/abc123/app/src/a.rb#L10-L11')
  })

  it('falls back to the configured branch when nothing has been synced yet', () => {
    const url = gitWebUrl(input({ url: 'https://github.com/o/r.git', branch: 'develop' }), 'master')

    expect(url).toContain('/blob/develop/')
  })

  it('writes a single-line fragment when the range covers one line', () => {
    const url = gitWebUrl(input({ url: 'https://github.com/o/r.git', location: { uri: 'x', startLine: 7, endLine: 7 } }), 'master')

    expect(url?.endsWith('#L7')).toBe(true)
  })

  it('omits the fragment when the reference carries no line', () => {
    const url = gitWebUrl(input({ url: 'https://github.com/o/r.git', location: { uri: 'x' } }), 'master')

    expect(url).toBe('https://github.com/o/r/blob/master/app/src/a.rb')
  })

  it('returns null when the config names no remote', () => {
    expect(gitWebUrl({ ...input({ url: 'x' }), config: {} }, 'master')).toBeNull()
  })
})
