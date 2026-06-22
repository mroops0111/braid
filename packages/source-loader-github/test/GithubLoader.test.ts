import type { SourceLoaderContext } from '@braidhq/core'
import type { AbsolutePath, SourceId, WorkspaceId } from '@braidhq/schema'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { createGithubLoader } from '../src/GithubLoader.js'

const ctx: SourceLoaderContext = {
  workspaceId: 'ws-test' as WorkspaceId,
  sourceId: 'src-test' as SourceId,
}

interface MockIssue {
  number: number
  title: string
  state?: string
  user?: { login: string } | null
  labels?: Array<{ name: string }>
  body?: string | null
  html_url?: string
  created_at: string
  updated_at: string
  pull_request?: object
  comments?: number
}

interface MockComment {
  user?: { login: string } | null
  body?: string | null
  created_at: string
  updated_at: string
}

interface MockClosingPR {
  number: number
  merged: boolean
  mergeCommit?: string | null
}

interface MockRouter {
  issues: readonly MockIssue[]
  comments?: Record<number, readonly MockComment[]>
  pageSize?: number
  /**
   * Per-issue mapping of "PRs that close this issue". When omitted, the
   * mock defaults to one merged PR per issue (lets the existing tests
   * exercise the happy-path filter without each having to declare a
   * provenance). Tests that want to assert filter behaviour pass an
   * explicit map.
   */
  closingPRs?: Record<number, readonly MockClosingPR[]>
}

function buildMockFetch(router: MockRouter, recorder?: { calls: string[], lastHeaders: Headers | null }): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (recorder) {
      recorder.calls.push(url)
      recorder.lastHeaders = new Headers(init?.headers ?? {})
    }
    const parsed = new URL(url)
    if (parsed.pathname === '/graphql') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : '{}') as { variables?: { number?: number } } : {}
      const issueNumber = body.variables?.number ?? 0
      const nodes = router.closingPRs?.[issueNumber] ?? defaultClosingPRsFor(router, issueNumber)
      const payload = {
        data: {
          repository: {
            issue: {
              closedByPullRequestsReferences: {
                nodes: nodes.map(n => ({
                  number: n.number,
                  merged: n.merged,
                  mergeCommit: n.mergeCommit === undefined
                    ? { oid: `sha-pr-${n.number}` }
                    : n.mergeCommit
                      ? { oid: n.mergeCommit }
                      : null,
                })),
              },
            },
          },
        },
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const issuesMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues$/)
    if (issuesMatch) {
      const since = parsed.searchParams.get('since')
      const state = parsed.searchParams.get('state') ?? 'all'
      const page = Number.parseInt(parsed.searchParams.get('page') ?? '1', 10)
      const pageSize = router.pageSize ?? 100
      let filtered = router.issues.slice()
      if (since)
        filtered = filtered.filter(i => i.updated_at > since)
      if (state !== 'all')
        filtered = filtered.filter(i => (i.state ?? 'open') === state)
      const start = (page - 1) * pageSize
      const slice = filtered.slice(start, start + pageSize)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (start + pageSize < filtered.length) {
        const nextUrl = new URL(url)
        nextUrl.searchParams.set('page', String(page + 1))
        headers.link = `<${nextUrl.toString()}>; rel="next"`
      }
      return new Response(JSON.stringify(slice), { status: 200, headers })
    }
    const commentsMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/)
    if (commentsMatch) {
      const num = Number.parseInt(commentsMatch[3]!, 10)
      const comments = router.comments?.[num] ?? []
      return new Response(JSON.stringify(comments), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('no route', { status: 404 })
  }
}

/**
 * When the test fixture doesn't declare per-issue closing PRs, fall
 * back to "one merged PR per issue" so all existing tests pass the
 * realized-intent gate without each having to spell out provenance.
 * Tests that exercise the filter explicitly set `closingPRs` instead.
 */
function defaultClosingPRsFor(router: MockRouter, issueNumber: number): readonly MockClosingPR[] {
  if (router.closingPRs)
    return router.closingPRs[issueNumber] ?? []
  return [{ number: issueNumber * 100, merged: true }]
}

interface ParsedFrontmatter {
  number: number
  title: string
  state: string
  author: string | null
  labels: readonly string[]
  createdAt: string
  updatedAt: string
  url: string
  closedByMergedPRs: ReadonlyArray<{ number: number, mergeCommit: string | null }>
}

function splitMarkdown(content: string): { fm: ParsedFrontmatter, rest: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match)
    throw new Error('frontmatter missing')
  return { fm: parseYaml(match[1]!) as ParsedFrontmatter, rest: match[2]! }
}

