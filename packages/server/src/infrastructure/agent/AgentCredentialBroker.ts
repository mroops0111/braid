import type { AgentCredentialStore } from '@braidhq/core'
import type { AgentKind, SkillRunId, UserId } from '@braidhq/schema'
import { randomUUID } from 'node:crypto'

/**
 * Which account a run resolved to, so a caller can say why it was refused.
 *
 * `none` is a refusal rather than a fallback.
 * A deployment with no server credential, and an author who saved none,
 * has nothing to spend.
 * Failing at spawn names the settings page,
 * where an upstream 401 names nothing the reader can act on.
 */
export type CredentialSource = 'own' | 'server' | 'none'

export interface BrokerLease {
  readonly source: CredentialSource
  /** The env a run carries. Empty where nothing resolved. */
  readonly env: Readonly<Record<string, string>>
}

export interface AgentCredentialBrokerDeps {
  readonly store: AgentCredentialStore
  /** The deployment's shared credential, where it configured one. */
  readonly serverCredential?: string
  /** Where the agent should send its requests, this server's own listener. */
  readonly baseUrl: string
}

interface Lent {
  readonly userId: UserId
  readonly kind: AgentKind
  readonly source: CredentialSource
}

/**
 * Lends a run a stand-in for whichever credential it resolved to.
 *
 * The agent never holds the real one.
 * It receives an address on this server,
 * and a token that means nothing anywhere else and dies with the run.
 * A planted skill reads the whole environment,
 * and leaves with a string `api.anthropic.com` rejects.
 *
 * The lease lives as long as the run and is released with it,
 * so a token outliving its run opens nothing.
 */
export class AgentCredentialBroker {
  private readonly byToken = new Map<string, Lent>()
  private readonly byRun = new Map<SkillRunId, string>()

  constructor(private readonly deps: AgentCredentialBrokerDeps) {}

  /**
   * Resolves the author's credential, then the server's, then refuses.
   *
   * A deployment holding a shared credential forces nobody to save one,
   * which is deliberate.
   * The settings page says which of the two a run would spend,
   * so the choice stays visible rather than silent.
   */
  async lease(runId: SkillRunId, userId: UserId, kind: AgentKind): Promise<BrokerLease> {
    const source = await this.resolve(userId, kind)
    if (source === 'none')
      return { source, env: {} }

    const token = this.mint(runId, { userId, kind, source })
    return {
      source,
      env: {
        ANTHROPIC_BASE_URL: this.deps.baseUrl,
        ANTHROPIC_AUTH_TOKEN: token,
      },
    }
  }

  /** Called when a run ends, so its stand-in stops opening doors. */
  release(runId: SkillRunId): void {
    const token = this.byRun.get(runId)
    if (token === undefined)
      return
    this.byToken.delete(token)
    this.byRun.delete(runId)
  }

  /**
   * The credential a lent token stands for, or undefined once released.
   *
   * The listener asks this per request rather than holding the credential,
   * so a revoked run stops being spendable at the next call,
   * rather than at the next spawn.
   */
  async redeem(token: string): Promise<string | undefined> {
    const lent = this.byToken.get(token)
    if (!lent)
      return undefined
    if (lent.source === 'server')
      return this.deps.serverCredential
    const credential = await this.deps.store.reveal(lent.userId, lent.kind)
    if (credential)
      await this.deps.store.markUsed(lent.userId, lent.kind)
    return credential
  }

  /** What a run would spend, without lending anything. */
  async sourceFor(userId: UserId, kind: AgentKind): Promise<CredentialSource> {
    return this.resolve(userId, kind)
  }

  private async resolve(userId: UserId, kind: AgentKind): Promise<CredentialSource> {
    if (await this.deps.store.describe(userId, kind))
      return 'own'
    return this.deps.serverCredential ? 'server' : 'none'
  }

  private mint(runId: SkillRunId, lent: Lent): string {
    const existing = this.byRun.get(runId)
    if (existing)
      return existing
    const token = `braid-agent.${randomUUID()}`
    this.byToken.set(token, lent)
    this.byRun.set(runId, token)
    return token
  }
}
