/** A base URL a path can be appended to, whatever the operator typed. */
export function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}
