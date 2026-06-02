// Seed eight commits covering every (Create / Update / Delete) × (Node / Edge) so the History compare UI has something to look at.
// Usage (server running, default port 4321):
//   pnpm tsx scripts/seed-history.ts                 # targets `dottedsign`
//   pnpm tsx scripts/seed-history.ts <workspaceName>
// IDs are timestamp-suffixed; reruns don't collide. Restore in the UI or delete `~/.braid/workspaces/<ws>` to clean up.

import process from 'node:process'

const SERVER = process.env.BRAID_SERVER ?? 'http://localhost:4321'
const WORKSPACE_NAME = process.argv[2] ?? 'dottedsign'
const SUFFIX = Math.floor(Date.now() / 1000) % 100000

interface WorkspaceListItem {
  id: string
  productManifest: { name: string }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status}: ${text}`)
  }
  return response.json() as Promise<T>
}

async function findWorkspaceId(name: string): Promise<string> {
  const list = await api<{ items: WorkspaceListItem[] }>('/workspaces')
  const found = list.items.find(w => w.id === name || w.productManifest?.name === name)
  if (!found) {
    const known = list.items.map(w => w.id).join(', ')
    throw new Error(`Workspace "${name}" not found. Known: [${known || 'none'}]`)
  }
  return found.id
}

async function applyProposal(
  workspaceId: string,
  label: string,
  operations: unknown[],
): Promise<void> {
  const proposal = await api<{ id: string }>(
    `/workspaces/${workspaceId}/proposals`,
    {
      method: 'POST',
      body: JSON.stringify({
        operations,
        rationale: `seed: ${label}`,
        generatedBy: 'extract',
      }),
    },
  )
  await api(
    `/workspaces/${workspaceId}/proposals/${proposal.id}/apply`,
    { method: 'POST', body: JSON.stringify({ userId: 'seed-script' }) },
  )
  console.log(`  ✓ ${label}`)
}

async function main(): Promise<void> {
  console.log(`Seeding history into "${WORKSPACE_NAME}" at ${SERVER}`)
  const workspaceId = await findWorkspaceId(WORKSPACE_NAME)
  console.log(`  workspace id: ${workspaceId}`)

  const bcId = `seed.bc.${SUFFIX}`
  const aggId = `seed.agg.${SUFFIX}`
  const cmdId = `seed.cmd.${SUFFIX}`
  const evtId = `seed.evt.${SUFFIX}`
  const containsEdgeId = `seed.edge.contains.${SUFFIX}`
  const acceptsEdgeId = `seed.edge.accepts.${SUFFIX}`

  const nodeMeta = { sourceReferences: [], intentMissing: true }
  const edgeMeta = { sourceReferences: [] }

  await applyProposal(workspaceId, '1/8 add bounded context', [{
    operation: 'addNode',
    payload: { id: bcId, type: 'boundedContext', name: `Seed BC ${SUFFIX}`, status: 'draft', metadata: nodeMeta },
  }])

  await applyProposal(workspaceId, '2/8 add aggregate', [{
    operation: 'addNode',
    payload: { id: aggId, type: 'aggregate', name: `Seed Order ${SUFFIX}`, status: 'draft', metadata: nodeMeta },
  }])

  await applyProposal(workspaceId, '3/8 link BC → aggregate', [{
    operation: 'addEdge',
    payload: { id: containsEdgeId, type: 'contains', fromNodeId: bcId, toNodeId: aggId, metadata: edgeMeta },
  }])

  await applyProposal(workspaceId, '4/8 add command + accepts edge', [
    { operation: 'addNode', payload: { id: cmdId, type: 'command', name: `Place Seed Order ${SUFFIX}`, status: 'draft', metadata: nodeMeta } },
    { operation: 'addEdge', payload: { id: acceptsEdgeId, type: 'accepts', fromNodeId: aggId, toNodeId: cmdId, metadata: edgeMeta } },
  ])

  await applyProposal(workspaceId, '5/8 update aggregate description', [{
    operation: 'updateNode',
    nodeId: aggId,
    patch: { description: 'Seed aggregate (description added in step 5)' },
  }])

  await applyProposal(workspaceId, '6/8 add event', [{
    operation: 'addNode',
    payload: { id: evtId, type: 'event', name: `Seed Order Placed ${SUFFIX}`, status: 'draft', metadata: nodeMeta },
  }])

  await applyProposal(workspaceId, '7/8 remove command (cascade-drops accepts edge)', [{
    operation: 'removeNode',
    nodeId: cmdId,
  }])

  await applyProposal(workspaceId, '8/8 update contains edge metadata', [{
    operation: 'updateEdge',
    edgeId: containsEdgeId,
    patch: {
      metadata: {
        sourceReferences: [],
        externalReferences: [{ kind: 'link', url: 'https://example.com/seed-edge-note', label: 'seed edge note' }],
      },
    },
  }])

  console.log('\nDone. Open History — you should see initial + 8 seed commits.')
  console.log('Try Compare: click any commit, hit Compare, then pick another.')
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
