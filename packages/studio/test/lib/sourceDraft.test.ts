import { describe, expect, it } from 'vitest'
import { nameToId, type SourceDraft, toSourceDescriptor } from '../../src/lib/sourceDraft'

const blank: SourceDraft = {
  role: 'intent',
  name: '',
  description: '',
  loaderKind: '',
  gitUrl: '',
  gitBranch: '',
  gdriveFolderId: '',
  gdriveInclude: '',
  gdriveExclude: '',
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
  it('groups intent sources under `intents/<id>` and derives path automatically', () => {
    const descriptor = toSourceDescriptor({ ...blank, role: 'intent', name: 'prd' })
    expect(descriptor).toEqual({
      kind: 'filesystem',
      id: 'prd',
      role: 'intent',
      name: 'prd',
      path: './intents/prd',
    })
  })

  it('groups code sources under `codebases/<id>`', () => {
    const descriptor = toSourceDescriptor({ ...blank, role: 'code', name: 'frontend' })
    expect(descriptor).toMatchObject({ id: 'frontend', role: 'code', path: './codebases/frontend' })
  })

  it('derives path from the slugified id, not the raw display name', () => {
    const descriptor = toSourceDescriptor({ ...blank, role: 'intent', name: 'My Source' })
    expect(descriptor).toMatchObject({ id: 'my-source', name: 'My Source', path: './intents/my-source' })
  })

  it('attaches a git loader when loaderKind=git, keeping both url and branch', () => {
    const descriptor = toSourceDescriptor({
      ...blank,
      role: 'code',
      name: 'src',
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
      loaderKind: 'gdrive',
      gdriveFolderId: '1abc',
    })

    expect(descriptor).toMatchObject({
      loader: { kind: 'gdrive', config: { folderId: '1abc' } },
    })
  })

  it('includes optional gdrive include / exclude regex on the loader config when set', () => {
    const descriptor = toSourceDescriptor({
      ...blank,
      name: 'drive',
      loaderKind: 'gdrive',
      gdriveFolderId: '1abc',
      gdriveInclude: '^docs/',
      gdriveExclude: '\\.tmp$',
    })

    expect(descriptor).toMatchObject({
      loader: {
        kind: 'gdrive',
        config: { folderId: '1abc', include: '^docs/', exclude: '\\.tmp$' },
      },
    })
  })

  it('omits include / exclude when blank (avoids passing empty regex to the loader)', () => {
    const descriptor = toSourceDescriptor({
      ...blank,
      name: 'drive',
      loaderKind: 'gdrive',
      gdriveFolderId: '1abc',
    })

    const config = (descriptor as { loader: { config: Record<string, unknown> } }).loader.config
    expect(config.include).toBeUndefined()
    expect(config.exclude).toBeUndefined()
  })

  it('throws when the name is empty (zod brand rejects empty SourceId)', () => {
    expect(() => toSourceDescriptor({ ...blank, name: '' })).toThrow()
  })
})
