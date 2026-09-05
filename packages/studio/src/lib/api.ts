import type {
  BatchPlan,
  Clarification,
  ClarificationCreateBody,
  CommitMeta,
  CommitSha,
  EmbeddingCoverage,
  FileDiff,
  GraphEdge,
  GraphNode,
  ListSourceLoadersResponse,
  McpServerConfig,
  ModelDiffEnvelope,
  ModelSnapshot,
  OntologyListResponse,
  OntologyResponse,
  ProductManifestCreate,
  Proposal,
  ReactorCycle,
  ReactorCycleId,
  RunRecord,
  SessionMetadata,
  SkillInputOptionsResponse,
  SkillManifest,
  SourceDescriptor,
  SourceId,
  SourceSyncPolicy,
  SourceSyncState,
  SourceUnitDiff,
  SourceUnitObservation,
  TagMeta,
  User,
  UserUpdate,
  ValidationResult,
  Workspace,
  WorkspaceMember,
  WorkspacePollingConfig,
  WorkspaceRole,
} from '@braidhq/schema'
import { getAuthToken } from './authToken.js'
import { getCurrentUserId } from './currentUser.js'
import { getTokenFor } from './remotes.js'
import { getServerUrl, getServerUrlFor } from './serverUrl.js'

export function workspaceEventsUrl(workspaceId: string): string {
  // EventSource cannot send custom headers, so the Bearer token is appended as `?token=...`,
  // matched server-side by the auth middleware for SSE paths only.
  const base = `${getServerUrl()}/workspaces/${workspaceId}/events`
  const token = getAuthToken()
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

export interface ItemList<T> { items: T[] }

export interface Invite {
  email: string
  invitedAt: string
  serverRole: 'admin' | 'user'
}

export interface AdminUserWorkspace {
  workspaceId: string
  role: WorkspaceRole
}

export type AdminUser = User & { workspaces: AdminUserWorkspace[] }

/**
 * GET /workspaces/:ws/clarifications/:id response. `skipReason` / `answerNote` are no longer populated,
 * the reviewer's rationale lives in git history now, but kept optional until the detail pane resurfaces them.
 */
export type ClarificationDetail = Clarification & { skipReason?: string, answerNote?: string }

export interface ProvisionSummary {
  sourceId: string
  /** Sync only, a first provision creates the source and reports nothing here. */
  changed?: boolean
  /** Per-file counts populated by loaders that can compute them cheaply (gdrive, git). */
  added?: number
  updated?: number
  removed?: number
  unchanged?: number
  metadata?: Record<string, unknown>
  fetchedAt?: string
  notes?: readonly string[]
}

export interface ScaffoldResult {
  workspace: Workspace
  provision: ProvisionSummary[]
}

export interface AddSourceResult {
  workspace: Workspace
  provision?: ProvisionSummary
}

export interface SourceConnection {
  connected: boolean
  needsAuth: boolean
  connectedBy?: { userId: string, displayName: string }
  connectedAt?: string
}

export type SourceConnectionSummary = SourceConnection & { sourceId: string, name: string, kind: string }

export interface PatchWorkspaceResult {
  workspace: Workspace
  renamed?: boolean
  previousId?: string
  newId?: string
}

/**
 * Caller-friendly error: carries the original status code so the UI can map known cases (404, 409,
 * 400 with specific text) to suggested actions rather than dumping raw `application/problem+json` on the user.
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

async function rawFetch<T>(baseUrl: string, token: string | null, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // Remote mode (Bearer) takes precedence over local mode (X-Braid-User).
      // The server's `authMiddleware` resolves the Bearer token to a userId, and stamps c.set('userId').
      // userIdMiddleware then falls through, already set. Local trust mode leaves c.get('userId') empty,
      // so `X-Braid-User` becomes authoritative.
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : { 'X-Braid-User': getCurrentUserId() }),
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

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  return rawFetch<T>(getServerUrl(), getAuthToken(), path, init)
}

/**
 * Like `fetchJson` but targets an explicit remote regardless of the active one.
 * The sidebar uses this to enumerate workspaces across every configured server without disturbing the active singleton.
 */
async function fetchJsonAt<T>(remoteId: string, path: string, init?: RequestInit): Promise<T> {
  return rawFetch<T>(getServerUrlFor(remoteId), getTokenFor(remoteId), path, init)
}

export interface AuthConfig {
  /** Which door to knock on, `/auth/{id}/start`. Null means no sign-in. */
  loginProvider: string | null
  studioUrl: string
  requiresAuth: boolean
}

/**
 * What this deployment does with MCP.
 *
 * Read-only. Whether there is an endpoint follows from the authorization
 * server, which is a deployment decision rather than a Studio one.
 */
export interface McpEndpointStatus {
  state: 'ready' | 'unreachable' | 'incomplete' | 'turnedOff' | 'noAuthorizationServer'
  endpointUrl: string | null
  /** What an `incomplete` deployment is waiting on, empty otherwise. */
  missing: string[]
}

export interface AuthWhoami {
  user: User | null
}

export const api = {
  authConfig: () => fetchJson<AuthConfig>('/auth/config'),
  mcpEndpoint: () => fetchJson<McpEndpointStatus>('/mcp-endpoint'),
  whoami: () => fetchJson<AuthWhoami>('/auth/whoami'),
  startSignIn: (provider: string, returnTo: string) =>
    fetchJson<{ authorizationUrl: string }>(
      `/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`,
    ),
  /**
   * Ends the session here, and says where to end it at the identity provider.
   *
   * Null when there is none to end,
   * which is the case for a server running its own Google client,
   * since Google's session is not Braid's to close.
   */
  logout: (returnTo: string) =>
    fetchJson<{ endSessionUrl: string | null }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ returnTo }),
    }),

  listUsers: () => fetchJson<ItemList<User>>('/users'),
  getMe: () => fetchJson<User>('/users/me'),
  updateUser: (userId: string, patch: UserUpdate) =>
    fetchJson<User>(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  listInvites: () => fetchJson<ItemList<Invite>>('/admin/invites'),
  addInvite: (draft: { email: string, serverRole?: 'admin' | 'user' }) =>
    fetchJson<Invite>('/admin/invites', { method: 'POST', body: JSON.stringify(draft) }),
  revokeInvite: (email: string) =>
    fetchJson<void>(`/admin/invites/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  adminListUsers: () => fetchJson<ItemList<AdminUser>>('/admin/users'),
  adminUpdateUserRole: (userId: string, serverRole: 'admin' | 'user') =>
    fetchJson<User>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ serverRole }),
    }),
  adminDeleteUser: (userId: string) =>
    fetchJson<void>(`/admin/users/${userId}`, { method: 'DELETE' }),

  listWorkspaceMembers: (workspaceId: string) =>
    fetchJson<ItemList<WorkspaceMember>>(`/workspaces/${workspaceId}/members`),
  addWorkspaceMember: (workspaceId: string, body: { userId: string, role?: WorkspaceRole }) =>
    fetchJson<WorkspaceMember>(`/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchWorkspaceMember: (
    workspaceId: string,
    memberUserId: string,
    patch: { role?: WorkspaceRole, skillOverrides?: Record<string, 'allow' | 'deny'> },
  ) =>
    fetchJson<WorkspaceMember>(`/workspaces/${workspaceId}/members/${memberUserId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  removeWorkspaceMember: (workspaceId: string, memberUserId: string) =>
    fetchJson<void>(`/workspaces/${workspaceId}/members/${memberUserId}`, { method: 'DELETE' }),
  transferWorkspaceOwnership: (workspaceId: string, newOwnerId: string) =>
    fetchJson<ItemList<WorkspaceMember>>(`/workspaces/${workspaceId}/transfer-ownership`, {
      method: 'POST',
      body: JSON.stringify({ newOwnerId }),
    }),

  listWorkspaces: () => fetchJson<ItemList<Workspace>>('/workspaces'),
  listWorkspacesAt: (remoteId: string) =>
    fetchJsonAt<ItemList<Workspace>>(remoteId, '/workspaces'),
  // Server-level: what source-loader plugins are registered on this server.
  // Studio uses this to populate its loader dropdown, without hardcoding `git / github / gdrive`.
  listSourceLoaders: () => fetchJson<ListSourceLoadersResponse>('/source-loaders'),
  getWorkspace: (workspaceId: string) =>
    fetchJson<Workspace>(`/workspaces/${workspaceId}`),
  scaffoldWorkspace: (name: string, manifest: ProductManifestCreate) =>
    fetchJson<ScaffoldResult>('/workspaces/scaffold', {
      method: 'POST',
      body: JSON.stringify({ name, manifest }),
    }),
  patchWorkspace: (workspaceId: string, patch: {
    name?: string
    description?: string
    ontologyId?: string
    mcpServers?: McpServerConfig[]
    polling?: WorkspacePollingConfig
  }) =>
    fetchJson<PatchWorkspaceResult>(`/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  /** Unregister and `rm -rf` the workspace folder. Server only accepts purge for canonical-root workspaces. */
  deleteWorkspace: (workspaceId: string) =>
    fetchJson<void>(`/workspaces/${workspaceId}?purge=true`, { method: 'DELETE' }),

  addSource: (workspaceId: string, source: SourceDescriptor) =>
    fetchJson<AddSourceResult>(`/workspaces/${workspaceId}/sources`, {
      method: 'POST',
      body: JSON.stringify(source),
    }),
  removeSource: (workspaceId: string, sourceId: string) =>
    fetchJson<{ workspace: Workspace }>(`/workspaces/${workspaceId}/sources/${sourceId}`, { method: 'DELETE' }),
  syncSource: (workspaceId: string, sourceId: string) =>
    fetchJson<ProvisionSummary>(`/workspaces/${workspaceId}/sources/${sourceId}/sync`, { method: 'POST' }),
  patchSource: (workspaceId: string, sourceId: string, patch: { description?: string, sync?: SourceSyncPolicy | null }) =>
    fetchJson<{ workspace: Workspace }>(`/workspaces/${workspaceId}/sources/${sourceId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  patchMcpServer: (workspaceId: string, mcpServerId: string, patch: { description?: string }) =>
    fetchJson<{ workspace: Workspace }>(`/workspaces/${workspaceId}/mcpServers/${mcpServerId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  getSourceConnection: (workspaceId: string, sourceId: string) =>
    fetchJson<SourceConnection>(`/workspaces/${workspaceId}/source-connections/${sourceId}`),

  listSourceConnections: (workspaceId: string) =>
    fetchJson<{ connections: SourceConnectionSummary[] }>(`/workspaces/${workspaceId}/source-connections`),

  listSourceSyncStates: (workspaceId: string) =>
    fetchJson<{ states: SourceSyncState[] }>(`/workspaces/${workspaceId}/source-sync-states`),

  startGoogleOAuth: (workspaceId: string, sourceId: string) =>
    fetchJson<{ authorizationUrl: string }>('/oauth/google/start', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, sourceId }),
    }),

  startGithubOAuth: (workspaceId: string, sourceId: string) =>
    fetchJson<{ authorizationUrl: string }>('/oauth/github/start', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, sourceId }),
    }),

  getGithubWebhookStatus: (workspaceId: string, sourceId: string) =>
    fetchJson<{ url: string, hasSecret: boolean, createdAt?: string }>(
      `/workspaces/${workspaceId}/source-webhooks/${sourceId}/github`,
    ),
  rotateGithubWebhookSecret: (workspaceId: string, sourceId: string) =>
    fetchJson<{ url: string, secret: string, createdAt: string }>(
      `/workspaces/${workspaceId}/source-webhooks/${sourceId}/github/rotate`,
      { method: 'POST' },
    ),

  /**
   * Diff a source's current units on disk against the recorded ledger. Reactor consumes this internally,
   * Studio uses it to render per-option badges ("processed Nm ago" / "stale" / never seen) on the source picker.
   */
  getSourceUnitDiff: (workspaceId: string, sourceId: string) =>
    fetchJson<SourceUnitDiff>(`/workspaces/${workspaceId}/source-unit-states/${sourceId}/diff`),
  listSourceUnitObservations: (workspaceId: string, sourceId?: string) => {
    const qs = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ''
    return fetchJson<{ items: SourceUnitObservation[] }>(`/workspaces/${workspaceId}/source-unit-states${qs}`)
  },

  listReactorCycles: (workspaceId: string) =>
    fetchJson<{ items: ReactorCycle[] }>(`/workspaces/${workspaceId}/reactor-cycles`),
  getReactorCycle: (workspaceId: string, cycleId: ReactorCycleId) =>
    fetchJson<ReactorCycle>(`/workspaces/${workspaceId}/reactor-cycles/${cycleId}`),

  listSkills: (workspaceId: string) =>
    fetchJson<ItemList<SkillManifest>>(`/workspaces/${workspaceId}/skills`),

  modelSnapshot: (workspaceId: string) =>
    fetchJson<ModelSnapshot>(`/workspaces/${workspaceId}/model/snapshot`),

  /**
   * Nodes ranked for a query rather than filtered by it.
   *
   * The server fuses a substring pass with a vector pass,
   * so an exact identifier and a paraphrase both land,
   * and a deployment with no embedding backend simply returns the substring hits.
   */
  searchNodes: (workspaceId: string, query: string, limit = 20) => {
    const params = new URLSearchParams({ q: query, semantic: 'true', limit: String(limit) })
    return fetchJson<ItemList<GraphNode>>(`/workspaces/${workspaceId}/nodes?${params.toString()}`)
  },

  getEmbeddingCoverage: (workspaceId: string) =>
    fetchJson<EmbeddingCoverage>(`/workspaces/${workspaceId}/embeddings`),
  /**
   * Answers as soon as the rebuild is accepted, not when it finishes.
   * Progress arrives on the workspace event stream.
   */
  rebuildEmbeddings: (workspaceId: string) =>
    fetchJson<EmbeddingCoverage>(`/workspaces/${workspaceId}/embeddings/rebuild`, { method: 'POST' }),

  listEdges: (workspaceId: string) =>
    fetchJson<ItemList<GraphEdge>>(`/workspaces/${workspaceId}/edges`),

  getOntology: (workspaceId: string) =>
    fetchJson<OntologyResponse>(`/workspaces/${workspaceId}/ontology`),

  getOntologies: () =>
    fetchJson<OntologyListResponse>(`/ontologies`),

  listProposals: (workspaceId: string, status?: string, showAll?: boolean) => {
    const params = new URLSearchParams()
    if (status)
      params.set('status', status)
    if (showAll)
      params.set('showAll', 'true')
    const query = params.toString() ? `?${params.toString()}` : ''
    return fetchJson<ItemList<Proposal>>(`/workspaces/${workspaceId}/proposals${query}`)
  },
  applyProposal: (workspaceId: string, proposalId: string) =>
    fetchJson<Proposal>(`/workspaces/${workspaceId}/proposals/${proposalId}/apply`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  rejectProposal: (workspaceId: string, proposalId: string, reason: string) =>
    fetchJson<Proposal>(`/workspaces/${workspaceId}/proposals/${proposalId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  validateProposal: (workspaceId: string, proposalId: string) =>
    fetchJson<ValidationResult>(`/workspaces/${workspaceId}/proposals/${proposalId}/validate`),

  listClarification: (workspaceId: string, status?: string, showAll?: boolean) => {
    const params = new URLSearchParams()
    if (status)
      params.set('status', status)
    if (showAll)
      params.set('showAll', 'true')
    const query = params.toString() ? `?${params.toString()}` : ''
    return fetchJson<ItemList<Clarification>>(`/workspaces/${workspaceId}/clarifications${query}`)
  },
  /**
   * Fetch a single clarification.
   */
  getClarification: (workspaceId: string, clarificationId: string) =>
    fetchJson<ClarificationDetail>(`/workspaces/${workspaceId}/clarifications/${clarificationId}`),
  /**
   * Server mints any omitted candidate ids, skills supply them deterministically (cc-1 etc.),
   * human-authored "New question" candidates leave them out and let `newClarificationCandidateId` fill in.
   */
  submitClarification: (workspaceId: string, draft: ClarificationCreateBody) =>
    fetchJson<Clarification>(`/workspaces/${workspaceId}/clarifications`, {
      method: 'POST',
      body: JSON.stringify(draft),
    }),
  /**
   * Answer a clarification.
   * `selection` is either picking an existing candidate or supplying a freshly-written description,
   * that the server appends to the clarification and answers in one transaction.
   * `note` is the reviewer's free-form rationale, saved on the answer commit.
   */
  answerClarification: (
    workspaceId: string,
    clarificationId: string,
    selection: { candidateId: string } | { customCandidate: { description: string } },
    note?: string,
  ) =>
    fetchJson<Clarification>(`/workspaces/${workspaceId}/clarifications/${clarificationId}/answer`, {
      method: 'POST',
      body: JSON.stringify({
        ...selection,
        ...(note ? { note } : {}),
      }),
    }),
  skipClarification: (workspaceId: string, clarificationId: string, reason: string) =>
    fetchJson<Clarification>(`/workspaces/${workspaceId}/clarifications/${clarificationId}/skip`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  skillRunUrl: (workspaceId: string, skillId: string) =>
    `${getServerUrl()}/workspaces/${workspaceId}/skills/${skillId}/run`,
  startSkillRun: (
    workspaceId: string,
    skillId: string,
    args: string,
    resumeSessionId?: string,
    sourceUnit?: { sourceId: SourceId, path: string },
  ) =>
    fetchJson<{ runId: string }>(
      `/workspaces/${workspaceId}/skills/${skillId}/run`,
      {
        method: 'POST',
        body: JSON.stringify({
          args,
          ...(resumeSessionId ? { resumeSessionId } : {}),
          ...(sourceUnit ? { sourceUnit } : {}),
        }),
      },
    ),

  listRuns: (workspaceId: string) =>
    fetchJson<ItemList<RunRecord>>(`/workspaces/${workspaceId}/runs`),
  runEventsUrl: (workspaceId: string, runId: string) => {
    const base = `${getServerUrl()}/workspaces/${workspaceId}/runs/${runId}/events`
    const token = getAuthToken()
    return token ? `${base}?token=${encodeURIComponent(token)}` : base
  },
  cancelRun: (workspaceId: string, runId: string) =>
    fetchJson<void>(`/workspaces/${workspaceId}/runs/${runId}/cancel`, { method: 'POST' }),
  forgetSession: (workspaceId: string, sessionId: string) =>
    fetch(`${getServerUrl()}/workspaces/${workspaceId}/runs/sessions/${sessionId}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok && r.status !== 404)
          throw new Error(`forgetSession failed: ${r.status} ${r.statusText}`)
      }),

  listSessionMetadata: (workspaceId: string) =>
    fetchJson<ItemList<SessionMetadata>>(`/workspaces/${workspaceId}/runs/sessions`),
  /** `title = null` clears the custom title and falls back to the first prompt. */
  renameSession: (workspaceId: string, sessionId: string, title: string | null) =>
    fetchJson<SessionMetadata>(`/workspaces/${workspaceId}/runs/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  /** Deletes the cwd and drops every RunRecord + event log for the session. */
  deleteSession: (workspaceId: string, sessionId: string) =>
    fetchJson<void>(`/workspaces/${workspaceId}/runs/sessions/${sessionId}?purge=true`, { method: 'DELETE' }),
  /** Orphan-row delete: single RunRecord by runId. */
  deleteRun: (workspaceId: string, runId: string) =>
    fetchJson<void>(`/workspaces/${workspaceId}/runs/${runId}`, { method: 'DELETE' }),

  listHistory: (workspaceId: string, options?: { since?: CommitSha, limit?: number }) => {
    const params = new URLSearchParams()
    if (options?.since)
      params.set('since', options.since)
    if (options?.limit)
      params.set('limit', String(options.limit))
    const query = params.toString()
    return fetchJson<ItemList<CommitMeta>>(`/workspaces/${workspaceId}/history${query ? `?${query}` : ''}`)
  },
  getCommit: (workspaceId: string, sha: CommitSha) =>
    fetchJson<CommitMeta & { diff: FileDiff[] }>(`/workspaces/${workspaceId}/history/${sha}`),
  getCommitModelDiff: (workspaceId: string, fromSha: CommitSha, toSha: CommitSha) =>
    fetchJson<ModelDiffEnvelope>(`/workspaces/${workspaceId}/history/graph-diff?from=${fromSha}&to=${toSha}`),
  restoreCommit: (workspaceId: string, sha: CommitSha) =>
    fetchJson<{ newCommit: CommitSha, restoredTo: CommitSha }>(
      `/workspaces/${workspaceId}/history/${sha}/restore`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  listHistoryTags: (workspaceId: string) =>
    fetchJson<ItemList<TagMeta>>(`/workspaces/${workspaceId}/history/tags`),
  createHistoryTag: (workspaceId: string, body: { sha: CommitSha, name: string, note?: string }) =>
    fetchJson<TagMeta>(`/workspaces/${workspaceId}/history/tags`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteHistoryTag: (workspaceId: string, name: string) =>
    fetchJson<void>(`/workspaces/${workspaceId}/history/tags/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  startBatch: (workspaceId: string, autoApply: boolean) =>
    fetchJson<BatchPlan>(`/workspaces/${workspaceId}/batch`, {
      method: 'POST',
      body: JSON.stringify({ autoApply }),
    }),
  getBatchStatus: async (workspaceId: string): Promise<BatchPlan | null> => {
    try {
      return await fetchJson<BatchPlan>(`/workspaces/${workspaceId}/batch`)
    }
    catch (err) {
      if (err instanceof Error && /404/.test(err.message))
        return null
      throw err
    }
  },
  stopBatch: (workspaceId: string) =>
    fetchJson<void>(`/workspaces/${workspaceId}/batch/stop`, { method: 'POST' }),
  resumeBatch: (workspaceId: string) =>
    fetchJson<BatchPlan>(`/workspaces/${workspaceId}/batch/resume`, { method: 'POST' }),
  archiveBatch: (workspaceId: string) =>
    fetchJson<BatchPlan>(`/workspaces/${workspaceId}/batch/archive`, { method: 'POST' }),

  listSkillInputOptions: (workspaceId: string, kind: string, filter?: unknown) => {
    const params = new URLSearchParams({ kind })
    if (filter !== undefined)
      params.set('filter', JSON.stringify(filter))
    return fetchJson<SkillInputOptionsResponse>(`/workspaces/${workspaceId}/skill-input-options?${params.toString()}`)
  },
}
