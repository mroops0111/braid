import type { ReactorCycleId } from '@braidhq/schema'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export const queryKeys = {
  users: () => ['users'] as const,
  me: () => ['users', 'me'] as const,
  adminInvites: () => ['admin', 'invites'] as const,
  adminUsers: () => ['admin', 'users'] as const,
  workspaces: () => ['workspaces'] as const,
  sourceLoaders: () => ['source-loaders'] as const,
  workspaceMembers: (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const,
  workspaceDetail: (workspaceId: string) => ['workspaces', workspaceId, 'detail'] as const,
  skills: (workspaceId: string) => ['workspaces', workspaceId, 'skills'] as const,
  modelSnapshot: (workspaceId: string) => ['workspaces', workspaceId, 'model', 'snapshot'] as const,
  ontology: (workspaceId: string) => ['workspaces', workspaceId, 'ontology'] as const,
  nodes: (workspaceId: string) => ['workspaces', workspaceId, 'nodes'] as const,
  edges: (workspaceId: string) => ['workspaces', workspaceId, 'edges'] as const,
  proposals: (workspaceId: string, status?: string) => ['workspaces', workspaceId, 'proposals', status ?? 'all'] as const,
  proposalValidation: (workspaceId: string, proposalId: string) => ['workspaces', workspaceId, 'proposals', proposalId, 'validate'] as const,
  clarifications: (workspaceId: string) => ['workspaces', workspaceId, 'clarifications'] as const,
  clarificationByStatus: (workspaceId: string, status: string) => ['workspaces', workspaceId, 'clarifications', status] as const,
  clarificationDetail: (workspaceId: string, clarificationId: string) => ['workspaces', workspaceId, 'clarifications', 'detail', clarificationId] as const,
  runs: (workspaceId: string) => ['workspaces', workspaceId, 'runs'] as const,
  sessionMetadata: (workspaceId: string) => ['workspaces', workspaceId, 'runs', 'sessions'] as const,
  history: (workspaceId: string) => ['workspaces', workspaceId, 'history'] as const,
  historyCommit: (workspaceId: string, sha: string) => ['workspaces', workspaceId, 'history', sha] as const,
  historyModelDiff: (workspaceId: string, fromSha: string, toSha: string) =>
    ['workspaces', workspaceId, 'history', 'graph-diff', fromSha, toSha] as const,
  historyTags: (workspaceId: string) => ['workspaces', workspaceId, 'history', 'tags'] as const,
  batch: (workspaceId: string) => ['workspaces', workspaceId, 'batch'] as const,
}

export function useUsers() {
  return useQuery({ queryKey: queryKeys.users(), queryFn: () => api.listUsers() })
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me(), queryFn: () => api.getMe() })
}

export function useAdminInvites(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.adminInvites(),
    queryFn: () => api.listInvites(),
    enabled,
  })
}

export function useAdminUsers(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.adminUsers(),
    queryFn: () => api.adminListUsers(),
    enabled,
  })
}

export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.workspaceMembers(workspaceId) : ['workspaceMembers', 'none'],
    queryFn: () => api.listWorkspaceMembers(workspaceId!),
    enabled: !!workspaceId,
  })
}

export function useWorkspaces() {
  return useQuery({ queryKey: queryKeys.workspaces(), queryFn: () => api.listWorkspaces() })
}

/**
 * Source-loader plugins registered on the active server.
 * Reflects whatever `composeFsApp` registered plus any extras the host passed in,
 * updates automatically when a new plugin ships without Studio code changes.
 */
export function useSourceLoaders() {
  return useQuery({
    queryKey: queryKeys.sourceLoaders(),
    queryFn: () => api.listSourceLoaders(),
    // Server-level static data. Refetch only on tab focus, not on every mount.
    staleTime: 5 * 60 * 1000,
  })
}

export function useSkills(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.skills(workspaceId) : ['skills', 'none'],
    queryFn: () => api.listSkills(workspaceId!),
    enabled: !!workspaceId,
  })
}

export function useModelSnapshot(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.modelSnapshot(workspaceId) : ['model', 'none'],
    queryFn: () => api.modelSnapshot(workspaceId!),
    enabled: !!workspaceId,
  })
}

export function useRuns(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.runs(workspaceId) : ['runs', 'none'],
    queryFn: () => api.listRuns(workspaceId!),
    enabled: !!workspaceId,
  })
}

export function useSessionMetadata(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.sessionMetadata(workspaceId) : ['session-metadata', 'none'],
    queryFn: () => api.listSessionMetadata(workspaceId!),
    enabled: !!workspaceId,
  })
}

