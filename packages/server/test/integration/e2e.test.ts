import type { OpenAPIHono } from '@hono/zod-openapi'
import type { AppDependencies } from '../../src/composition.js'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeFsApp } from '../../src/composeFs.js'
import { readJson } from '../helpers/readJson.js'

/**
 * End-to-end integration test for the post-refactor architecture.
 *
 * Exercises the full data flow through the running server:
 *
 * 1. Workspace scaffold, writes PRODUCT.md, registers workspace,
 * binds the active OntologyPlugin's validators.
 * 2. Proposal submission, HITLService.assertOperationsValid runs framework invariants (Evidence/OrphanEdge) inline,
 * plus the active OntologyPlugin's validators (OntologyType + Structural, auto-bound by `defineOntology`).
 * 3. Apply proposal, StoragePlugin to ModelRepository write,
 * status transitions to `applied`.
 *
 * Does NOT spawn the `claude` subprocess, agent path is tested separately with mockSpawn.
 * This test pins the registry-routed wiring + the validator orchestration.
 */

/** Minimal valid node payload satisfying EvidenceValidator. */
function validNode(opts: { type: string, name: string, id: string }): unknown {
  return {
    type: opts.type,
    name: opts.name,
    id: opts.id,
    // implementationMissing satisfies EvidenceValidator, the node is intent for code not yet shipped,
    // so no sourceReferences needed.
    metadata: { sourceReferences: [], implementationMissing: true },
  }
}

/** Build a proposal POST body for /workspaces/:ws/proposals. */
function proposalBody(opts: {
  operations: unknown[]
  rationale: string
  generatedBy?: string
}): string {
  return JSON.stringify({
    operations: opts.operations,
    generatedBy: opts.generatedBy ?? 'extract',
    rationale: opts.rationale,
  })
}

interface ProposalRef { id: string }
interface ProblemBody { code: string, issues?: Array<{ code: string }> }
interface NodesBody { items: Array<{ id: string, name: string, type: string }> }
interface OntologyBody {
  ontologyId: string
  nodeTypes: Array<{ id: string }>
  edgeTypes: Array<{ id: string }>
}

