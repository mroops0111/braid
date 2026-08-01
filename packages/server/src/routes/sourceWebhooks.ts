import type {
  PluginRegistry,
  SourceLoaderRunner,
  WebhookCapability,
  WorkspaceService,
} from '@braidhq/core'
import type { SecretStore } from '../infrastructure/secrets/SecretStore.js'
import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createLogger, NotFoundError, ServiceUnavailableError, UnauthorizedError, ValidationError } from '@braidhq/core'
import { type SourceDescriptor, SourceId, WorkspaceId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { Hono } from 'hono'
import { WorkspaceIdParam } from './_shared.js'

/**
 * GitHub webhook plumbing for filesystem sources,
 * whose loader plugin declares a `webhook` capability.
 *
 * Two routers.
 *
 *   `createGithubWebhookReceiver` is public (no Bearer auth).
 *   GitHub POSTs deliveries here.
 *   We verify the HMAC, confirm the payload names the claimed repo,
 *   ask the plugin whether the event is worth a `syncOne`,
 *   and dispatch in the background. The response returns immediately,
 *   so GitHub's ~10s delivery timeout never trips on a slow loader.
 *
 *   `createSourceWebhooksAdminRouter` is workspace-scoped,
 *   and gated by the existing auth middleware.
 *   Studio uses it to display the webhook URL and rotate the secret.
 *
 * The receiver is loader-agnostic and does not switch on `loader.kind`.
 * A new loader extends the webhook surface from its plugin definition,
 * via `webhook: { repoIdentity, shouldDispatch }`.
 *
 * Secrets live in the existing `SecretStore`,
 * under namespace `webhook-github`, keyed by `<workspaceId>--<sourceId>`.
 * That mirrors the OAuth namespaces (oauth-google, oauth-github),
 * which already use the same `--` separator.
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

// Verify GitHub's `X-Hub-Signature-256` header.
// GitHub computes `sha256=<hex>` over the raw body with the secret.
// We recompute and compare in constant time.
// The prefix check is case-insensitive,
// because some proxies and WAFs normalise headers.
function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header || !header.toLowerCase().startsWith('sha256='))
    return false
  // Normalise the hex digest to lowercase,
  // so the timing-safe compare still accepts an uppercased hex,
  // (rare but valid).
  const provided = `sha256=${header.slice('sha256='.length).toLowerCase()}`
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  if (a.length !== b.length)
    return false
  return timingSafeEqual(a, b)
}

// Look up the loader plugin's `webhook` capability for a source.
// Returns undefined when the source is not webhook-capable, never throws.
function resolveWebhookCapability(
  pluginRegistry: PluginRegistry,
  source: SourceDescriptor,
): { capability: WebhookCapability, config: unknown } | undefined {
  if (source.kind !== 'filesystem' || !source.loader)
    return undefined
  const plugin = pluginRegistry.findSourceLoader(source.loader.kind)
  if (!plugin?.webhook)
    return undefined
  return { capability: plugin.webhook, config: source.loader.config }
}

// Uniform anonymous response for any pre-signature failure,
// (missing workspace, source, webhook capability, secret, or HMAC).
// Distinct error bodies would leak which pairs exist,
// and which are webhook-armed, to an unauthenticated caller.
// That recon ladder we deliberately close off.
function unauthorized(): never {
  throw new UnauthorizedError('Invalid webhook signature.')
}

interface VerifiedDelivery {
  readonly workspace: Awaited<ReturnType<WorkspaceService['findById']>>
  readonly resolved: NonNullable<ReturnType<typeof resolveWebhookCapability>>
  readonly identity: NonNullable<ReturnType<WebhookCapability['repoIdentity']>>
  readonly rawBody: string
}

// Run the full pre-signature pipeline inside a single try/catch,
// (header presence, body read, workspace and source lookup,
// plugin webhook capability, repo identity, secret read, HMAC verify).
// Returns the trusted state on success and `undefined` on any failure.
// The caller collapses every failure mode to a 401.
async function verifyDelivery(
  deps: GithubWebhookReceiverDeps,
  context: { req: { header: (n: string) => string | undefined, text: () => Promise<string> } },
  workspaceId: WorkspaceId,
  sourceId: SourceId,
): Promise<VerifiedDelivery | undefined> {
  try {
    const signature = context.req.header('X-Hub-Signature-256')
    if (!signature)
      return undefined
    const rawBody = await context.req.text()
    const workspace = await deps.workspaceService.findById(workspaceId)
    const source = workspace.sources.find(s => s.id === sourceId)
    if (!source)
      return undefined
    const resolved = resolveWebhookCapability(deps.pluginRegistry, source)
    if (!resolved)
      return undefined
    const identity = resolved.capability.repoIdentity(resolved.config)
    if (!identity || identity.provider !== PROVIDER)
      return undefined
    const record = await deps.secretStore.read<WebhookSecretRecord>(SECRET_NAMESPACE, secretKey(workspaceId, sourceId))
    if (!record)
      return undefined
    if (!verifySignature(rawBody, signature, record.secret))
      return undefined
    return { workspace, resolved, identity, rawBody }
  }
  catch (err) {
    receiverLogger.warn({ workspaceId, sourceId, err: err instanceof Error ? err.message : String(err) }, 'webhook: pre-signature check failed')
    return undefined
  }
}

export function createGithubWebhookReceiver(deps: GithubWebhookReceiverDeps): Hono {
  const router = new Hono()

  // `:workspaceId/:sourceId` is the routing identity,
  // the user installs on the GitHub side.
  // We accept the request, verify, and return 202 immediately.
  // Sync runs in the background,
  // so a slow loader never blocks GitHub's delivery worker.
  // GitHub times deliveries out at ~10s.
  router.post('/github/:workspaceId/:sourceId', async (context) => {
    const workspaceId = WorkspaceId.parse(context.req.param('workspaceId'))
    const sourceId = SourceId.parse(context.req.param('sourceId'))
    // The verifyDelivery call returns either the trusted state or undefined,
    // (workspace, resolved capability, repository identity, raw body).
    // On undefined we always return a uniform 401,
    // so distinct errors never tell an anonymous caller apart,
    // "no such workspace", "no secret yet", and "bad signature".
    const verified = await verifyDelivery(deps, context, workspaceId, sourceId)
    if (!verified)
      return unauthorized()
    const { workspace, resolved, identity, rawBody } = verified

    // Parse the body only after the signature check,
    // so an attacker who can't forge the HMAC, never reaches our JSON parser.
    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    }
    catch {
      throw new ValidationError('Invalid JSON payload.')
    }

    const fullName = extractFullName(payload)
    const expectedFullName = `${identity.owner}/${identity.repo}`.toLowerCase()
    // GitHub repo names are case-insensitive,
    // (a stored `Owner/Repo` may arrive as `owner/repo`, or vice versa).
    // Compare normalised. Also REQUIRE full_name to be present.
    // A verified delivery without one is rejected,
    // since this receiver is per-source,
    // (some org-level or installation events omit it).
    if (typeof fullName !== 'string' || fullName.toLowerCase() !== expectedFullName)
      throw new ValidationError(`Payload repository "${fullName ?? '(missing)'}" does not match configured "${expectedFullName}".`)

    // X-GitHub-Event must be present on real deliveries.
    // Treating an absent header as "unknown",
    // would let a stripping proxy silently drop every event,
    // since loaders default to skipping unknown events.
    const event = context.req.header('X-GitHub-Event')
    if (!event)
      throw new ValidationError('Missing X-GitHub-Event header.')

    const shouldDispatch = resolved.capability.shouldDispatch?.(resolved.config, { event, payload }) ?? true
    if (!shouldDispatch) {
      // Return 202 so GitHub does not treat the delivery as a failure,
      // and back off retries, deliberately accepting and dropping.
      return context.json({ accepted: true, event, workspaceId, sourceId, skipped: true }, 202)
    }

    // Fire-and-forget. Deliveries time out at ~10s,
    // and a clean repo with many issues can take minutes to poll.
    // Errors are logged so a failing sync doesn't silently disappear,
    // the next delivery retries.
    // Concurrent deliveries are allowed to race, loaders are idempotent,
    // (last-writer-wins per file) so the result still converges,
    // to the latest remote state.
    void deps.sourceLoaderRunner.syncOne(workspace, sourceId).catch((err) => {
      receiverLogger.warn(
        {
          workspaceId,
          sourceId,
          err: err instanceof Error ? err.message : String(err),
        },
        'background syncOne triggered by github webhook failed',
      )
    })

    return context.json({ accepted: true, event, workspaceId, sourceId, skipped: false }, 202)
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
   * Base URL under which the public webhook receiver is reachable.
   * Required so the admin response can return an absolute URL,
   * that the user pastes straight into GitHub's webhook settings.
   * When unset (composeApp in tests), the admin endpoints return 503.
   * Better than returning a relative path Studio would render verbatim.
   */
  readonly apiUrl?: string
}

