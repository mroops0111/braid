import type { SourceLoaderPlugin } from '@braidhq/core'
import type { Timestamp } from '@braidhq/schema'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { defineSourceLoader } from '@braidhq/sdk'
import { stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'

/**
 * Inject `fetchFn` for tests; real callers use globalThis.fetch.
 */
export type FetchFn = typeof globalThis.fetch

export const GithubLoaderConfig = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  state: z.enum(['open', 'closed', 'all']).default('all'),
  labels: z.array(z.string().min(1)).optional(),
  includeComments: z.boolean().default(true),
  /**
   * GitHub's REST treats PRs as a subtype of issues. Default `false` so a
   * source declared as "issues" doesn't silently pick up PR threads too.
   */
  includePullRequests: z.boolean().default(false),
  /**
   * Auth token. Supports `${VAR}` interpolation against the server's process
   * env. Defaults to `${GH_TOKEN}`. An empty string after interpolation
   * means anonymous (60 req/h rate limit, public repos only).
   */
  // eslint-disable-next-line no-template-curly-in-string -- literal `${VAR}` placeholder for env interpolation, NOT a template string
  token: z.string().default('${GH_TOKEN}'),
  /** REST base URL. Override for GitHub Enterprise. */
  apiBaseUrl: z.string().default('https://api.github.com'),
})
export type GithubLoaderConfig = z.infer<typeof GithubLoaderConfig>

export interface GithubLoaderDeps {
  /** Inject for tests. Real callers use globalThis.fetch. */
  fetchFn?: FetchFn
}

interface RawIssue {
  number: number
  title: string
  state: string
  user: { login: string } | null
  labels: Array<{ name: string } | string>
  body: string | null
  html_url: string
  created_at: string
  updated_at: string
  pull_request?: unknown
  comments: number
}

interface RawComment {
  user: { login: string } | null
  body: string | null
  created_at: string
  updated_at: string
}

interface CursorFile {
  owner: string
  repo: string
  since: string
}

const CURSOR_FILENAME = '.braid-github-cursor.json'

/**
 * Build a SourceLoader for a GitHub repository's Issues. The `destination`
 * is owned by the loader: each issue is written as
 * `<destination>/issues/<number>.md` with a deterministic YAML frontmatter
 * + body + `## Comments` section. Untouched issues stay byte-identical
 * across `sync` so downstream sha-based fingerprints don't churn.
 *
 * Auth: pass the token via `${GH_TOKEN}` (or any other env var) in
 * `config.token`. Tokens are never persisted on disk; only the rendered
 * markdown lands in `destination`.
 */
export function createGithubLoader(deps: GithubLoaderDeps = {}): SourceLoaderPlugin {
  const fetchFn: FetchFn = deps.fetchFn ?? globalThis.fetch

  return defineSourceLoader({
    kind: 'github',
    configSchema: GithubLoaderConfig,
    ingest: async (config, destination) => {
      const issuesDir = join(destination, 'issues')
      await mkdir(issuesDir, { recursive: true })
      const headers = buildHeaders(config)
      const issues = await fetchIssues(fetchFn, config, headers, undefined)
      let mostRecent = ''
      for (const issue of issues) {
        if (issue.updated_at > mostRecent)
          mostRecent = issue.updated_at
        const comments = await fetchCommentsIfNeeded(fetchFn, config, headers, issue)
        const markdown = renderIssueMarkdown(config, issue, comments)
        const path = join(issuesDir, `${issue.number}.md`)
        await writeIfChanged(path, markdown)
      }
      if (mostRecent)
        await writeCursor(destination, { owner: config.owner, repo: config.repo, since: mostRecent })
      return {
        localPath: destination,
        metadata: { owner: config.owner, repo: config.repo, issueCount: issues.length },
        fetchedAt: new Date().toISOString() as Timestamp,
      }
    },
    sync: async (config, destination) => {
      const issuesDir = join(destination, 'issues')
      await mkdir(issuesDir, { recursive: true })
      const headers = buildHeaders(config)
      const cursor = await readCursor(destination)
      const sinceParam = cursor?.owner === config.owner && cursor.repo === config.repo
        ? cursor.since
        : undefined
      const issues = await fetchIssues(fetchFn, config, headers, sinceParam)
      let added = 0
      let updated = 0
      let mostRecent = cursor?.since ?? ''
      for (const issue of issues) {
        if (issue.updated_at > mostRecent)
          mostRecent = issue.updated_at
        const comments = await fetchCommentsIfNeeded(fetchFn, config, headers, issue)
        const markdown = renderIssueMarkdown(config, issue, comments)
        const path = join(issuesDir, `${issue.number}.md`)
        const result = await writeIfChanged(path, markdown)
        if (result === 'added')
          added++
        else if (result === 'updated')
          updated++
      }
      if (mostRecent)
        await writeCursor(destination, { owner: config.owner, repo: config.repo, since: mostRecent })
      return {
        changed: added + updated > 0,
        added,
        updated,
        removed: 0,
        metadata: { owner: config.owner, repo: config.repo, since: sinceParam ?? null },
        fetchedAt: new Date().toISOString() as Timestamp,
      }
    },
    webhook: {
      repoIdentity: config => ({ provider: 'github', owner: config.owner, repo: config.repo }),
      // This loader pulls issues + (optionally) comments. Push and other
      // code-side events do not change what we'd re-fetch; accept but
      // skip so the receiver returns 202 (preserving GitHub's retry
      // posture) without spending an API call.
      shouldDispatch: (_config, delivery) =>
        delivery.event === 'issues'
        || delivery.event === 'issue_comment'
        || delivery.event === 'ping',
    },
  })
}

