import { useMe, useSessionShares } from '@/lib/queries'

export interface SessionShareState {
  /** Ids this conversation was lent to, empty unless the viewer lent them. */
  readonly grantedTo: readonly string[]
  /** Who lent the conversation to the viewer, absent when nobody did. */
  readonly grantedBy: string | undefined
  /** True when the viewer holds it on loan rather than having started it. */
  readonly isBorrowed: boolean
}

const NOTHING_SHARED: SessionShareState = {
  grantedTo: [],
  grantedBy: undefined,
  isBorrowed: false,
}

/**
 * What a share means for the viewer looking at one conversation.
 *
 * `GET /runs/shares` answers with grants the viewer is party to,
 * so a grant between two other people never reaches here,
 * and the two directions are told apart by who started the conversation.
 *
 * Three surfaces asked the same question of the same list before this,
 * which meant a fourth kind of share state had to be added in three places.
 */
export function useSessionShareState(
  workspaceId: string,
  sessionId: string | null,
  startedBy: string | null,
): SessionShareState {
  const { data: me } = useMe()
  const { data: shares } = useSessionShares(workspaceId)
  if (sessionId === null)
    return NOTHING_SHARED

  const onThisSession = (shares?.items ?? []).filter(share => share.sessionId === sessionId)
  const isMine = me !== undefined && startedBy === me.id
  return {
    grantedTo: isMine ? onThisSession.map(share => share.grantee) : [],
    grantedBy: isMine
      ? undefined
      : onThisSession.find(share => share.grantee === me?.id)?.grantedBy,
    isBorrowed: !isMine && onThisSession.some(share => share.grantee === me?.id),
  }
}
