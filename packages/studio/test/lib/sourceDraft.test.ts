import { describe, expect, it } from 'vitest'
import { nameToId, toSourceDescriptor } from '../../src/lib/sourceDraft'

const empty = {
  role: 'intent' as const,
  name: '',
  path: '',
  loaderKind: '' as const,
  gitUrl: '',
  gitBranch: '',
  gdriveFolderId: '',
  mcpServerId: '',
}

describe('nameToId', () => {
  it('lowercases and replaces non-alphanumeric characters with dashes', () => {
    expect(nameToId('My Source')).toBe('my-source')
    expect(nameToId('foo/bar.md')).toBe('foo-bar-md')
    expect(nameToId('Already-OK')).toBe('already-ok')
  })
})

describe('toSourceDescriptor', () => {
  it('builds a manual filesystem source when no loader is set', () => {
    const descriptor = toSourceDescriptor({
      ...empty,
      kind: 'filesystem',
      name: 'intent',
      path: './intent',
    })
    expect(descriptor).toEqual({
      kind: 'filesystem',
      id: 'intent',
      role: 'intent',
      name: 'intent',
      path: './intent',
    })
  })

  it('attaches a git loader when loaderKind = git', () => {
    const descriptor = toSourceDescriptor({
      ...empty,
      kind: 'filesystem',
      role: 'code',
      name: 'src',
      path: './src',
      loaderKind: 'git',
      gitUrl: 'https://example.com/repo.git',
      gitBranch: 'develop',
    })
    expect(descriptor).toMatchObject({
      kind: 'filesystem',
      loader: { kind: 'git', config: { url: 'https://example.com/repo.git', branch: 'develop' } },
    })
  })

  it('omits the git branch from loader config when blank', () => {
    const descriptor = toSourceDescriptor({
      ...empty,
      kind: 'filesystem',
      name: 'src',
      path: './src',
      loaderKind: 'git',
      gitUrl: 'https://example.com/repo.git',
      gitBranch: '',
    })
    expect(descriptor).toMatchObject({
      loader: { kind: 'git', config: { url: 'https://example.com/repo.git' } },
    })
  })

  it('attaches a gdrive loader when loaderKind = gdrive', () => {
    const descriptor = toSourceDescriptor({
      ...empty,
      kind: 'filesystem',
      name: 'drive',
      path: './drive',
      loaderKind: 'gdrive',
      gdriveFolderId: '1abc',
    })
    expect(descriptor).toMatchObject({
      loader: { kind: 'gdrive', config: { folderId: '1abc' } },
    })
  })

  it('builds an mcp source pointing at the chosen server', () => {
    const descriptor = toSourceDescriptor({
      ...empty,
      kind: 'mcp',
      role: 'code',
      name: 'linear',
      mcpServerId: 'linear',
    })
    expect(descriptor).toEqual({
      kind: 'mcp',
      id: 'linear',
      role: 'code',
      name: 'linear',
      mcpServerId: 'linear',
    })
  })
})
