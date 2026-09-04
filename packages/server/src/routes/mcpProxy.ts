import { Hono } from 'hono'

/**
 * Publishes the MCP endpoint on this server's own port.
 *
 * The gateway is a separate process, and a Python one,
 * so it cannot be mounted in-process.
 * It binds loopback instead and this router forwards to it,
 * which leaves a deployment with one address, one port, and one certificate.
 * From outside, the endpoint is part of the API.
 *
 * Streaming matters here. Streamable HTTP answers with an event stream,
 * so the body is passed through rather than read,
 * and headers are carried across so `WWW-Authenticate` reaches the client.
 */
export interface McpProxyDeps {
  /** Where the gateway listens, loopback and not published. */
  readonly gatewayUrl: string
  readonly fetch?: typeof globalThis.fetch
}

// Hop-by-hop headers, meaningless to forward and actively wrong to copy.
const SKIPPED_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length'])
const SKIPPED_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding'])

export function createMcpProxyRouter(deps: McpProxyDeps): Hono {
  const router = new Hono()
  const send = deps.fetch ?? globalThis.fetch

  router.all('/*', async (context) => {
    const incoming = new URL(context.req.url)
    const target = `${deps.gatewayUrl}${incoming.pathname}${incoming.search}`
    const headers = new Headers()
    for (const [name, value] of Object.entries(context.req.header())) {
      if (!SKIPPED_REQUEST_HEADERS.has(name.toLowerCase()))
        headers.set(name, value)
    }

    const method = context.req.method
    const hasBody = method !== 'GET' && method !== 'HEAD'
    let response: Response
    try {
      response = await send(target, {
        method,
        headers,
        ...(hasBody ? { body: context.req.raw.body, duplex: 'half' } as RequestInit : {}),
      })
    }
    catch {
      // The gateway is supervised and restarts, so a gap is a retry,
      // not a fault in the API the caller reached.
      return context.json(
        {
          type: 'about:blank',
          title: 'Service Unavailable',
          status: 503,
          detail: 'The MCP endpoint is not accepting requests right now. Try again shortly.',
        },
        503,
        { 'Content-Type': 'application/problem+json' },
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
