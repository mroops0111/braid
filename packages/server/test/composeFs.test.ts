import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { composeFsApp } from '../src/composeFs.js'

async function makeTelosHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'telos-home-'))
}

async function seedWorkspaceDir(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `telos-ws-${name}-`))
  const manifest = `---
name: ${name}
agents:
  default: claude-default
storage:
  kind: in-memory
  config: {}
---
# Test workspace`
  await writeFile(join(dir, 'PRODUCT.md'), manifest, 'utf-8')
  await mkdir(join(dir, 'artifacts'), { recursive: true })
  return dir
}

describe('composeFsApp', () => {
  it('createApp with composeFsApp serves health endpoint', async () => {
    const telosHome = await makeTelosHome()
    const app = createApp(composeFsApp({ telosHome }))

    const response = await app.request('/health')
    expect(response.status).toBe(200)
  })

  it('persists workspace registration across compose calls (same TELOS_HOME)', async () => {
    const telosHome = await makeTelosHome()
    const wsDir = await seedWorkspaceDir('persist-demo')

    const firstApp = createApp(composeFsApp({ telosHome }))
    const registerResponse = await firstApp.request('/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath: wsDir }),
    })
    expect(registerResponse.status).toBe(201)

    // Fresh compose with same TELOS_HOME — workspace should still be visible
    const secondApp = createApp(composeFsApp({ telosHome }))
    const listResponse = await secondApp.request('/workspaces')
    const body = await listResponse.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].productManifest.name).toBe('persist-demo')
  })

  it('exposes skill route once skill runner is wired', async () => {
    const telosHome = await makeTelosHome()
    const wsDir = await seedWorkspaceDir('skills-demo')

    const app = createApp(composeFsApp({ telosHome }))
    await app.request('/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath: wsDir }),
    })

    const response = await app.request('/workspaces/skills-demo/skills')
    expect(response.status).toBe(200)
    const body = await response.json()
    const ids = (body.items as Array<{ id: string }>).map(item => item.id).sort()
    expect(ids).toEqual(['telos-ask', 'telos-clarify', 'telos-extract', 'telos-generate-doc'])
  })

  it('POST /workspaces/scaffold rolls back PRODUCT.md and registry on ingest failure', async () => {
    // A source whose loader.kind isn't registered makes
    // SourceLoaderRunner.ingestAll throw. Verify the route catches it,
    // removes the just-written PRODUCT.md, and leaves the registry empty
    // so a retry doesn't trip on "PRODUCT.md already exists".
    const telosHome = await makeTelosHome()
    const wsDir = await mkdtemp(join(tmpdir(), 'telos-scaffold-rollback-'))
    const app = createApp(composeFsApp({ telosHome }))

    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rootPath: wsDir,
        manifest: {
          name: 'rollback-demo',
          sources: [{
            kind: 'filesystem',
            id: 'intent',
            role: 'intent',
            name: 'intent',
            path: './intent',
            loader: { kind: 'this-loader-does-not-exist', config: {} },
          }],
        },
      }),
    })

    expect(response.status).toBeGreaterThanOrEqual(400)

    await expect(stat(join(wsDir, 'PRODUCT.md'))).rejects.toThrow(/ENOENT/)

    const listResponse = await app.request('/workspaces')
    const list = await listResponse.json() as { items: unknown[] }
    expect(list.items).toEqual([])
  })
})
