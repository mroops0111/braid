import { ConflictError, NotFoundError, ValidationError } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/buildApp.js'
import { readJson } from './helpers/readJson.js'

interface HealthBody {
  status: string
  service: string
  timestamp: string
}

interface ProblemBody {
  code: string
  title: string
  detail?: string
}

describe('GET /health', () => {
  it('returns service status payload', async () => {
    const response = await (await buildTestApp()).app.request('/health')
    expect(response.status).toBe(200)
    const body = await readJson<HealthBody>(response)
    expect(body.status).toBe('ok')
    expect(body.service).toBe('braid-server')
    expect(typeof body.timestamp).toBe('string')
  })
})

describe('error middleware', () => {
  it('maps ValidationError to 400 problem+json', async () => {
    const { app } = await buildTestApp()
    app.get('/boom-val', () => {
      throw new ValidationError('bad input')
    })
    const response = await app.request('/boom-val')
    expect(response.status).toBe(400)
    expect(response.headers.get('Content-Type')).toContain('application/problem+json')
    const body = await readJson<ProblemBody>(response)
    expect(body.code).toBe('BRAID-VAL')
    expect(body.title).toBe('ValidationError')
  })

  it('maps NotFoundError to 404', async () => {
    const { app } = await buildTestApp()
    app.get('/boom-nf', () => {
      throw new NotFoundError('missing')
    })
    const response = await app.request('/boom-nf')
    expect(response.status).toBe(404)
    const body = await readJson<ProblemBody>(response)
    expect(body.code).toBe('BRAID-NOT-FOUND')
  })

  it('maps ConflictError to 409', async () => {
    const { app } = await buildTestApp()
    app.get('/boom-cf', () => {
      throw new ConflictError('dup')
    })
    const response = await app.request('/boom-cf')
    expect(response.status).toBe(409)
    const body = await readJson<ProblemBody>(response)
    expect(body.code).toBe('BRAID-CONFLICT')
  })

  it('maps unknown error to 500 internal problem', async () => {
    const { app } = await buildTestApp()
    app.get('/boom', () => {
      throw new Error('something else')
    })
    const response = await app.request('/boom')
    expect(response.status).toBe(500)
    const body = await readJson<ProblemBody>(response)
    expect(body.code).toBe('BRAID-INTERNAL')
    expect(body.detail).toBe('something else')
  })
})
