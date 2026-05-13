/**
 * Pick the most informative single line from a tool-call args object so a
 * collapsed row can be scanned without expanding. Examples:
 *
 *   { command: "ls" }            → "ls"
 *   { file_path: "/x" }          → "/x"
 *   { url: "https://..." }       → "https://..."
 *   { foo: 1, bar: 2 }           → '{"foo":1,"bar":2}'
 *
 * Output is always truncated to 80 chars.
 */
const PREVIEW_FIELDS = ['command', 'file_path', 'path', 'query', 'url'] as const

export function formatArgsPreview(args: unknown): string {
  if (args === null || args === undefined)
    return ''
  if (typeof args !== 'object')
    return truncate(String(args))

  const record = args as Record<string, unknown>
  for (const field of PREVIEW_FIELDS) {
    const value = record[field]
    if (typeof value === 'string')
      return truncate(value)
  }
  return truncate(JSON.stringify(args))
}

function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
