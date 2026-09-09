import type { AgentCredentialBroker } from '../infrastructure/agent/AgentCredentialBroker.js'
import { Hono } from 'hono'

/**
 * Spends a run's resolved credential on its behalf.
 *
 * The agent is pointed here instead of at the upstream API,
 * carrying a token only this server understands.
 * Each request is exchanged for the real credential,
 * which never leaves this process, and the reply streams back untouched.
 *
 * The same shape as the MCP proxy,
 * which already swaps an `Authorization` header,
 * and passes a stream through in both directions.
 */
export interface AgentProxyDeps {
  readonly broker: AgentCredentialBroker
  /** The real API this stands in front of. */
  readonly upstreamUrl: string
  readonly fetch?: typeof globalThis.fetch
}

// Hop-by-hop headers, meaningless to forward and actively wrong to copy.
const SKIPPED_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', 'authorization'])
const SKIPPED_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding'])

/**
 * What a subscription credential needs that an API key does not.
 *
 * The upstream reads `sk-ant-oat` as a subscription credential,
 * and refuses it as a bearer unless the request opts into this beta.
 * The agent sends the flag when it signs in itself,
 * and drops it the moment it is pointed at a gateway,
 * because a gateway is assumed to hold credentials of its own.
 * Restoring it here is what makes a lent subscription work at all.
 */
const OAUTH_CREDENTIAL_PREFIX = 'sk-ant-oat'
const OAUTH_BETA = 'oauth-2025-04-20'

export function createAgentProxyRouter(deps: AgentProxyDeps): Hono {
  const router = new Hono()
  const send = deps.fetch ?? globalThis.fetch

  // The CLI probes this before its first message,
  // and from a different client than it uses for the API.
  // Answering keeps it from reading the endpoint as unreachable.
  router.on(['GET', 'HEAD'], '/api/hello', context => context.body(null, 200))

  // Named rather than a bare wildcard.
  // The captured value is the path relative to wherever this was mounted,
  // where `context.req.path` keeps the mount prefix,
  // and forwarding that asks the vendor for a route it does not have.
  router.all('/:upstreamPath{.*}', async (context) => {
    const presented = bearerFrom(context.req.header('authorization'))
    const credential = presented ? await deps.broker.redeem(presented) : undefined
    if (!credential) {
      // The same shape the upstream uses,
      // since the agent parses this and cannot know a broker stood in the way.
      return context.json(
        { type: 'error', error: { type: 'authentication_error', message: 'This run holds no agent credential.' } },
        401,
      )
    }

    const query = new URL(context.req.url).search
    const headers = new Headers()
    for (const [name, value] of Object.entries(context.req.header())) {
      if (!SKIPPED_REQUEST_HEADERS.has(name.toLowerCase()))
        headers.set(name, value)
    }
    headers.set('authorization', `Bearer ${credential}`)
    if (credential.startsWith(OAUTH_CREDENTIAL_PREFIX))
      headers.set('anthropic-beta', withBeta(context.req.header('anthropic-beta'), OAUTH_BETA))

    const method = context.req.method
    const hasBody = method !== 'GET' && method !== 'HEAD'
    let response: Response
    try {
      response = await send(`${deps.upstreamUrl}/${context.req.param('upstreamPath')}${query}`, {
        method,
        headers,
        // Streamed rather than read,
        // since a turn carries the whole conversation and replies as events.
        ...(hasBody ? { body: context.req.raw.body, duplex: 'half' } as RequestInit : {}),
      })
    }
    catch {
      return context.json(
        { type: 'error', error: { type: 'api_error', message: 'The upstream API could not be reached.' } },
        502,
      )
    }

    const outgoing = new Headers()
    response.headers.forEach((value, name) => {
      if (!SKIPPED_RESPONSE_HEADERS.has(name.toLowerCase()))
        outgoing.set(name, value)
    })
    return new Response(response.body, { status: response.status, headers: outgoing })
  })

  return router
}

/**
 * Adds one beta flag to the comma separated list the agent sent.
 *
 * The others carry features the agent asked for,
 * so replacing the header outright would turn them off.
 */
function withBeta(header: string | undefined, flag: string): string {
  const flags = (header ?? '').split(',').map(one => one.trim()).filter(Boolean)
  if (flags.includes(flag))
    return flags.join(',')
  return [...flags, flag].join(',')
}

function bearerFrom(header: string | undefined): string | undefined {
  if (!header)
    return undefined
  const [scheme, value] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined
}
