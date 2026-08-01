import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mutable stand-in for the remotes store, so each case can set the active
// remote and the registered list without touching real localStorage.
const remotesState = vi.hoisted(() => ({
  activeId: 'local',
  remotes: [] as { id: string, url: string }[],
}))

vi.mock('../../src/lib/remotes', () => ({
  LOCAL_REMOTE_ID: 'local',
  getActiveRemoteId: () => remotesState.activeId,
  listRemotes: () => remotesState.remotes,
}))

const { DEFAULT_SERVER_URL, getServerUrl, getServerUrlFor, isTauriRuntime } = await import('../../src/lib/serverUrl')

beforeEach(() => {
  remotesState.activeId = 'local'
  remotesState.remotes = []
})

describe('getServerUrl', () => {
  it('falls back to the default when the active remote is Local', () => {
    expect(getServerUrl()).toBe(DEFAULT_SERVER_URL)
  })

  it('returns the active remote url when one is selected', () => {
    remotesState.activeId = 'r1'
    remotesState.remotes = [{ id: 'r1', url: 'https://team.example.com' }]
    expect(getServerUrl()).toBe('https://team.example.com')
  })

  it('falls back to the default when the active remote was removed externally', () => {
    remotesState.activeId = 'ghost'
    remotesState.remotes = []
    expect(getServerUrl()).toBe(DEFAULT_SERVER_URL)
  })
})

describe('getServerUrlFor', () => {
  it('resolves Local to the default url', () => {
    expect(getServerUrlFor('local')).toBe(DEFAULT_SERVER_URL)
  })

  it('resolves a known remote id to its url', () => {
    remotesState.remotes = [{ id: 'r1', url: 'https://team.example.com' }]
    expect(getServerUrlFor('r1')).toBe('https://team.example.com')
  })

  it('resolves an unknown remote id to the default url', () => {
    expect(getServerUrlFor('missing')).toBe(DEFAULT_SERVER_URL)
  })
})

describe('isTauriRuntime', () => {
  it('is false outside a Tauri shell', () => {
    expect(isTauriRuntime()).toBe(false)
  })
})
