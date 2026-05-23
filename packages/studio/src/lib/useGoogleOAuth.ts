import type { UseMutationResult } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import { api } from './api'

interface OauthPostMessage {
  source?: string
  provider?: string
  status?: string
}

/**
 * Start the Google OAuth flow for a `(workspaceId, sourceId)` pair and
 * resolve when the popup posts a success status. Caller passes a
 * `onConnected` callback that fires once consent completes; the popup
 * itself closes via `window.close()` in the callback HTML page that
 * `/oauth/google/callback` serves.
 *
 * The same hook is used in two places:
 *   - `CreateWorkspaceWizard`: workspaceId comes from the wizard's
 *     typed name (the workspace doesn't exist on the server yet, but
 *     the SecretStore key is just `${workspaceId}--${sourceId}` so we
 *     can stash tokens ahead of scaffold).
 *   - `AddSourceDialog`: workspaceId is the real id of the workspace
 *     the dialog is opened on.
 */
export function useGoogleOAuth(
  workspaceId: string,
  sourceId: string,
  options: { onConnected: (sourceId: string) => void },
): UseMutationResult<{ authorizationUrl: string }, Error, void> {
  return useMutation({
    mutationFn: () => api.startGoogleOAuth(workspaceId, sourceId),
    onSuccess: (result) => {
      const popup = window.open(result.authorizationUrl, 'braid-oauth-google', 'width=520,height=720')
      if (!popup)
        return
      const onMessage = (event: MessageEvent): void => {
        const data = event.data as OauthPostMessage | null
        if (!data || data.source !== 'braid-oauth' || data.provider !== 'google')
          return
        window.removeEventListener('message', onMessage)
        if (data.status === 'success')
          options.onConnected(sourceId)
      }
      window.addEventListener('message', onMessage)
    },
  })
}
