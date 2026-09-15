import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { queryKeys, useMe, useUsers, useWorkspaceMembers } from '@/lib/queries'
import { useSessionShareState } from '@/lib/useSessionShareState'
import { cn } from '@/lib/utils'

/** Past this many people, scanning the list beats scrolling it. */
const FILTER_THRESHOLD = 8

interface ShareConversationDialogProps {
  workspaceId: string
  sessionId: string
  /** Who opened it, so the hook can tell a grant given from one received. */
  startedBy: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Lends one conversation to named members of the same workspace.
 *
 * Every row is a toggle rather than a two-step pick-then-confirm,
 * because a grant and its withdrawal are the same size of decision,
 * and the list is the only place either one is visible.
 */
export function ShareConversationDialog({ workspaceId, sessionId, startedBy, open, onOpenChange }: ShareConversationDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const { data: members } = useWorkspaceMembers(workspaceId)
  const { data: users } = useUsers()
  const { grantedTo } = useSessionShareState(workspaceId, sessionId, startedBy)
  const [filter, setFilter] = useState('')

  // The dialog only ever opens on the viewer's own conversation,
  // so every grant on it is one they gave.
  const granteeIds = new Set(grantedTo)

  const toggle = useMutation({
    mutationFn: ({ userId, holds }: { userId: string, holds: boolean }) =>
      holds
        ? api.unshareSession(workspaceId, sessionId, userId)
        : api.shareSession(workspaceId, sessionId, userId).then(() => undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionShares(workspaceId) })
    },
  })

  const nameOf = (userId: string): string =>
    users?.items.find(user => user.id === userId)?.displayName ?? userId

  // The author already reads their own conversation, so they are not a candidate.
  const candidates = (members?.items ?? []).filter(member => member.userId !== me?.id)
  const showFilter = candidates.length > FILTER_THRESHOLD
  const needle = filter.trim().toLowerCase()
  const shownMembers = needle.length === 0
    ? candidates
    : candidates.filter(member => nameOf(member.userId).toLowerCase().includes(needle))
  const pendingUserId = toggle.isPending ? toggle.variables?.userId : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('ask.shareDialogTitle')}</DialogTitle>
          <DialogDescription>{t('ask.shareDialogDescription')}</DialogDescription>
        </DialogHeader>
        {candidates.length === 0
          ? <p className="text-xs text-muted-foreground">{t('ask.shareNoMembers')}</p>
          : (
              <div className="space-y-2">
                {showFilter && (
                  <Input
                    value={filter}
                    onChange={event => setFilter(event.target.value)}
                    placeholder={t('ask.shareFilterPlaceholder')}
                    className="h-8 text-xs"
                  />
                )}
                {shownMembers.length === 0
                  ? <p className="px-1 py-2 text-xs text-muted-foreground">{t('ask.shareNoMatches')}</p>
                  : (
                      <ul className="max-h-64 overflow-y-auto scrollbar-thin">
                        {shownMembers.map((member) => {
                          const holds = granteeIds.has(member.userId)
                          return (
                            <li
                              key={member.userId}
                              className="flex items-center justify-between gap-3 rounded-md px-1 py-1 transition-colors duration-150 hover:bg-accent"
                            >
                              <div className="flex min-w-0 items-baseline gap-2">
                                <span className="truncate text-xs text-foreground/90">{nameOf(member.userId)}</span>
                                <span className="shrink-0 text-2xs uppercase text-muted-foreground">{member.role}</span>
                              </div>
                              <Button
                                size="xs"
                                variant={holds ? 'secondary' : 'ghost'}
                                className={cn('shrink-0 [&_svg]:size-2.5', !holds && 'text-muted-foreground')}
                                disabled={toggle.isPending}
                                onClick={() => toggle.mutate({ userId: member.userId, holds })}
                              >
                                {pendingUserId === member.userId
                                  ? <Loader2 className="animate-spin" />
                                  : holds && <Check />}
                                {holds ? t('ask.shareHolds') : t('ask.shareGrant')}
                              </Button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
              </div>
            )}
        {toggle.isError && (
          <p className="text-2xs text-destructive">{t('ask.shareFailed')}</p>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('ask.shareDone')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
