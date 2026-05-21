import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { composeFsApp } from '../src/composeFs.js'
import { readJson } from './helpers/readJson.js'

interface WorkspaceListBody {
  items: Array<{ id: string, productManifest: { name: string } }>
}

interface SkillsListBody {
  items: Array<{ id: string }>
}

async function makeBraidHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'braid-home-'))
}

async function seedWorkspaceDir(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `braid-ws-${name}-`))
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
    const braidHome = await makeBraidHome()
    const app = createApp(await composeFsApp({ braidHome }))

    const response = await app.request('/health')
    expect(response.status).toBe(200)
  })

  it('auto-discovers workspaces sitting under <braidHome>/workspaces/ on boot', async () => {
    // CLI-created workspaces, scaffold orphans, and copies-from-another-
    // machine end up at the canonical path but are not in workspaces.json.
    // composeFsApp must surface them without requiring an explicit register.
    const braidHome = await makeBraidHome()
    const discoveredDir = join(braidHome, 'workspaces', 'auto-discovered')
    await mkdir(discoveredDir, { recursive: true })
    await writeFile(
      join(discoveredDir, 'PRODUCT.md'),
      `---
name: auto-discovered
agents:
  default: claude-default
storage:
  kind: in-memory
  config: {}
---
# Auto`,
      'utf-8',
    )

    const app = createApp(await composeFsApp({ braidHome }))

    const listResponse = await app.request('/workspaces')
    const body = await readJson<WorkspaceListBody>(listResponse)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.productManifest.name).toBe('auto-discovered')
  })

  it('DELETE ?purge=true removes the workspace folder so auto-discover does not bring it back', async () => {
    // The auto-discover-on-boot loop is exactly why plain unregister
    // isn't enough for canonical-root workspaces: the folder is right
    // there with a PRODUCT.md, so the next composeFsApp would register
    // it again. Purge is the only way to fully rebuild from scratch.
    const braidHome = await makeBraidHome()
    const wsDir = join(braidHome, 'workspaces', 'purge-me')
    await mkdir(wsDir, { recursive: true })
    await writeFile(
      join(wsDir, 'PRODUCT.md'),
      `---
name: purge-me
agents:
  default: claude-default
storage:
  kind: in-memory
  config: {}
---
# Purge`,
      'utf-8',
    )

    const firstApp = createApp(await composeFsApp({ braidHome }))
    let list = await readJson<WorkspaceListBody>(await firstApp.request('/workspaces'))
    expect(list.items).toHaveLength(1)

    const purge = await firstApp.request('/workspaces/purge-me?purge=true', { method: 'DELETE' })
    expect(purge.status).toBe(204)
    await expect(stat(wsDir)).rejects.toThrow(/ENOENT/)

    // Boot afresh; auto-discover should find nothing (folder gone).
    const secondApp = createApp(await composeFsApp({ braidHome }))
    list = await readJson<WorkspaceListBody>(await secondApp.request('/workspaces'))
    expect(list.items).toHaveLength(0)
  })

  it('DELETE ?purge=true refuses workspaces outside the canonical root', async () => {
    // Arbitrary-path workspaces register via POST /workspaces with a
    // custom rootPath (e.g. PRODUCT.md committed inside the user's own
    // repo). We must not rm those directories on the user's behalf.
    const braidHome = await makeBraidHome()
    const arbitraryDir = await seedWorkspaceDir('arbitrary')
    const app = createApp(await composeFsApp({ braidHome }))
    await app.request('/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath: arbitraryDir }),
    })

    const response = await app.request('/workspaces/arbitrary?purge=true', { method: 'DELETE' })
    expect(response.status).toBe(400)
    // Folder must still exist.
    await expect(stat(arbitraryDir)).resolves.toBeTruthy()
  })

  it('persists workspace registration across compose calls (same BRAID_HOME)', async () => {
    const braidHome = await makeBraidHome()
    const wsDir = await seedWorkspaceDir('persist-demo')

    const firstApp = createApp(await composeFsApp({ braidHome }))
    const registerResponse = await firstApp.request('/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath: wsDir }),
    })
    expect(registerResponse.status).toBe(201)

    // Fresh compose with same BRAID_HOME — workspace should still be visible
    const secondApp = createApp(await composeFsApp({ braidHome }))
    const listResponse = await secondApp.request('/workspaces')
    const body = await readJson<WorkspaceListBody>(listResponse)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.productManifest.name).toBe('persist-demo')
  })

  it('exposes skill route once skill runner is wired', async () => {
    const braidHome = await makeBraidHome()
    const wsDir = await seedWorkspaceDir('skills-demo')

    const app = createApp(await composeFsApp({ braidHome }))
    await app.request('/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath: wsDir }),
    })

    const response = await app.request('/workspaces/skills-demo/skills')
    expect(response.status).toBe(200)
    const body = await readJson<SkillsListBody>(response)
    const ids = body.items.map(item => item.id).sort()
    expect(ids).toEqual(['braid-ask', 'braid-clarify', 'braid-extract', 'braid-generate-doc', 'braid-model'])
  })

  it('POST /workspaces/scaffold rolls back PRODUCT.md and registry on ingest failure', async () => {
    // A source whose loader.kind isn't registered makes
    // SourceLoaderRunner.ingestAll throw. Verify the route catches it,
    // removes the just-written PRODUCT.md, and leaves the registry empty
    // so a retry doesn't trip on "PRODUCT.md already exists".
    const braidHome = await makeBraidHome()
    const app = createApp(await composeFsApp({ braidHome }))

    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'rollback-demo',
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

    const wsDir = join(braidHome, 'workspaces', 'rollback-demo')
    await expect(stat(join(wsDir, 'PRODUCT.md'))).rejects.toThrow(/ENOENT/)

    const listResponse = await app.request('/workspaces')
    const list = await readJson<{ items: unknown[] }>(listResponse)
    expect(list.items).toEqual([])
  })
})
