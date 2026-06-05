import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export const queryKeys = {
  users: () => ['users'] as const,
  me: () => ['users', 'me'] as const,
  workspaces: () => ['workspaces'] as const,
  workspaceMembers: (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const,
  workspaceDetail: (workspaceId: string) => ['workspaces', workspaceId, 'detail'] as const,
  skills: (workspaceId: string) => ['workspaces', workspaceId, 'skills'] as const,
  modelSnapshot: (workspaceId: string) => ['workspaces', workspaceId, 'model', 'snapshot'] as const,
  ontology: (workspaceId: string) => ['workspaces', workspaceId, 'ontology'] as const,
  nodes: (workspaceId: string) => ['workspaces', workspaceId, 'nodes'] as const,
  edges: (workspaceId: string) => ['workspaces', workspaceId, 'edges'] as const,
  proposals: (workspaceId: string, status?: string) => ['workspaces', workspaceId, 'proposals', status ?? 'all'] as const,
  proposalValidation: (workspaceId: string, proposalId: string) => ['workspaces', workspaceId, 'proposals', proposalId, 'validate'] as const,
  clarify: (workspaceId: string) => ['workspaces', workspaceId, 'clarify'] as const,
  clarifyByStatus: (workspaceId: string, status: string) => ['workspaces', workspaceId, 'clarify', status] as const,
  clarifyDetail: (workspaceId: string, ticketId: string) => ['workspaces', workspaceId, 'clarify', 'detail', ticketId] as const,
  decisions: (workspaceId: string) => ['workspaces', workspaceId, 'decisions'] as const,
  runs: (workspaceId: string) => ['workspaces', workspaceId, 'runs'] as const,
  sessionMetadata: (workspaceId: string) => ['workspaces', workspaceId, 'runs', 'sessions'] as const,
  history: (workspaceId: string) => ['workspaces', workspaceId, 'history'] as const,
  historyCommit: (workspaceId: string, sha: string) => ['workspaces', workspaceId, 'history', sha] as const,
  historyGraphDiff: (workspaceId: string, fromSha: string, toSha: string) =>
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

export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.workspaceMembers(workspaceId) : ['workspaceMembers', 'none'],
    queryFn: () => api.listWorkspaceMembers(workspaceId!),
    enabled: !!workspaceId,
  })
}

/**
 * Resolve the current user's role in a specific workspace by looking
 * up their userId in the members list. Returns `undefined` while
 * loading and when the user isn't a member (server admins bypass the
 * gate elsewhere; this hook only reports the literal member entry).
 */
export function useMyWorkspaceRole(workspaceId: string | undefined) {
  const { data: me } = useMe()
  const { data: members } = useWorkspaceMembers(workspaceId)
  if (!me || !members)
    return undefined
  const member = members.items.find(m => m.userId === me.id)
  return member?.role
}

export function useWorkspaces() {
  return useQuery({ queryKey: queryKeys.workspaces(), queryFn: () => api.listWorkspaces() })
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
    // The ontology is plugin-bound and only changes if the workspace
    // switches `ontologyId` in its PRODUCT.md (rare). Avoid refetching
    // on every focus.
    staleTime: 60_000,
  })
}

export function useProposalsByStatus(workspaceId: string | undefined, status: string) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.proposals(workspaceId, status) : ['proposals', 'none'],
    queryFn: () => api.listProposals(workspaceId!, status),
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

export function useClarifyByStatus(workspaceId: string | undefined, status: string) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.clarifyByStatus(workspaceId, status) : ['clarify', 'none'],
    queryFn: () => api.listClarify(workspaceId!, status),
    enabled: !!workspaceId,
  })
}

export function usePendingClarify(workspaceId: string | undefined) {
  return useClarifyByStatus(workspaceId, 'pending')
}

export function useClarifyTicketDetail(workspaceId: string, ticketId: string | null) {
  return useQuery({
    queryKey: ticketId ? queryKeys.clarifyDetail(workspaceId, ticketId) : ['clarify-detail', 'none'],
    queryFn: () => api.getClarify(workspaceId, ticketId!),
    enabled: !!ticketId,
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

export function useCommitGraphDiff(workspaceId: string, fromSha: string | null, toSha: string | null) {
  const enabled = !!fromSha && !!toSha && fromSha !== toSha
  return useQuery({
    queryKey: enabled
      ? queryKeys.historyGraphDiff(workspaceId, fromSha, toSha)
      : ['history-graph-diff', 'none'],
    queryFn: () => api.getCommitGraphDiff(workspaceId, fromSha as never, toSha as never),
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
