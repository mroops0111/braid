import type { Hono } from 'hono'
import type { AppDependencies } from '../../src/composition.js'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeFsApp } from '../../src/composeFs.js'

/**
 * End-to-end integration test for the post-refactor architecture.
 *
 * Exercises the full data flow through the running server:
 *
 *   1. **Workspace scaffold** — POST /workspaces/scaffold writes PRODUCT.md,
 *      registers the workspace; the active OntologyPlugin (`ddd`) gets
 *      looked up from PluginRegistry, its bundled validators get bound.
 *   2. **Proposal submission with valid evidence** — POST /workspaces/:ws/proposals
 *      runs through HITLService.assertOperationsValid → ValidationService:
 *        - Framework invariants (EvidenceValidator, OrphanEdgeValidator) inline
 *        - Active ontology's validators (OntologyTypeValidator, StructuralValidator
 *          auto-bound by defineOntology) via OntologyPlugin.validators[]
 *      → returns 201 + saved proposal.
 *   3. **Framework invariant rejection** — node without sourceReferences nor
 *      "missing" flag fails EvidenceValidator → 400.
 *   4. **Ontology rule rejection** — unknown node type fails the ontology's
 *      OntologyTypeValidator → 400.
 *   5. **Apply proposal** — POST /proposals/:id/apply → Kuzu writes via
 *      `pluginRegistry.requireStoragePlugin(kind).createModelRepository()`,
 *      Decision recorded, status transitions to `applied`.
 *   6. **Verify read paths** — GET /nodes returns the applied node;
 *      GET /ontology returns the active ontology's schema; GET /decisions
 *      shows the apply record.
 *
 * Does NOT spawn the `claude` subprocess; agent path is tested separately
 * with mockSpawn. This test pins the registry-routed wiring + the
 * validator orchestration.
 */