function buildHeaders(config: GithubLoaderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'braid-source-loader-github',
  }
  const token = interpolateEnv(config.token).trim()
  if (token.length > 0)
    headers.Authorization = `Bearer ${token}`
  return headers
}

async function fetchIssues(
  fetchFn: FetchFn,
  config: GithubLoaderConfig,
  headers: Record<string, string>,
  since: string | undefined,
): Promise<RawIssue[]> {
  const params = new URLSearchParams()
  params.set('state', config.state)
  params.set('per_page', '100')
  params.set('sort', 'updated')
  params.set('direction', 'asc')
  if (config.labels && config.labels.length > 0)
    params.set('labels', config.labels.join(','))
  if (since)
    params.set('since', since)
  let url = `${config.apiBaseUrl}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues?${params.toString()}`
  const out: RawIssue[] = []
  while (url) {
    const response = await fetchFn(url, { headers })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`githubLoader: GET ${url} failed (${response.status}): ${body.slice(0, 200)}`)
    }
    const page = (await response.json()) as RawIssue[]
    for (const issue of page) {
      if (!config.includePullRequests && issue.pull_request !== undefined)
        continue
      out.push(issue)
    }
    url = parseNextLink(response.headers.get('link')) ?? ''
  }
  return out
}

async function fetchCommentsIfNeeded(
  fetchFn: FetchFn,
  config: GithubLoaderConfig,
  headers: Record<string, string>,
  issue: RawIssue,
): Promise<RawComment[]> {
  if (!config.includeComments || issue.comments === 0)
    return []
  const params = new URLSearchParams()
  params.set('per_page', '100')
  let url = `${config.apiBaseUrl}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues/${issue.number}/comments?${params.toString()}`
  const out: RawComment[] = []
  while (url) {
    const response = await fetchFn(url, { headers })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`githubLoader: GET ${url} failed (${response.status}): ${body.slice(0, 200)}`)
    }
    const page = (await response.json()) as RawComment[]
    out.push(...page)
    url = parseNextLink(response.headers.get('link')) ?? ''
  }
  out.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return out
}

function renderIssueMarkdown(
  config: GithubLoaderConfig,
  issue: RawIssue,
  comments: readonly RawComment[],
): string {
  const labels = (issue.labels ?? [])
    .map(l => typeof l === 'string' ? l : l.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .sort()
  const frontmatter = {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.user?.login ?? null,
    labels,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    url: issue.html_url,
  }
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()
  const body = (issue.body ?? '').trimEnd()
  const parts = [`---\n${yaml}\n---`, '', body]
  if (config.includeComments && comments.length > 0) {
    parts.push('', '## Comments')
    for (const comment of comments) {
      const author = comment.user?.login ?? 'unknown'
      parts.push('', `### ${author} — ${comment.created_at}`, '', (comment.body ?? '').trimEnd())
    }
  }
  return `${parts.join('\n').trimEnd()}\n`
}

async function writeIfChanged(path: string, content: string): Promise<'added' | 'updated' | 'unchanged'> {
  let existing: string | undefined
  try {
    existing = await readFile(path, 'utf-8')
  }
  catch {
    existing = undefined
  }
  if (existing === content)
    return 'unchanged'
  await writeFile(path, content, 'utf-8')
  return existing === undefined ? 'added' : 'updated'
}

async function readCursor(destination: string): Promise<CursorFile | undefined> {
  try {
    const raw = await readFile(join(destination, CURSOR_FILENAME), 'utf-8')
    return JSON.parse(raw) as CursorFile
  }
  catch {
    return undefined
  }
}

async function writeCursor(destination: string, cursor: CursorFile): Promise<void> {
  await writeFile(
    join(destination, CURSOR_FILENAME),
    `${JSON.stringify(cursor, null, 2)}\n`,
    'utf-8',
  )
}

function parseNextLink(header: string | null): string | undefined {
  if (!header)
    return undefined
  for (const part of header.split(',')) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="next"$/)
    if (match)
      return match[1]
  }
  return undefined
}

function interpolateEnv(input: string): string {
  return input.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name: string) => process.env[name] ?? '')
}
