import type { AgentCredentialStatus, AgentSummary } from '@/lib/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { queryKeys, useAgentCredential, useAgents } from '@/lib/queries'

// Three tones rather than a badge per source,
// since a reader acts on whether their runs are their own or refused.
const SOURCE_TONE = {
  own: 'text-emerald-400',
  server: 'text-amber-400',
  none: 'text-destructive',
} as const

export function AgentTab() {
  const { t } = useTranslation()
  const { data, isLoading } = useAgents()

  if (isLoading)
    return <p className="text-xs text-muted-foreground">{t('common.loading')}</p>

  const agents = data?.agents ?? []
  if (agents.length === 0)
    return <p className="text-xs text-muted-foreground">{t('admin.agent.noAgents')}</p>

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('admin.agent.title')}
        </h2>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {t('admin.agent.description')}
        </p>
      </div>

      {agents.map(agent => <AgentCredentialFields key={agent.kind} agent={agent} />)}

      <p className="max-w-2xl text-2xs leading-relaxed text-muted-foreground">
        {t('admin.agent.storageNote')}
      </p>
    </div>
  )
}

/**
 * One agent's credential, saved and forgotten on its own.
 *
 * A skill names the agent it wants in its frontmatter,
 * so a person may be running two and owe a credential to each.
 */
function AgentCredentialFields({ agent }: { agent: AgentSummary }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: status, isLoading, error } = useAgentCredential(agent.kind)
  const [draft, setDraft] = useState('')
  // Replacing is one overwrite rather than a forget followed by a save,
  // so no run in between is refused or charged to the shared seat.
  const [replacing, setReplacing] = useState(false)

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.agentCredential(agent.kind) })
  }

  const save = useMutation({
    mutationFn: () => api.saveAgentCredential(agent.kind, draft.trim()),
    onSuccess: () => {
      setDraft('')
      setReplacing(false)
      invalidate()
    },
  })

  const forget = useMutation({
    mutationFn: () => api.forgetAgentCredential(agent.kind),
    onSuccess: invalidate,
  })

  if (isLoading)
    return <p className="text-xs text-muted-foreground">{t('common.loading')}</p>

  // A deployment with no encryption key stores no credentials at all,
  // which is a fact about the server rather than something a reader fixes.
  if (error || !status)
    return <p className="text-xs text-muted-foreground">{t('admin.agent.unavailable')}</p>

  return (
    <div className="space-y-2">
      <h3 className="font-mono text-2xs text-foreground">{agent.kind}</h3>
      <SourceLine status={status} />

      {status.credential
        ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xs text-muted-foreground">
                {t('admin.agent.savedMasked', { masked: status.credential.masked })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-2xs"
                onClick={() => {
                  setDraft('')
                  setReplacing(!replacing)
                }}
              >
                {replacing ? t('common.cancel') : t('admin.agent.replaceButton')}
              </Button>
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

      {/* Hidden once one is saved, since an empty box beside a saved value
          says nothing about what typing in it would do. */}
      <div className={`flex items-center gap-1.5 ${status.credential && !replacing ? 'hidden' : ''}`}>
        <Input
          type="password"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          // The command belongs to the agent, not to this page,
          // so an agent that declares none is asked for plainly.
          placeholder={agent.credentialCommand
            ? t('admin.agent.placeholderCommand', { command: agent.credentialCommand })
            : t('admin.agent.placeholder')}
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