describe('e2e: scaffold → submit → validate → apply (post-Model-A-refactor)', () => {
  let braidHome: string
  let workspaceRoot: string
  let deps: AppDependencies
  let app: Hono

  beforeEach(async () => {
    braidHome = await mkdtemp(join(tmpdir(), 'braid-e2e-home-'))
    workspaceRoot = await mkdtemp(join(tmpdir(), 'braid-e2e-ws-'))
    deps = await composeFsApp({ braidHome })
    app = createApp(deps)
  })

  afterEach(async () => {
    // Kuzu cleanup: release any cached connections before nuking the dir
    // to avoid lock errors. The KuzuModelRepository owns the cache; in
    // production composeFsApp doesn't dispose at process exit either.
    await rm(braidHome, { recursive: true, force: true }).catch(() => {})
    await rm(workspaceRoot, { recursive: true, force: true }).catch(() => {})
  })

  async function scaffold(name: string): Promise<string> {
    // intent/ has to exist so the filesystem source path resolves;
    // no source loader is used so we drop the marker file manually.
    await writeFile(join(workspaceRoot, 'NOTES.md'), '# notes\n')
    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rootPath: workspaceRoot,
        manifest: {
          name,
          sources: [],
        },
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json() as { workspace: { id: string } }
    return body.workspace.id
  }

  it('routes a valid proposal through both framework and ontology validators', async () => {
    const wsId = await scaffold('e2e-valid')

    // Submit a boundedContext + an aggregate inside it.
    // EvidenceValidator: `implementationMissing` satisfies the evidence rule.
    // OntologyTypeValidator (from ddd ontology.validators[]): both types are valid.
    // StructuralValidator (from ddd ontology.validators[]): contains edge is
    //   `boundedContext → aggregate`, which matches DDDOntology.edgeTypes[0].fromTypes/toTypes.
    const response = await app.request(`/workspaces/${wsId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            operation: 'addNode',
            payload: {
              type: 'boundedContext',
              name: 'Billing',
              id: 'ctx-billing',
              metadata: { sourceReferences: [], implementationMissing: true },
            },
          },
          {
            operation: 'addNode',
            payload: {
              type: 'aggregate',
              name: 'Invoice',
              id: 'agg-invoice',
              metadata: { sourceReferences: [], implementationMissing: true },
            },
          },
          {
            operation: 'addEdge',
            payload: {
              type: 'contains',
              fromNodeId: 'ctx-billing',
              toNodeId: 'agg-invoice',
              id: 'e-1',
            },
          },
        ],
        generatedBy: 'extract',
        rationale: 'e2e: valid graph',
      }),
    })

    expect(response.status).toBe(201)
    const proposal = await response.json() as { id: string, status: string }
    expect(proposal.status).toBe('pending')
    expect(proposal.id.length).toBeGreaterThan(0)
  })

  it('rejects a proposal that violates the framework EvidenceValidator (no sourceReferences, no missing flag)', async () => {
    const wsId = await scaffold('e2e-no-evidence')

    const response = await app.request(`/workspaces/${wsId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            operation: 'addNode',
            payload: { type: 'command', name: 'placeOrder', id: 'cmd-1' },
          },
        ],
        generatedBy: 'extract',
        rationale: 'e2e: missing evidence',
      }),
    })

    expect(response.status).toBe(400)
    const problem = await response.json() as { code: string, issues?: Array<{ code: string }> }
    expect(problem.issues?.some(issue => issue.code === 'evidence.no-source-or-flag')).toBe(true)
  })

  it('rejects a proposal whose node type is not in the active ontology', async () => {
    const wsId = await scaffold('e2e-bad-type')

    const response = await app.request(`/workspaces/${wsId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            operation: 'addNode',
            payload: {
              type: 'screen',
              name: 'CheckoutPage',
              id: 'ui-1',
              metadata: { sourceReferences: [], implementationMissing: true },
            },
          },
        ],
        generatedBy: 'extract',
        rationale: 'e2e: screen is not in ddd ontology',
      }),
    })

    expect(response.status).toBe(400)
    const problem = await response.json() as { issues?: Array<{ code: string }> }
    expect(problem.issues?.some(issue => issue.code === 'ontology.unknown-node-type')).toBe(true)
  })

  it('rejects a proposal that violates the ontology StructuralValidator (edge endpoints reversed)', async () => {
    const wsId = await scaffold('e2e-structural')

    // contains: boundedContext → aggregate. Here we point the edge the
    // wrong way (aggregate as source). StructuralValidator should flag it.
    const response = await app.request(`/workspaces/${wsId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            operation: 'addNode',
            payload: {
              type: 'boundedContext',
              name: 'X',
              id: 'ctx-x',
              metadata: { sourceReferences: [], implementationMissing: true },
            },
          },
          {
            operation: 'addNode',
            payload: {
              type: 'aggregate',
              name: 'Y',
              id: 'agg-y',
              metadata: { sourceReferences: [], implementationMissing: true },
            },
          },
          {
            operation: 'addEdge',
            payload: {
              type: 'contains',
              fromNodeId: 'agg-y',
              toNodeId: 'ctx-x',
              id: 'e-bad',
            },
          },
        ],
        generatedBy: 'extract',
        rationale: 'e2e: reversed contains direction',
      }),
    })

    expect(response.status).toBe(400)
    const problem = await response.json() as { issues?: Array<{ code: string }> }
    expect(problem.issues?.some(issue => issue.code.startsWith('structural.'))).toBe(true)
  })

  it('apply path: writes nodes through StoragePlugin and surfaces them via REST', async () => {
    const wsId = await scaffold('e2e-apply')

    // Create
    const createResponse = await app.request(`/workspaces/${wsId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            operation: 'addNode',
            payload: {
              type: 'command',
              name: 'placeOrder',
              id: 'cmd-place',
              metadata: { sourceReferences: [], implementationMissing: true },
            },
          },
        ],
        generatedBy: 'extract',
        rationale: 'e2e: apply path',
      }),
    })
    expect(createResponse.status).toBe(201)
    const proposal = await createResponse.json() as { id: string }

    // Apply
    const applyResponse = await app.request(`/workspaces/${wsId}/proposals/${proposal.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'tester' }),
    })
    expect(applyResponse.status).toBe(200)
    const decision = await applyResponse.json() as { action: string, references: { proposalId: string } }
    expect(decision.action).toBe('applyProposal')
    expect(decision.references.proposalId).toBe(proposal.id)

    // Read the node back through the StoragePlugin-routed ModelRepository
    const nodesResponse = await app.request(`/workspaces/${wsId}/nodes`)
    expect(nodesResponse.status).toBe(200)
    const nodesBody = await nodesResponse.json() as { items: Array<{ id: string, name: string, type: string }> }
    const placed = nodesBody.items.find(n => n.id === 'cmd-place')
    expect(placed?.name).toBe('placeOrder')
    expect(placed?.type).toBe('command')

    // The decision is in `decisions` list
    const decisionsResponse = await app.request(`/workspaces/${wsId}/decisions`)
    const decisionsBody = await decisionsResponse.json() as { items: Array<{ action: string }> }
    expect(decisionsBody.items.some(d => d.action === 'applyProposal')).toBe(true)

    // Proposal status moved to `applied`
    const proposalRead = await app.request(`/workspaces/${wsId}/proposals/${proposal.id}`)
    const reread = await proposalRead.json() as { status: string }
    expect(reread.status).toBe('applied')
  })

  it('GET /ontology returns the active OntologyPlugin schema (ddd) — confirms ontology routes through registry', async () => {
    const wsId = await scaffold('e2e-ontology')

    const response = await app.request(`/workspaces/${wsId}/ontology`)
    expect(response.status).toBe(200)
    const body = await response.json() as {
      ontologyId: string
      nodeTypes: Array<{ id: string }>
      edgeTypes: Array<{ id: string }>
    }
    expect(body.ontologyId).toBe('ddd')
    expect(body.nodeTypes.some(t => t.id === 'boundedContext')).toBe(true)
    expect(body.nodeTypes.some(t => t.id === 'actor')).toBe(true) // P0 addition
    expect(body.edgeTypes.some(t => t.id === 'performedBy')).toBe(true) // P0 addition
  })

  it('artifacts: proposal persistence lands in workspace `artifacts/proposals/` (filesystem path)', async () => {
    const wsId = await scaffold('e2e-fs')

    await app.request(`/workspaces/${wsId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            operation: 'addNode',
            payload: {
              type: 'event',
              name: 'OrderPlaced',
              id: 'evt-1',
              metadata: { sourceReferences: [], implementationMissing: true },
            },
          },
        ],
        generatedBy: 'extract',
        rationale: 'e2e: fs persistence',
      }),
    })

    // Expect a JSON file inside artifacts/proposals/pending/
    const pendingDir = join(workspaceRoot, 'artifacts', 'proposals', 'pending')
    const files = await readdir(pendingDir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/\.json$/)
  })
})
