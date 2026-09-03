/**
 * The two things Braid needs from an authorization server's published
 * metadata, per RFC 8414.
 *
 * Discovered rather than configured, so an operator names the issuer once and
 * a key rotation or an endpoint move needs no redeployment.
 */
export interface OidcMetadata {
  readonly issuer: string
  readonly jwksUri: string
  /** Absent on an authorization server that runs no browser flow. */
  readonly authorizationEndpoint?: string
  readonly tokenEndpoint?: string
  /** Absent on a server that offers no RP-initiated logout. */
  readonly endSessionEndpoint?: string
}

interface RawMetadata {
  readonly issuer?: unknown
  readonly jwks_uri?: unknown
  readonly authorization_endpoint?: unknown
  readonly token_endpoint?: unknown
  readonly end_session_endpoint?: unknown
}

/**
 * Read an issuer's metadata.
 *
 * Both well-known paths are tried, since an OpenID provider publishes at
 * `openid-configuration` and a plain OAuth server at
 * `oauth-authorization-server`, and a deployment should not have to know
 * which kind it was handed.
 */
export async function discoverOidcMetadata(
  issuer: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<OidcMetadata> {
  const base = issuer.replace(/\/$/, '')
  const candidates = [
    `${base}/.well-known/openid-configuration`,
    `${base}/.well-known/oauth-authorization-server`,
  ]
  const failures: string[] = []
  for (const url of candidates) {
    try {
      const metadata = await readMetadata(url, fetchImpl)
      // The issuer in the document is authoritative, and must be the one that
      // was asked for. A mismatch means the document describes someone else.
      if (metadata.issuer !== base && metadata.issuer !== `${base}/`)
        throw new Error(`issuer is "${metadata.issuer}", expected "${base}"`)
      return metadata
    }
    catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Could not read OIDC metadata for "${issuer}". ${failures.join('; ')}`)
}

async function readMetadata(url: string, fetchImpl: typeof globalThis.fetch): Promise<OidcMetadata> {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
  if (!response.ok)
    throw new Error(`responded ${response.status}`)
  const body = await response.json() as RawMetadata
  if (typeof body.issuer !== 'string' || typeof body.jwks_uri !== 'string')
    throw new Error('missing issuer or jwks_uri')
  return {
    issuer: body.issuer.replace(/\/$/, ''),
    jwksUri: body.jwks_uri,
    // Optional, because a server that only validates tokens publishes
    // neither, and Braid still trusts it for the programmatic door.
    ...(typeof body.authorization_endpoint === 'string' ? { authorizationEndpoint: body.authorization_endpoint } : {}),
    ...(typeof body.token_endpoint === 'string' ? { tokenEndpoint: body.token_endpoint } : {}),
    ...(typeof body.end_session_endpoint === 'string' ? { endSessionEndpoint: body.end_session_endpoint } : {}),
  }
}
