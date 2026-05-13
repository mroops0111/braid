import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export const queryKeys = {
  workspaces: () => ['workspaces'] as const,
  skills: (workspaceId: string) => ['workspaces', workspaceId, 'skills'] as const,
  modelSnapshot: (workspaceId: string) => ['workspaces', workspaceId, 'model', 'snapshot'] as const,
  proposals: (workspaceId: string, status?: string) => ['workspaces', workspaceId, 'proposals', status ?? 'all'] as const,
  clarify: (workspaceId: string) => ['workspaces', workspaceId, 'clarify'] as const,
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

export function usePendingProposals(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.proposals(workspaceId, 'pending') : ['proposals', 'none'],
    queryFn: () => api.listProposals(workspaceId!, 'pending'),
    enabled: !!workspaceId,
  })
}
