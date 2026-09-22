import type { Surface } from '../helpers/specDescriptions.js'
import { describe, expect, it } from 'vitest'
import { buildMultiUserApp } from '../helpers/multiUser.js'
import {
  ontologyVocabularyIn,
  operationsOf,
  secondPersonIn,
  silentOperations,
  undescribedBodyFields,
  undescribedParameters,
} from '../helpers/specDescriptions.js'

/**
 * What a run's tools say about themselves, checked on the spec it is served.
 *
 * The narrowed document is what the run's gateway is given,
 * so this is the surface a skill actually meets,
 * rather than the whole spec, most of which no run can see.
 * The deployment's own MCP endpoint is the other surface,
 * checked in `mcpToolSurface.test.ts` against the same helpers.
 */

/**
 * The pairings a run is actually served, one spec each.
 *
 * Composing the app is the slow part, by an order of magnitude,
 * so a surface is read once and every check below reads the same document.
 *
 * Only a render operation carries a form marker, and it marks `blocks`,
 * so a category's prose surface is a subset of its blocks surface.
 * The three blocks surfaces are therefore every operation any run can see,
 * and `ask` with prose is here to hold that reasoning to account.
 */
const PAIRINGS = [
  { category: 'ask', form: 'prose' },
  { category: 'ask', form: 'blocks' },
  { category: 'build', form: 'blocks' },
  { category: 'generate', form: 'blocks' },
] as const

const served = new Map<string, Promise<Surface>>()

function surface(category: string, form: string): Promise<Surface> {
  const key = `${category}/${form}`
  const read = served.get(key) ?? readSurface(category, form)
  served.set(key, read)
  return read
}

/**
 * The composition a deployment actually runs, rather than a lighter one.
 *
 * Several routers mount only when the dependency behind them exists,
 * so a lighter app serves a smaller document,
 * and a field on one of those routes would go unchecked while a run is handed it.
 * A real `ask` run against `composeFsApp` was offered nineteen operations
 * that the runner harness never builds, ten of whose fields said nothing.
 */
async function readSurface(category: string, form: string): Promise<Surface> {
  const { app } = await buildMultiUserApp()
  const response = await app.request(`/openapi/runs/${category}/${form}/openapi.json`)
  expect(response.status).toBe(200)
  return await response.json() as Surface
}

describe('every field a run is asked to fill', () => {
  // What a field means belongs where every caller reads it.
  // The alternative was one skill's prompt explaining it,
  // which is how `clarificationId` came to be a rule only `clarify` knew.
  it.each(PAIRINGS)('says what it is on a $category run writing $form', async ({ category, form }) => {
    const document = await surface(category, form)
    expect(undescribedBodyFields(document, operationsOf(document))).toEqual([])
  })

  it.each(PAIRINGS)('says what it is on a $category run\'s path and query, writing $form', async ({ category, form }) => {
    const document = await surface(category, form)
    expect(undescribedParameters(operationsOf(document))).toEqual([])
  })

  // A tool with no prose at all is a name and a shape,
  // and the name is the only part a model reads before deciding.
  it.each(PAIRINGS)('says what the operation does on a $category run writing $form', async ({ category, form }) => {
    const document = await surface(category, form)
    expect(silentOperations(operationsOf(document))).toEqual([])
  })
})

describe('the prose a run is served', () => {
  it.each(PAIRINGS)('names no vocabulary only one ontology would have, on a $category run writing $form', async ({ category, form }) => {
    expect(ontologyVocabularyIn(await surface(category, form))).toEqual([])
  })

  // One description serves a model choosing a call and a person reading the API,
  // so it says what the field is rather than addressing whoever holds it.
  it.each(PAIRINGS)('addresses nobody as `you`, on a $category run writing $form', async ({ category, form }) => {
    expect(secondPersonIn(await surface(category, form))).toEqual([])
  })
})
