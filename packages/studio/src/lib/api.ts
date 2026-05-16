import type {
  ClarifyTicket,
  Decision,
  GraphEdge,
  GraphNode,
  McpServerConfig,
  ModelSnapshot,
  OntologyResponse,
  ProductManifestDraft,
  Proposal,
  RunRecord,
  SkillManifest,
  SourceDescriptor,
  ValidationResult,
  Workspace,
} from '@braidhq/schema'

const baseUrl = import.meta.env.VITE_BRAID_API_URL ?? 'http://localhost:4321'

export function workspaceEventsUrl(workspaceId: string): string {
  return `${baseUrl}/workspaces/${workspaceId}/events`
}

export interface ItemList<T> { items: T[] }

export interface IngestSummary {
  sourceId: string
  changed: boolean
  metadata?: Record<string, unknown>
  fetchedAt?: string
  notes?: readonly string[]
}

export interface ScaffoldResult {
  workspace: Workspace
  ingest: IngestSummary[]
}

export interface AddSourceResult {
  workspace: Workspace
  ingest?: IngestSummary
}

export interface PatchWorkspaceResult {
  workspace: Workspace
  renamed?: boolean
  previousId?: string
  newId?: string
}

/**
 * Caller-friendly error: carries the original status code so the UI can
 * map known cases (404, 409, 400 with specific text) to suggested actions
 * rather than dumping raw `application/problem+json` on the user.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
    readonly problem?: { title?: string, code?: string },
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

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
    let problem: { title?: string, code?: string, detail?: string } | undefined
    try {
      problem = JSON.parse(detail)
    }
    catch { /* not JSON */ }
    const message = problem?.detail ?? problem?.title ?? detail ?? `${response.status} ${response.statusText}`
    throw new ApiError(message, response.status, detail, problem)
  }
  if (response.status === 204)
    return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  listWorkspaces: () => fetchJson<ItemList<Workspace>>('/workspaces'),
  getWorkspace: (workspaceId: string) =>
    fetchJson<Workspace>(`/workspaces/${workspaceId}`),
  registerWorkspace: (rootPath: string) =>
    fetchJson<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify({ rootPath }) }),
  scaffoldWorkspace: (rootPath: string, manifest: ProductManifestDraft) =>
    fetchJson<ScaffoldResult>('/workspaces/scaffold', {
      method: 'POST',
      body: JSON.stringify({ rootPath, manifest }),
    }),
  patchWorkspace: (workspaceId: string, patch: {
    name?: string
    description?: string
    ontologyId?: string
    mcpServers?: McpServerConfig[]
  }) =>
    fetchJson<PatchWorkspaceResult>(`/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  unregisterWorkspace: (workspaceId: string) =>
    fetchJson<void>(`/workspaces/${workspaceId}`, { method: 'DELETE' }),

  addSource: (workspaceId: string, source: SourceDescriptor) =>
    fetchJson<AddSourceResult>(`/workspaces/${workspaceId}/sources`, {
      method: 'POST',
      body: JSON.stringify(source),
    }),
  removeSource: (workspaceId: string, sourceId: string) =>
    fetchJson<{ workspace: Workspace }>(`/workspaces/${workspaceId}/sources/${sourceId}`, { method: 'DELETE' }),
  syncSource: (workspaceId: string, sourceId: string) =>
    fetchJson<IngestSummary>(`/workspaces/${workspaceId}/sources/${sourceId}/sync`, { method: 'POST' }),

  startGoogleOAuth: (workspaceId: string, sourceId: string) =>
    fetchJson<{ authorizationUrl: string }>('/oauth/google/start', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, sourceId }),
    }),

  listSkills: (workspaceId: string) =>
    fetchJson<ItemList<SkillManifest>>(`/workspaces/${workspaceId}/skills`),

  modelSnapshot: (workspaceId: string) =>
    fetchJson<ModelSnapshot>(`/workspaces/${workspaceId}/model/snapshot`),

  listNodes: (workspaceId: string) =>
    fetchJson<ItemList<GraphNode>>(`/workspaces/${workspaceId}/nodes`),

  listEdges: (workspaceId: string) =>
    fetchJson<ItemList<GraphEdge>>(`/workspaces/${workspaceId}/edges`),

  getOntology: (workspaceId: string) =>
    fetchJson<OntologyResponse>(`/workspaces/${workspaceId}/ontology`),

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
  validateProposal: (workspaceId: string, proposalId: string) =>
    fetchJson<ValidationResult>(`/workspaces/${workspaceId}/proposals/${proposalId}/validate`),

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
  cancelRun: (workspaceId: string, runId: string) =>
    fetchJson<void>(`/workspaces/${workspaceId}/runs/${runId}/cancel`, { method: 'POST' }),
  forgetSession: (workspaceId: string, sessionId: string) =>
    fetch(`${baseUrl}/workspaces/${workspaceId}/runs/sessions/${sessionId}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok && r.status !== 404)
          throw new Error(`forgetSession failed: ${r.status} ${r.statusText}`)
      }),
}