const adminLogger = createLogger('webhooks.github.admin')

const SourceIdParam = WorkspaceIdParam.extend({
  sourceId: SourceId.openapi({ param: { name: 'sourceId', in: 'path' } }),
})

const WebhookStatusResponse = z.object({
  url: z.string(),
  hasSecret: z.boolean(),
  createdAt: z.string().optional(),
}).openapi('GithubWebhookStatusResponse')

const WebhookRotateResponse = z.object({
  url: z.string(),
  secret: z.string(),
  createdAt: z.string(),
}).openapi('GithubWebhookRotateResponse')

const ErrorBody = z.object({ error: z.string() }).openapi('GithubWebhookErrorBody')

const getStatusRoute = createRoute({
  method: 'get',
  path: '/{sourceId}/github',
  operationId: 'getGithubWebhookStatus',
  summary: 'Read the GitHub webhook URL and whether a secret has been provisioned for a source.',
  tags: ['source-webhooks'],
  request: { params: SourceIdParam },
  responses: {
    200: {
      description: 'Webhook URL plus secret-presence flag (the secret itself is never returned on read).',
      content: { 'application/json': { schema: WebhookStatusResponse } },
    },
    400: { description: 'Source is not webhook-capable.', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Source not found.', content: { 'application/json': { schema: ErrorBody } } },
    503: { description: 'Server was not configured with apiUrl.', content: { 'application/json': { schema: ErrorBody } } },
  },
})

const rotateRoute = createRoute({
  method: 'post',
  path: '/{sourceId}/github/rotate',
  operationId: 'rotateGithubWebhookSecret',
  summary: 'Generate a fresh 32-byte hex secret for the GitHub webhook, returning it ONCE.',
  description: 'The secret is shown exactly once in the rotate response so the user can copy it into GitHub. Subsequent GET requests return only `hasSecret` + `createdAt`.',
  tags: ['source-webhooks'],
  request: { params: SourceIdParam },
  responses: {
    200: {
      description: 'New secret minted and stored.',
      content: { 'application/json': { schema: WebhookRotateResponse } },
    },
    400: { description: 'Source is not webhook-capable.', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Source not found.', content: { 'application/json': { schema: ErrorBody } } },
    503: { description: 'Server was not configured with apiUrl.', content: { 'application/json': { schema: ErrorBody } } },
  },
})

export function createSourceWebhooksAdminRouter(deps: SourceWebhooksAdminDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(getStatusRoute, async (context) => {
    const { workspaceId, sourceId } = context.req.valid('param')
    if (!deps.apiUrl)
      throw new ServiceUnavailableError('Server is not configured with a public apiUrl. Webhook URLs cannot be rendered.')
    await guardWebhookSource(deps, workspaceId, sourceId)
    const record = await deps.secretStore.read<WebhookSecretRecord>(SECRET_NAMESPACE, secretKey(workspaceId, sourceId))
    return context.json({
      url: buildWebhookUrl(deps.apiUrl, workspaceId, sourceId),
      hasSecret: record !== undefined,
      ...(record?.createdAt ? { createdAt: record.createdAt } : {}),
    }, 200)
  })

  router.openapi(rotateRoute, async (context) => {
    const { workspaceId, sourceId } = context.req.valid('param')
    if (!deps.apiUrl)
      throw new ServiceUnavailableError('Server is not configured with a public apiUrl. Webhook URLs cannot be rendered.')
    await guardWebhookSource(deps, workspaceId, sourceId)

    // 32 bytes is the GitHub-recommended minimum,
    // matching what their own webhook setup UI generates.
    const secret = randomBytes(32).toString('hex')
    const createdAt = new Date().toISOString()
    const record: WebhookSecretRecord = { secret, createdAt }
    await deps.secretStore.write(SECRET_NAMESPACE, secretKey(workspaceId, sourceId), record)
    return context.json({
      url: buildWebhookUrl(deps.apiUrl, workspaceId, sourceId),
      secret,
      createdAt,
    }, 200)
  })

  return router
}

// Shared admin precondition check.
// Returns undefined when the source is a webhook-capable github source,
// otherwise returns the 4xx the caller should surface.
// We never throw. On schema drift defineSourceLoaderPlugin's wrapper,
// may throw ZodError, which we catch and translate to 400.
async function guardWebhookSource(
  deps: SourceWebhooksAdminDeps,
  workspaceId: WorkspaceId,
  sourceId: SourceId,
): Promise<void> {
  const workspace = await deps.workspaceService.findById(workspaceId)
  const source = workspace.sources.find(s => s.id === sourceId)
  if (!source)
    throw new NotFoundError(`Source "${sourceId}" not found`)
  const resolved = resolveWebhookCapability(deps.pluginRegistry, source)
  if (!resolved)
    throw new ValidationError(`Source "${sourceId}" has no webhook-capable loader.`)
  try {
    const identity = resolved.capability.repoIdentity(resolved.config)
    if (!identity || identity.provider !== PROVIDER)
      throw new ValidationError(`Source "${sourceId}" is not bound to a github repo.`)
  }
  catch (err) {
    if (err instanceof ValidationError)
      throw err
    adminLogger.warn({ workspaceId, sourceId, err: err instanceof Error ? err.message : String(err) }, 'admin: repoIdentity threw')
    throw new ValidationError(`Source "${sourceId}" loader config does not match the loader's schema.`)
  }
}

function buildWebhookUrl(apiUrl: string, workspaceId: WorkspaceId, sourceId: SourceId): string {
  const base = apiUrl.replace(/\/$/, '')
  return `${base}/webhooks/github/${workspaceId}/${sourceId}`
}
