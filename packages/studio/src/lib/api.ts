import type {
  BatchPlan,
  ClarifyAmbiguityType,
  ClarifyCandidate,
  ClarifyOrigin,
  ClarifyTicket,
  CommitMeta,
  CommitSha,
  Decision,
  ExternalReference,
  FileDiff,
  GraphDiffEnvelope,
  GraphEdge,
  GraphNode,
  McpServerConfig,
  ModelSnapshot,
  NodeId,
  OntologyResponse,
  ProductManifestDraft,
  Proposal,
  RunRecord,
  SessionMetadata,
  SkillInputOptionsResponse,
  SkillManifest,
  SourceDescriptor,
  TagMeta,
  User,
  UserDraft,
  UserPatch,
  ValidationResult,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '@braidhq/schema'
import { getAuthToken } from './authToken.js'
import { getCurrentUserId } from './currentUser.js'
import { getTokenFor } from './remotes.js'
import { getServerUrl, getServerUrlFor } from './serverUrl.js'

export function workspaceEventsUrl(workspaceId: string): string {
  return `${getServerUrl()}/workspaces/${workspaceId}/events`
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
 * GET /workspaces/:ws/clarify/:id response — the canonical ticket plus
 * server-side projections derived from the Decision log so the detail
 * pane can render the reviewer's rationale without a second fetch.
 * `skipReason` is set on `skipped` tickets, `answerNote` on
 * `answered` / `applied` tickets.
 */
export type ClarifyTicketDetail = ClarifyTicket & { skipReason?: string, answerNote?: string }

/**
 * POST /workspaces/:ws/clarify body shape — mirrors the server's
 * `CreateBodySchema`. Candidate `id` is optional so the server can
 * mint via `newClarifyCandidateId` for human-authored questions.
 */
export interface ClarifySubmitBody {
  question: string
  candidates: ReadonlyArray<Omit<ClarifyCandidate, 'id'> & { id?: ClarifyCandidate['id'] }>
  externalReferences?: ReadonlyArray<ExternalReference>
  origin?: ClarifyOrigin
  context?: string
  relatedNode?: NodeId
  ambiguityType?: ClarifyAmbiguityType
}

export interface IngestSummary {
  sourceId: string
  changed: boolean
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

async function rawFetch<T>(baseUrl: string, token: string | null, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // Remote mode (Bearer) takes precedence over local mode (X-Braid-User).
      // The server's `authMiddleware` resolves the Bearer token to a userId
      // and stamps c.set('userId'); userIdMiddleware then falls through
      // (already set). Local trust mode leaves c.get('userId') empty so
      // `X-Braid-User` becomes authoritative.
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
 * Like `fetchJson` but targets an explicit remote regardless of the active
 * one. The sidebar uses this to enumerate workspaces across every
 * configured server without disturbing the active singleton.
 */
async function fetchJsonAt<T>(remoteId: string, path: string, init?: RequestInit): Promise<T> {
  return rawFetch<T>(getServerUrlFor(remoteId), getTokenFor(remoteId), path, init)
}

export interface AuthConfig {
  googleEnabled: boolean
  studioUrl: string
  requiresAuth: boolean
}

export interface AuthWhoami {
  user: User | null
}

export const api = {
  authConfig: () => fetchJson<AuthConfig>('/auth/config'),
  whoami: () => fetchJson<AuthWhoami>('/auth/whoami'),
  startGoogleSignIn: (returnTo: string) =>
    fetchJson<{ authorizationUrl: string }>(
      `/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`,
    ),
  logout: () =>
    fetchJson<void>('/auth/logout', { method: 'POST' }),

  listUsers: () => fetchJson<ItemList<User>>('/users'),
  getMe: () => fetchJson<User>('/users/me'),
  createUser: (draft: UserDraft) =>
    fetchJson<User>('/users', { method: 'POST', body: JSON.stringify(draft) }),
  updateUser: (userId: string, patch: UserPatch) =>
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
  getWorkspace: (workspaceId: string) =>
    fetchJson<Workspace>(`/workspaces/${workspaceId}`),
  scaffoldWorkspace: (name: string, manifest: ProductManifestDraft) =>
    fetchJson<ScaffoldResult>('/workspaces/scaffold', {
      method: 'POST',
      body: JSON.stringify({ name, manifest }),
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
  /** Unregister AND `rm -rf` the workspace folder. Server only accepts purge for canonical-root workspaces. */
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
    fetchJson<IngestSummary>(`/workspaces/${workspaceId}/sources/${sourceId}/sync`, { method: 'POST' }),
  patchSource: (workspaceId: string, sourceId: string, patch: { description?: string }) =>
    fetchJson<{ workspace: Workspace }>(`/workspaces/${workspaceId}/sources/${sourceId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  patchMcpServer: (workspaceId: string, mcpServerId: string, patch: { description?: string }) =>
    fetchJson<{ workspace: Workspace }>(`/workspaces/${workspaceId}/mcpServers/${mcpServerId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

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
    fetchJson<Decision>(`/workspaces/${workspaceId}/proposals/${proposalId}/apply`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  rejectProposal: (workspaceId: string, proposalId: string, reason: string) =>
    fetchJson<Decision>(`/workspaces/${workspaceId}/proposals/${proposalId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  validateProposal: (workspaceId: string, proposalId: string) =>
    fetchJson<ValidationResult>(`/workspaces/${workspaceId}/proposals/${proposalId}/validate`),

  listClarify: (workspaceId: string, status?: string, showAll?: boolean) => {
    const params = new URLSearchParams()
    if (status)
      params.set('status', status)
    if (showAll)
      params.set('showAll', 'true')
    const query = params.toString() ? `?${params.toString()}` : ''
    return fetchJson<ItemList<ClarifyTicket>>(`/workspaces/${workspaceId}/clarify${query}`)
  },
  /**
   * Returns the ticket plus a `skipReason` projection when the ticket
   * is in `skipped` status — derived server-side from the most recent
   * skipClarifyTicket Decision so the UI doesn't need a second call.
   */
  getClarify: (workspaceId: string, ticketId: string) =>
    fetchJson<ClarifyTicketDetail>(`/workspaces/${workspaceId}/clarify/${ticketId}`),
  /**
   * Server mints any omitted candidate ids — skills supply them
   * deterministically (cc-1 etc.), human-authored "New question"
   * candidates leave them out and let `newClarifyCandidateId` fill in.
   */
  submitClarify: (workspaceId: string, draft: ClarifySubmitBody) =>
    fetchJson<ClarifyTicket>(`/workspaces/${workspaceId}/clarify`, {
      method: 'POST',
      body: JSON.stringify(draft),
    }),
  /**
   * Answer a clarify ticket. `selection` is either picking an existing
   * candidate or supplying a freshly-written description that the
   * server appends to the ticket and answers in one transaction.
   * `note` is the reviewer's free-form rationale; the server stores
   * it on the Decision and projects it back as `answerNote` on the
   * GET /clarify/:id response.
   */
  answerClarify: (
    workspaceId: string,
    ticketId: string,
    selection: { candidateId: string } | { customCandidate: { description: string } },
    note?: string,
  ) =>
    fetchJson<Decision>(`/workspaces/${workspaceId}/clarify/${ticketId}/answer`, {
      method: 'POST',
      body: JSON.stringify({
        ...selection,
        ...(note ? { note } : {}),
      }),
    }),
  skipClarify: (workspaceId: string, ticketId: string, reason: string) =>
    fetchJson<Decision>(`/workspaces/${workspaceId}/clarify/${ticketId}/skip`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  listDecisions: (workspaceId: string) =>
    fetchJson<ItemList<Decision>>(`/workspaces/${workspaceId}/decisions`),

  skillRunUrl: (workspaceId: string, skillId: string) =>
    `${getServerUrl()}/workspaces/${workspaceId}/skills/${skillId}/run`,
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
    `${getServerUrl()}/workspaces/${workspaceId}/runs/${runId}/events`,
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
  /** Deletes the cwd AND drops every RunRecord + event log for the session. */
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
  getCommitGraphDiff: (workspaceId: string, fromSha: CommitSha, toSha: CommitSha) =>
    fetchJson<GraphDiffEnvelope>(`/workspaces/${workspaceId}/history/graph-diff?from=${fromSha}&to=${toSha}`),
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

  listSkillInputOptions: (workspaceId: string, type: string, filter?: unknown) => {
    const params = new URLSearchParams({ type })
    if (filter !== undefined)
      params.set('filter', JSON.stringify(filter))
    return fetchJson<SkillInputOptionsResponse>(`/workspaces/${workspaceId}/skill-input-options?${params.toString()}`)
  },
}
