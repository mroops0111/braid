/**
 * Send the browser to a server's Google sign-in.
 *
 * The start endpoint answers with the authorization URL, it does not redirect,
 * so pointing `location.href` straight at it lands the user on raw JSON.
 * It takes a base URL rather than using the api client,
 * so a caller can reach a remote server it holds no token for yet.
 */
export async function startGoogleSignIn(serverUrl: string, remoteId: string): Promise<void> {
  const returnTo = `${window.location.origin}${window.location.pathname}#auth-remote=${encodeURIComponent(remoteId)}`
  const response = await fetch(`${serverUrl}/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`)
  if (!response.ok)
    throw new Error(`Sign-in is unavailable on ${serverUrl} (${response.status}).`)
  const { authorizationUrl } = await response.json() as { authorizationUrl: string }
  window.location.href = authorizationUrl
}
