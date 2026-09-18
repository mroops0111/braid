import type { Locale } from '@braidhq/schema'
import { localize } from '@braidhq/schema'
import { useMutation } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useRuns, useSkills } from '@/lib/queries'
import { TopBanner } from './TopBanner'
import { Button } from './ui/button'

interface InFlightRunBannerProps {
  workspaceId: string | null
  /**
   * Surfaces that render the run's log themselves (Actions or Batch).
   * Pass `true` to suppress the banner there,
   * so the user is not shown two competing "still running" indicators.
   */
  suppress?: boolean
}

/**
 * Top-of-app banner that surfaces in-flight skill runs,
 * when the active surface does not already show the log.
 * Reads the runs list, kept live by `useWorkspaceEvents`,
 * and shows the most recent run that has no `completedAt`.
 *
 * Cancel POSTs `/runs/:id/cancel`, which SIGTERMs the claude subprocess.
 * The drain loop then emits `completed` with the actual exit code,
 * and `run.completed` flows through the event bus as usual.
 */
export function InFlightRunBanner({ workspaceId, suppress }: InFlightRunBannerProps) {
  const { data } = useRuns(workspaceId ?? undefined)
  const active = data?.items.find(r => !r.completedAt)

  if (!workspaceId || !active || suppress)
    return null

  return <ActiveBanner workspaceId={workspaceId} runId={active.runId} skillId={active.skillId} startedAt={active.startedAt} />
}

function ActiveBanner({ workspaceId, runId, skillId, startedAt }: {
  workspaceId: string
  runId: string
  skillId: string
  startedAt: string
}) {
  const { t, i18n } = useTranslation()
  const { data: skills } = useSkills(workspaceId)
  const elapsed = useElapsed(startedAt)
  // A skill id is an address, so a banner showing `/ddd:extract` shows plumbing.
  // The skill names itself for a reader, localised like the ontology's own types.
  // Absent, the id stands, which is at least true.
  const declared = skills?.items.find(skill => skill.id === skillId)?.frontmatter.braid.label
  const label = declared ? localize(declared, i18n.language as Locale) : `/${skillId}`
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(workspaceId, runId),
  })

  return (
    <TopBanner
      tone="run"
      label={label}
      detail={t('review.banners.runningElapsed', { elapsed })}
      actions={(
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-2xs"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          <X className="size-3" />
          {cancel.isPending ? t('common.cancelling') : t('common.cancel')}
        </Button>
      )}
    />
  )
}

function useElapsed(startedAt: string): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
}