describe('e2e: scaffold → submit → validate → apply (post-Model-A-refactor)', () => {
  let braidHome: string
  let deps: AppDependencies
  let app: OpenAPIHono

  beforeEach(async () => {
    braidHome = await mkdtemp(join(tmpdir(), 'braid-e2e-home-'))
    deps = await composeFsApp({ braidHome })
    app = createApp(deps)
  })

  afterEach(async () => {
    // Kuzu cleanup: release cached connections before nuking the dir, to avoid lock errors.
    // The KuzuModelRepository owns the cache, production composeFsApp doesn't dispose at process exit either.
    await rm(braidHome, { recursive: true, force: true }).catch(() => {})
  })

  async function scaffold(name: string): Promise<string> {
    // Seed a stray file so we exercise the scaffold-into-existing-dir path.
    // Server's writeProductManifest does `mkdir -p`, so this is just defensive realism, not a precondition.
    const workspaceRoot = join(braidHome, 'workspaces', name)
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(join(workspaceRoot, 'NOTES.md'), '# notes\n')
    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        manifest: {
          name,
          sources: [
            { kind: 'filesystem', id: 'intent', role: 'intent', name: 'intent', path: './intent' },
            { kind: 'filesystem', id: 'code', role: 'code', name: 'code', path: './code' },
          ],
        },
      }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ workspace: { id: string } }>(response)
    return body.workspace.id
  }

  async function submitProposal(wsId: string, body: string): Promise<Response> {
    return app.request(`/workspaces/${wsId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  }

  it('routes a valid proposal through both framework and ontology validators', async () => {
    const wsId = await scaffold('e2e-valid')

    // boundedContext to aggregate via `contains`. Three validators must pass:
    // - EvidenceValidator (framework): implementationMissing satisfies it
    // - OntologyTypeValidator (ontology): both types declared in ddd
    // - StructuralValidator (ontology): contains direction matches descriptor
    const response = await submitProposal(wsId, proposalBody({
      operations: [
        { operation: 'addNode', payload: validNode({ type: 'boundedContext', name: 'Billing', id: 'ctx-billing' }) },
        { operation: 'addNode', payload: validNode({ type: 'aggregate', name: 'Invoice', id: 'agg-invoice' }) },
        {
          operation: 'addEdge',
          payload: { type: 'contains', fromNodeId: 'ctx-billing', toNodeId: 'agg-invoice', id: 'e-1' },
        },
      ],
      rationale: 'e2e: valid graph',
    }))

    expect(response.status).toBe(201)
    const proposal = await readJson<ProposalRef & { status: string }>(response)
    expect(proposal.status).toBe('pending')
    expect(proposal.id.length).toBeGreaterThan(0)
  })

  it('rejects a proposal that violates the framework EvidenceValidator (no sourceReferences, no missing flag)', async () => {
    const wsId = await scaffold('e2e-no-evidence')

    const response = await submitProposal(wsId, proposalBody({
      operations: [{
        operation: 'addNode',
        // No metadata at all, so EvidenceValidator fires.
        payload: { type: 'command', name: 'placeOrder', id: 'cmd-1' },
      }],
      rationale: 'e2e: missing evidence',
    }))

    expect(response.status).toBe(400)
    const problem = await readJson<ProblemBody>(response)
    expect(problem.issues?.some(issue => issue.code === 'evidence.no-source-or-flag')).toBe(true)
  })

  it('rejects a proposal whose node type is not in the active ontology', async () => {
    const wsId = await scaffold('e2e-bad-type')

    const response = await submitProposal(wsId, proposalBody({
      operations: [
        { operation: 'addNode', payload: validNode({ type: 'screen', name: 'CheckoutPage', id: 'ui-1' }) },
      ],
      rationale: 'e2e: screen is not in ddd ontology',
    }))

    expect(response.status).toBe(400)
    const problem = await readJson<ProblemBody>(response)
    expect(problem.issues?.some(issue => issue.code === 'ontology.unknown-node-type')).toBe(true)
  })

  it('rejects a proposal that violates the ontology StructuralValidator (edge endpoints reversed)', async () => {
    const wsId = await scaffold('e2e-structural')

    // Contains runs boundedContext to aggregate. Reversing the endpoints trips StructuralValidator.
    const response = await submitProposal(wsId, proposalBody({
      operations: [
        { operation: 'addNode', payload: validNode({ type: 'boundedContext', name: 'X', id: 'ctx-x' }) },
        { operation: 'addNode', payload: validNode({ type: 'aggregate', name: 'Y', id: 'agg-y' }) },
        {
          operation: 'addEdge',
          payload: { type: 'contains', fromNodeId: 'agg-y', toNodeId: 'ctx-x', id: 'e-bad' },
        },
      ],
      rationale: 'e2e: reversed contains direction',
    }))

    expect(response.status).toBe(400)
    const problem = await readJson<ProblemBody>(response)
    expect(problem.issues?.some(issue => issue.code.startsWith('structural.'))).toBe(true)
  })

  it('apply path: writes nodes through StoragePlugin and surfaces them via REST', async () => {
    const wsId = await scaffold('e2e-apply')

    const createResponse = await submitProposal(wsId, proposalBody({
      operations: [
        { operation: 'addNode', payload: validNode({ type: 'command', name: 'placeOrder', id: 'cmd-place' }) },
      ],
      rationale: 'e2e: apply path',
    }))
    expect(createResponse.status).toBe(201)
    const proposal = await readJson<ProposalRef>(createResponse)

    const applyResponse = await app.request(`/workspaces/${wsId}/proposals/${proposal.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'tester' }),
    })
    expect(applyResponse.status).toBe(200)
    const applied = await readJson<{ id: string, status: string }>(applyResponse)
    expect(applied.status).toBe('applied')
    expect(applied.id).toBe(proposal.id)

    // StoragePlugin-routed ModelRepository should now expose the node.
    const nodesResponse = await app.request(`/workspaces/${wsId}/nodes`)
    expect(nodesResponse.status).toBe(200)
    const nodesBody = await readJson<NodesBody>(nodesResponse)
    const placed = nodesBody.items.find(n => n.id === 'cmd-place')
    expect(placed?.name).toBe('placeOrder')
    expect(placed?.type).toBe('command')

    const proposalRead = await app.request(`/workspaces/${wsId}/proposals/${proposal.id}`)
    const reread = await readJson<{ status: string }>(proposalRead)
    expect(reread.status).toBe('applied')
  })

  it('GET /ontology returns the active OntologyPlugin schema (ddd) — confirms ontology routes through registry', async () => {
    const wsId = await scaffold('e2e-ontology')

    const response = await app.request(`/workspaces/${wsId}/ontology`)
    expect(response.status).toBe(200)
    const body = await readJson<OntologyBody>(response)
    expect(body.ontologyId).toBe('ddd')
    expect(body.nodeTypes.some(t => t.id === 'boundedContext')).toBe(true)
    // P0 additions: actor node + performedBy edge.
    expect(body.nodeTypes.some(t => t.id === 'actor')).toBe(true)
    expect(body.edgeTypes.some(t => t.id === 'performedBy')).toBe(true)
  })

  it('artifacts: proposal persistence lands in workspace `artifacts/proposals/` (filesystem path)', async () => {
    const wsId = await scaffold('e2e-fs')

    await submitProposal(wsId, proposalBody({
      operations: [
        { operation: 'addNode', payload: validNode({ type: 'event', name: 'OrderPlaced', id: 'evt-1' }) },
      ],
      rationale: 'e2e: fs persistence',
    }))

    const pendingDir = join(braidHome, 'workspaces', 'e2e-fs', 'artifacts', 'proposals', 'pending')
    const files = await readdir(pendingDir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/\.json$/)
  })
})
