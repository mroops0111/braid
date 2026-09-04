import type { McpEndpointStatus } from '../infrastructure/mcp/mcpEndpointStatus.js'
import type { McpGatewayResolution } from '../infrastructure/mcp/mcpGatewaySettings.js'
import { Hono } from 'hono'
import { readMcpEndpointStatus } from '../infrastructure/mcp/mcpEndpointStatus.js'

/**
 * Reports whether this deployment serves an MCP endpoint, and where.
 *
 * Read-only on purpose. Whether there is an endpoint follows from the
 * authorization server, which is a deployment decision, so Studio explains
 * the state rather than offering a switch that would disagree with boot.
 */
export interface McpStatusRouterDeps {
  readonly resolution: McpGatewayResolution
  /** Where callers reach it, this server's own port and not the gateway's. */
  readonly endpointUrl?: string
  /** Loopback, since the published name may not resolve from inside. */
  readonly gatewayUrl?: string
  readonly fetch?: typeof globalThis.fetch
}

export function createMcpStatusRouter(deps: McpStatusRouterDeps): Hono {
  const router = new Hono()
  const send = deps.fetch ?? globalThis.fetch

  router.get('/', async (context) => {
    const status: McpEndpointStatus = await readMcpEndpointStatus({
      resolution: deps.resolution,
      endpointUrl: deps.endpointUrl ?? null,
      reachable: async () => {
        if (!deps.gatewayUrl)
          return false
        // Any answer proves it is listening. An unauthenticated probe draws
        // a challenge, which is a reply and so counts as reachable.
        try {
          await send(deps.gatewayUrl, { method: 'GET' })
          return true
        }
        catch {
          return false
        }
      },
    })
    return context.json(status)
  })

  return router
}
