import { afterEach, describe, expect, it } from 'vitest'
import { buildRunnerApp, endAllSpawned } from '../helpers/runnerApp.js'

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
async function surface(category: string, form: string = 'blocks'): Promise<Record<string, Record<string, unknown>>> {
  const key = `${category}/${form}`
  const read = surfaces.get(key)
  if (read)
    return read
  const { app } = await buildRunnerApp()
  const response = await app.request(`/openapi/runs/${category}/${form}/openapi.json`)
  expect(response.status).toBe(200)
  const document = await response.json() as { paths: Record<string, Record<string, unknown>> }
  surfaces.set(key, document.paths)
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
  it('gives every run the reads', async () => {
    for (const category of ['ask', 'build', 'generate']) {
      const ids = operations(await surface(category))
      expect(ids).toContain('listNodes')
    }
  })

  // A render call costs a place in the tool list,
  // and the tokens to describe it, whether or not it is ever made,
  // so a run is offered only the calls its own kind of work owes.
  it('offers prose and a drawing to every kind of run', async () => {
    for (const category of ['ask', 'build', 'generate']) {
      const ids = operations(await surface(category))
      expect(ids).toContain('showAnswer')
      expect(ids).toContain('showDiagram')
      expect(ids).toContain('showSubgraph')
    }
  })

  it('keeps the document calls out of an ask and a build run', async () => {
    for (const category of ['ask', 'build']) {
      const ids = operations(await surface(category))
      expect(ids).not.toContain('showSection')
      expect(ids).not.toContain('showCheck')
      expect(ids).not.toContain('showCustom')
    }
  })

  it('gives a generate run the calls a document is written from', async () => {
    const ids = operations(await surface('generate'))
    expect(ids).toContain('showSection')
    expect(ids).toContain('showCheck')
    expect(ids).toContain('showCustom')
    expect(ids).toContain('showEvidence')
  })

  // A finding is two sides disagreeing and a trail is what a run searched,
  // and a document is neither.
  it('keeps findings and trails out of a generate run', async () => {
    const ids = operations(await surface('generate'))
    expect(ids).not.toContain('showFinding')
    expect(ids).not.toContain('showTrace')
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
  it('does not ship its own markers to the gateway', async () => {
    const body = JSON.stringify(await surface('build'))
    expect(body).not.toContain('x-braid-run-categories')
    expect(body).not.toContain('x-braid-run-output-forms')
  })

  it('answers 404 for a category no skill can declare', async () => {
    const { app } = await buildRunnerApp()
    expect((await app.request('/openapi/runs/anything/blocks/openapi.json')).status).toBe(404)
  })

  // The saving is the operation never reaching the model,
  // rather than a prompt asking it to leave what it can see alone.
  it('shows a prose run no way to render', async () => {
    const ids = operations(await surface('ask', 'prose'))
    expect(ids).not.toContain('showAnswer')
    expect(ids).not.toContain('showEvidence')
    expect(ids).not.toContain('showFinding')
    expect(ids).not.toContain('showMatrix')
    expect(ids).not.toContain('showTrace')
    expect(ids).not.toContain('showDiagram')
    expect(ids).not.toContain('showSubgraph')
  })

  it('leaves a prose run everything it answers a question with', async () => {
    const prose = operations(await surface('ask', 'prose'))
    const blocks = operations(await surface('ask', 'blocks'))
    const missing = blocks.filter(id => !prose.includes(id))

    expect(prose).toContain('listNodes')
    // The render calls are the whole of the difference.
    expect(missing.every(id => id.startsWith('show'))).toBe(true)
  })

  it('answers 404 for a form no run can take', async () => {
    const { app } = await buildRunnerApp()
    expect((await app.request('/openapi/runs/ask/sonnet/openapi.json')).status).toBe(404)
  })

  // A generate run's blocks are the document rather than a rendering of it,
  // so a prose one would finish having produced nothing.
  it('refuses a prose form to a run whose blocks are its product', async () => {
    const { app } = await buildRunnerApp()
    expect((await app.request('/openapi/runs/generate/prose/openapi.json')).status).toBe(404)
  })
})
