import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { composeFsApp } from '../src/composeFsApp.js'
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

async function seedWorkspaceDir(braidHome: string, name: string): Promise<string> {
  const dir = join(braidHome, 'workspaces', name)
  await mkdir(dir, { recursive: true })
  const manifest = `---
name: ${name}
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
    // CLI-created workspaces, scaffold orphans, machine-to-machine copies,
    // all land at the canonical path but aren't in workspaces.json.
    // composeFsApp must surface them without an explicit register.
    const braidHome = await makeBraidHome()
    const discoveredDir = join(braidHome, 'workspaces', 'auto-discovered')
    await mkdir(discoveredDir, { recursive: true })
    await writeFile(
      join(discoveredDir, 'PRODUCT.md'),
      `---
name: auto-discovered
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
    // Auto-discover-on-boot is why plain unregister isn't enough here. The folder sits there with a PRODUCT.md,
    // so the next boot re-registers it. Purge is the only way to fully rebuild from scratch.
    const braidHome = await makeBraidHome()
    const wsDir = join(braidHome, 'workspaces', 'purge-me')
    await mkdir(wsDir, { recursive: true })
    await writeFile(
      join(wsDir, 'PRODUCT.md'),
      `---
name: purge-me
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

    // Boot afresh, auto-discover should find nothing (folder gone).
    const secondApp = createApp(await composeFsApp({ braidHome }))
    list = await readJson<WorkspaceListBody>(await secondApp.request('/workspaces'))
    expect(list.items).toHaveLength(0)
  })

  it('persists workspace registration across compose calls (same BRAID_HOME)', async () => {
    const braidHome = await makeBraidHome()
    await seedWorkspaceDir(braidHome, 'persist-demo')

    const firstApp = createApp(await composeFsApp({ braidHome }))
    const firstList = await readJson<WorkspaceListBody>(await firstApp.request('/workspaces'))
    expect(firstList.items).toHaveLength(1)

    const secondApp = createApp(await composeFsApp({ braidHome }))
    const body = await readJson<WorkspaceListBody>(await secondApp.request('/workspaces'))
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.productManifest.name).toBe('persist-demo')
  })

  it('exposes skill route once skill runner is wired', async () => {
    const braidHome = await makeBraidHome()
    await seedWorkspaceDir(braidHome, 'skills-demo')

    const app = createApp(await composeFsApp({ braidHome }))

    const response = await app.request('/workspaces/skills-demo/skills')
    expect(response.status).toBe(200)
    const body = await readJson<SkillsListBody>(response)
    const ids = body.items.map(item => item.id).sort()
    expect(ids).toEqual(['braid:ask', 'braid:generate-doc', 'braid:scan', 'ddd:clarify', 'ddd:extract', 'ddd:reconcile'])
  })

  it('POST /workspaces/scaffold rolls back PRODUCT.md and registry on provision failure', async () => {
    // A source with an unregistered loader.kind makes provisionAll throw. Verify the route catches it,
    // removes the just-written PRODUCT.md, and leaves the registry empty so a retry doesn't hit "already exists".
    const braidHome = await makeBraidHome()
    const app = createApp(await composeFsApp({ braidHome }))

    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'rollback-demo',
        manifest: {
          name: 'rollback-demo',
          sources: [
            {
              kind: 'filesystem',
              id: 'intent',
              role: 'intent',
              name: 'intent',
              path: './intent',
              loader: { kind: 'this-loader-does-not-exist', config: {} },
            },
            {
              kind: 'filesystem',
              id: 'code',
              role: 'code',
              name: 'code',
              path: './code',
              loader: { kind: 'this-loader-does-not-exist', config: {} },
            },
          ],
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
