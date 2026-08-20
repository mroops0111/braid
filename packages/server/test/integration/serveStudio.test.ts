import type { OpenAPIHono } from '@hono/zod-openapi'
import type { AppDependencies } from '../../src/composeApp.js'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveSkillsDir } from '@braidhq/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeFsApp } from '../../src/composeFsApp.js'

/**
 * Serving the UI from the API process is what keeps a deployment on one origin.
 * These cover the two ways that can go wrong,
 * a static route shadowing an API prefix,
 * and the UI silently not being served at all.
 */
describe('serving Studio from the server', () => {
  let braidHome: string
  let studioRoot: string
  let deps: AppDependencies

  beforeEach(async () => {
    braidHome = await mkdtemp(join(tmpdir(), 'braid-serve-home-'))
    studioRoot = await mkdtemp(join(tmpdir(), 'braid-serve-studio-'))
    await writeFile(join(studioRoot, 'index.html'), '<!doctype html><title>Braid Studio</title>', 'utf-8')
    await mkdir(join(studioRoot, 'assets'), { recursive: true })
    await writeFile(join(studioRoot, 'assets', 'app.js'), 'console.log("studio")', 'utf-8')
  })

  afterEach(async () => {
    deps?.sourcePollingService.stopAll()
    delete process.env.BRAID_STUDIO_ROOT
    await rm(braidHome, { recursive: true, force: true }).catch(() => {})
    await rm(studioRoot, { recursive: true, force: true }).catch(() => {})
  })

  // Through the env var the deployment sets, so the wiring is under test too.
  async function build(root?: string): Promise<OpenAPIHono> {
    if (root)
      process.env.BRAID_STUDIO_ROOT = root
    deps = await composeFsApp({ braidHome })
    return createApp(deps)
  }

  it('serves the UI at the root once a studio root is configured', async () => {
    const app = await build(studioRoot)

    const response = await app.request('/')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Braid Studio')
  })

  it('serves the built assets alongside it', async () => {
    const app = await build(studioRoot)

    const response = await app.request('/assets/app.js')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('studio')
  })

  it('leaves every API prefix to its router', async () => {
    const app = await build(studioRoot)

    const health = await app.request('/health')
    const workspaces = await app.request('/workspaces')

    expect(health.status).toBe(200)
    expect(workspaces.status).toBe(200)
    expect(await workspaces.json()).toHaveProperty('items')
  })

  it('serves nothing when no studio root is configured', async () => {
    const app = await build()

    expect((await app.request('/')).status).toBe(404)
    expect((await app.request('/health')).status).toBe(200)
  })
})

/**
 * A deployment that never reaches its own Studio is the failure this guards.
 * The dev defaults have to stop applying once a real origin is named,
 * or a production server would keep trusting localhost.
 */
describe('cors origins', () => {
  let braidHome: string
  let deps: AppDependencies

  beforeEach(async () => {
    braidHome = await mkdtemp(join(tmpdir(), 'braid-cors-home-'))
  })

  afterEach(async () => {
    deps?.sourcePollingService.stopAll()
    delete process.env.BRAID_STUDIO_URL
    delete process.env.BRAID_CORS_ORIGINS
    delete process.env.BRAID_LOCAL_TRUST
    await rm(braidHome, { recursive: true, force: true }).catch(() => {})
  })

  // Naming a public origin is a deployment, and a deployment authenticates.
  function deployAt(studioUrl: string): void {
    process.env.BRAID_STUDIO_URL = studioUrl
    process.env.BRAID_LOCAL_TRUST = 'false'
  }

  async function allowedFor(origin: string): Promise<string | null> {
    deps = await composeFsApp({ braidHome })
    const app = createApp(deps)
    const response = await app.request('/health', { headers: { Origin: origin } })
    return response.headers.get('Access-Control-Allow-Origin')
  }

  it('keeps the dev origins when nothing is configured', async () => {
    expect(await allowedFor('http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('trusts the configured studio origin', async () => {
    deployAt('https://braid.internal/')

    expect(await allowedFor('https://braid.internal')).toBe('https://braid.internal')
  })

  it('stops trusting localhost once a real origin is named', async () => {
    deployAt('https://braid.internal')

    expect(await allowedFor('http://localhost:5173')).toBeNull()
  })

  it('adds the origins named explicitly, for a desktop or a second studio', async () => {
    deployAt('https://braid.internal')
    process.env.BRAID_CORS_ORIGINS = 'https://other.internal,http://localhost:5173'

    expect(await allowedFor('https://other.internal')).toBe('https://other.internal')
    expect(await allowedFor('http://localhost:5173')).toBe('http://localhost:5173')
  })
})

/**
 * A bundler collapses each module into one file,
 * so the path a package walks to reach its own `skills/` stops leading anywhere.
 * Nothing catches that until a run asks for a skill and the registry comes back empty.
 */
describe('bundled skill assets', () => {
  it('resolves the staged copy ahead of the walk to a package root', async () => {
    const staged = await mkdtemp(join(tmpdir(), 'braid-staged-'))
    await mkdir(join(staged, 'skills', 'core'), { recursive: true })

    const moduleUrl = pathToFileURL(join(staged, 'server.mjs')).href

    expect(resolveSkillsDir(moduleUrl, 'core')).toBe(join(staged, 'skills', 'core'))
    expect(resolveSkillsDir(moduleUrl, 'absent')).toBe(resolve(staged, '..', 'skills'))
  })
})

/**
 * The library default trusts every caller,
 * which is right for a laptop and catastrophic on a shared host.
 * A Studio origin outside loopback says this deployment is reachable by other people.
 */
describe('local trust on a reachable deployment', () => {
  let braidHome: string

  beforeEach(async () => {
    braidHome = await mkdtemp(join(tmpdir(), 'braid-trust-'))
    process.env.BRAID_LOCAL_TRUST = 'true'
  })

  afterEach(async () => {
    delete process.env.BRAID_LOCAL_TRUST
    delete process.env.BRAID_STUDIO_URL
    await rm(braidHome, { recursive: true, force: true }).catch(() => {})
  })

  it('refuses to boot when a public studio origin is trusted blindly', async () => {
    process.env.BRAID_STUDIO_URL = 'https://braid.internal'

    await expect(composeFsApp({ braidHome })).rejects.toThrow(/BRAID_LOCAL_TRUST/)
  })

  it('allows it on loopback, which is what a local install is', async () => {
    process.env.BRAID_STUDIO_URL = 'http://localhost:5173'
    const deps = await composeFsApp({ braidHome })
    deps.sourcePollingService.stopAll()

    expect(deps.authMode.requiresAuth).toBe(false)
  })
})
