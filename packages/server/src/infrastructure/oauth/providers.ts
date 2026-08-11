/** A connectable OAuth provider and where its tokens and sources live. */
export interface OAuthProviderInfo {
  readonly id: 'google' | 'github'
  readonly label: string
  // Secret-store namespace holding this provider's tokens.
  readonly namespace: string
  // Source loader kind whose sources authenticate through this provider.
  readonly loaderKind: string
}

/**
 * The single place a provider's id, label, token namespace,
 * and loader kind are tied together. Routes and the composition root
 * derive their lists from this,
 * so a new provider is one entry here rather than edits across files.
 */
export const OAUTH_PROVIDERS: readonly OAuthProviderInfo[] = [
  { id: 'google', label: 'Google', namespace: 'oauth-google', loaderKind: 'gdrive' },
  { id: 'github', label: 'GitHub', namespace: 'oauth-github', loaderKind: 'github' },
]

/** The registry entry for a provider id. */
export function oauthProvider(id: OAuthProviderInfo['id']): OAuthProviderInfo {
  const provider = OAUTH_PROVIDERS.find(entry => entry.id === id)
  if (!provider)
    throw new Error(`Unknown OAuth provider "${id}".`)
  return provider
}

/** The secret-store namespace a provider's tokens live under. */
export function oauthNamespace(id: OAuthProviderInfo['id']): string {
  return oauthProvider(id).namespace
}
