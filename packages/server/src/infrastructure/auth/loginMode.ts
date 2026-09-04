/**
 * Which browser sign-in a deployment offers.
 *
 * One, never two.
 * An authorization server displaces the Google client rather than joining it,
 * so a person has one identity whichever door they use,
 * and Google is configured once at the issuer instead of twice.
 */
export type LoginMode =
  | { readonly kind: 'oidc', readonly issuer: string, readonly clientId: string, readonly clientSecret: string }
  | { readonly kind: 'google' }
  /** Nobody can sign in. `reason` names what is missing, for the boot log. */
  | { readonly kind: 'none', readonly reason: string }

const ISSUER_VAR = 'BRAID_OIDC_ISSUER'
const CLIENT_ID_VAR = 'BRAID_OIDC_CLIENT_ID'
const CLIENT_SECRET_VAR = 'BRAID_OIDC_CLIENT_SECRET'

/**
 * Pure, so the rule is testable without building a provider.
 *
 * An issuer wins whenever one is named,
 * including when it is named incompletely.
 * Falling back to Google there is worse than refusing.
 * It signs people in against the provider the deployment just replaced.
 */
export function chooseLoginMode(
  env: Readonly<Record<string, string | undefined>>,
  context: { readonly googleConfigured: boolean },
): LoginMode {
  const issuer = env[ISSUER_VAR]
  if (issuer) {
    const clientId = env[CLIENT_ID_VAR]
    const clientSecret = env[CLIENT_SECRET_VAR]
    if (clientId && clientSecret)
      return { kind: 'oidc', issuer, clientId, clientSecret }
    const missing = [
      ...(clientId ? [] : [CLIENT_ID_VAR]),
      ...(clientSecret ? [] : [CLIENT_SECRET_VAR]),
    ]
    return {
      kind: 'none',
      reason: `${ISSUER_VAR} is set, so sign-in goes through it, but ${missing.join(' and ')} is missing.`,
    }
  }
  if (context.googleConfigured)
    return { kind: 'google' }
  return { kind: 'none', reason: `Neither ${ISSUER_VAR} nor a Google client is configured.` }
}
