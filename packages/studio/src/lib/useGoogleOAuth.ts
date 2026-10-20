import type { UseMutationResult } from '@tanstack/react-query'
import { api } from './api'
import { useOAuthPopup } from './useOAuthPopup'

/**
 * Start the Google OAuth flow for a `(workspaceId, sourceId)` pair.
 * A thin binding of `useOAuthPopup` to the Google start endpoint.
 * `CreateWorkspaceWizard` uses it with a workspaceId from the typed name, ahead of scaffold.
 * `AddSourceDialog` uses it with the workspace's real id.
 */
export function useGoogleOAuth(
  workspaceId: string,
  sourceId: string,
  options: { onConnected: (sourceId: string) => void },
): UseMutationResult<{ authorizationUrl: string }, Error, void> {
  return useOAuthPopup('google', workspaceId, sourceId, api.startGoogleOAuth, options)
}
