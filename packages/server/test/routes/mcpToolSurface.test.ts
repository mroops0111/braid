import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../helpers/buildApp.js'
import { readJson } from '../helpers/readJson.js'

interface Operation {
  'operationId'?: string
  'x-mcp-integration'?: { tool?: Record<string, unknown> }
}

// The operations an MCP client may call, in full.
// A route added to this list is a decision about what a token buys,
// so the assertion below is an equality rather than a containment check.
const MCP_TOOLS = [
  'getModelSnapshot',
  'getNode',
  'getNodeScope',
  'getOntology',
  'listEdges',
  'listNodes',
  'listWorkspaces',
]

async function markedOperations(): Promise<{ id: string, method: string, path: string }[]> {
  const { app } = await buildTestApp()
  const doc = await readJson<{ paths: Record<string, Record<string, Operation>> }>(
    await app.request('/openapi.json'),
  )
  const marked: { id: string, method: string, path: string }[] = []
  for (const [path, pathItem] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (operation['x-mcp-integration'])
        marked.push({ id: operation.operationId ?? '', method, path })
    }
  }
  return marked
}

describe('the MCP tool surface', () => {
  it('marks exactly the read operations a client is meant to reach', async () => {
    const marked = await markedOperations()
    expect(marked.map(operation => operation.id).sort()).toEqual(MCP_TOOLS)
  })

  it('marks no operation that can change anything', async () => {
    const marked = await markedOperations()
    // Braid's writes are all POST, PATCH, or DELETE, so the method is enough.
    // A read tool that cannot mutate the graph needs far less trust.
    expect(marked.filter(operation => operation.method !== 'get')).toEqual([])
  })

  it('declares a tool on every marked operation', async () => {
    const { app } = await buildTestApp()
    const doc = await readJson<{ paths: Record<string, Record<string, Operation>> }>(
      await app.request('/openapi.json'),
    )
    // `marked_only` exposes an operation whose extension names a `tool`.
    // An extension carrying only a `resource`, or nothing,
    // would pass the count above while surfacing no tool at all.
    const operations = Object.values(doc.paths).flatMap(pathItem => Object.values(pathItem))
    const withExtension = operations.filter(operation => operation['x-mcp-integration'])
    expect(withExtension.length).toBe(MCP_TOOLS.length)
    for (const operation of withExtension)
      expect(operation['x-mcp-integration']?.tool, operation.operationId).toBeDefined()
  })

  it('keeps the host path and source config out of the workspace list tool', async () => {
    const { app } = await buildTestApp()
    const doc = await readJson<{ paths: Record<string, Record<string, Operation>> }>(
      await app.request('/openapi.json'),
    )
    // The REST response carries `rootPath` and the whole manifest,
    // which name a path on the host and the credentials-shaped source config.
    // The projection is what stops both from reaching a model.
    const shaping = doc.paths['/workspaces']?.get?.['x-mcp-integration']?.tool?.response
    expect(shaping).toBeTypeOf('string')
    expect(shaping).not.toContain('rootPath')
    expect(shaping).toContain('id')
    expect(shaping).toContain('productManifest.name')
  })
})
