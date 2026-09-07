import type { AudienceDescriptor, EvidenceDetail, Locale, SkillEvent, SkillManifest } from '@braidhq/schema'
import { localize } from '@braidhq/schema'
import { useMutation } from '@tanstack/react-query'
import { MessageCircleQuestion, PanelLeftClose, PanelLeftOpen, Plus, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BlockCanvas } from '@/components/blocks/BlockCanvas'
import { BlockOutline } from '@/components/blocks/BlockOutline'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { MentionTextarea } from '@/components/references/MentionTextarea'
import { SkillTranscript } from '@/components/SkillTranscript'
import { SurfaceLayout } from '@/components/SurfaceLayout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { type AnswerView, TRANSCRIPT_VIEW, useAnswerView, visibleBlocks } from '@/lib/blocks/audience'
import { collectTurns } from '@/lib/blocks/collectBlocks'
import { summariseActivity } from '@/lib/blocks/runActivity'
import { EvidenceDetailContext, WorkspaceScopeContext } from '@/lib/blocks/WorkspaceScopeContext'
import { useOntology, useRuns, useSessionMetadata, useSkills } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useConversation, useTurns } from '@/lib/useRun'
import { formatTimestamp, groupBySession, type SessionGroup } from './Actions'

const ASK_CATEGORY = 'ask'

/** A workspace that declares no audiences hides nothing, so `full` is the floor. */
function detailFor(view: AnswerView, audiences: readonly AudienceDescriptor[]): EvidenceDetail {
  return audiences.find(audience => audience.id === view)?.evidenceDetail ?? 'full'
}

interface RunStats {
  readonly turns?: number
  readonly durationMs?: number
  readonly costUsd?: number
}

/** The run's own accounting, so a reader can see what an answer cost to produce. */
function readStats(events: readonly SkillEvent[]): RunStats | null {
  const merged: { turns?: number, durationMs?: number, costUsd?: number } = {}
  let seen = false
  for (const event of events) {
    if (event.type !== 'usage')
      continue
    seen = true
    if (event.turns !== undefined)
      merged.turns = event.turns
    if (event.durationMs !== undefined)
      merged.durationMs = event.durationMs
    if (event.costUsd !== undefined)
      merged.costUsd = event.costUsd
  }
  return seen ? merged : null
}