describe('GithubLoader', () => {
  let dest: AbsolutePath

  beforeEach(async () => {
    dest = await mkdtemp(join(tmpdir(), 'braid-github-loader-')) as AbsolutePath
  })

  afterEach(async () => {
    await rm(dest, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('ingest writes one markdown file per issue with deterministic frontmatter', async () => {
    const fetchFn = buildMockFetch({
      issues: [
        {
          number: 1,
          title: 'First issue',
          state: 'open',
          user: { login: 'alice' },
          labels: [{ name: 'bug' }, { name: 'p1' }],
          body: 'Body of issue 1.',
          html_url: 'https://github.com/o/r/issues/1',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-02-01T00:00:00Z',
          comments: 0,
        },
        {
          number: 2,
          title: 'Second issue',
          state: 'closed',
          user: { login: 'bob' },
          body: '',
          html_url: 'https://github.com/o/r/issues/2',
          created_at: '2026-01-02T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
          comments: 0,
        },
      ],
    })

    const loader = createGithubLoader({ fetchFn })
    const report = await loader.ingest({ owner: 'o', repo: 'r' }, dest, ctx)

    expect(report.localPath).toBe(dest)
    const files = (await readdir(join(dest, 'issues'))).sort()
    expect(files).toEqual(['1.md', '2.md'])

    const issue1 = await readFile(join(dest, 'issues', '1.md'), 'utf-8')
    const { fm, rest } = splitMarkdown(issue1)
    expect(fm.number).toBe(1)
    expect(fm.title).toBe('First issue')
    expect(fm.author).toBe('alice')
    expect(fm.labels).toEqual(['bug', 'p1'])
    expect(rest.trim()).toBe('Body of issue 1.')
  })

  it('always omits PR-shaped entries even when `includePullRequests` is set to true (deprecated flag is ignored)', async () => {
    const router: MockRouter = {
      issues: [
        { number: 1, title: 'Issue', created_at: 't', updated_at: 't' },
        { number: 2, title: 'PR', pull_request: { url: 'x' }, created_at: 't', updated_at: 't' },
      ],
    }
    const loader = createGithubLoader({ fetchFn: buildMockFetch(router) })
    await loader.ingest({ owner: 'o', repo: 'r', includePullRequests: true }, dest, ctx)
    // PR (#2) is filtered out regardless of the deprecated flag; only #1
    // survives, and it passes the realized-intent gate via the mock's
    // default "one merged PR per issue" stub.
    expect((await readdir(join(dest, 'issues'))).sort()).toEqual(['1.md'])
  })

  it('excludes issues whose closedByPullRequestsReferences contains no merged PR', async () => {
    const router: MockRouter = {
      issues: [
        { number: 1, title: 'merged-by-pr', created_at: 't', updated_at: 't' },
        { number: 2, title: 'closed-but-no-pr', created_at: 't', updated_at: 't' },
        { number: 3, title: 'pr-closed-without-merge', created_at: 't', updated_at: 't' },
      ],
      closingPRs: {
        1: [{ number: 10, merged: true, mergeCommit: 'abc1' }],
        2: [], // no PR ever closed this issue
        3: [{ number: 30, merged: false }], // PR was closed without merging
      },
    }
    const loader = createGithubLoader({ fetchFn: buildMockFetch(router) })
    await loader.ingest({ owner: 'o', repo: 'r' }, dest, ctx)
    expect((await readdir(join(dest, 'issues'))).sort()).toEqual(['1.md'])
  })

  it('frontmatter records every merged PR ref (number + mergeCommit) so the markdown carries provenance', async () => {
    const router: MockRouter = {
      issues: [{ number: 7, title: 'multi-PR fix', created_at: 't', updated_at: 't' }],
      closingPRs: {
        7: [
          { number: 70, merged: true, mergeCommit: 'sha-70' },
          { number: 71, merged: false }, // not merged; should be excluded
          { number: 72, merged: true, mergeCommit: 'sha-72' },
        ],
      },
    }
    const loader = createGithubLoader({ fetchFn: buildMockFetch(router) })
    await loader.ingest({ owner: 'o', repo: 'r' }, dest, ctx)
    const content = await readFile(join(dest, 'issues', '7.md'), 'utf-8')
    const { fm } = splitMarkdown(content)
    expect((fm as unknown as { closedByMergedPRs: Array<{ number: number, mergeCommit: string }> }).closedByMergedPRs).toEqual([
      { number: 70, mergeCommit: 'sha-70' },
      { number: 72, mergeCommit: 'sha-72' },
    ])
  })

  it('reports `fetchedRaw` in the ingest metadata so dogfooders can see how many issues were filtered out', async () => {
    const router: MockRouter = {
      issues: [
        { number: 1, title: 'kept', created_at: 't', updated_at: 't' },
        { number: 2, title: 'filtered', created_at: 't', updated_at: 't' },
      ],
      closingPRs: {
        1: [{ number: 10, merged: true }],
        2: [],
      },
    }
    const loader = createGithubLoader({ fetchFn: buildMockFetch(router) })
    const report = await loader.ingest({ owner: 'o', repo: 'r' }, dest, ctx)
    expect(report.metadata).toMatchObject({ issueCount: 1, fetchedRaw: 2 })
  })

  it('appends sorted comments under ## Comments', async () => {
    const fetchFn = buildMockFetch({
      issues: [{
        number: 7,
        title: 'Discussion',
        body: 'Original.',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-03T00:00:00Z',
        comments: 2,
      }],
      comments: {
        7: [
          { user: { login: 'bob' }, body: 'second', created_at: '2026-01-03T00:00:00Z', updated_at: '2026-01-03T00:00:00Z' },
          { user: { login: 'alice' }, body: 'first', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
        ],
      },
    })

    const loader = createGithubLoader({ fetchFn })
    await loader.ingest({ owner: 'o', repo: 'r' }, dest, ctx)
    const content = await readFile(join(dest, 'issues', '7.md'), 'utf-8')
    expect(content).toContain('## Comments')
    const aliceIdx = content.indexOf('alice')
    const bobIdx = content.indexOf('bob')
    expect(aliceIdx).toBeGreaterThan(0)
    expect(bobIdx).toBeGreaterThan(aliceIdx)
  })

  it('follows the Link: rel="next" header for pagination', async () => {
    const issues = Array.from({ length: 3 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: `2026-01-0${i + 1}T00:00:00Z`,
    }))
    const fetchFn = buildMockFetch({ issues, pageSize: 1 })

    const loader = createGithubLoader({ fetchFn })
    await loader.ingest({ owner: 'o', repo: 'r' }, dest, ctx)
    expect((await readdir(join(dest, 'issues'))).sort()).toEqual(['1.md', '2.md', '3.md'])
  })

  it('sync with cursor only rewrites issues whose updated_at moved; untouched files stay byte-identical', async () => {
    const router: MockRouter = {
      issues: [
        { number: 1, title: 'One', body: 'one', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' },
        { number: 2, title: 'Two', body: 'two', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-02-02T00:00:00Z' },
      ],
    }
    const loader = createGithubLoader({ fetchFn: buildMockFetch(router) })
    await loader.ingest({ owner: 'o', repo: 'r' }, dest, ctx)

    const beforeStat1 = await stat(join(dest, 'issues', '1.md'))
    const beforeContent1 = await readFile(join(dest, 'issues', '1.md'), 'utf-8')

    // Bump issue 2 only; issue 1 stays as-is.
    const router2: MockRouter = {
      issues: [
        { number: 1, title: 'One', body: 'one', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' },
        { number: 2, title: 'Two (edited)', body: 'two edited', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
      ],
    }
    const loader2 = createGithubLoader({ fetchFn: buildMockFetch(router2) })
    const report = await loader2.sync!({ owner: 'o', repo: 'r' }, dest, ctx)

    expect(report.changed).toBe(true)
    expect(report.added).toBe(0)
    expect(report.updated).toBe(1)

    const afterStat1 = await stat(join(dest, 'issues', '1.md'))
    const afterContent1 = await readFile(join(dest, 'issues', '1.md'), 'utf-8')
    expect(afterContent1).toBe(beforeContent1)
    expect(afterStat1.mtimeMs).toBe(beforeStat1.mtimeMs)

    const content2 = await readFile(join(dest, 'issues', '2.md'), 'utf-8')
    expect(content2).toContain('Two (edited)')
  })

  // eslint-disable-next-line no-template-curly-in-string -- describing the literal `${VAR}` placeholder, NOT a template string
  it('sets Authorization header from ${GH_TOKEN} env interpolation; omits it when unset', async () => {
    const recorder = { calls: [] as string[], lastHeaders: null as Headers | null }
    const fetchFn = buildMockFetch({ issues: [] }, recorder)

    vi.stubEnv('GH_TOKEN', 'ghp-abc-123')
    const loader = createGithubLoader({ fetchFn })
    await loader.ingest({ owner: 'o', repo: 'r' }, dest, ctx)
    expect(recorder.lastHeaders?.get('Authorization')).toBe('Bearer ghp-abc-123')

    vi.unstubAllEnvs()
    const recorder2 = { calls: [] as string[], lastHeaders: null as Headers | null }
    const loader2 = createGithubLoader({ fetchFn: buildMockFetch({ issues: [] }, recorder2) })
    await loader2.ingest({ owner: 'o', repo: 'r' }, dest, ctx)
    expect(recorder2.lastHeaders?.get('Authorization')).toBeNull()
  })
})

describe('GithubLoader webhook capability', () => {
  const loader = createGithubLoader()

  it('reports repoIdentity from the loader config', () => {
    expect(loader.webhook?.repoIdentity({ owner: 'mroops0111', repo: 'braid' }))
      .toEqual({ provider: 'github', owner: 'mroops0111', repo: 'braid' })
  })

  it('dispatches issues, issue_comment, and ping events', () => {
    const config = { owner: 'o', repo: 'r' }
    expect(loader.webhook?.shouldDispatch?.(config, { event: 'issues', payload: {} })).toBe(true)
    expect(loader.webhook?.shouldDispatch?.(config, { event: 'issue_comment', payload: {} })).toBe(true)
    expect(loader.webhook?.shouldDispatch?.(config, { event: 'ping', payload: {} })).toBe(true)
  })

  it('skips events the loader does not consume so the receiver returns 202 without a wasted fetch', () => {
    const config = { owner: 'o', repo: 'r' }
    expect(loader.webhook?.shouldDispatch?.(config, { event: 'push', payload: { ref: 'refs/heads/master' } })).toBe(false)
    expect(loader.webhook?.shouldDispatch?.(config, { event: 'pull_request', payload: {} })).toBe(false)
  })
})
