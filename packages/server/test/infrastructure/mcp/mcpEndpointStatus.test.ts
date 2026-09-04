import { describe, expect, it } from 'vitest'
import { readMcpEndpointStatus } from '../../../src/infrastructure/mcp/mcpEndpointStatus.js'

const ENDPOINT = 'https://braid.example/braid/mcp'
const readyResolution = {
  kind: 'ready',
  gatewayPackage: 'openapi-mcp-gateway[oidc]',
  config: {},
} as never

describe('readMcpEndpointStatus', () => {
  it('names the reason a deployment serves no endpoint', async () => {
    const off = await readMcpEndpointStatus({
      resolution: { kind: 'unrequested', reason: 'turnedOff' },
      endpointUrl: ENDPOINT,
      reachable: async () => true,
    })
    expect(off).toEqual({ state: 'turnedOff', endpointUrl: null, missing: [] })

    const noIdp = await readMcpEndpointStatus({
      resolution: { kind: 'unrequested', reason: 'noAuthorizationServer' },
      endpointUrl: ENDPOINT,
      reachable: async () => true,
    })
    expect(noIdp.state).toBe('noAuthorizationServer')
  })

  it('carries what an incomplete deployment is waiting on', async () => {
    const status = await readMcpEndpointStatus({
      resolution: { kind: 'incomplete', missing: ['BRAID_MCP_GATEWAY_CLIENT_ID'] },
      endpointUrl: ENDPOINT,
      reachable: async () => true,
    })
    expect(status).toEqual({
      state: 'incomplete',
      endpointUrl: null,
      missing: ['BRAID_MCP_GATEWAY_CLIENT_ID'],
    })
  })

  it('publishes the endpoint once the gateway answers', async () => {
    const status = await readMcpEndpointStatus({
      resolution: readyResolution,
      endpointUrl: ENDPOINT,
      reachable: async () => true,
    })
    expect(status).toEqual({ state: 'ready', endpointUrl: ENDPOINT, missing: [] })
  })

  // Resolving `ready` only says boot intended an endpoint.
  // The gateway is a supervised process, so it can be down while configured.
  it('reports a configured endpoint that is not answering as unreachable', async () => {
    const status = await readMcpEndpointStatus({
      resolution: readyResolution,
      endpointUrl: ENDPOINT,
      reachable: async () => false,
    })
    expect(status.state).toBe('unreachable')
    expect(status.endpointUrl).toBe(ENDPOINT)
  })

  it('does not probe where boot never resolved an endpoint', async () => {
    let probed = false
    await readMcpEndpointStatus({
      resolution: { kind: 'unrequested', reason: 'turnedOff' },
      endpointUrl: ENDPOINT,
      reachable: async () => {
        probed = true
        return true
      },
    })
    expect(probed).toBe(false)
  })
})
