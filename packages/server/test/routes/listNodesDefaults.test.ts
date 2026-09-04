import type { NodeId, NodeTypeId, WorkspaceId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../helpers/buildApp.js'

const WORKSPACE = 'w-1' as WorkspaceId
const COMMAND = 'command' as NodeTypeId

interface NodeList {
  items: { id: string }[]
  total: number
}

interface Parameter {
  name: string
  schema: { type?: string, default?: unknown, anyOf?: unknown[] }
  description?: string
}

describe('listNodes defaults', () => {
  it('caps how much one call can cost, whatever the caller asks for', async () => {
    const { app } = await buildTestApp()
    const spec = await (await app.request('/openapi.json')).json() as {
      paths: Record<string, Record<string, { parameters: Parameter[] }>>
    }
    const limit = spec.paths['/workspaces/{workspaceId}/nodes']!.get!.parameters.find(p => p.name === 'limit')
    // Reading the whole graph is what the snapshot is for, so a caller
    // cannot get there one large page at a time either.
    expect((limit?.schema as { maximum?: number }).maximum).toBe(100)
  })

  it('declares semantic as the boolean it means, not the string it arrives as', async () => {
    const { app } = await buildTestApp()
    const spec = await (await app.request('/openapi.json')).json() as {
      paths: Record<string, Record<string, { parameters: Parameter[] }>>
    }
    const parameters = spec.paths['/workspaces/{workspaceId}/nodes']!.get!.parameters
    // A query parameter arrives as a string, but the schema says what it
    // means, and a model reading `string` has to guess the spelling of true.
    expect(parameters.find(p => p.name === 'semantic')?.schema.type).toBe('boolean')
    // Descriptions are the whole of what a model has to go on, and they
    // vanish silently when two copies of zod-to-openapi race to install
    // `.openapi()`, so their presence is worth asserting rather than assuming.
    for (const name of ['q', 'semantic', 'limit', 'type', 'status'])
      expect(parameters.find(p => p.name === name)?.description, name).toBeTruthy()
  })

  it('caps an unfiltered read, and says how many it left behind', async () => {
    const { app, deps } = await buildTestApp()
    await deps.modelRepository.applyOperations(WORKSPACE, Array.from({ length: 25 }, (_, index) => ({
      operation: 'addNode' as const,
      payload: { type: COMMAND, name: `task${index}`, id: `n-${index}` as NodeId, status: 'draft' as const },
    })))

    const body = await (await app.request(`/workspaces/${WORKSPACE}/nodes`)).json() as NodeList

    // Unfiltered, this endpoint used to return the whole graph.
    expect(body.items).toHaveLength(20)
    // And the caller can tell that it did, which is what decides whether the
    // next move is to read on or to narrow the query.
    expect(body.total).toBe(25)
  })

  it('ranks by meaning without being asked, where a backend can', async () => {
    // No embedding service is wired here, so the flag is inert and the
    // substring pass answers. What matters is that the default is on, so a
    // caller gets the better ranking without knowing the parameter exists.
    const { app } = await buildTestApp()
    const spec = await (await app.request('/openapi.json')).json() as {
      paths: Record<string, Record<string, { parameters: (Parameter & { schema: { default?: unknown } })[] }>>
    }
    const semantic = spec.paths['/workspaces/{workspaceId}/nodes']!.get!.parameters.find(p => p.name === 'semantic')
    expect(semantic?.schema.default).toBe(true)
  })
})
