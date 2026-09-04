import type { NodeId, NodeTypeId, WorkspaceId } from '@braidhq/schema'
import { PluginRegistry } from '@braidhq/core'
import { dddOntology } from '@braidhq/ontology-ddd'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../helpers/buildApp.js'

const WORKSPACE = 'w-1' as WorkspaceId

/** The ontology a fresh test workspace names by default. */
function withDdd(): PluginRegistry {
  const registry = new PluginRegistry()
  registry.register(dddOntology)
  return registry
}

describe('node type filter validation', () => {
  it('refuses a type the workspace ontology does not define, and says what it does', async () => {
    // Answering 200 with an empty list makes a typo indistinguishable from a
    // true absence, which leaves a caller with nothing to correct and a model
    // believing the graph holds no such nodes.
    const { app } = await buildTestApp({ pluginRegistry: withDdd() })
    const response = await app.request(`/workspaces/${WORKSPACE}/nodes?type=agregate`)

    expect(response.status).toBe(400)
    const body = await response.json() as { detail?: string }
    expect(body.detail).toContain('agregate')
    // The message carries the vocabulary, so one round trip is enough to fix.
    expect(body.detail).toContain('aggregate')
  })

  it('accepts a type the ontology defines', async () => {
    const { app, deps } = await buildTestApp({ pluginRegistry: withDdd() })
    await deps.modelRepository.applyOperations(WORKSPACE, [{
      operation: 'addNode',
      payload: { type: 'aggregate' as NodeTypeId, name: 'Task', id: 'n-1' as NodeId, status: 'draft' },
    }])
    const response = await app.request(`/workspaces/${WORKSPACE}/nodes?type=aggregate`)
    expect(response.status).toBe(200)
  })

  it('leaves an unfiltered read alone, since there is no type to check', async () => {
    const { app } = await buildTestApp({ pluginRegistry: withDdd() })
    expect((await app.request(`/workspaces/${WORKSPACE}/nodes`)).status).toBe(200)
  })
})
