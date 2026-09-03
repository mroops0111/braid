import type { UserId } from '@braidhq/schema'

export interface VerifiedCaller {
  readonly userId: UserId
}

/**
 * Turns a bearer token into the person it stands for,
 * or null when it does not stand for anyone here.
 *
 * A deployment can accept more than one kind of credential.
 * The browser carries a session Braid issued,
 * and a programmatic client carries one an authorization server issued.
 * Both arrive in the same header,
 * so the middleware asks each verifier in turn,
 * rather than guessing from the shape of the string.
 *
 * Returning null means "not mine", not "invalid".
 * A verifier that recognises a token and rejects it throws,
 * so a genuinely expired credential does not fall through to the next one,
 * and come back as a vaguer error.
 */
export interface AccessTokenVerifier {
  verify: (token: string) => Promise<VerifiedCaller | null>
}
