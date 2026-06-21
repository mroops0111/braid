import type {
  SourceLoaderRunner,
  WorkspaceService,
} from '@braidhq/core'
import type { SourceDescriptor, SourceId, WorkspaceId } from '@braidhq/schema'
import type { SecretStore } from '../infrastructure/secrets/SecretStore.js'
import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createLogger } from '@braidhq/core'
import { Hono } from 'hono'

/**
 * GitHub webhook plumbing for `kind: 'github'` sources.
 *
 * Two routers:
 *
 *   `createGithubWebhookReceiver` is public (no Bearer auth). GitHub
 *   POSTs `push` / `issues` / `issue_comment` deliveries here; we
 *   verify the HMAC, confirm the payload names the configured repo,
 *   and trigger `sourceLoaderRunner.syncOne` in the background. The
 *   response returns immediately so GitHub's delivery timeout never
 *   trips on a slow sync.
 *
 *   `createSourceWebhooksAdminRouter` is workspace-scoped and gated
 *   by the existing auth middleware. Studio uses it to display the
 *   webhook URL and rotate the secret when the user installs / re-
 *   installs the webhook on the GitHub side.
 *
 * Secrets live in the existing `SecretStore` under namespace
 * `webhook-github`, keyed by `<workspaceId>--<sourceId>` to mirror
 * the OAuth namespaces.
 */

const SECRET_NAMESPACE = 'webhook-github'

interface WebhookSecretRecord {
  readonly secret: string
  readonly createdAt: string
}

function secretKey(workspaceId: WorkspaceId, sourceId: SourceId): string {
  return `${workspaceId}--${sourceId}`
}

export interface GithubWebhookReceiverDeps {
  readonly workspaceService: WorkspaceService
  readonly sourceLoaderRunner: SourceLoaderRunner
  readonly secretStore: SecretStore
}

const receiverLogger = createLogger('webhooks.github.receiver')

/**
 * Verify GitHub's `X-Hub-Signature-256` header. GitHub computes
 * `sha256=<hex>` over the raw request body using the webhook secret;
 * we recompute and compare in constant time.
 */
function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header || !header.startsWith('sha256='))
    return false
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  if (a.length !== b.length)
    return false
  return timingSafeEqual(a, b)
}

export function createGithubWebhookReceiver(deps: GithubWebhookReceiverDeps): Hono {
  const router = new Hono()

  // `:workspaceId/:sourceId` is the routing identity the user installs
  // on the GitHub side. We accept the request, verify, and return 202
  // immediately; sync runs in the background so a slow loader run does
  // not block GitHub's delivery worker (it times deliveries out at ~10s).
  router.post('/github/:workspaceId/:sourceId', async (context) => {
    const workspaceId = context.req.param('workspaceId') as WorkspaceId
    const sourceId = context.req.param('sourceId') as SourceId
    const rawBody = await context.req.text()

    let workspace
    try {
      workspace = await deps.workspaceService.findById(workspaceId)
    }
    catch {
      return context.json({ error: 'workspace not found' }, 404)
    }

    const source = workspace.sources.find(s => s.id === sourceId)
    if (!source)
      return context.json({ error: `source "${sourceId}" not found in workspace` }, 404)
    const githubConfig = extractGithubConfig(source)
    if (!githubConfig)
      return context.json({ error: `source "${sourceId}" is not a github-loader source` }, 400)

    const record = await deps.secretStore.read<WebhookSecretRecord>(SECRET_NAMESPACE, secretKey(workspaceId, sourceId))
    if (!record)
      return context.json({ error: 'webhook secret not configured for this source; rotate one via the Studio settings panel' }, 404)

    const signature = context.req.header('X-Hub-Signature-256')
    if (!verifySignature(rawBody, signature, record.secret))
      return context.json({ error: 'invalid signature' }, 401)

    // Parse the body after the signature check so an attacker who can't
    // forge the HMAC never reaches our JSON parser.
    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    }
    catch {
      return context.json({ error: 'invalid json payload' }, 400)
    }

    const fullName = extractFullName(payload)
    const expectedFullName = `${githubConfig.owner}/${githubConfig.repo}`
    if (fullName && fullName !== expectedFullName)
      return context.json({ error: `payload repository "${fullName}" does not match configured "${expectedFullName}"` }, 400)

    // Fire-and-forget. We must NOT await the sync; deliveries time out
    // at ~10s and a clean repo with many issues can take minutes to
    // poll. Errors are logged so a failing sync doesn't silently
    // disappear; the next delivery retries.
    void deps.sourceLoaderRunner.syncOne(workspace, sourceId)
      .catch((err) => {
        receiverLogger.warn(
          {
            workspaceId,
            sourceId,
            err: err instanceof Error ? err.message : String(err),
          },
          'background syncOne triggered by github webhook failed',
        )
      })

    const event = context.req.header('X-GitHub-Event') ?? 'unknown'
    return context.json({ accepted: true, event, workspaceId, sourceId }, 202)
  })

  return router
}

