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
   * Deprecated. Originally controlled whether PR-shaped entries leaked
   * into the issue list. Now hard-wired to `false`: the loader's
   * "realized intent" semantics (see below) treat PRs themselves as
   * the code-side artefact, not as intent. Setting this to `true` is
   * silently ignored after a one-time warn so existing configs do not
   * break — drop the field at your next config edit.
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
  /** GraphQL endpoint. Defaults to `${apiBaseUrl}/graphql`. */
  graphqlUrl: z.string().optional(),
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
 * **Realized-intent filter (always on)**: only issues that have at least
 * one merged pull request in their `closedByPullRequestsReferences`
 * association are written to disk. This implements Braid's stated
 * "intent + code convergence" contract — pure speculative intent (open
 * issues with no PR yet, abandoned issues, docs-only closes) does not
 * pollute the ledger, and the same workspace re-ingest is idempotent.
 * The check uses GitHub's GraphQL API; setups behind an enterprise
 * proxy that only exposes REST can override `graphqlUrl`.
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
      warnDeprecated(config)
      const headers = buildHeaders(config)
      const rawIssues = await fetchIssues(fetchFn, config, headers, undefined)
      const issues = await filterAndAnnotateRealizedIntent(fetchFn, config, headers, rawIssues)
      // Cursor advances over every raw issue we examined, not just
      // survivors of the realized-intent filter — see same comment in `sync`.
      let mostRecent = ''
      for (const raw of rawIssues) {
        if (raw.updated_at > mostRecent)
          mostRecent = raw.updated_at
      }
      for (const { issue, mergedPRs } of issues) {
        const comments = await fetchCommentsIfNeeded(fetchFn, config, headers, issue)
        const markdown = renderIssueMarkdown(config, issue, comments, mergedPRs)
        const path = join(issuesDir, `${issue.number}.md`)
        await writeIfChanged(path, markdown)
      }
      if (mostRecent)
        await writeCursor(destination, { owner: config.owner, repo: config.repo, since: mostRecent })
      return {
        localPath: destination,
        metadata: {
          owner: config.owner,
          repo: config.repo,
          issueCount: issues.length,
          fetchedRaw: rawIssues.length,
        },
        fetchedAt: new Date().toISOString() as Timestamp,
      }
    },
    sync: async (config, destination) => {
      const issuesDir = join(destination, 'issues')
      await mkdir(issuesDir, { recursive: true })
      warnDeprecated(config)
      const headers = buildHeaders(config)
      const cursor = await readCursor(destination)
      const sinceParam = cursor?.owner === config.owner && cursor.repo === config.repo
        ? cursor.since
        : undefined
      const rawIssues = await fetchIssues(fetchFn, config, headers, sinceParam)
      const issues = await filterAndAnnotateRealizedIntent(fetchFn, config, headers, rawIssues)
      let added = 0
      let updated = 0
      // Advance the cursor across every raw issue we examined this sync,
      // not just survivors. Otherwise an issue that's filtered out (no
      // merged PR yet) keeps appearing in every subsequent `since=` query
      // and re-burns one GraphQL probe per sync until it eventually
      // merges, which on a chatty repo can starve the rate budget.
      let mostRecent = cursor?.since ?? ''
      for (const raw of rawIssues) {
        if (raw.updated_at > mostRecent)
          mostRecent = raw.updated_at
      }
      for (const { issue, mergedPRs } of issues) {
        const comments = await fetchCommentsIfNeeded(fetchFn, config, headers, issue)
        const markdown = renderIssueMarkdown(config, issue, comments, mergedPRs)
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
        metadata: {
          owner: config.owner,
          repo: config.repo,
          since: sinceParam ?? null,
          fetchedRaw: rawIssues.length,
        },
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
      // PR-shaped entries are the code-side artefact (their merged
      // state is what gates issue inclusion in the realized-intent
      // filter); they never become intent units themselves.
      if (issue.pull_request !== undefined)
        continue
      out.push(issue)
    }
    url = parseNextLink(response.headers.get('link')) ?? ''
  }
  return out
}

/**
 * Per-issue snapshot of merged PRs that closed it. Empty list means the
 * issue is filtered out by the realized-intent gate; a non-empty list
 * means the issue both passes the gate AND carries provenance bundles
 * the markdown frontmatter ships to readers.
 */
interface MergedPRRef {
  readonly number: number
  readonly mergeCommit: string | null
}

