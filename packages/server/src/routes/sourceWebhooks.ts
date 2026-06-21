import type {
  PluginRegistry,
  SourceLoaderPlugin,
  SourceLoaderRunner,
  WebhookCapability,
  WorkspaceService,
} from '@braidhq/core'
import type { SourceDescriptor, SourceId, WorkspaceId } from '@braidhq/schema'
import type { SecretStore } from '../infrastructure/secrets/SecretStore.js'
import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createLogger } from '@braidhq/core'
import { Hono } from 'hono'

/**
 * GitHub webhook plumbing for filesystem sources whose loader plugin
 * declares a `webhook` capability.
 *
 * Two routers:
 *
 *   `createGithubWebhookReceiver` is public (no Bearer auth). GitHub
 *   POSTs deliveries here; we verify the HMAC, confirm the payload
 *   names the same repo the source's loader plugin claims, ask the
 *   plugin whether the event is worth a `syncOne`, and dispatch in the
 *   background. The response returns immediately so GitHub's ~10s
 *   delivery timeout never trips on a slow loader.
 *
 *   `createSourceWebhooksAdminRouter` is workspace-scoped and gated by
 *   the existing auth middleware. Studio uses it to display the
 *   webhook URL and rotate the secret.
 *
 * The receiver is loader-agnostic: it does not switch on
 * `loader.kind`. New loaders extend the webhook surface by adding a
 * `webhook: { repoIdentity, shouldDispatch }` to their plugin
 * definition.
 *
 * Secrets live in the existing `SecretStore` under namespace
 * `webhook-github`, keyed by `<workspaceId>--<sourceId>` to mirror the
 * OAuth namespaces.
 */

const SECRET_NAMESPACE = 'webhook-github'
const PROVIDER = 'github' as const

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
  readonly pluginRegistry: PluginRegistry
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

/**
 * Look up the loader plugin's `webhook` capability for a source, or
 * return undefined when the source is not webhook-capable. Wraps the
 * registry lookup so route handlers can short-circuit on a single
 * truthy check.
 */
function resolveWebhookCapability(
  pluginRegistry: PluginRegistry,
  source: SourceDescriptor,
): { capability: WebhookCapability, plugin: SourceLoaderPlugin, config: unknown } | undefined {
  if (source.kind !== 'filesystem' || !source.loader)
    return undefined
  const plugin = pluginRegistry.findSourceLoader(source.loader.kind)
  if (!plugin?.webhook)
    return undefined
  return { capability: plugin.webhook, plugin, config: source.loader.config }
}

export function createGithubWebhookReceiver(deps: GithubWebhookReceiverDeps): Hono {
  const router = new Hono()

  // `:workspaceId/:sourceId` is the routing identity the user installs
  // on the GitHub side. We accept the request, verify, and return 202
  // immediately; sync runs in the background so a slow loader does not
  // block GitHub's delivery worker (it times deliveries out at ~10s).
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

    const resolved = resolveWebhookCapability(deps.pluginRegistry, source)
    if (!resolved)
      return context.json({ error: `source "${sourceId}" has no webhook-capable loader` }, 400)
    const identity = resolved.capability.repoIdentity(resolved.config)
    if (!identity || identity.provider !== PROVIDER)
      return context.json({ error: `source "${sourceId}" is not bound to a github repo` }, 400)

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
    const expectedFullName = `${identity.owner}/${identity.repo}`
    if (fullName && fullName !== expectedFullName)
      return context.json({ error: `payload repository "${fullName}" does not match configured "${expectedFullName}"` }, 400)

    const event = context.req.header('X-GitHub-Event') ?? 'unknown'
    const shouldDispatch = resolved.capability.shouldDispatch?.(resolved.config, { event, payload }) ?? true
    if (!shouldDispatch) {
      // Return 202 so GitHub does not treat the delivery as a failure
      // and back off retries; we deliberately accept and drop.
      return context.json({ accepted: true, event, workspaceId, sourceId, skipped: true }, 202)
    }

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

    return context.json({ accepted: true, event, workspaceId, sourceId }, 202)
  })

  return router
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
  readonly pluginRegistry: PluginRegistry
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
    const resolved = resolveWebhookCapability(deps.pluginRegistry, source)
    if (!resolved || resolved.capability.repoIdentity(resolved.config)?.provider !== PROVIDER)
      return context.json({ error: `source "${sourceId}" is not bound to a github repo` }, 400)
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
    const resolved = resolveWebhookCapability(deps.pluginRegistry, source)
    if (!resolved || resolved.capability.repoIdentity(resolved.config)?.provider !== PROVIDER)
      return context.json({ error: `source "${sourceId}" is not bound to a github repo` }, 400)

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
