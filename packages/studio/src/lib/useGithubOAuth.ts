import type { UseMutationResult } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import { api } from './api'

interface OauthPostMessage {
  source?: string
  provider?: string
  status?: string
}

/**
 * Start the GitHub OAuth flow for a `(workspaceId, sourceId)` pair,
 * and resolve when the popup posts a success status.
 * Mirrors `useGoogleOAuth`,
 * the popup closes itself in the page that `/oauth/github/callback` serves.
 * The workspace may not exist yet when the Wizard connects,
 * the token is stashed by `${workspaceId}--${sourceId}` ahead of scaffold,
 * and the caller becomes the workspace owner.
 */
export function useGithubOAuth(
  workspaceId: string,
  sourceId: string,
  options: { onConnected: (sourceId: string) => void },
): UseMutationResult<{ authorizationUrl: string }, Error, void> {
  return useMutation({
    mutationFn: () => api.startGithubOAuth(workspaceId, sourceId),
    onSuccess: (result) => {
      const popup = window.open(result.authorizationUrl, 'braid-oauth-github', 'width=520,height=720')
      if (!popup)
        return
      const onMessage = (event: MessageEvent): void => {
        const data = event.data as OauthPostMessage | null
        if (!data || data.source !== 'braid-oauth' || data.provider !== 'github')
          return
        window.removeEventListener('message', onMessage)
        if (data.status === 'success')
          options.onConnected(sourceId)
      }
      window.addEventListener('message', onMessage)
    },
  })
}
