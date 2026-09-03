/**
 * Send the browser to a server's sign-in.
 *
 * Which provider that is belongs to the server, not here. A deployment with
 * an authorization server signs people in there, one without uses Braid's own
 * Google client, and Studio only needs the id to build the path.
 *
 * The start endpoint answers with the authorization URL, it does not redirect,
 * so pointing `location.href` straight at it lands the user on raw JSON.
 * It takes a base URL rather than using the api client,
 * so a caller can reach a remote server it holds no token for yet.
 */
export async function startSignIn(serverUrl: string, remoteId: string): Promise<void> {
  const config = await fetch(`${serverUrl}/auth/config`)
  if (!config.ok)
    throw new Error(`Could not read the sign-in mode of ${serverUrl} (${config.status}).`)
  const { loginProvider } = await config.json() as { loginProvider: string | null }
  if (!loginProvider)
    throw new Error(`${serverUrl} has no sign-in configured. Ask the admin to set one up.`)

  const returnTo = `${window.location.origin}${window.location.pathname}#auth-remote=${encodeURIComponent(remoteId)}`
  const response = await fetch(`${serverUrl}/auth/${loginProvider}/start?returnTo=${encodeURIComponent(returnTo)}`)
  if (!response.ok)
    throw new Error(`Sign-in is unavailable on ${serverUrl} (${response.status}).`)
  const { authorizationUrl } = await response.json() as { authorizationUrl: string }
  window.location.href = authorizationUrl
}
