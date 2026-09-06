import type { SourceWebUrlInput } from '@braidhq/core'

/**
 * A git remote in any of the forms a config may carry, reduced to the two
 * parts a web URL needs. Credentials are stripped, since the caller of the
 * link is a browser carrying its own session, not the mirror's fetch token.
 */
export interface RemoteTarget {
  readonly origin: string
  readonly path: string
}

const SSH_REMOTE = /^(?:ssh:\/\/)?(?:[^@/]+@)?([^:/]+)[:/](.+?)(?:\.git)?\/?$/

export function parseRemote(url: string): RemoteTarget | null {
  const trimmed = url.trim()
  if (trimmed.length === 0)
    return null

  if (/^https?:\/\//.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      const path = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '')
      if (path.length === 0)
        return null
      return { origin: `${parsed.protocol}//${parsed.host.toLowerCase()}`, path }
    }
    catch {
      return null
    }
  }

  const matched = SSH_REMOTE.exec(trimmed)
  const host = matched?.[1]
  const path = matched?.[2]
  if (!host || !path)
    return null
  return { origin: `https://${host.toLowerCase()}`, path: path.replace(/^\/+/, '').replace(/\/+$/, '') }
}

/**
 * A blob URL on the host the mirror came from.
 *
 * GitHub and GitLab agree on `/-`-free `blob/<ref>/<path>#L<start>-L<end>`
 * closely enough that one builder serves both, and a host that disagrees
 * still lands on a page rather than a 404. Pinning to the revision matters
 * more than the fragment, because a line number against a moving branch
 * points at whatever happens to be there later.
 */
export function gitWebUrl(input: SourceWebUrlInput, defaultRef: string): string | null {
  const config = input.config as { url?: unknown, branch?: unknown } | null
  if (typeof config?.url !== 'string')
    return null
  const remote = parseRemote(config.url)
  if (!remote)
    return null

  const ref = input.revision ?? (typeof config.branch === 'string' ? config.branch : defaultRef)
  const path = input.unitPath.replace(/^\/+/, '')
  const { startLine, endLine } = input.location
  const fragment = startLine === undefined
    ? ''
    : endLine !== undefined && endLine !== startLine
      ? `#L${startLine}-L${endLine}`
      : `#L${startLine}`

  return `${remote.origin}/${remote.path}/blob/${ref}/${path}${fragment}`
}
