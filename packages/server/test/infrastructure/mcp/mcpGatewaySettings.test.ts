// The `${...}` literals below are the assertion, not an interpolation.
// They are what the gateway resolves against its env at startup.
/* eslint-disable no-template-curly-in-string */
import type { McpGatewayContext } from '../../../src/infrastructure/mcp/mcpGatewaySettings.js'
import { describe, expect, it } from 'vitest'
import { resolveMcpGateway } from '../../../src/infrastructure/mcp/mcpGatewaySettings.js'

const context: McpGatewayContext = {
  apiUrl: 'https://braid.example.com',
  loopbackApiUrl: 'http://localhost:4321',
  audience: 'https://braid.example.com',
  uvxBin: 'uvx',
}

const completeEnv = {
  BRAID_OIDC_ISSUER: 'https://as.example.com',
  BRAID_MCP_GATEWAY_CLIENT_ID: 'gateway',
  BRAID_MCP_GATEWAY_CLIENT_SECRET: 'shh',
}

describe('resolveMcpGateway', () => {
  it('serves nothing when no authorization server can authenticate a caller', () => {
    expect(resolveMcpGateway({}, context)).toEqual({ kind: 'unrequested' })
  })

  it('stays off when the deployment switches it off, issuer or not', () => {
    expect(resolveMcpGateway({ ...completeEnv, BRAID_MCP_ENABLED: 'false' }, context))
      .toEqual({ kind: 'unrequested' })
  })

  it.each([
    ['BRAID_MCP_GATEWAY_CLIENT_ID'],
    ['BRAID_MCP_GATEWAY_CLIENT_SECRET'],
  ])('names %s when it is what the endpoint is missing', (variable) => {
    const env = { ...completeEnv, [variable]: undefined }
    const resolution = resolveMcpGateway(env, context)
    expect(resolution.kind).toBe('incomplete')
    expect(resolution.kind === 'incomplete' && resolution.missing).toEqual([variable])
  })

  it('names uv when the binary the gateway runs under is absent', () => {
    const resolution = resolveMcpGateway(completeEnv, { ...context, uvxBin: undefined })
    expect(resolution.kind === 'incomplete' && resolution.missing).toEqual(['uv on PATH'])
  })

  it('never falls back to a shared static token', () => {
    // A deployment with no authorization server gets no endpoint at all.
    // The alternative, one token every caller shares,
    // would land every MCP call under a single identity,
    // and lose per-user attribution.
    const resolution = resolveMcpGateway({ BRAID_MCP_GATEWAY_CLIENT_ID: 'x' }, context)
    expect(resolution.kind).toBe('unrequested')
    expect(JSON.stringify(resolution)).not.toContain('bearer')
  })

  it('exchanges the caller token rather than holding a credential of its own', () => {
    const resolution = resolveMcpGateway(completeEnv, context)
    expect(resolution.kind).toBe('ready')
    if (resolution.kind !== 'ready')
      return
    const server = resolution.config.servers[0]!
    expect(server.auth.flow).toBe('token_exchange')
    expect(server.auth.issuer).toBe('https://as.example.com')
    // Names Braid,
    // so the forwarded token passes Braid's own audience check,
    // rather than the authorization server's default.
    // Both spellings, since servers disagree on which one drives the exchange.
    expect(server.auth.upstream.resource).toBe('https://braid.example.com')
    expect(server.auth.upstream.audience).toBe('https://braid.example.com')
    // References, not values, so the generated file holds no secret.
    expect(server.auth.upstream.client_id).toBe('${BRAID_MCP_GATEWAY_CLIENT_ID}')
    expect(server.auth.upstream.client_secret).toBe('${BRAID_MCP_GATEWAY_CLIENT_SECRET}')
  })

  it('exposes only what the spec marks, and reaches Braid on loopback', () => {
    const resolution = resolveMcpGateway(completeEnv, context)
    if (resolution.kind !== 'ready')
      throw new Error('expected a ready resolution')
    const server = resolution.config.servers[0]!
    expect(server.policy.marked_only).toBe(true)
    // The spec's `servers[]` names the public URL,
    // which a proxied host cannot always reach by its own name.
    expect(server.spec).toBe('http://localhost:4321/openapi.json')
    expect(server.base_url).toBe('http://localhost:4321')
  })

  it('advertises this API as the address, and binds loopback', () => {
    const resolution = resolveMcpGateway(completeEnv, { ...context, apiUrl: 'https://braid.example.com/' })
    if (resolution.kind !== 'ready')
      throw new Error('expected a ready resolution')
    // The endpoint reaches callers on this server's port, so the metadata
    // names this API. A trailing slash would reach a client doubled.
    expect(resolution.config.url).toBe('https://braid.example.com')
    // Never published. The only way in is through this server.
    expect(resolution.config.host).toBe('127.0.0.1')
  })

  it('resolves the gateway with the oidc extra, and takes a pin', () => {
    const resolution = resolveMcpGateway(completeEnv, context)
    // Without the extra the gateway starts and then refuses every call,
    // since it cannot verify the token the caller arrived with.
    expect(resolution.kind === 'ready' && resolution.gatewayPackage).toBe('openapi-mcp-gateway[oidc]')
    const pinned = resolveMcpGateway({ ...completeEnv, BRAID_MCP_GATEWAY_PACKAGE: 'openapi-mcp-gateway[oidc]==1.2.3' }, context)
    expect(pinned.kind === 'ready' && pinned.gatewayPackage).toBe('openapi-mcp-gateway[oidc]==1.2.3')
  })

  it('falls back to a default port, and takes an integer override', () => {
    const ready = (env: Record<string, string | undefined>) => {
      const resolution = resolveMcpGateway(env, context)
      if (resolution.kind !== 'ready')
        throw new Error('expected a ready resolution')
      return resolution.config
    }
    expect(ready(completeEnv).port).toBe(4322)
    expect(ready({ ...completeEnv, BRAID_MCP_GATEWAY_PORT: '9000' }).port).toBe(9000)
    expect(ready({ ...completeEnv, BRAID_MCP_GATEWAY_PORT: 'not-a-port' }).port).toBe(4322)
  })
})
