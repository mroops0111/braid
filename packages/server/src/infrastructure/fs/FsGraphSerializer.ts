import type { GraphSerializer, Workspace } from '@braidhq/core'
import type { ModelSnapshot } from '@braidhq/schema'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { GraphEdge, GraphNode } from '@braidhq/schema'
import { z } from 'zod'
import { graphJsonPath, workspaceArtifactsDir } from './paths.js'

/**
 * Current `graph.json` schema version. Bumped only when the on-disk
 * shape changes in a way that needs a migration helper (e.g.
 * normalising legacy fields); the reader rejects unknown versions so
 * an older binary can't silently corrupt a newer file.
 */
const GRAPH_JSON_VERSION = 1

const GraphJsonFile = z.object({
  version: z.number().int(),
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
})
type GraphJsonFile = z.infer<typeof GraphJsonFile>

/**
 * Filesystem `GraphSerializer` writing `<workspaceRoot>/artifacts/graph.json`.
 * Writes are atomic via the `mv tmp final` rename trick so a crashed
 * server can't leave a half-written graph that would later mis-hydrate
 * Kùzu on restart.
 *
 * Nodes and edges are sorted by id before serialising so two runs over
 * the same logical state produce byte-identical files. That keeps
 * `git log -p` noise-free and lets `git status` mean what it says
 * during workspace bootstrap.
 */
export class FsGraphSerializer implements GraphSerializer {
  async write(workspace: Workspace, snapshot: ModelSnapshot): Promise<void> {
    const path = graphJsonPath(workspace.rootPath)
    await mkdir(workspaceArtifactsDir(workspace.rootPath), { recursive: true })
    const payload: GraphJsonFile = {
      version: GRAPH_JSON_VERSION,
      nodes: [...snapshot.nodes].sort(byId),
      edges: [...snapshot.edges].sort(byId),
    }
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
    const parsed = GraphJsonFile.parse(JSON.parse(raw))
    if (parsed.version !== GRAPH_JSON_VERSION) {
      throw new Error(
        `graph.json version mismatch in ${workspace.rootPath}: expected ${GRAPH_JSON_VERSION}, got ${parsed.version}`,
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
