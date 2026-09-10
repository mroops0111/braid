/**
 * What a skill subprocess inherits from the server it was spawned by.
 *
 * An agent runs a prompt that lives in the workspace,
 * so whoever can edit a skill decides what it reads.
 * Handing it the server's whole environment hands over every credential,
 * and a run needs only enough to find its interpreter,
 * and to reach the network.
 *
 * An allowlist rather than a denylist.
 * A deployment gains variables over time,
 * and the name nobody thought to exclude is the one that leaks.
 * A credential a run legitimately needs comes from its caller,
 * which is where the decision to grant it can be seen.
 */
const INHERITED: ReadonlySet<string> = new Set([
  // Finding and running the agent's own binary.
  'PATH',
  'HOME',
  'SHELL',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TZ',
  'TERM',
  // Reaching the network through whatever the deployment sits behind.
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
])

/**
 * The environment a spawned agent starts from.
 *
 * Callers layer what the run itself needs on top,
 * so this answers only what may be carried over from the server process.
 */
export function inheritableSpawnEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of INHERITED) {
    const value = source[name]
    if (typeof value === 'string')
      result[name] = value
  }
  return result
}
