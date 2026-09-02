import type { EmbeddingRepository } from '@braidhq/core'
import type { AbsolutePath, NodeEmbedding, NodeId, WorkspaceId } from '@braidhq/schema'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { NodeEmbedding as NodeEmbeddingSchema } from '@braidhq/schema'
import { embeddingsPath } from '../_shared/paths.js'

export interface FsEmbeddingRepositoryDeps {
  /**
   * Locates a workspace on disk,
   * mirroring how the storage plugins resolve their own state,
   * rather than owning the registry.
   */
  readonly resolveWorkspaceRoot: (workspaceId: WorkspaceId) => Promise<string>
}

/**
 * Vectors on disk, one JSON object per line.
 *
 * A line per vector rather than one document,
 * so a malformed tail costs the vectors after it and not the whole index,
 * which a rebuild then refills.
 */
export class FsEmbeddingRepository implements EmbeddingRepository {
  constructor(private readonly deps: FsEmbeddingRepositoryDeps) {}

  async list(workspaceId: WorkspaceId): Promise<readonly NodeEmbedding[]> {
    const path = await this.pathFor(workspaceId)
    let raw: string
    try {
      raw = await readFile(path, 'utf-8')
    }
    catch {
      return []
    }
    const out: NodeEmbedding[] = []
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0)
        continue
      const parsed = NodeEmbeddingSchema.safeParse(safeJson(line))
      // A vector that no longer parses is treated as absent,
      // so the next rebuild replaces it instead of failing the read.
      if (parsed.success)
        out.push(parsed.data)
    }
    return out
  }

  async putMany(workspaceId: WorkspaceId, embeddings: readonly NodeEmbedding[]): Promise<void> {
    if (embeddings.length === 0)
      return
    const incoming = new Map(embeddings.map(entry => [entry.nodeId, entry]))
    const kept = (await this.list(workspaceId)).filter(entry => !incoming.has(entry.nodeId))
    await this.writeAll(workspaceId, [...kept, ...incoming.values()])
  }

  async deleteMany(workspaceId: WorkspaceId, nodeIds: readonly NodeId[]): Promise<void> {
    if (nodeIds.length === 0)
      return
    const dropped = new Set(nodeIds)
    const kept = (await this.list(workspaceId)).filter(entry => !dropped.has(entry.nodeId))
    await this.writeAll(workspaceId, kept)
  }

  private async writeAll(workspaceId: WorkspaceId, entries: readonly NodeEmbedding[]): Promise<void> {
    const path = await this.pathFor(workspaceId)
    await mkdir(dirname(path), { recursive: true })
    const body = entries.map(entry => JSON.stringify(entry)).join('\n')
    // Atomic write. A crash mid-rebuild must not leave a half index behind,
    // which would read as a corpus with a torn final line.
    const temporary = `${path}.tmp`
    await writeFile(temporary, entries.length > 0 ? `${body}\n` : '', 'utf-8')
    await rename(temporary, path)
  }

  private async pathFor(workspaceId: WorkspaceId): Promise<string> {
    const root = await this.deps.resolveWorkspaceRoot(workspaceId)
    return embeddingsPath(root as AbsolutePath)
  }
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line)
  }
  catch {
    return null
  }
}
