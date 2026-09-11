import { afterEach, describe, expect, it } from 'vitest'
import { buildRunnerApp, endAllSpawned } from '../helpers/runnerApp.js'

// Every render call Braid publishes.
// A run that cannot reach one of them has no way to say that shape of thing,
// so the whole list is checked rather than one example of it.
const RENDER_TOOLS = [
  'showAnswer',
  'showDiagram',
  'showEvidence',
  'showFinding',
  'showMatrix',
  'showSubgraph',
  'showTrace',
]

/**
 * One document per category, read once and kept.
 *
 * Composing the app and generating the document is the slow part here,
 * by an order of magnitude over the checks that read the result,
 * and the document a category gets does not change between them.
 * Reading it per check was the same work nine times over,
 * which is what put this file within reach of the default timeout on CI.
 */
const surfaces = new Map<string, Record<string, Record<string, unknown>>>()

// The full composition,
// because the render operations only reach the document with a runner wired,
// and they are half of what a run is offered.
async function surface(category: string): Promise<Record<string, Record<string, unknown>>> {
  const read = surfaces.get(category)
  if (read)
    return read
  const { app } = await buildRunnerApp()
  const response = await app.request(`/openapi/runs/${category}/openapi.json`)
  expect(response.status).toBe(200)
  const document = await response.json() as { paths: Record<string, Record<string, unknown>> }
  surfaces.set(category, document.paths)
  return document.paths
}

function operations(paths: Record<string, Record<string, unknown>>): string[] {
  return Object.values(paths).flatMap(item =>
    Object.entries(item)
      .filter(([, value]) => typeof value === 'object' && value !== null && 'operationId' in (value as object))
      .map(([, value]) => (value as { operationId: string }).operationId),
  )
}

describe('the spec a run is given', () => {
  afterEach(endAllSpawned)

  // A run's tools come from its spec,
  // so a question about what a kind of run may do is answered once, here,
  // rather than by every handler learning who is calling it.
  it('keeps proposing and clarifying out of an ask run', async () => {
    const ids = operations(await surface('ask'))
    expect(ids).not.toContain('createProposal')
    expect(ids).not.toContain('createClarification')
    expect(ids).not.toContain('reportNoClarification')
  })

  it('gives a build run the calls it exists to make', async () => {
    const ids = operations(await surface('build'))
    expect(ids).toContain('createProposal')
    expect(ids).toContain('createClarification')
    expect(ids).toContain('reportNoClarification')
  })

  // Reads carry no marking,
  // which keeps the marking to the operations that actually need narrowing.
  it('gives every run the reads, and every render call', async () => {
    for (const category of ['ask', 'build', 'generate']) {
      const ids = operations(await surface(category))
      expect(ids).toContain('listNodes')
      for (const tool of RENDER_TOOLS)
        expect(ids).toContain(tool)
    }
  })

  // Applying and rejecting are decisions a person makes.
  it('offers no run the calls that settle a review', async () => {
    for (const category of ['ask', 'build', 'generate']) {
      const ids = operations(await surface(category))
      expect(ids).not.toContain('applyProposal')
      expect(ids).not.toContain('rejectProposal')
      expect(ids).not.toContain('answerClarification')
      expect(ids).not.toContain('skipClarification')
      expect(ids).not.toContain('deferClarification')
    }
  })

  // Braid's own bookkeeping, answered by the time the document is built.
  it('does not ship its own marker to the gateway', async () => {
    const body = JSON.stringify(await surface('build'))
    expect(body).not.toContain('x-braid-run-categories')
  })

  it('answers 404 for a category no skill can declare', async () => {
    const { app } = await buildRunnerApp()
    expect((await app.request('/openapi/runs/anything/openapi.json')).status).toBe(404)
  })
})
