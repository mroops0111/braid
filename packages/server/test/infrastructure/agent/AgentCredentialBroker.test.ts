import type { AgentCredentialStore, StoredCredential } from '@braidhq/core'
import type { AgentKind, SkillRunId, UserId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { AgentCredentialBroker } from '../../../src/infrastructure/agent/AgentCredentialBroker.js'

const ADA = 'user-ada' as UserId
const BO = 'user-bo' as UserId
const CLAUDE = 'claude-code' as AgentKind
const RUN = 'run-1' as SkillRunId

function storeWith(held: Record<string, string>): AgentCredentialStore & { readonly used: string[] } {
  const used: string[] = []
  return {
    used,
    async reveal(userId, kind) {
      return held[`${userId}--${kind}`]
    },
    async save() {},
    async forget() {},
    async describe(userId, kind): Promise<StoredCredential | undefined> {
      const credential = held[`${userId}--${kind}`]
      return credential ? { hint: credential.slice(-4), updatedAt: '2026-01-01T00:00:00.000Z' } : undefined
    },
    async markUsed(userId, kind) {
      used.push(`${userId}--${kind}`)
    },
  }
}

function brokerWith(held: Record<string, string>, serverCredential?: string) {
  const store = storeWith(held)
  const broker = new AgentCredentialBroker({
    store,
    baseUrl: 'http://127.0.0.1:4399/agent',
    ...(serverCredential ? { serverCredential } : {}),
  })
  return { broker, store }
}

describe('resolution order', () => {
  it('spends the author\'s own credential before the server\'s', async () => {
    const { broker } = brokerWith({ 'user-ada--claude-code': 'sk-ada' }, 'sk-server')
    const lease = await broker.lease(RUN, ADA, CLAUDE)
    expect(lease.source).toBe('own')
    expect(await broker.redeem(lease.env.ANTHROPIC_AUTH_TOKEN!)).toBe('sk-ada')
  })

  // A deployment with a shared seat does not force anyone to save their own.
  it('falls back to the server credential for an author who saved none', async () => {
    const { broker } = brokerWith({}, 'sk-server')
    const lease = await broker.lease(RUN, BO, CLAUDE)
    expect(lease.source).toBe('server')
    expect(await broker.redeem(lease.env.ANTHROPIC_AUTH_TOKEN!)).toBe('sk-server')
  })

  // Letting the run start would reach an upstream 401,
  // which tells the reader nothing about what to do.
  it('refuses when neither the author nor the server holds one', async () => {
    const { broker } = brokerWith({})
    const lease = await broker.lease(RUN, BO, CLAUDE)
    expect(lease.source).toBe('none')
    expect(lease.env).toEqual({})
  })

  it('answers what a run would spend without lending anything', async () => {
    const { broker } = brokerWith({ 'user-ada--claude-code': 'sk-ada' }, 'sk-server')
    expect(await broker.sourceFor(ADA, CLAUDE)).toBe('own')
    expect(await broker.sourceFor(BO, CLAUDE)).toBe('server')
  })

  // One person may hold a credential per agent,
  // and reaching for the wrong one spends an account they did not choose.
  it('keeps one person\'s credentials apart by agent kind', async () => {
    const { broker } = brokerWith({ 'user-ada--claude-code': 'sk-ada' })
    expect(await broker.sourceFor(ADA, 'other-agent' as AgentKind)).toBe('none')
  })
})

describe('the stand-in', () => {
  // This is what a planted skill walks away with, so it has to be worthless.
  it('is not the credential itself', async () => {
    const { broker } = brokerWith({ 'user-ada--claude-code': 'sk-ada' })
    const lease = await broker.lease(RUN, ADA, CLAUDE)
    expect(lease.env.ANTHROPIC_AUTH_TOKEN).not.toBe('sk-ada')
    expect(JSON.stringify(lease.env)).not.toContain('sk-ada')
  })

  it('points the agent at this server rather than the upstream', async () => {
    const { broker } = brokerWith({ 'user-ada--claude-code': 'sk-ada' })
    const lease = await broker.lease(RUN, ADA, CLAUDE)
    expect(lease.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:4399/agent')
  })

  it('is the same token for a run that leases twice', async () => {
    const { broker } = brokerWith({ 'user-ada--claude-code': 'sk-ada' })
    const first = await broker.lease(RUN, ADA, CLAUDE)
    const second = await broker.lease(RUN, ADA, CLAUDE)
    expect(second.env.ANTHROPIC_AUTH_TOKEN).toBe(first.env.ANTHROPIC_AUTH_TOKEN)
  })

  it('stops opening doors once the run ends', async () => {
    const { broker } = brokerWith({ 'user-ada--claude-code': 'sk-ada' })
    const lease = await broker.lease(RUN, ADA, CLAUDE)
    broker.release(RUN)
    expect(await broker.redeem(lease.env.ANTHROPIC_AUTH_TOKEN!)).toBeUndefined()
  })

  it('means nothing when it was never lent', async () => {
    const { broker } = brokerWith({ 'user-ada--claude-code': 'sk-ada' })
    expect(await broker.redeem('braid-agent.invented')).toBeUndefined()
  })

  // Two runs by different people must not resolve to each other's account.
  it('resolves each run against its own author', async () => {
    const { broker } = brokerWith({ 'user-ada--claude-code': 'sk-ada', 'user-bo--claude-code': 'sk-bo' })
    const ada = await broker.lease('run-ada' as SkillRunId, ADA, CLAUDE)
    const bo = await broker.lease('run-bo' as SkillRunId, BO, CLAUDE)
    expect(await broker.redeem(ada.env.ANTHROPIC_AUTH_TOKEN!)).toBe('sk-ada')
    expect(await broker.redeem(bo.env.ANTHROPIC_AUTH_TOKEN!)).toBe('sk-bo')
  })

  // Attribution is the point of the feature, so a spend has to be recorded.
  it('records that the author\'s credential was spent', async () => {
    const { broker, store } = brokerWith({ 'user-ada--claude-code': 'sk-ada' })
    const lease = await broker.lease(RUN, ADA, CLAUDE)
    await broker.redeem(lease.env.ANTHROPIC_AUTH_TOKEN!)
    expect(store.used).toEqual(['user-ada--claude-code'])
  })

  it('records nothing when the run spent the server\'s', async () => {
    const { broker, store } = brokerWith({}, 'sk-server')
    const lease = await broker.lease(RUN, BO, CLAUDE)
    await broker.redeem(lease.env.ANTHROPIC_AUTH_TOKEN!)
    expect(store.used).toEqual([])
  })
})
