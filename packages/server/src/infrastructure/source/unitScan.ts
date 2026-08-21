import type { PluginRegistry, SourceUnitItem, Workspace } from '@braidhq/core'
import type { SourceRole } from '@braidhq/schema'
import { Buffer } from 'node:buffer'
import { open, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { unitBearingRoleIds } from '@braidhq/core'
import { parseMarkdownFrontmatter } from '../_shared/frontmatter.js'

const UNIT_FILE_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst'])

/** The unit-bearing role ids the workspace's active ontology declares. */
export function unitBearingRolesOf(registry: PluginRegistry, workspace: Workspace): readonly SourceRole[] {
  const ontology = registry.findOntology(workspace.productManifest.ontologyId)
  return ontology ? unitBearingRoleIds(ontology) : []
}

/**
 * Shared by the Studio source picker and BatchService,
 * so both see the same per-doc granularity.
 * Walks sources whose role is in `roles`, the ontology's unit-bearing roles.
 */
export async function listUnitItems(workspace: Workspace, roles: readonly SourceRole[]): Promise<SourceUnitItem[]> {
  const items: SourceUnitItem[] = []
  for (const source of workspace.sources) {
    if (!roles.includes(source.role))
      continue
    if (source.kind !== 'filesystem')
      // MCP sources aren't directory-listable, future enhancement.
      continue
    const absoluteRoot = isAbsolute(source.path)
      ? source.path
      : join(workspace.rootPath, source.path)
    items.push(...await listUnitEntries(absoluteRoot, source.id, source.name))
  }
  return items
}

async function listUnitEntries(root: string, sourceId: string, sourceName: string): Promise<SourceUnitItem[]> {
  const items: SourceUnitItem[] = []
  let topEntries
  try {
    topEntries = await readdir(root, { withFileTypes: true })
  }
  catch {
    return items
  }
  for (const entry of topEntries) {
    if (entry.name.startsWith('.'))
      continue
    if (entry.isDirectory()) {
      const folder = join(root, entry.name)
      // A flat directory of loose markdown files gives one unit per file,
      // so downstream skills run per-document rather than over the bag all at once.
      // Such layouts include a github loader's issues tree,
      // or a hand-curated prd folder of onboarding docs.
      // A directory with its own sub-structure stays a single unit,
      // since that structure is the unit's own organisation.
      const flatFiles = await listFlatDocumentFiles(folder)
      if (flatFiles) {
        for (const name of flatFiles) {
          const title = await readTitle(join(folder, name))
          items.push({
            value: `${entry.name}/${name}`,
            label: `${entry.name}/${stripExtension(name)}`,
            sourceId,
            sourceName,
            ...(title ? { title } : {}),
          })
        }
        continue
      }
      if (await containsDocument(folder, 4)) {
        items.push({
          value: `${entry.name}/`,
          label: entry.name,
          sourceId,
          sourceName,
        })
      }
      continue
    }
    if (entry.isFile() && isUnitDocument(entry.name)) {
      const title = await readTitle(join(root, entry.name))
      items.push({
        value: entry.name,
        label: stripExtension(entry.name),
        sourceId,
        sourceName,
        ...(title ? { title } : {}),
      })
    }
  }
  // Newest first, which for a mirror named by upstream id,
  // means the most recent work rather than the oldest.
  return items.sort((a, b) => byNaturalName(b.label, a.label))
}

// A flat document directory has every visible entry a markdown file,
// with no subdirectories.
// For one, returns the sorted list of filenames.
// Returns `undefined` otherwise, so the caller falls back to treating,
// the directory as a single unit.
// "Visible" here excludes dotfiles,
// so sync state like `.braid-github-cursor.json` doesn't disqualify it.
async function listFlatDocumentFiles(dir: string): Promise<string[] | undefined> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  }
  catch {
    return undefined
  }
  const docs: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.'))
      continue
    if (entry.isDirectory())
      return undefined
    if (!entry.isFile())
      continue
    if (!isUnitDocument(entry.name))
      return undefined
    docs.push(entry.name)
  }
  if (docs.length === 0)
    return undefined
  return docs.sort(byNaturalName)
}

async function containsDocument(dir: string, maxDepth: number): Promise<boolean> {
  if (maxDepth < 0)
    return false
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  }
  catch {
    return false
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.'))
      continue
    if (entry.isFile() && isUnitDocument(entry.name))
      return true
    if (entry.isDirectory() && await containsDocument(join(dir, entry.name), maxDepth - 1))
      return true
  }
  return false
}

/**
 * Orders names the way a reader expects, so `9` precedes `10`.
 * Plain string order puts `10` first,
 * which scrambles any source named by an upstream id,
 * once the numbers pass single digits.
 *
 * The locale is pinned, since the default varies by host,
 * and the order a listing comes back in should not.
 */
function byNaturalName(left: string, right: string): number {
  return left.localeCompare(right, 'en', { numeric: true })
}

// Frontmatter sits at the top, so the rest of a long document is never read.
// A picker opens over every unit at once, and some mirrors run to thousands.
const FRONTMATTER_BUDGET = 4096

/**
 * The document's own title, when its frontmatter carries one.
 * Anything unreadable or unparseable yields nothing,
 * since a listing that fails over one malformed document,
 * is worse than one missing a label.
 */
async function readTitle(path: string): Promise<string | undefined> {
  let handle
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(FRONTMATTER_BUDGET)
    const { bytesRead } = await handle.read(buffer, 0, FRONTMATTER_BUDGET, 0)
    const head = buffer.subarray(0, bytesRead).toString('utf-8')
    // A truncated read can cut the closing delimiter, so put one back.
    const { frontmatter } = parseMarkdownFrontmatter<{ title?: unknown }>(
      bytesRead < FRONTMATTER_BUDGET ? head : `${head}\n---\n`,
    )
    const { title } = frontmatter
    return typeof title === 'string' && title.length > 0 ? title : undefined
  }
  catch {
    return undefined
  }
  finally {
    await handle?.close()
  }
}

function isUnitDocument(filename: string): boolean {
  const dot = filename.lastIndexOf('.')
  if (dot < 0)
    return false
  return UNIT_FILE_EXTENSIONS.has(filename.slice(dot).toLowerCase())
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? filename : filename.slice(0, dot)
}
