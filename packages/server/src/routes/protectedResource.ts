import { Hono } from 'hono'

export interface ProtectedResourceRouterDeps {
  /** This deployment's public address, the resource a token is issued for. */
  readonly resource: string
  /** Issuers whose tokens this deployment accepts. */
  readonly authorizationServers: readonly string[]
}

/**
 * Protected resource metadata, RFC 9728.
 *
 * A client that meets a 401 here reads this to learn where to ask for a token,
 * so nobody has to be told out of band.
 * It is also what lets Braid stay a resource server,
 * since naming an authorization server is the alternative to becoming one,
 * and the field is a list because a deployment may trust more than one.
 *
 * Mounted only when a deployment names an issuer.
 * Serving it with an empty list would advertise a way in that does not exist.
 */
export function createProtectedResourceRouter(deps: ProtectedResourceRouterDeps): Hono {
  const router = new Hono()
  router.get('/', context => context.json({
    resource: deps.resource,
    authorization_servers: [...deps.authorizationServers],
    bearer_methods_supported: ['header'],
  }))
  return router
}
