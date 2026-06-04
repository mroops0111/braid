import type { Workspace } from '@braidhq/core'
import { readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

const INTENT_FILE_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst'])

export interface IntentItem {
  readonly value: string
  readonly label: string
  readonly sourceId: string
  readonly sourceName: string
}

// Shared by the Studio source picker and BatchService so both see the same per-doc granularity.
export async function listIntentItems(workspace: Workspace): Promise<IntentItem[]> {
  const items: IntentItem[] = []
  for (const source of workspace.sources) {
    if (source.role !== 'intent')
      continue
    if (source.kind !== 'filesystem')
      // MCP intent sources aren't directory-listable; future enhancement.
      continue
    const absoluteRoot = isAbsolute(source.path)
      ? source.path
      : join(workspace.rootPath, source.path)
    items.push(...await listIntentEntries(absoluteRoot, source.id, source.name))
  }
  return items
}

async function listIntentEntries(root: string, sourceId: string, sourceName: string): Promise<IntentItem[]> {
  const items: IntentItem[] = []
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
    if (entry.isFile() && isIntentDocument(entry.name)) {
      items.push({
        value: entry.name,
        label: stripExtension(entry.name),
        sourceId,
        sourceName,
      })
    }
  }
  return items.sort((a, b) => a.label.localeCompare(b.label))
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
    if (entry.isFile() && isIntentDocument(entry.name))
      return true
    if (entry.isDirectory() && await containsDocument(join(dir, entry.name), maxDepth - 1))
      return true
  }
  return false
}

function isIntentDocument(filename: string): boolean {
  const dot = filename.lastIndexOf('.')
  if (dot < 0)
    return false
  return INTENT_FILE_EXTENSIONS.has(filename.slice(dot).toLowerCase())
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? filename : filename.slice(0, dot)
}
