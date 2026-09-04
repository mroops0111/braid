/**
 * The `openapi-mcp-gateway` config document Braid generates,
 * for its own read-only MCP endpoint.
 *
 * Braid knows three things an operator should not assemble by hand,
 * its own spec URL, the base URL the gateway calls back on,
 * and which operations are marked. Only deployment facts stay in env.
 *
 * Typed loosely on purpose. The gateway owns this schema,
 * so mirroring it in TypeScript would give a second definition,
 * one that drifts on the gateway's next release without anything failing.
 */
export interface McpGatewayConfigDocument {
  readonly host: string
  readonly port: number
  readonly url: string
  readonly transport: 'streamable-http'
  readonly logging: { readonly level: 'INFO', readonly format: 'json' }
  readonly servers: readonly McpGatewayServerEntry[]
}

interface McpGatewayServerEntry {
  readonly name: string
  readonly spec: string
  readonly base_url: string
  readonly policy: { readonly annotated_only: true }
  readonly auth: {
    readonly type: 'oauth2'
    readonly flow: 'token_exchange'
    /** Inbound. Who may mint a token this endpoint accepts. */
    readonly issuer: string
    /** Outbound. How the gateway reaches Braid on the caller's behalf. */
    readonly upstream: {
      readonly client_id: string
      readonly client_secret: string
      readonly resource: string
      readonly audience: string
    }
  }
}

export interface McpGatewayConfigOptions {
  /**
   * Address the gateway binds.
   * Loopback, because the endpoint reaches callers through this server's own
   * port rather than one of its own.
   */
  readonly host: string
  readonly port: number
  /**
   * Public base URL a client reaches the endpoint at, which is this API's.
   * The OAuth metadata documents quote it verbatim,
   * so a client that cannot resolve it cannot complete the flow,
   * whatever the listen address.
   */
  readonly publicUrl: string
  /** Reachable from the gateway process, so loopback, not the public name. */
  readonly specUrl: string
  readonly baseUrl: string
  /** Authorization server Braid already trusts, from `BRAID_OIDC_ISSUER`. */
  readonly issuer: string
  /**
   * Names Braid as the audience the exchanged token is for.
   * Without it the authorization server mints for its own default audience,
   * which Braid's own verifier then refuses.
   */
  readonly audience: string
  /**
   * Env-var references, not values.
   * The gateway resolves them against the env Braid spawns it with.
   */
  readonly clientIdRef: string
  readonly clientSecretRef: string
}

/**
 * The server name, which also decides the mount path.
 * A client reaches the endpoint at `<publicUrl>/braid/mcp`.
 */
export const MCP_GATEWAY_SERVER_NAME = 'braid'

export function buildMcpGatewayConfig(options: McpGatewayConfigOptions): McpGatewayConfigDocument {
  return {
    host: options.host,
    port: options.port,
    url: options.publicUrl,
    transport: 'streamable-http',
    // Structured, so the gateway's lines ride the server's log pipeline.
    logging: { level: 'INFO', format: 'json' },
    servers: [{
      name: MCP_GATEWAY_SERVER_NAME,
      spec: options.specUrl,
      base_url: options.baseUrl,
      // The annotation on each route is the curation list.
      // Without this every operation in the spec becomes a tool,
      // proposals, skill runs, and webhook rotation among them.
      policy: { annotated_only: true },
      // The gateway holds no credential of its own.
      // It validates the caller's token against the same issuer Braid does,
      // then exchanges it for one whose audience names Braid,
      // so per-user identity survives the hop.
      auth: {
        type: 'oauth2',
        flow: 'token_exchange',
        // No `required_scopes`. Demanding one would reject any client whose
        // registration asked for a different set, and what Braid actually
        // needs is an email claim, which is the authorization server's to
        // release rather than a scope Braid is in a position to insist on.
        issuer: options.issuer,
        upstream: {
          // References rather than values, resolved by the gateway against
          // the env it inherits, so the generated file holds no secret.
          client_id: options.clientIdRef,
          client_secret: options.clientSecretRef,
          // RFC 8693 defines both spellings, and servers disagree on which
          // one drives the exchange. Keycloak reads `audience` and ignores
          // `resource`, while a server built to RFC 8707 reads `resource`.
          // Sending both keeps the generated config portable,
          // rather than making the operator work out which theirs wants.
          resource: options.audience,
          audience: options.audience,
        },
      },
    }],
  }
}
