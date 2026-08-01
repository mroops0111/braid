import type { ModelSerializer, Workspace } from '@braidhq/core'
import type { ModelSnapshot } from '@braidhq/schema'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { GraphEdge, GraphNode } from '@braidhq/schema'
import { z } from 'zod'
import { graphJsonPath, workspaceArtifactsDir } from '../_shared/paths.js'

export const MODEL_JSON_VERSION = 1

export const ModelJsonFile = z.object({
  version: z.number().int(),
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
})

export class FsModelSerializer implements ModelSerializer {
  async write(workspace: Workspace, snapshot: ModelSnapshot): Promise<void> {
    const path = graphJsonPath(workspace.rootPath)
    await mkdir(workspaceArtifactsDir(workspace.rootPath), { recursive: true })
    const payload = {
      version: MODEL_JSON_VERSION,
      nodes: [...snapshot.nodes].sort(byId),
      edges: [...snapshot.edges].sort(byId),
    }
    // Atomic write. A crashed server must not leave a half-file behind,
    // one that would mis-hydrate Kùzu on the next restart.
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
    await rename(tmp, path)
  }

  async read(workspace: Workspace): Promise<ModelSnapshot | null> {
    let raw: string
    try {
      raw = await readFile(graphJsonPath(workspace.rootPath), 'utf-8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return null
      throw error
    }
    const parsed = ModelJsonFile.parse(JSON.parse(raw))
    if (parsed.version !== MODEL_JSON_VERSION) {
      throw new Error(
        `model.json version mismatch in ${workspace.rootPath}: expected ${MODEL_JSON_VERSION}, got ${parsed.version}`,
      )
    }
    return { nodes: parsed.nodes, edges: parsed.edges }
  }

  async exists(workspace: Workspace): Promise<boolean> {
    try {
      await readFile(graphJsonPath(workspace.rootPath), 'utf-8')
      return true
    }
    catch {
      return false
    }
  }
}

function byId<T extends { id: string }>(a: T, b: T): number {
  if (a.id < b.id)
    return -1
  if (a.id > b.id)
    return 1
  return 0
}