function formatStats(stats: RunStats): string {
  const parts = [
    stats.turns != null ? `${stats.turns} turns` : null,
    stats.durationMs != null ? `${(stats.durationMs / 1000 / 60).toFixed(1)}m` : null,
    stats.costUsd != null ? `$${stats.costUsd.toFixed(2)}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

/**
 * The workspace's read surface. An answer is the product, so it holds the page,
 * and the transcript that produced it sits behind a disclosure underneath.
 */
export function AskPage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  // Reading an answer wants the width, so the list of past ones folds away.
  const [listOpen, setListOpen] = useState(true)
  const { data: skillsData } = useSkills(workspaceId)
  const { data: runsData } = useRuns(workspaceId)
  const { data: titleData } = useSessionMetadata(workspaceId)

  const askSkill = (skillsData?.items ?? []).find(
    skill => skill.frontmatter.braid.category === ASK_CATEGORY && !skill.frontmatter.braid.hidden,
  )
  const answers = askSkill
    ? groupBySession(runsData?.items ?? [], titleData?.items ?? []).filter(group => group.skillId === askSkill.id)
    : []

  if (!skillsData)
    return <div className="p-4 text-sm text-muted-foreground">{t('review.actions.loadingActions')}</div>

  if (!askSkill) {
    return (
      <EmptyState
        icon={MessageCircleQuestion}
        title={t('ask.noSkillTitle')}
        description={t('ask.noSkillDescription')}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      {listOpen
        ? (
            <SurfaceLayout
              list={(
                <AnswerList
                  workspaceId={workspaceId}
                  skill={askSkill}
                  answers={answers}
                  onCollapse={() => setListOpen(false)}
                />
              )}
            >
              <Answer workspaceId={workspaceId} skill={askSkill} />
            </SurfaceLayout>
          )
        : (
            <div className="flex min-h-0 flex-1">
              <div className="flex w-9 shrink-0 flex-col items-center border-r border-border pt-2.5">
                <Button
                  variant="ghost"
                  size="xs"
                  className="[&_svg]:size-3.5"
                  title={t('ask.showAnswers')}
                  onClick={() => setListOpen(true)}
                >
                  <PanelLeftOpen />
                </Button>
              </div>
              <Answer workspaceId={workspaceId} skill={askSkill} />
            </div>
          )}
    </div>
  )
}

function AnswerList({ workspaceId, skill, answers, onCollapse }: {
  workspaceId: string
  skill: SkillManifest
  answers: readonly SessionGroup[]
  onCollapse: () => void
}) {
  const { t } = useTranslation()
  const activeTurns = useTurns(workspaceId, skill.id)

  return (
    <>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('ask.answersHeading')}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="xs"
            className="[&_svg]:size-3"
            onClick={() => runStore.clearTurns(workspaceId, skill.id)}
          >
            <Plus />
            {t('ask.newQuestion')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="[&_svg]:size-3.5"
            title={t('ask.hideAnswers')}
            onClick={onCollapse}
          >
            <PanelLeftClose />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {answers.length === 0
          ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">{t('ask.noAnswers')}</p>
            )
          : answers.map(group => (
              <ListRow
                key={group.groupId}
                active={activeTurns.includes(group.records[0]?.runId ?? '')}
                onClick={() => runStore.setTurns(workspaceId, skill.id, group.records.map(record => record.runId))}
              >
                <p className="line-clamp-3 text-xs leading-relaxed text-foreground/90">
                  {group.title ?? group.firstPrompt}
                </p>
                <p className="mt-1 text-2xs text-muted-foreground">{formatTimestamp(group.lastStartedAt)}</p>
              </ListRow>
            ))}
      </div>
    </>
  )
}

function Answer({ workspaceId, skill }: { workspaceId: string, skill: SkillManifest }) {
  const { t } = useTranslation()
  const conversation = useConversation(workspaceId, skill.id)
  const { data: runsData } = useRuns(workspaceId)
  const { data: ontology } = useOntology(workspaceId)
  const audiences = ontology?.audiences ?? []
  const [view, setView] = useAnswerView(audiences)
  const [question, setQuestion] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const running = conversation.phase === 'streaming' || submitting
  const turns = collectTurns(conversation.events)
  // The transcript is not an audience, so it filters nothing.
  const shownTurns = view === TRANSCRIPT_VIEW
    ? turns
    : turns.map(turn => ({ ...turn, blocks: visibleBlocks(turn.blocks, view) }))
  const stats = readStats(conversation.events)
  // The latest question, not the first. A follow-up is what the reader is
  // looking at now, and the earlier ones head their own section in the canvas.
  const askedQuestion = conversation.events.filter(event => event.type === 'started').at(-1)?.args ?? null
  const activeRunId = conversation.phase === 'streaming' ? conversation.turnIds.at(-1) ?? null : null
  const toolCalls = conversation.events.filter(event => event.type === 'tool-call').length
  const activity = summariseActivity(conversation.events)

  const cancel = useMutation({
    mutationFn: () => activeRunId ? api.cancelRun(workspaceId, activeRunId) : Promise.resolve(),
  })

  async function send(): Promise<void> {
    const asked = question.trim()
    if (!asked || running)
      return
    setQuestion('')
    setSubmitting(true)
    setLocalError(null)
    try {
      await runStore.startTurn({
        workspaceId,
        skillId: skill.id,
        question: asked,
        ...(conversation.sessionId ? { resumeSessionId: conversation.sessionId } : {}),
      })
    }
    catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
    finally {
      setSubmitting(false)
    }
  }

  // A run that missed its output contract is resumed by the server, so a turn
  // can appear that this client never started. Adopt it, or the correction's
  // blocks never reach the canvas.
  //
  // Keyed on the run ids rather than on the live turn list, because adopting
  // changes that list, and depending on what you mutate re-fires forever.
  const sessionId = conversation.sessionId
  const sessionRunIds = (runsData?.items ?? [])
    .filter(record => sessionId !== null && record.sessionId === sessionId)
    .map(record => record.runId)
    .join(',')
  useEffect(() => {
    if (sessionRunIds.length === 0)
      return
    const known = new Set(runStore.getTurns(workspaceId, skill.id))
    for (const runId of sessionRunIds.split(',')) {
      if (!known.has(runId))
        runStore.pushTurn(workspaceId, skill.id, runId)
    }
  }, [sessionRunIds, workspaceId, skill.id])

  const error = localError ?? conversation.error ?? null

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex min-h-11 shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-2.5">
        <div className="min-w-0 flex-1">
          {askedQuestion
            ? <p className="line-clamp-2 text-sm leading-relaxed text-foreground">{askedQuestion}</p>
            : <p className="text-sm text-muted-foreground">{t('ask.placeholderHeading')}</p>}
          {stats && (
            <p className="mt-0.5 font-mono text-2xs text-muted-foreground">{formatStats(stats)}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ViewToggle value={view} onChange={setView} audiences={audiences} toolCalls={toolCalls} />
          {activeRunId && (
            <Button variant="ghost" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              <X />
              {cancel.isPending ? t('common.cancelling') : t('common.cancel')}
            </Button>
          )}
        </div>
      </header>

      {view === TRANSCRIPT_VIEW
        ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <SkillTranscript events={[...conversation.events]} error={error} running={running} />
            </div>
          )
        : (
            <WorkspaceScopeContext value={workspaceId}>
              <EvidenceDetailContext value={detailFor(view, audiences)}>
                <div className="flex min-h-0 flex-1">
                  <BlockCanvas turns={shownTurns} running={running} activity={activity} />
                  <BlockOutline blocks={shownTurns.flatMap(turn => turn.blocks)} />
                </div>
              </EvidenceDetailContext>
            </WorkspaceScopeContext>
          )}

      <div className="flex shrink-0 items-end gap-2 border-t border-border px-4 py-2.5">
        <MentionTextarea
          id="ask-prompt"
          className="flex-1"
          placeholder={t('ask.inputPlaceholder')}
          value={question}
          onChange={setQuestion}
          disabled={running}
          onKeyDown={(event) => {
            // An IME confirming a CJK candidate also sends Enter,
            // so composing input must never submit.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !running) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <Button size="sm" disabled={running || !question.trim()} onClick={() => void send()}>
          <Send />
          {running ? t('ask.asking') : t('ask.send')}
        </Button>
      </div>
    </div>
  )
}

function ViewToggle({ value, onChange, audiences, toolCalls }: {
  value: AnswerView
  onChange: (next: AnswerView) => void
  audiences: readonly AudienceDescriptor[]
  toolCalls: number
}) {
  const { t, i18n } = useTranslation()
  return (
    <Tabs value={value} onValueChange={next => onChange(next as AnswerView)}>
      <TabsList variant="line" className="h-8">
        {/* The description rides on `title` rather than a Tooltip wrapper.
            Wrapping a trigger stopped Radix marking it selected, and a tab
            that never looks active is worse than a plainer hover. */}
        {audiences.map((audience) => {
          const label = localize(audience.label, i18n.language as Locale)
          return (
            <TabsTrigger
              key={audience.id}
              value={audience.id}
              className="text-2xs"
              // `title` gives the hover description, and would otherwise become
              // the accessible name, so the short label is pinned explicitly.
              aria-label={label}
              {...(audience.description ? { title: audience.description } : {})}
            >
              {label}
            </TabsTrigger>
          )
        })}
        <TabsTrigger value={TRANSCRIPT_VIEW} className="gap-1.5 text-2xs">
          {t('ask.view.transcript')}
          {toolCalls > 0 && <span className="font-mono text-muted-foreground/60">{toolCalls}</span>}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
