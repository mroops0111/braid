import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export const queryKeys = {
  workspaces: () => ['workspaces'] as const,
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
