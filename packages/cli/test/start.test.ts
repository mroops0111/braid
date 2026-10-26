import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startCommand } from '../src/commands/start.js'

// Hoisted with the mocks, above the static imports, so it imports what it needs itself.
const { startServer, builtStudio } = await vi.hoisted(async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  // A Studio build with an index.html, standing in for the published assets.
  const builtStudio = mkdtempSync(join(tmpdir(), 'braid-studio-'))
  writeFileSync(join(builtStudio, 'index.html'), '<!doctype html>')
  const startServer = vi.fn(async (options: { onListen?: (url: string) => void }) => {
    options.onListen?.('http://localhost:4321')
  })
  return { startServer, builtStudio }
})

vi.mock('@braidhq/server', () => ({ loadRootEnv: () => {}, startServer }))
vi.mock('@braidhq/studio/assets', () => ({ studioAssetsDir: builtStudio }))

describe('startCommand', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    delete process.env.BRAID_STUDIO_ROOT
    delete process.env.BRAID_STUDIO_URL
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => {
    process.env = { ...saved }
    startServer.mockClear()
    vi.restoreAllMocks()
  })

  it('serves the published Studio from the server port', async () => {
    await startCommand({ port: 4321 })

    expect(process.env.BRAID_STUDIO_ROOT).toBe(builtStudio)
    expect(process.env.BRAID_STUDIO_URL).toBe('http://localhost:4321')
    expect(startServer).toHaveBeenCalledWith(expect.objectContaining({ port: 4321 }))
  })

  it('keeps a Studio root and origin the caller already set', async () => {
    process.env.BRAID_STUDIO_ROOT = builtStudio
    process.env.BRAID_STUDIO_URL = 'https://braid.example.com'

    await startCommand({ port: 8080 })

    expect(process.env.BRAID_STUDIO_URL).toBe('https://braid.example.com')
  })

  it('refuses to start without a built Studio', async () => {
    process.env.BRAID_STUDIO_ROOT = mkdtempSync(join(tmpdir(), 'braid-empty-'))

    await expect(startCommand({ port: 4321 })).rejects.toThrow(/No built Studio/)
    expect(startServer).not.toHaveBeenCalled()
  })
})
