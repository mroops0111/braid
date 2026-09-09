import type { AgentCredentialStatus } from '@/lib/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { queryKeys, useAgentCredential } from '@/lib/queries'

// The one agent this deployment ships. A second would turn this into a list,
// which is why the routes are keyed by kind already.
const AGENT_KIND = 'claude-code'

// Three tones rather than a badge per source,
// since a reader acts on whether their runs are their own or refused.
const SOURCE_TONE = {
  own: 'text-emerald-400',
  server: 'text-amber-400',
  none: 'text-destructive',
} as const

export function AgentTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: status, isLoading, error } = useAgentCredential(AGENT_KIND)
  const [draft, setDraft] = useState('')

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.agentCredential(AGENT_KIND) })
  }

  const save = useMutation({
    mutationFn: () => api.saveAgentCredential(AGENT_KIND, draft.trim()),
    onSuccess: () => {
      setDraft('')
      invalidate()
    },
  })

  const forget = useMutation({
    mutationFn: () => api.forgetAgentCredential(AGENT_KIND),
    onSuccess: invalidate,
  })

  if (isLoading)
    return <p className="text-xs text-muted-foreground">{t('common.loading')}</p>

  // A deployment with no encryption key stores no credentials at all,
  // which is a fact about the server rather than something a reader fixes.
  if (error || !status)
    return <p className="text-xs text-muted-foreground">{t('admin.agent.unavailable')}</p>

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('admin.agent.title')}
        </h2>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {t('admin.agent.description')}
        </p>
      </div>

      <SourceLine status={status} />

      {status.credential
        ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xs text-muted-foreground">
                {t('admin.agent.savedHint', { hint: status.credential.hint })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-2xs"
                disabled={forget.isPending}
                onClick={() => forget.mutate()}
              >
                {t('admin.agent.forgetButton')}
              </Button>
            </div>
          )
        : null}

      <div className="flex items-center gap-1.5">
        <Input
          type="password"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder={t('admin.agent.placeholder')}
          className="h-7 max-w-md flex-1 text-2xs"
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-2xs [&_svg]:size-3"
          disabled={draft.trim().length === 0 || save.isPending}
          onClick={() => save.mutate()}
        >
          <KeyRound />
          {t('admin.agent.saveButton')}
        </Button>
      </div>
      <p className="max-w-2xl text-2xs leading-relaxed text-muted-foreground">
        {t('admin.agent.storageNote')}
      </p>
    </div>
  )
}

/**
 * Which account the reader's runs currently spend.
 *
 * Shown even where they have saved nothing,
 * because a shared seat is easy to sit on without noticing.
 */
function SourceLine({ status }: { status: AgentCredentialStatus }) {
  const { t } = useTranslation()
  return (
    <p className={`text-xs ${SOURCE_TONE[status.source]}`}>
      {t(`admin.agent.source.${status.source}`)}
    </p>
  )
}