export function useOntology(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.ontology(workspaceId) : ['ontology', 'none'],
    queryFn: () => api.getOntology(workspaceId!),
    enabled: !!workspaceId,
    // The ontology is plugin-bound. It only changes if the workspace switches `ontologyId` in PRODUCT.md,
    // which is rare, so avoid refetching on every focus.
    staleTime: 60_000,
  })
}

export function useOntologies() {
  return useQuery({
    queryKey: ['ontologies'] as const,
    queryFn: () => api.getOntologies(),
    // Registered plugins are fixed for a server process, so this rarely changes.
    staleTime: 60_000,
  })
}

export function useProposalsByStatus(workspaceId: string | undefined, status: string, showAll?: boolean) {
  return useQuery({
    queryKey: workspaceId ? [...queryKeys.proposals(workspaceId, status), showAll ? 'all' : 'mine'] : ['proposals', 'none'],
    queryFn: () => api.listProposals(workspaceId!, status, showAll),
    enabled: !!workspaceId,
  })
}

export function usePendingProposals(workspaceId: string | undefined) {
  return useProposalsByStatus(workspaceId, 'pending')
}

export function useProposalValidation(workspaceId: string, proposalId: string | null) {
  return useQuery({
    queryKey: proposalId ? queryKeys.proposalValidation(workspaceId, proposalId) : ['proposal-validation', 'none'],
    queryFn: () => api.validateProposal(workspaceId, proposalId!),
    enabled: !!proposalId,
  })
}

export function useClarificationByStatus(workspaceId: string | undefined, status: string, showAll?: boolean) {
  return useQuery({
    queryKey: workspaceId ? [...queryKeys.clarificationByStatus(workspaceId, status), showAll ? 'all' : 'mine'] : ['clarifications', 'none'],
    queryFn: () => api.listClarification(workspaceId!, status, showAll),
    enabled: !!workspaceId,
  })
}

export function usePendingClarification(workspaceId: string | undefined) {
  return useClarificationByStatus(workspaceId, 'pending')
}

export function useClarificationDetail(workspaceId: string, clarificationId: string | null) {
  return useQuery({
    queryKey: clarificationId ? queryKeys.clarificationDetail(workspaceId, clarificationId) : ['clarifications-detail', 'none'],
    queryFn: () => api.getClarification(workspaceId, clarificationId!),
    enabled: !!clarificationId,
  })
}

export function useHistory(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.history(workspaceId) : ['history', 'none'],
    queryFn: () => api.listHistory(workspaceId!),
    enabled: !!workspaceId,
  })
}

export function useHistoryCommit(workspaceId: string, sha: string | null) {
  return useQuery({
    queryKey: sha ? queryKeys.historyCommit(workspaceId, sha) : ['history-commit', 'none'],
    queryFn: () => api.getCommit(workspaceId, sha as never),
    enabled: !!sha,
  })
}

export function useCommitModelDiff(workspaceId: string, fromSha: string | null, toSha: string | null) {
  const enabled = !!fromSha && !!toSha && fromSha !== toSha
  return useQuery({
    queryKey: enabled
      ? queryKeys.historyModelDiff(workspaceId, fromSha, toSha)
      : ['history-graph-diff', 'none'],
    queryFn: () => api.getCommitModelDiff(workspaceId, fromSha as never, toSha as never),
    enabled,
  })
}

export function useHistoryTags(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.historyTags(workspaceId) : ['history-tags', 'none'],
    queryFn: () => api.listHistoryTags(workspaceId!),
    enabled: !!workspaceId,
  })
}

export function useBatchStatus(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.batch(workspaceId) : ['batch', 'none'],
    queryFn: () => api.getBatchStatus(workspaceId!),
    enabled: !!workspaceId,
  })
}

/**
 * Shared with `ReactorBanner` and the Activity page via React Query's dedup-by-key.
 * `useWorkspaceEvents` invalidates this on every reactor SSE event, so consumers stay live.
 */
export function useReactorCycles(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: ['reactor-cycles', workspaceId ?? null],
    queryFn: () => api.listReactorCycles(workspaceId!),
    enabled: !!workspaceId,
  })
}

export function useReactorCycle(workspaceId: string | null | undefined, cycleId: ReactorCycleId | null) {
  return useQuery({
    queryKey: ['reactor-cycles', workspaceId ?? null, cycleId],
    queryFn: () => api.getReactorCycle(workspaceId!, cycleId!),
    enabled: !!workspaceId && cycleId !== null,
  })
}
