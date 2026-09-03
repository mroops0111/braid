import type { AuthConfig } from './api'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/**
 * The active server's auth mode.
 *
 * Shared by the gate and the identity picker, on one query key,
 * so the two never disagree about whether this server has sessions at all.
 * A local-trust server answers `requiresAuth: false`,
 * which means there is no session to hold and none to leave.
 */
export function useAuthConfig(): AuthConfig | undefined {
  const { data } = useQuery({
    queryKey: ['auth', 'config'],
    queryFn: () => api.authConfig(),
    staleTime: 5 * 60 * 1000,
  })
  return data
}