/**
 * Resolve the GitHub `owner/repo` pair a source is tied to. Two loaders
 * surface a github webhook today: the dedicated `github` issues loader
 * (which stores `owner` / `repo` directly), and the generic `git` loader
 * pointed at a `github.com` URL (parsed). Any other shape returns
 * undefined and the webhook routes refuse to serve.
 */
function extractGithubConfig(source: SourceDescriptor): { owner: string, repo: string } | undefined {
  if (source.kind !== 'filesystem' || !source.loader)
    return undefined
  const config = source.loader.config
  if (typeof config !== 'object' || config === null)
    return undefined
  if (source.loader.kind === 'github') {
    const { owner, repo } = config as { owner?: unknown, repo?: unknown }
    if (typeof owner !== 'string' || typeof repo !== 'string' || !owner || !repo)
      return undefined
    return { owner, repo }
  }
  if (source.loader.kind === 'git') {
    const { url } = config as { url?: unknown }
    if (typeof url !== 'string')
      return undefined
    return parseGithubUrl(url)
  }
  return undefined
}

/**
 * Pull `owner/repo` out of a GitHub clone URL. Accepts the three shapes
 * the git loader supports: `https://github.com/o/r.git`,
 * `git@github.com:o/r.git`, and credential-prefixed
 * `https://x-access-token:T@github.com/o/r.git`. Non-github hosts (e.g.
 * `gitlab.com`) return undefined so we don't pretend to validate them.
 */
function parseGithubUrl(url: string): { owner: string, repo: string } | undefined {
  const trimmed = url.trim().replace(/\.git$/, '')
  const httpsMatch = trimmed.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+)$/)
  if (httpsMatch)
    return { owner: httpsMatch[1]!, repo: httpsMatch[2]! }
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+)$/)
  if (sshMatch)
    return { owner: sshMatch[1]!, repo: sshMatch[2]! }
  return undefined
}

function extractFullName(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null)
    return undefined
  const repository = (payload as { repository?: unknown }).repository
  if (typeof repository !== 'object' || repository === null)
    return undefined
  const fullName = (repository as { full_name?: unknown }).full_name
  return typeof fullName === 'string' ? fullName : undefined
}

export interface SourceWebhooksAdminDeps {
  readonly workspaceService: WorkspaceService
  readonly secretStore: SecretStore
  /**
   * Base URL under which the public webhook receiver is reachable. Used
   * to render the URL the user pastes into GitHub. Falls back to an
   * empty string when unset, in which case Studio computes the URL from
   * its current API base.
   */
  readonly apiUrl?: string
}

export function createSourceWebhooksAdminRouter(deps: SourceWebhooksAdminDeps): Hono {
  const router = new Hono()

  // GET status: webhook URL + whether a secret exists. We never return
  // the secret itself on a read — it's surfaced ONCE on rotate so the
  // user can copy it into GitHub immediately; future reads only see
  // `hasSecret` and the createdAt timestamp.
  router.get('/:sourceId/github', async (context) => {
    const workspaceId = context.req.param('workspaceId') as WorkspaceId
    const sourceId = context.req.param('sourceId') as SourceId
    const workspace = await deps.workspaceService.findById(workspaceId)
    const source = workspace.sources.find(s => s.id === sourceId)
    if (!source)
      return context.json({ error: `source "${sourceId}" not found` }, 404)
    if (!extractGithubConfig(source))
      return context.json({ error: `source "${sourceId}" is not a github-loader source` }, 400)
    const record = await deps.secretStore.read<WebhookSecretRecord>(SECRET_NAMESPACE, secretKey(workspaceId, sourceId))
    return context.json({
      url: buildWebhookUrl(deps.apiUrl, workspaceId, sourceId),
      hasSecret: record !== undefined,
      createdAt: record?.createdAt,
    })
  })

  router.post('/:sourceId/github/rotate', async (context) => {
    const workspaceId = context.req.param('workspaceId') as WorkspaceId
    const sourceId = context.req.param('sourceId') as SourceId
    const workspace = await deps.workspaceService.findById(workspaceId)
    const source = workspace.sources.find(s => s.id === sourceId)
    if (!source)
      return context.json({ error: `source "${sourceId}" not found` }, 404)
    if (!extractGithubConfig(source))
      return context.json({ error: `source "${sourceId}" is not a github-loader source` }, 400)

    // 32 bytes is the GitHub-recommended minimum and matches what their
    // own webhook setup UI generates.
    const secret = randomBytes(32).toString('hex')
    const createdAt = new Date().toISOString()
    const record: WebhookSecretRecord = { secret, createdAt }
    await deps.secretStore.write(SECRET_NAMESPACE, secretKey(workspaceId, sourceId), record)
    return context.json({
      url: buildWebhookUrl(deps.apiUrl, workspaceId, sourceId),
      secret,
      createdAt,
    })
  })

  return router
}

function buildWebhookUrl(apiUrl: string | undefined, workspaceId: WorkspaceId, sourceId: SourceId): string {
  const base = apiUrl?.replace(/\/$/, '') ?? ''
  return `${base}/webhooks/github/${workspaceId}/${sourceId}`
}
