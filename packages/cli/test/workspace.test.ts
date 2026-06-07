import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workspaceListCommand } from '../src/commands/workspace.js'

describe('workspaceListCommand', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders one line per workspace', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        items: [
          { id: 'alpha', rootPath: '/abs/alpha', productManifest: { name: 'Alpha', ontologyId: 'ddd' } },
          { id: 'beta', rootPath: '/abs/beta', productManifest: { name: 'Beta', ontologyId: 'redoc' } },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await workspaceListCommand({ apiUrl: 'http://localhost:4321' })

    const calls = stdoutSpy.mock.calls.map(args => String(args[0]))
    expect(calls.some(line => line.includes('alpha') && line.includes('/abs/alpha'))).toBe(true)
    expect(calls.some(line => line.includes('beta') && line.includes('redoc'))).toBe(true)
  })

  it('prints a hint when no workspaces are registered', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ items: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await workspaceListCommand({ apiUrl: 'http://localhost:4321' })
    const out = stdoutSpy.mock.calls.map(args => String(args[0])).join('')
    expect(out).toMatch(/No workspaces registered\. Create one via Studio\./)
  })
})
