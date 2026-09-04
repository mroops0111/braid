import { describe, expect, it } from 'vitest'
import { createMcpStatusRouter } from '../../src/routes/mcpStatus.js'

const readyResolution = { kind: 'ready', gatewayPackage: 'x', config: {} } as never

describe('mcp status route', () => {
  it('reports a reachable gateway with the address a client should use', async () => {
    const router = createMcpStatusRouter({
      resolution: readyResolution,
      endpointUrl: 'https://braid.example/braid/mcp',
      gatewayUrl: 'http://127.0.0.1:4322',
      fetch: async () => new Response('', { status: 401 }),
    })
    const response = await router.request('/')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      state: 'ready',
      endpointUrl: 'https://braid.example/braid/mcp',
      missing: [],
    })
  })

  // A challenge is a reply, so the gateway is up.
  // Only a connection that never lands means it is not.
  it('counts an unauthenticated rejection as answering', async () => {
    const router = createMcpStatusRouter({
      resolution: readyResolution,
      endpointUrl: 'https://braid.example/braid/mcp',
      gatewayUrl: 'http://127.0.0.1:4322',
      fetch: async () => {
        throw new Error('ECONNREFUSED')
      },
    })
    const body = await (await router.request('/')).json() as { state: string }
    expect(body.state).toBe('unreachable')
  })

  it('explains an absent endpoint rather than reporting it as broken', async () => {
    const router = createMcpStatusRouter({
      resolution: { kind: 'unrequested', reason: 'noAuthorizationServer' },
    })
    const body = await (await router.request('/')).json()
    expect(body).toEqual({ state: 'noAuthorizationServer', endpointUrl: null, missing: [] })
  })
})
