import { describe, expect, it } from 'vitest'
import { nameToId, type SourceDraft, toSourceDescriptor } from '../../src/lib/sourceDraft'

const blank: SourceDraft = {
  role: 'intent',
  kind: 'filesystem',
  name: '',
  path: '',
  loaderKind: '',
  gitUrl: '',
  gitBranch: '',
  gdriveFolderId: '',
  mcpServerId: '',
}

describe('nameToId', () => {
  it('lowercases letters and replaces non-alphanumerics with dashes', () => {
    expect(nameToId('My Source')).toBe('my-source')
    expect(nameToId('foo/bar.md')).toBe('foo-bar-md')
    expect(nameToId('Already-OK')).toBe('already-ok')
  })

  it('returns an empty string when given an empty input', () => {
    expect(nameToId('')).toBe('')
  })

  it('collapses runs of special characters into individual dashes (no merging)', () => {
    expect(nameToId('!!!')).toBe('---')
  })
})

describe('toSourceDescriptor — filesystem', () => {
  it('builds a manual filesystem source when no loader is selected', () => {
    const descriptor = toSourceDescriptor({
      ...blank,
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

  it('attaches a git loader when loaderKind=git, keeping both url and branch', () => {
    const descriptor = toSourceDescriptor({
      ...blank,
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

  it('drops the branch field from the git loader config when blank', () => {
    const descriptor = toSourceDescriptor({
      ...blank,
      name: 'src',
      path: './src',
      loaderKind: 'git',
      gitUrl: 'https://example.com/repo.git',
    })

    expect(descriptor).toMatchObject({
      loader: { kind: 'git', config: { url: 'https://example.com/repo.git' } },
    })
    expect((descriptor as { loader: { config: { branch?: string } } }).loader.config.branch).toBeUndefined()
  })

  it('attaches a gdrive loader when loaderKind=gdrive', () => {
    const descriptor = toSourceDescriptor({
      ...blank,
      name: 'drive',
      path: './drive',
      loaderKind: 'gdrive',
      gdriveFolderId: '1abc',
    })

    expect(descriptor).toMatchObject({
      loader: { kind: 'gdrive', config: { folderId: '1abc' } },
    })
  })

  it('throws when the name is empty (zod brand rejects empty SourceId)', () => {
    expect(() => toSourceDescriptor({ ...blank, name: '', path: './x' })).toThrow()
  })

  it('throws when the path is empty (zod brand rejects empty AbsolutePath)', () => {
    expect(() => toSourceDescriptor({ ...blank, name: 'intent', path: '' })).toThrow()
  })
})

describe('toSourceDescriptor — mcp', () => {
  it('builds an mcp source pointing at the chosen server', () => {
    const descriptor = toSourceDescriptor({
      ...blank,
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

  it('throws when mcpServerId is empty', () => {
    expect(() => toSourceDescriptor({
      ...blank,
      kind: 'mcp',
      name: 'linear',
      mcpServerId: '',
    })).toThrow()
  })
})
