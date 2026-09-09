import type { AgentCredentialBroker } from '../../src/infrastructure/agent/AgentCredentialBroker.js'
import { describe, expect, it, vi } from 'vitest'
import { createAgentProxyRouter } from '../../src/routes/agentProxy.js'

function brokerHolding(byToken: Record<string, string>): AgentCredentialBroker {
  return {
    async redeem(token: string) {
      return byToken[token]
    },
  } as unknown as AgentCredentialBroker
}

function router(byToken: Record<string, string>, fetchImpl?: typeof globalThis.fetch) {
  return createAgentProxyRouter({
    broker: brokerHolding(byToken),
    upstreamUrl: 'https://api.anthropic.example',
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
}

describe('agent proxy', () => {
  // The CLI sends this before its first message,
  // and reads a failure as the endpoint being unreachable.
  it('answers the connectivity probe without a credential', async () => {
    const response = await router({}).request('/api/hello', { method: 'HEAD' })
    expect(response.status).toBe(200)
  })

  it('swaps the stand-in for the real credential on the way out', async () => {
    const sent: (string | null)[] = []
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(new Headers(init.headers).get('authorization'))
      return new Response('{}', { status: 200 })
    }) as unknown as typeof globalThis.fetch

    await router({ 'stand-in': 'sk-real' }, fetchImpl).request('/v1/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer stand-in' },
      body: '{}',
    })
    expect(sent).toEqual(['Bearer sk-real'])
  })

  it('sends the request to the upstream it was given', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url)
      return new Response('{}', { status: 200 })
    }) as unknown as typeof globalThis.fetch

    await router({ 'stand-in': 'sk-real' }, fetchImpl).request('/v1/messages?beta=true', {
      method: 'POST',
      headers: { authorization: 'Bearer stand-in' },
      body: '{}',
    })
    expect(urls).toEqual(['https://api.anthropic.example/v1/messages?beta=true'])
  })

  // A released run must stop being spendable at the next call,
  // not the next spawn, which is what asking per request buys.
  it('refuses a token the broker no longer knows', async () => {
    const response = await router({}).request('/v1/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer released' },
      body: '{}',
    })
    expect(response.status).toBe(401)
  })

  it('refuses a request carrying no token at all', async () => {
    const response = await router({ 'stand-in': 'sk-real' }).request('/v1/messages', {
      method: 'POST',
      body: '{}',
    })
    expect(response.status).toBe(401)
  })

  // The agent parses this and cannot know a broker stood in the way,
  // so a refusal has to look like the upstream's own.
  it('refuses in the shape the upstream uses', async () => {
    const response = await router({}).request('/v1/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer released' },
      body: '{}',
    })
    expect(await response.json()).toEqual({
      type: 'error',
      error: { type: 'authentication_error', message: 'This run holds no agent credential.' },
    })
  })

  it('reports an unreachable upstream rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof globalThis.fetch
    const response = await router({ 'stand-in': 'sk-real' }, fetchImpl).request('/v1/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer stand-in' },
      body: '{}',
    })
    expect(response.status).toBe(502)
  })

  it('passes the upstream status and body back unchanged', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('{"ok":true}', { status: 429, headers: { 'retry-after': '30' } }),
    ) as unknown as typeof globalThis.fetch
    const response = await router({ 'stand-in': 'sk-real' }, fetchImpl).request('/v1/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer stand-in' },
      body: '{}',
    })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(await response.text()).toBe('{"ok":true}')
  })
})
