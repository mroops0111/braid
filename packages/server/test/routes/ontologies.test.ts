import type { OntologyListResponse } from '@braidhq/schema'
import { makeOntology } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../helpers/buildApp.js'
import { readJson } from '../helpers/readJson.js'

describe('GET /ontologies', () => {
  it('returns an empty catalog when no ontology is registered', async () => {
    const { app } = await buildTestApp()
    const response = await app.request('/ontologies')
    expect(response.status).toBe(200)
    const body = await readJson<OntologyListResponse>(response)
    expect(body.ontologies).toEqual([])
  })

  it('lists each registered ontology with its declared source roles', async () => {
    const { app, deps } = await buildTestApp()
    await deps.pluginRegistry.register(makeOntology({
      ontologyId: 'ddd',
      sourceRoles: [
        { id: 'intent', label: 'Intent', required: true, unitBearing: true, pathSegment: 'intents' },
        { id: 'code', label: 'Code', required: true, pathSegment: 'codebases' },
      ],
    }))

    const response = await app.request('/ontologies')
    expect(response.status).toBe(200)
    const body = await readJson<OntologyListResponse>(response)
    expect(body.ontologies).toHaveLength(1)
    expect(body.ontologies[0]?.ontologyId).toBe('ddd')
    expect(body.ontologies[0]?.sourceRoles.map(role => role.id)).toEqual(['intent', 'code'])
    expect(body.ontologies[0]?.sourceRoles.find(role => role.id === 'intent')?.unitBearing).toBe(true)
  })
})
