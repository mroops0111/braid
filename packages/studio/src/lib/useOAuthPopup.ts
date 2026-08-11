import type { UseMutationResult } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import { getServerUrl } from './serverUrl'

interface OauthPostMessage {
  source?: string
  provider?: string
  status?: string
}

/**
 * Start an OAuth flow for a `(workspaceId, sourceId)` pair,
 * and fire `onConnected` when the popup posts a success for this provider.
 * The popup closes itself in the page that `/oauth/<provider>/callback` serves.
 * The workspace may not exist yet when the Wizard connects,
 * the token is stashed by `${workspaceId}--${sourceId}` ahead of scaffold,
 * and the caller becomes the workspace owner.
 */
export function useOAuthPopup(
  provider: 'google' | 'github',
  workspaceId: string,
  sourceId: string,
  start: (workspaceId: string, sourceId: string) => Promise<{ authorizationUrl: string }>,
  options: { onConnected: (sourceId: string) => void },
): UseMutationResult<{ authorizationUrl: string }, Error, void> {
  return useMutation({
    mutationFn: () => start(workspaceId, sourceId),
    onSuccess: (result) => {
      const popup = window.open(result.authorizationUrl, `braid-oauth-${provider}`, 'width=520,height=720')
      if (!popup)
        return
      // The callback page is served by the API, so trust only its origin.
      const callbackOrigin = new URL(getServerUrl()).origin
      const onMessage = (event: MessageEvent): void => {
        if (event.origin !== callbackOrigin)
          return
        const data = event.data as OauthPostMessage | null
        if (!data || data.source !== 'braid-oauth' || data.provider !== provider)
          return
        window.removeEventListener('message', onMessage)
        if (data.status === 'success')
          options.onConnected(sourceId)
      }
      window.addEventListener('message', onMessage)
    },
  })
}
