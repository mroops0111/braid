import type { WorkspaceService } from '@braidhq/core'
import type { Hono as HonoType } from 'hono'
import type { SecretStore } from '../infrastructure/secrets/SecretStore.js'
import { WorkspaceId } from '@braidhq/schema'
import { Hono } from 'hono'
import { requirePermission } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'

// OAuth namespaces a source credential can live under,
// keyed by `${workspaceId}--${sourceId}`. A source uses at most one.
const OAUTH_NAMESPACES = ['oauth-google', 'oauth-github'] as const
// Loader kinds whose sources authenticate over OAuth.
const OAUTH_LOADER_KINDS = new Set(['gdrive', 'github'])

interface StoredCredential {
  readonly connectedBy?: { userId: string, displayName: string }
  readonly connectedAt?: string
  readonly needsAuth?: boolean
}

export interface SourceConnectionStatus {
  readonly connected: boolean
  // A stored credential exists but a refresh has failed,
  // so the source needs a reconnect.
  // Distinct from `connected: false`, which is never linked.
  readonly needsAuth: boolean
  readonly connectedBy?: { userId: string, displayName: string }
  readonly connectedAt?: string
}

export type SourceConnectionSummary = SourceConnectionStatus & { readonly sourceId: string, readonly name: string, readonly kind: string }

export interface SourceConnectionRouterDeps {
  readonly secretStore: SecretStore
  readonly workspaceService: WorkspaceService
}

/**
 * Reports whether a source has a live OAuth connection, who linked it,
 * and whether its token has gone stale.
 * Read-only, so any workspace member can see the status,
 * the reconnect action stays owner-gated on the start route.
 * The collection route lets a banner flag a stale source without opening it.
 */
export function createSourceConnectionRouter(deps: SourceConnectionRouterDeps): HonoType {
  const router = new Hono()

  router.get('/', requirePermission('workspace.read'), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const workspace = await deps.workspaceService.findById(WorkspaceId.parse(workspaceId))
    const connections: SourceConnectionSummary[] = []
    for (const source of workspace.productManifest.sources) {
      if (source.kind !== 'filesystem' || !source.loader || !OAUTH_LOADER_KINDS.has(source.loader.kind))
        continue
      connections.push({ sourceId: source.id, name: source.name, kind: source.loader.kind, ...await readStatus(deps.secretStore, workspaceId, source.id) })
    }
    return context.json({ connections })
  })

  router.get('/:sourceId', requirePermission('workspace.read'), async (context) => {
    return context.json(await readStatus(deps.secretStore, getWorkspaceId(context), context.req.param('sourceId')))
  })

  return router
}

async function readStatus(secretStore: SecretStore, workspaceId: string, sourceId: string): Promise<SourceConnectionStatus> {
  const key = `${workspaceId}--${sourceId}`
  for (const namespace of OAUTH_NAMESPACES) {
    const stored = await secretStore.read<StoredCredential>(namespace, key)
    if (stored) {
      return {
        connected: true,
        needsAuth: stored.needsAuth === true,
        ...(stored.connectedBy ? { connectedBy: stored.connectedBy } : {}),
        ...(stored.connectedAt ? { connectedAt: stored.connectedAt } : {}),
      }
    }
  }
  return { connected: false, needsAuth: false }
}
