import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workspaceAddCommand, workspaceListCommand } from '../src/commands/workspace.js'

describe('workspaceAddCommand', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs the absolute rootPath and reports the registered workspace', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        id: 'my-product',
        rootPath: '/abs/my-product',
        productManifest: { name: 'My Product', ontologyId: 'ddd' },
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ))

    await workspaceAddCommand({ rootPath: '/abs/my-product', apiUrl: 'http://localhost:4321' })

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:4321/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('/abs/my-product'),
      }),
    )
  })

  it('surfaces problem+json detail on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ code: 'BRAID-CONFLICT', title: 'ConflictError', detail: 'workspace already registered' }),
      { status: 409, headers: { 'content-type': 'application/problem+json' } },
    ))
    await expect(workspaceAddCommand({ rootPath: '/abs/already', apiUrl: 'http://localhost:4321' }))
      .rejects
      .toThrow(/already registered/)
  })

  it('wraps a network failure into a hint about braid serve', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(workspaceAddCommand({ rootPath: '/abs/x', apiUrl: 'http://localhost:4321' }))
      .rejects
      .toThrow(/braid serve/)
  })
})

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
    expect(out).toMatch(/No workspaces registered/)
  })
})
