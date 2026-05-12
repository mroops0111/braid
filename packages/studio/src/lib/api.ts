import type {
  ClarifyTicket,
  Decision,
  GraphEdge,
  GraphNode,
  ModelSnapshot,
  Proposal,
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
}
