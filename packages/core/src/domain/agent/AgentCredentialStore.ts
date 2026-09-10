import type { AgentKind, UserId } from '@braidhq/schema'

/**
 * Where a person's own agent credential is kept.
 *
 * A port rather than a concrete store,
 * because protecting it at rest is a deployment's decision.
 * A self-hosted install encrypts to a file, a hosted one reaches a vault,
 * and neither changes what a run asks for.
 *
 * No read returns the credential to a caller.
 * A run gets one spent on its behalf, never handed over,
 * which is what keeps a planted skill from walking off with an account.
 */
export interface AgentCredentialStore {
  /** Undefined where this person has stored none for this kind. */
  reveal: (userId: UserId, kind: AgentKind) => Promise<string | undefined>
  save: (userId: UserId, kind: AgentKind, credential: string) => Promise<void>
  forget: (userId: UserId, kind: AgentKind) => Promise<void>
  /** What a reader may see, which is everything except the credential. */
  describe: (userId: UserId, kind: AgentKind) => Promise<StoredCredential | undefined>
  markUsed: (userId: UserId, kind: AgentKind) => Promise<void>
}

export interface StoredCredential {
  /** The credential with its middle removed, see `maskCredential`. */
  readonly masked: string
  readonly updatedAt: string
  readonly lastUsedAt?: string
}
