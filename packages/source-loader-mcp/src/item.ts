import type { McpLoaderConfig } from './config.js'
import { stringify as stringifyYaml } from 'yaml'
import { readPath } from './config.js'

/** One item of a page, already read through the configured paths. */
export interface MirroredItem {
  readonly id: string
  readonly updatedAt: string
  readonly filename: string
  readonly markdown: string
}

/**
 * A filename that survives every filesystem and cannot escape its directory.
 * An upstream id is arbitrary text,
 * so anything outside the safe set becomes a dash,
 * and a run of dashes collapses.
 */
export function toFilename(id: string): string {
  const safe = id.replace(/[^\w.-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return `${safe.length > 0 ? safe.slice(0, 120) : 'item'}.md`
}

/**
 * Frontmatter carries every scalar the item has, not only the mapped ones,
 * so a status or an assignee reaches the agent without being configured.
 * A nested value is dropped rather than serialised, and the keys are sorted,
 * so the rendering stays byte-identical while the upstream is unchanged.
 *
 * The three mapped fields are then written under their canonical names,
 * so a reader sees `title` whether the server calls it `subject` or `summary`.
 */
function frontmatterOf(
  item: Record<string, unknown>,
  config: McpLoaderConfig,
  mapped: { readonly id: string, readonly title: unknown, readonly updatedAt: string },
): Record<string, unknown> {
  const bodyKey = config.item.body.split('.')[0]
  const carried: [string, unknown][] = []
  for (const [key, value] of Object.entries(item)) {
    if (key === bodyKey)
      continue
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      carried.push([key, value])
  }
  const canonical: [string, unknown][] = [['id', mapped.id]]
  if (typeof mapped.title === 'string' || typeof mapped.title === 'number')
    canonical.push(['title', mapped.title])
  if (mapped.updatedAt)
    canonical.push(['updatedAt', mapped.updatedAt])
  const merged = new Map([...carried, ...canonical])
  return Object.fromEntries([...merged].sort(([left], [right]) => left.localeCompare(right)))
}

/**
 * Render one item, or explain why it cannot be one.
 * An item without an id has no stable filename, so it can never be tracked,
 * and the loader says which path was empty rather than inventing a name.
 */
export function renderItem(raw: unknown, config: McpLoaderConfig): MirroredItem {
  if (raw === null || typeof raw !== 'object')
    throw new TypeError(`mcpLoader: expected an object item, received ${typeof raw}`)
  const item = raw as Record<string, unknown>
  const id = readPath(item, config.item.id)
  if (typeof id !== 'string' && typeof id !== 'number')
    throw new TypeError(`mcpLoader: item has no id at "${config.item.id}"`)
  const rawUpdatedAt = readPath(item, config.item.updatedAt)
  const updatedAt = typeof rawUpdatedAt === 'string' ? rawUpdatedAt : ''
  const mapped = { id: String(id), title: readPath(item, config.item.title), updatedAt }
  const body = readPath(item, config.item.body)
  const yaml = stringifyYaml(frontmatterOf(item, config, mapped), { lineWidth: 0 }).trimEnd()
  const text = typeof body === 'string' ? body.trimEnd() : ''
  return {
    id: mapped.id,
    updatedAt,
    filename: toFilename(mapped.id),
    markdown: `---\n${yaml}\n---\n\n${text}\n`.replace(/\n{3,}$/, '\n'),
  }
}
