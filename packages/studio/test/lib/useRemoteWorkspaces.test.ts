import type { Workspace } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../src/lib/api'
import { classifyRemoteResult, type RemoteSummary } from '../../src/lib/useRemoteWorkspaces'

const LOCAL: RemoteSummary = { id: 'local', name: 'Local', url: 'http://localhost:4321', isLocal: true }
const REMOTE: RemoteSummary = { id: 'r-team', name: 'team', url: 'https://team.example.com', isLocal: false }

function ws(id: string): Workspace {
  return { id, rootPath: '/tmp', members: [] } as unknown as Workspace
}

describe('classifyRemoteResult', () => {
  it('skips remotes that have no stored token before considering the query state', () => {
    const result = classifyRemoteResult(REMOTE, {
      hasToken: false,
      isPending: false,
      error: undefined,
      data: undefined,
    })
    expect(result.state.kind).toBe('unauthenticated')
  })

  it('does not skip Local when there is no token, since X-Braid-User covers local trust mode', () => {
    const result = classifyRemoteResult(LOCAL, {
      hasToken: false,
      isPending: false,
      error: undefined,
      data: { items: [ws('braid')] },
    })
    expect(result.state).toEqual({ kind: 'ok', workspaces: [ws('braid')] })
  })

  it('reports loading before the first response settles', () => {
    const result = classifyRemoteResult(LOCAL, {
      hasToken: true,
      isPending: true,
      error: undefined,
      data: undefined,
    })
    expect(result.state.kind).toBe('loading')
  })

  it('collapses 401 to unauthenticated so the sidebar prompts a re-sign-in', () => {
    const result = classifyRemoteResult(REMOTE, {
      hasToken: true,
      isPending: false,
      error: new ApiError('Unauthorized', 401),
      data: undefined,
    })
    expect(result.state.kind).toBe('unauthenticated')
  })

  it('surfaces non-401 errors with their message so the user can see what is wrong', () => {
    const result = classifyRemoteResult(REMOTE, {
      hasToken: true,
      isPending: false,
      error: new Error('Network unreachable'),
      data: undefined,
    })
    expect(result.state).toEqual({ kind: 'error', message: 'Network unreachable' })
  })

  it('returns the workspace list on success', () => {
    const result = classifyRemoteResult(REMOTE, {
      hasToken: true,
      isPending: false,
      error: undefined,
      data: { items: [ws('alpha'), ws('beta')] },
    })
    expect(result.state).toEqual({ kind: 'ok', workspaces: [ws('alpha'), ws('beta')] })
  })

  it('treats missing data as an empty workspace list rather than crashing', () => {
    const result = classifyRemoteResult(REMOTE, {
      hasToken: true,
      isPending: false,
      error: undefined,
      data: undefined,
    })
    expect(result.state).toEqual({ kind: 'ok', workspaces: [] })
  })
})
