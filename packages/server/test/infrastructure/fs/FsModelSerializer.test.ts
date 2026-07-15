import type { AbsolutePath, EdgeId, EdgeTypeId, GraphEdge, GraphNode, NodeId, NodeTypeId } from '@braidhq/schema'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FsModelSerializer } from '../../../src/infrastructure/fs/FsModelSerializer.js'
import { graphJsonPath, workspaceArtifactsDir } from '../../../src/infrastructure/fs/paths.js'
import { makeWorkspace } from '../../helpers/fakes.js'

async function makeRoot(): Promise<AbsolutePath> {
  return (await mkdtemp(join(tmpdir(), 'braid-graph-json-'))) as AbsolutePath
}

function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: id as NodeId,
    type: 'aggregate' as NodeTypeId,
    name: id,
    status: 'draft',
    metadata: { sourceReferences: [] },
    ...overrides,
  }
}

function makeEdge(id: string, from: string, to: string): GraphEdge {
  return {
    id: id as EdgeId,
    type: 'contains' as EdgeTypeId,
    fromNodeId: from as NodeId,
    toNodeId: to as NodeId,
    metadata: { sourceReferences: [] },
  }
}

describe('FsModelSerializer', () => {
  it('exists returns false before any write', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })
    expect(await new FsModelSerializer().exists(ws)).toBe(false)
  })

  it('read returns null before any write', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })
    expect(await new FsModelSerializer().read(ws)).toBeNull()
  })

  it('round-trips a snapshot through write + read', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })
    const serializer = new FsModelSerializer()
    const snapshot = {
      nodes: [makeNode('node-b'), makeNode('node-a')],
      edges: [makeEdge('edge-1', 'node-a', 'node-b')],
    }

    await serializer.write(ws, snapshot)
    const read = await serializer.read(ws)

    expect(read).not.toBeNull()
    expect(read!.nodes.map(n => n.id).sort()).toEqual(['node-a', 'node-b'])
    expect(read!.edges).toHaveLength(1)
  })

  it('sorts nodes and edges by id so two writes of the same logical state are byte-identical', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })
    const serializer = new FsModelSerializer()
    const nodes = [makeNode('z'), makeNode('a'), makeNode('m')]
    const edges = [makeEdge('e-z', 'z', 'a'), makeEdge('e-a', 'a', 'm')]

    await serializer.write(ws, { nodes, edges })
    const first = await readFile(graphJsonPath(root), 'utf-8')
    await serializer.write(ws, { nodes: [...nodes].reverse(), edges: [...edges].reverse() })
    const second = await readFile(graphJsonPath(root), 'utf-8')

    expect(second).toBe(first)
    const parsed = JSON.parse(first) as { nodes: Array<{ id: string }> }
    expect(parsed.nodes.map(n => n.id)).toEqual(['a', 'm', 'z'])
  })

  it('throws on an unknown model.json version (forward-compat guard)', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })
    const serializer = new FsModelSerializer()
    await serializer.write(ws, { nodes: [], edges: [] })
    const path = graphJsonPath(root)
    const raw = await readFile(path, 'utf-8')
    const tampered = raw.replace(/"version":\s*\d+/, '"version": 999')
    await writeFile(path, tampered, 'utf-8')

    await expect(serializer.read(ws)).rejects.toThrow(/version mismatch/)
  })

  it('writes to artifacts/model.json under the workspace root', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })

    await new FsModelSerializer().write(ws, { nodes: [], edges: [] })

    const expected = join(workspaceArtifactsDir(root), 'model.json')
    const raw = await readFile(expected, 'utf-8')
    expect(JSON.parse(raw)).toMatchObject({ version: 1, nodes: [], edges: [] })
  })
})