interface RealizedIntentIssue {
  readonly issue: RawIssue
  readonly mergedPRs: readonly MergedPRRef[]
}

/**
 * Apply the "realized intent" filter: keep only issues that have at
 * least one merged PR in their `closedByPullRequestsReferences`
 * association, and annotate each surviving issue with the merged-PR
 * refs so the markdown frontmatter can carry the provenance.
 *
 * Implementation note: GitHub REST does not expose closed-by-PR
 * directly (only `commit_id` on closed events, which is set for
 * PR merges but also for plain `git commit --close ...` references).
 * GraphQL's `closedByPullRequestsReferences` is the canonical source.
 * One round-trip per issue keeps the code simple; batching with
 * aliased subqueries is a future optimisation if rate limits bite.
 */
async function filterAndAnnotateRealizedIntent(
  fetchFn: FetchFn,
  config: GithubLoaderConfig,
  headers: Record<string, string>,
  issues: readonly RawIssue[],
): Promise<readonly RealizedIntentIssue[]> {
  const out: RealizedIntentIssue[] = []
  for (const issue of issues) {
    // PRs (which REST returns alongside issues) are the code-side
    // artefact, not the intent. Always skip them irrespective of the
    // deprecated `includePullRequests` knob.
    if (issue.pull_request !== undefined)
      continue
    const mergedPRs = await fetchMergedPRsClosingIssue(fetchFn, config, headers, issue.number)
    if (mergedPRs.length === 0)
      continue
    out.push({ issue, mergedPRs })
  }
  return out
}

interface ClosingPRNode {
  number: number
  merged: boolean
  mergeCommit: { oid: string } | null
}

interface ClosedByQueryResponse {
  data?: {
    repository?: {
      issue?: {
        closedByPullRequestsReferences?: { nodes: ClosingPRNode[] }
      }
    }
  }
  errors?: Array<{ message: string }>
}

async function fetchMergedPRsClosingIssue(
  fetchFn: FetchFn,
  config: GithubLoaderConfig,
  headers: Record<string, string>,
  issueNumber: number,
): Promise<readonly MergedPRRef[]> {
  const query = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      closedByPullRequestsReferences(first: 50, includeClosedPrs: true) {
        nodes {
          number
          merged
          mergeCommit { oid }
        }
      }
    }
  }
}`
  const url = config.graphqlUrl ?? `${config.apiBaseUrl}/graphql`
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { owner: config.owner, repo: config.repo, number: issueNumber },
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (response.status === 401) {
      throw new Error(
        // GitHub's GraphQL endpoint rejects anonymous requests — the
        // realized-intent filter needs `GH_TOKEN` (or any other env var
        // referenced via ${VAR} in config.token). The REST issue list
        // works anonymously, so this only bites when the loader reaches
        // the merged-PR check; surface it actionably.
        `githubLoader: realized-intent filter requires an authenticated token (set GH_TOKEN or override config.token). GitHub GraphQL returned 401 for issue ${issueNumber}.`,
      )
    }
    throw new Error(`githubLoader: GraphQL POST failed (${response.status}) for issue ${issueNumber}: ${body.slice(0, 200)}`)
  }
  const payload = await response.json() as ClosedByQueryResponse
  if (payload.errors && payload.errors.length > 0)
    throw new Error(`githubLoader: GraphQL errors for issue ${issueNumber}: ${payload.errors.map(e => e.message).join('; ')}`)
  const nodes = payload.data?.repository?.issue?.closedByPullRequestsReferences?.nodes ?? []
  return nodes
    .filter(n => n.merged === true)
    .map(n => ({ number: n.number, mergeCommit: n.mergeCommit?.oid ?? null }))
}

let warnedDeprecatedIncludePullRequests = false
function warnDeprecated(config: GithubLoaderConfig): void {
  if (config.includePullRequests && !warnedDeprecatedIncludePullRequests) {
    warnedDeprecatedIncludePullRequests = true

    console.warn(
      'githubLoader: `includePullRequests` is deprecated and now always treated as false. '
      + 'The realized-intent filter excludes PR-shaped entries; remove the flag from PRODUCT.md.',
    )
  }
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
  mergedPRs: readonly MergedPRRef[],
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
    // The merged PRs that ship the work this issue tracks. Drives the
    // "realized intent" semantics: an issue only lands here when at
    // least one entry exists.
    closedByMergedPRs: mergedPRs.map(p => ({ number: p.number, mergeCommit: p.mergeCommit })),
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
