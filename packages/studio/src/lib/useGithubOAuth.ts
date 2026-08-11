import type { UseMutationResult } from '@tanstack/react-query'
import { api } from './api'
import { useOAuthPopup } from './useOAuthPopup'

/**
 * Start the GitHub OAuth flow for a `(workspaceId, sourceId)` pair.
 * A thin binding of `useOAuthPopup` to the GitHub start endpoint.
 */
export function useGithubOAuth(
  workspaceId: string,
  sourceId: string,
  options: { onConnected: (sourceId: string) => void },
): UseMutationResult<{ authorizationUrl: string }, Error, void> {
  return useOAuthPopup('github', workspaceId, sourceId, api.startGithubOAuth, options)
}
