import type { AccessTokenVerifier, VerifiedCaller } from './AccessTokenVerifier.js'
import type { SessionStore } from './SessionStore.js'

/**
 * The sessions Braid issues itself,
 * behind the same port as any other credential.
 *
 * An adapter rather than a special case in the middleware,
 * so the order credentials are tried is a matter of how the list is composed,
 * rather than something written into the code that walks it.
 */
export class SessionTokenVerifier implements AccessTokenVerifier {
  constructor(private readonly sessions: SessionStore) {}

  async verify(token: string): Promise<VerifiedCaller | null> {
    // An unknown token is declined rather than refused.
    // It may belong to another verifier,
    // and only the last one to decline settles the answer.
    const session = await this.sessions.resolve(token)
    return session ? { userId: session.userId } : null
  }
}
