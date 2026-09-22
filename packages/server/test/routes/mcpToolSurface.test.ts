import type { Operation as SpecOperation, Surface } from '../helpers/specDescriptions.js'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../helpers/buildApp.js'
import { readJson } from '../helpers/readJson.js'
import {
  ontologyVocabularyIn,
  operationsOf,
  secondPersonIn,
  silentOperations,
  undescribedBodyFields,
  undescribedParameters,
} from '../helpers/specDescriptions.js'

interface Operation {
  'operationId'?: string
  'x-mcp-integration'?: { tool?: Record<string, unknown> }
}

// The operations an MCP client may call, in full.
// A route added to this list is a decision about what a token buys,
// so the assertion below is an equality rather than a containment check.
const MCP_TOOLS = [
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
    // `annotated_only` exposes an operation whose extension names a `tool`.
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

/**
 * The tools the deployment's own endpoint hands a client, and what they say.
 *
 * The other tool surface is the narrowed spec a run is given,
 * checked in `runToolSurfaceDescriptions.test.ts` against the same helpers.
 * This one is served to whoever holds a token,
 * a client Braid did not write and cannot send a prompt to,
 * so the spec is the whole of what its model will ever know about these tools.
 */
describe('what the MCP tools say about themselves', () => {
  async function toolOperations(): Promise<{ document: Surface, operations: Array<{ id: string, operation: SpecOperation }> }> {
    const { app } = await buildTestApp()
    const document = await readJson<Surface>(await app.request('/openapi.json'))
    const operations = operationsOf(document)
      .filter(({ operation }) => operation['x-mcp-integration'] !== undefined)
    expect(operations.map(({ id }) => id).sort()).toEqual(MCP_TOOLS)
    return { document, operations }
  }

  it('says what every path and query parameter is', async () => {
    const { operations } = await toolOperations()
    expect(undescribedParameters(operations)).toEqual([])
  })

  // Reads only today, and the rule holds for whatever is marked next.
  it('says what every body field is', async () => {
    const { document, operations } = await toolOperations()
    expect(undescribedBodyFields(document, operations)).toEqual([])
  })

  it('says what every tool is for', async () => {
    const { operations } = await toolOperations()
    expect(silentOperations(operations)).toEqual([])
  })

  // A summary is written for somebody reading the REST API,
  // who already knows what Braid is and what a node is.
  // A client on this endpoint was handed a token and nothing else,
  // so the tool's own line is the whole of what its model will ever know,
  // and falling back to a summary is a line that was never aimed at it.
  it('writes that line for a model rather than falling back to the summary', async () => {
    const { operations } = await toolOperations()
    const unwritten = operations
      .filter(({ operation }) => {
        const integration = operation['x-mcp-integration'] as { tool?: { description?: unknown } } | undefined
        const written = integration?.tool?.description
        return !(typeof written === 'string' && written.trim().length > 0)
      })
      .map(({ id }) => id)
      .sort()
    expect(unwritten).toEqual([])
  })

  // These tools serve whatever ontology the workspace behind them declares.
  it('names no vocabulary only one ontology would have', async () => {
    const { operations } = await toolOperations()
    expect(ontologyVocabularyIn(operations.map(({ operation }) => operation))).toEqual([])
  })

  it('addresses nobody as `you`', async () => {
    const { operations } = await toolOperations()
    expect(secondPersonIn(operations.map(({ operation }) => operation))).toEqual([])
  })
})
