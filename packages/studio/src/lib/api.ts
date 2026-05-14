import type {
  ClarifyTicket,
  Decision,
  GraphEdge,
  GraphNode,
  ModelSnapshot,
  Proposal,
  RunRecord,
  SkillManifest,
  Workspace,
} from '@telos/schema'

const baseUrl = import.meta.env.VITE_TELOS_API_URL ?? 'http://localhost:4321'

export interface ItemList<T> { items: T[] }

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}: ${detail}`)
  }
  return response.json() as Promise<T>
}

export const api = {
  listWorkspaces: () => fetchJson<ItemList<Workspace>>('/workspaces'),
  registerWorkspace: (rootPath: string) =>
    fetchJson<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify({ rootPath }) }),

  listSkills: (workspaceId: string) =>
    fetchJson<ItemList<SkillManifest>>(`/workspaces/${workspaceId}/skills`),

  modelSnapshot: (workspaceId: string) =>
    fetchJson<ModelSnapshot>(`/workspaces/${workspaceId}/model/snapshot`),

  listNodes: (workspaceId: string) =>
    fetchJson<ItemList<GraphNode>>(`/workspaces/${workspaceId}/nodes`),

  listEdges: (workspaceId: string) =>
    fetchJson<ItemList<GraphEdge>>(`/workspaces/${workspaceId}/edges`),

  listProposals: (workspaceId: string, status?: string) => {
    const query = status ? `?status=${status}` : ''
    return fetchJson<ItemList<Proposal>>(`/workspaces/${workspaceId}/proposals${query}`)
  },
  applyProposal: (workspaceId: string, proposalId: string, userId: string) =>
    fetchJson<Decision>(`/workspaces/${workspaceId}/proposals/${proposalId}/apply`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  rejectProposal: (workspaceId: string, proposalId: string, reason: string, userId: string) =>
    fetchJson<Decision>(`/workspaces/${workspaceId}/proposals/${proposalId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason, userId }),
    }),

  listClarify: (workspaceId: string, status?: string) => {
    const query = status ? `?status=${status}` : ''
    return fetchJson<ItemList<ClarifyTicket>>(`/workspaces/${workspaceId}/clarify${query}`)
  },

  listDecisions: (workspaceId: string) =>
    fetchJson<ItemList<Decision>>(`/workspaces/${workspaceId}/decisions`),

  skillRunUrl: (workspaceId: string, skillId: string) =>
    `${baseUrl}/workspaces/${workspaceId}/skills/${skillId}/run`,
  startSkillRun: (workspaceId: string, skillId: string, args: string, resumeSessionId?: string) =>
    fetchJson<{ runId: string }>(
      `/workspaces/${workspaceId}/skills/${skillId}/run`,
      {
        method: 'POST',
        body: JSON.stringify({
          args,
          ...(resumeSessionId ? { resumeSessionId } : {}),
        }),
      },
    ),

  listRuns: (workspaceId: string) =>
    fetchJson<ItemList<RunRecord>>(`/workspaces/${workspaceId}/runs`),
  runEventsUrl: (workspaceId: string, runId: string) =>
    `${baseUrl}/workspaces/${workspaceId}/runs/${runId}/events`,
  forgetSession: (workspaceId: string, sessionId: string) =>
    fetch(`${baseUrl}/workspaces/${workspaceId}/runs/sessions/${sessionId}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok && r.status !== 404)
          throw new Error(`forgetSession failed: ${r.status} ${r.statusText}`)
      }),
}
