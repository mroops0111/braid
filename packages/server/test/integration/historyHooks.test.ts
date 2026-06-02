import type { OpenAPIHono } from '@hono/zod-openapi'
import type { AppDependencies } from '../../src/composition.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeFsApp } from '../../src/composeFs.js'
import { readJson } from '../helpers/readJson.js'

interface ProposalRef { id: string }
interface DecisionBody { action: string, references: { proposalId: string } }

/**
 * Phase-2 wiring proof: HITLService's mutation paths must land real
 * commits on the workspace's git repo. This drives the whole stack
 * (route → service → simple-git) instead of mocking history, so we
 * also catch any composition wiring regressions.
 */
describe('e2e history hooks: applying a proposal writes a commit', () => {
  let braidHome: string
  let deps: AppDependencies
  let app: OpenAPIHono
  let workspaceRoot: string
  let workspaceId: string

  beforeEach(async () => {
    braidHome = await mkdtemp(join(tmpdir(), 'braid-history-e2e-'))
    deps = await composeFsApp({ braidHome })
    app = createApp(deps)
    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'history-ws',
        manifest: { name: 'history-ws', sources: [] },
      }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ workspace: { id: string } }>(response)
    workspaceId = body.workspace.id
    workspaceRoot = join(braidHome, 'workspaces', 'history-ws')
  })

  afterEach(async () => {
    await rm(braidHome, { recursive: true, force: true }).catch(() => {})
  })

  it('appends an apply commit with Kind / Proposal-Id / Author trailers and updates graph.json', async () => {
    // Submit a minimal valid proposal: a command node with the
    // implementationMissing flag so EvidenceValidator is satisfied
    // without faking sourceReferences.
    const submit = await app.request(`/workspaces/${workspaceId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          operation: 'addNode',
          payload: {
            type: 'command',
            name: 'placeOrder',
            id: 'cmd-place',
            metadata: { sourceReferences: [], implementationMissing: true },
          },
        }],
        rationale: 'history hook e2e',
        generatedBy: 'extract',
      }),
    })
    expect(submit.status).toBe(201)
    const { id: proposalId } = await readJson<ProposalRef>(submit)

    const apply = await app.request(`/workspaces/${workspaceId}/proposals/${proposalId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'tester' }),
    })
    expect(apply.status).toBe(200)
    const decision = await readJson<DecisionBody>(apply)
    expect(decision.action).toBe('applyProposal')

    // Real `.git/` should now hold an extra commit on top of the
    // synthetic `initial:` bootstrap one. We hit simple-git directly
    // rather than the (Phase-3) history routes so the test pins the
    // disk-level effect rather than tautologising on the same code
    // path we're verifying.
    const git = simpleGit({ baseDir: workspaceRoot })
    const log = await git.log({ maxCount: 5 })
    expect(log.all.length).toBeGreaterThanOrEqual(2)
    const head = log.latest!
    expect(head.message.startsWith('proposal-apply:')).toBe(true)
    const body = await git.raw(['show', '--no-patch', '--format=%B', head.hash])
    expect(body).toContain('Kind: proposal-apply')
    expect(body).toContain(`Proposal-Id: ${proposalId}`)
    expect(body).toContain(`Author: tester`)

    // graph.json must reflect the post-mutation state — the commit's
    // tree should include the new node.
    const showPath = await git.raw(['show', `${head.hash}:artifacts/graph.json`])
    expect(showPath).toContain('"cmd-place"')
  })

  it('rejecting a proposal writes a kind=reject commit without touching graph.json', async () => {
    const submit = await app.request(`/workspaces/${workspaceId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          operation: 'addNode',
          payload: {
            type: 'command',
            name: 'rejectMe',
            id: 'cmd-rej',
            metadata: { sourceReferences: [], implementationMissing: true },
          },
        }],
        rationale: 'will be rejected',
        generatedBy: 'extract',
      }),
    })
    const { id: proposalId } = await readJson<ProposalRef>(submit)

    const reject = await app.request(`/workspaces/${workspaceId}/proposals/${proposalId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'tester', reason: 'wrong shape' }),
    })
    expect(reject.status).toBe(200)

    const git = simpleGit({ baseDir: workspaceRoot })
    const head = (await git.log({ maxCount: 1 })).latest!
    expect(head.message.startsWith('proposal-reject:')).toBe(true)
    const body = await git.raw(['show', '--no-patch', '--format=%B', head.hash])
    expect(body).toContain('Kind: proposal-reject')
    expect(body).toContain(`Proposal-Id: ${proposalId}`)
    // graph.json shouldn't appear in the diff because reject doesn't
    // mutate Kùzu nor call the graph serialiser.
    const changed = await git.raw(['show', '--name-only', '--format=', head.hash])
    expect(changed).not.toContain('graph.json')
  })
})
