import type { AgentCredentialStore, StoredCredential } from '@braidhq/core'
import type { AgentKind, UserId } from '@braidhq/schema'
import type { SecretStore } from '../secrets/SecretStore.js'
import { maskCredential } from '@braidhq/core'

const NAMESPACE = 'agent-credential'

interface Stored {
  readonly credential: string
  readonly updatedAt: string
  readonly lastUsedAt?: string
}

/**
 * A person's agent credential, kept in whatever secret store is wired.
 *
 * Keyed by user and kind together, so one person may hold one per agent,
 * and switching agents does not silently reuse the wrong account.
 */
export class SecretAgentCredentialStore implements AgentCredentialStore {
  constructor(
    private readonly secrets: SecretStore,
    private readonly now: () => string,
  ) {}

  async reveal(userId: UserId, kind: AgentKind): Promise<string | undefined> {
    return (await this.load(userId, kind))?.credential
  }

  async save(userId: UserId, kind: AgentKind, credential: string): Promise<void> {
    await this.secrets.write(NAMESPACE, keyFor(userId, kind), {
      credential,
      updatedAt: this.now(),
    } satisfies Stored)
  }

  async forget(userId: UserId, kind: AgentKind): Promise<void> {
    await this.secrets.delete(NAMESPACE, keyFor(userId, kind))
  }

  async describe(userId: UserId, kind: AgentKind): Promise<StoredCredential | undefined> {
    const stored = await this.load(userId, kind)
    if (!stored)
      return undefined
    return {
      // Derived here rather than read back,
      // so a record written under an older shape needs no migration.
      masked: maskCredential(stored.credential),
      updatedAt: stored.updatedAt,
      ...(stored.lastUsedAt ? { lastUsedAt: stored.lastUsedAt } : {}),
    }
  }

  /**
   * Records that a run spent this credential.
   *
   * Silent where none is stored.
   * The caller is reporting a use rather than asking for one,
   * and a run that resolved elsewhere is not a fault.
   */
  async markUsed(userId: UserId, kind: AgentKind): Promise<void> {
    const stored = await this.load(userId, kind)
    if (!stored)
      return
    await this.secrets.write(NAMESPACE, keyFor(userId, kind), {
      ...stored,
      lastUsedAt: this.now(),
    } satisfies Stored)
  }

  private async load(userId: UserId, kind: AgentKind): Promise<Stored | undefined> {
    return this.secrets.read<Stored>(NAMESPACE, keyFor(userId, kind))
  }
}

function keyFor(userId: UserId, kind: AgentKind): string {
  return `${userId}--${kind}`
}
