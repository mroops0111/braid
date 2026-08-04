import { describe, expect, it } from 'vitest'
import { draftPathSegment, loaderKindLabel, nameToId, type SourceDraft, toSourceDescriptor } from '../../src/lib/sourceDraft'

const blank: SourceDraft = {
  role: 'primary',
  pathSegment: 'primaries',
  name: '',
  description: '',
  loaderKind: '',
  gitUrl: '',
  gitBranch: '',
  gdriveFolderId: '',
  gdriveInclude: '',
  gdriveExclude: '',
  githubOwner: '',
  githubRepo: '',
  githubState: 'all',
  githubLabels: '',
  githubIncludeComments: true,
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

describe('loaderKindLabel', () => {
  it('labels the empty kind as manual', () => {
    expect(loaderKindLabel('')).toBe('manual (no auto-sync)')
  })

  it('spells out github as issues', () => {
    expect(loaderKindLabel('github')).toBe('github (issues)')
  })

  it('falls back to the raw kind for an unknown loader', () => {
    expect(loaderKindLabel('git')).toBe('git')
    expect(loaderKindLabel('gdrive')).toBe('gdrive')
  })
})

describe('draftPathSegment', () => {
  it('uses the declared pathSegment', () => {
    expect(draftPathSegment({ role: 'primary', pathSegment: 'primaries' })).toBe('primaries')
  })

  it('falls back to the role id when no pathSegment is declared', () => {
    expect(draftPathSegment({ role: 'primary', pathSegment: '' })).toBe('primary')
  })
})

describe('toSourceDescriptor: filesystem', () => {
  it('groups sources under `<pathSegment>/<id>` and derives path automatically', () => {
    const descriptor = toSourceDescriptor({ ...blank, pathSegment: 'primaries', name: 'prd' })
    expect(descriptor).toEqual({
      kind: 'filesystem',
      id: 'prd',
      role: 'primary',
      name: 'prd',
      path: './primaries/prd',
    })
  })

  it('groups a differently-typed source under its own segment', () => {
    const descriptor = toSourceDescriptor({ ...blank, role: 'secondary', pathSegment: 'secondaries', name: 'frontend' })
    expect(descriptor).toMatchObject({ id: 'frontend', role: 'secondary', path: './secondaries/frontend' })
  })

  it('derives path from the slugified id, not the raw display name', () => {
    const descriptor = toSourceDescriptor({ ...blank, pathSegment: 'primaries', name: 'My Source' })
    expect(descriptor).toMatchObject({ id: 'my-source', name: 'My Source', path: './primaries/my-source' })
  })

  it('attaches a git loader when loaderKind=git, keeping both url and branch', () => {
    const descriptor = toSourceDescriptor({
      ...blank,
      role: 'secondary',
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

  it('attaches a github loader with owner / repo / state / flags', () => {
    const descriptor = toSourceDescriptor({
      ...blank,
      name: 'issues',
      loaderKind: 'github',
      githubOwner: 'mroops0111',
      githubRepo: 'braid',
      githubState: 'open',
      githubIncludeComments: true,
    })
    expect(descriptor).toMatchObject({
      loader: {
        kind: 'github',
        config: {
          owner: 'mroops0111',
          repo: 'braid',
          state: 'open',
          includeComments: true,
        },
      },
    })
  })

  it('parses comma-separated labels and omits the labels field when blank', () => {
    const withLabels = toSourceDescriptor({
      ...blank,
      name: 'issues',
      loaderKind: 'github',
      githubOwner: 'o',
      githubRepo: 'r',
      githubLabels: ' bug , p1 , ',
    })
    expect((withLabels as { loader: { config: { labels?: string[] } } }).loader.config.labels).toEqual(['bug', 'p1'])

    const noLabels = toSourceDescriptor({
      ...blank,
      name: 'issues2',
      loaderKind: 'github',
      githubOwner: 'o',
      githubRepo: 'r',
    })
    expect((noLabels as { loader: { config: { labels?: string[] } } }).loader.config.labels).toBeUndefined()
  })
})
