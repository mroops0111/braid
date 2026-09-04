import type { McpGatewayConfigDocument } from './gatewayConfig.js'
import { withoutTrailingSlash } from '../_shared/urls.js'
import { buildMcpGatewayConfig } from './gatewayConfig.js'

const ENABLED_VAR = 'BRAID_MCP_ENABLED'
const PORT_VAR = 'BRAID_MCP_GATEWAY_PORT'
const CLIENT_ID_VAR = 'BRAID_MCP_GATEWAY_CLIENT_ID'
const CLIENT_SECRET_VAR = 'BRAID_MCP_GATEWAY_CLIENT_SECRET'
const ISSUER_VAR = 'BRAID_OIDC_ISSUER'
const PACKAGE_VAR = 'BRAID_MCP_GATEWAY_PACKAGE'

const DEFAULT_PORT = 4322

// The `oidc` extra carries the JWT verification token_exchange needs.
// Without it the gateway starts and then refuses every call,
// since it cannot check the token the caller arrived with.
const DEFAULT_PACKAGE = 'openapi-mcp-gateway[oidc]'

/**
 * Where Braid reaches itself and who it trusts,
 * the two facts the gateway config needs that do not come from env.
 */
export interface McpGatewayContext {
  /**
   * Where callers reach this API, and so where they reach the endpoint,
   * since it is published on this server's own port.
   */
  readonly apiUrl: string
  /** Loopback, since a proxied host cannot always reach its own public name. */
  readonly loopbackApiUrl: string
  /** What Braid's own verifier requires an exchanged token to name. */
  readonly audience: string
  readonly uvxBin: string | undefined
}

/** Why a deployment serves no endpoint, for a reader who expected one. */
export type McpUnrequestedReason = 'turnedOff' | 'noAuthorizationServer'

export type McpGatewayResolution =
  | { readonly kind: 'unrequested', readonly reason: McpUnrequestedReason }
  /** Possible in principle, but something it cannot run without is missing. */
  | { readonly kind: 'incomplete', readonly missing: readonly string[] }
  | {
    readonly kind: 'ready'
    readonly config: McpGatewayConfigDocument
    /** What `uvx` resolves the gateway from, the `oidc` extra included. */
    readonly gatewayPackage: string
  }

/**
 * Decide whether this deployment serves an MCP endpoint, and with what config.
 *
 * Pure, so the decision is testable without a filesystem or a subprocess.
 * The composition root turns a `ready` resolution into a running process.
 *
 * There is no static-token fallback on purpose.
 * A shared token would flatten every MCP caller into one identity,
 * which is exactly what per-user run attribution rules out.
 * A deployment without an authorization server gets no endpoint,
 * rather than an anonymous one.
 */
export function resolveMcpGateway(
  env: Readonly<Record<string, string | undefined>>,
  context: McpGatewayContext,
): McpGatewayResolution {
  // Built in rather than opted into, so a deployment that can serve it does.
  // The authorization server is what makes it possible at all,
  // and a deployment without one has no MCP surface to offer.
  if (env[ENABLED_VAR]?.toLowerCase() === 'false')
    return { kind: 'unrequested', reason: 'turnedOff' }
  const issuer = env[ISSUER_VAR]
  if (!issuer)
    return { kind: 'unrequested', reason: 'noAuthorizationServer' }

  const missing: string[] = []
  if (!env[CLIENT_ID_VAR])
    missing.push(CLIENT_ID_VAR)
  if (!env[CLIENT_SECRET_VAR])
    missing.push(CLIENT_SECRET_VAR)
  if (!context.uvxBin)
    missing.push('uv on PATH')
  if (missing.length > 0)
    return { kind: 'incomplete', missing }

  return {
    kind: 'ready',
    gatewayPackage: env[PACKAGE_VAR] || DEFAULT_PACKAGE,
    config: buildMcpGatewayConfig({
      // Loopback only. This server proxies the endpoint on its own port,
      // so the gateway never needs an address of its own.
      host: '127.0.0.1',
      port: readPort(env[PORT_VAR]),
      publicUrl: withoutTrailingSlash(context.apiUrl),
      specUrl: `${context.loopbackApiUrl}/openapi.json`,
      baseUrl: context.loopbackApiUrl,
      issuer,
      audience: context.audience,
      // References rather than values,
      // resolved by the gateway against the env it inherits,
      // so the generated file holds no secret.
      // eslint-disable-next-line no-template-curly-in-string
      clientIdRef: '${BRAID_MCP_GATEWAY_CLIENT_ID}',
      // eslint-disable-next-line no-template-curly-in-string
      clientSecretRef: '${BRAID_MCP_GATEWAY_CLIENT_SECRET}',
    }),
  }
}

function readPort(raw: string | undefined): number {
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT
}
