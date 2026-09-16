import type { AudienceDescriptor, EvidenceDetail, Locale, RunRecord, SkillManifest } from '@braidhq/schema'
import { localize } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, MessageCircleQuestion, MoreHorizontal, Pencil, Plus, Send, Share2, Trash2, X } from 'lucide-react'
import { DropdownMenu as DropdownPrimitive } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BlockCanvas } from '@/components/blocks/BlockCanvas'
import { BlockOutline } from '@/components/blocks/BlockOutline'
import { RunCost } from '@/components/blocks/RunCost'
import { EmptyState } from '@/components/EmptyState'
import { ListRow, ListRowTitle } from '@/components/ListRow'
import { MentionTextarea } from '@/components/references/MentionTextarea'
import { ReferenceLabel } from '@/components/references/ReferenceLabel'
import { ReferenceText } from '@/components/references/ReferenceText'
import { ShareConversationDialog } from '@/components/ShareConversationDialog'
import { SkillTranscript } from '@/components/SkillTranscript'
import { SurfaceBand } from '@/components/SurfaceBand'
import { CollapseListButton, SurfaceLayout } from '@/components/SurfaceLayout'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { type AnswerView, TRANSCRIPT_VIEW, useAnswerView, visibleBlocks } from '@/lib/blocks/audience'
import { collectTurns } from '@/lib/blocks/collectBlocks'
import { summariseActivity } from '@/lib/blocks/runActivity'
import { readStats } from '@/lib/blocks/runStats'
import { EvidenceDetailContext, WorkspaceScopeContext } from '@/lib/blocks/WorkspaceScopeContext'
import { formatTimestamp, groupBySession, type SessionGroup } from '@/lib/conversations'
import { queryKeys, useMe, useOntology, useRuns, useSessionMetadata, useSkills, useUsers } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useConversation, useTurns } from '@/lib/useRun'
import { useSessionShareState } from '@/lib/useSessionShareState'
import { cn } from '@/lib/utils'
import { useWorkspacePolicy } from '@/policy'

const ASK_CATEGORY = 'ask'

/** A workspace that declares no audiences hides nothing, so `full` is the floor. */
function detailFor(view: AnswerView, audiences: readonly AudienceDescriptor[]): EvidenceDetail {
  return audiences.find(audience => audience.id === view)?.evidenceDetail ?? 'full'
}

/** The run's own accounting, so a reader can see what an answer cost to produce. */
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
    return <div className="p-4 text-sm text-muted-foreground">{t('ask.loading')}</div>

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
      <SurfaceLayout
        collapse={{
          collapsed: !listOpen,
          onToggle: next => setListOpen(!next),
          showLabel: t('common.showList'),
        }}
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
      <SurfaceBand
        title={t('ask.answersHeading')}
        trailing={(
          <>
            <Button
              variant="ghost"
              size="xs"
              className="[&_svg]:size-3"
              onClick={() => runStore.clearTurns(workspaceId, skill.id)}
            >
              <Plus />
              {t('ask.newQuestion')}
            </Button>
            <CollapseListButton label={t('common.hideList')} onCollapse={onCollapse} />
          </>
        )}
      />
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {answers.length === 0
          ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">{t('ask.noAnswers')}</p>
            )
          : answers.map(group => (
              <AnswerRow
                key={group.groupId}
                workspaceId={workspaceId}
                group={group}
                active={activeTurns.includes(group.records[0]?.runId ?? '')}
                onOpen={() => runStore.setTurns(workspaceId, skill.id, group.records.map(record => record.runId))}
              />
            ))}
      </div>
    </>
  )
}

/**
 * One past answer, and the controls for who else may read it.
 *
 * Only the person who asked can lend a conversation out,
 * so the share control is theirs alone,
 * and everyone else sees a marker saying the answer reached them second-hand.
 */
/** A conversation carries one turn per run that did not carry another on. */
function turnCount(group: SessionGroup): number {
  return group.records.filter(record => record.continues === undefined).length
}

/**
 * One past answer, and the actions its author holds over it.
 *
 * Only the person who asked can lend a conversation out,
 * while renaming and deleting follow the same rule the server applies,
 * which lets an owner tidy the workspace history as a whole.
 */
function AnswerRow({ workspaceId, group, active, onOpen }: {
  workspaceId: string
  group: SessionGroup
  active: boolean
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const { data: users } = useUsers()
  const policy = useWorkspacePolicy(workspaceId)
  const [shareOpen, setShareOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.title ?? group.firstPrompt)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!editing)
      setDraft(group.title ?? group.firstPrompt)
  }, [editing, group.title, group.firstPrompt])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const nameOf = (userId: string): string =>
    users?.items.find(user => user.id === userId)?.displayName ?? userId

  const isMine = me !== undefined && group.startedBy === me.id
  const { grantedTo, grantedBy } = useSessionShareState(workspaceId, group.sessionId, group.startedBy)
  // A grant reaches a session, so an orphan run has nothing to hang one on.
  const canShare = group.sessionId !== null && isMine
  // `workspace.manage` is what reaches everybody else's conversations,
  // so the server lets it rename and delete what it did not start.
  const canWrite = isMine || policy.can('workspace.manage')

  // Who a conversation travelled between, said once on the row's own line.
  // A badge saying only that it was shared leaves the reader to guess by whom,
  // and the panel is too narrow to spend on a word that answers nothing.
  const shareNote = grantedBy !== undefined
    ? t('ask.sharedBy', { name: nameOf(grantedBy) })
    : grantedTo.length === 1 && grantedTo[0] !== undefined
      ? t('ask.sharedWith', { name: nameOf(grantedTo[0]) })
      : grantedTo.length > 1
        ? t('ask.sharedWithCount', { count: grantedTo.length })
        : null

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.runs(workspaceId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessionMetadata(workspaceId) })
  }

  const rename = useMutation({
    mutationFn: ({ title }: { title: string | null }) => {
      if (!group.sessionId)
        throw new Error('An orphan run has no session to rename.')
      return api.renameSession(workspaceId, group.sessionId, title)
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: () => group.sessionId
      ? api.deleteSession(workspaceId, group.sessionId)
      // An orphan row is keyed on its run id, which is all there is to delete.
      : api.deleteRun(workspaceId, group.groupId),
    onSuccess: () => {
      setConfirmOpen(false)
      invalidate()
    },
  })

  function commitRename(): void {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === (group.title ?? group.firstPrompt))
      return
    rename.mutate({ title: next })
  }

  if (editing) {
    return (
      <li className="px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitRename()
            }
            else if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(group.title ?? group.firstPrompt)
              setEditing(false)
            }
          }}
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:border-ring focus:outline-none"
          maxLength={200}
        />
      </li>
    )
  }

  return (
    <>
      <ListRow active={active} onClick={onOpen} className="group/row flex-col items-start gap-1">
        <div className="flex w-full items-start gap-2">
          <ListRowTitle><ReferenceLabel text={group.title ?? group.firstPrompt} /></ListRowTitle>
          {(canShare || canWrite) && (
            <DropdownPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownPrimitive.Trigger asChild>
                <button
                  type="button"
                  onClick={event => event.stopPropagation()}
                  title={t('ask.answerActions')}
                  aria-label={t('ask.answerActions')}
                  className={cn(
                    'shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors duration-150',
                    'hover:bg-accent hover:text-foreground',
                    menuOpen ? 'inline-flex text-foreground' : 'hidden group-hover/row:inline-flex',
                  )}
                >
                  <MoreHorizontal className="size-3" />
                </button>
              </DropdownPrimitive.Trigger>
              <DropdownPrimitive.Portal>
                <DropdownPrimitive.Content
                  align="end"
                  sideOffset={4}
                  onClick={event => event.stopPropagation()}
                  className="z-50 min-w-36 rounded-md border border-border bg-popover p-1 text-xs shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0"
                >
                  {canShare && (
                    <DropdownPrimitive.Item
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-accent focus:bg-accent"
                      onSelect={() => setShareOpen(true)}
                    >
                      <Share2 className="size-3" />
                      {t('ask.share')}
                    </DropdownPrimitive.Item>
                  )}
                  {canWrite && group.sessionId && (
                    <DropdownPrimitive.Item
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-accent focus:bg-accent"
                      onSelect={() => setEditing(true)}
                    >
                      <Pencil className="size-3" />
                      {t('ask.rename')}
                    </DropdownPrimitive.Item>
                  )}
                  {canWrite && (
                    <>
                      <DropdownPrimitive.Separator className="my-1 h-px bg-border" />
                      <DropdownPrimitive.Item
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-destructive outline-none hover:bg-destructive/10 focus:bg-destructive/10"
                        onSelect={() => setConfirmOpen(true)}
                      >
                        <Trash2 className="size-3" />
                        {t('common.delete')}
                      </DropdownPrimitive.Item>
                    </>
                  )}
                </DropdownPrimitive.Content>
              </DropdownPrimitive.Portal>
            </DropdownPrimitive.Root>
          )}
        </div>
        <div className="flex w-full items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="shrink-0">{formatTimestamp(group.lastStartedAt)}</span>
          {shareNote && (
            <>
              <span aria-hidden className="shrink-0">·</span>
              <Share2 className="size-2.5 shrink-0" />
              <span className="truncate">{shareNote}</span>
            </>
          )}
        </div>
      </ListRow>
      {canShare && group.sessionId && (
        <ShareConversationDialog
          workspaceId={workspaceId}
          sessionId={group.sessionId}
          startedBy={group.startedBy}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ask.deleteDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('ask.deleteDialogDescription', { count: turnCount(group) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)} disabled={remove.isPending}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? t('ask.deleting') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The runs that carry another on, which the record holds whatever the log does. */
function carriedOnRuns(records: readonly RunRecord[]): ReadonlySet<string> {
  return new Set(records.filter(record => record.continues !== undefined).map(record => record.runId))
}

/**
 * The question that opened the conversation.
 *
 * A follow-up heads its own section in the canvas,
 * so carrying the latest one up here prints the same sentence twice.
 * A correction is told the gap it must close rather than a question,
 * and is skipped for the same reason it heads no section.
 *
 * Read from the run record.
 * `RUN_STARTED` carries a thread and a run and nothing about what was asked,
 * so a conversation hydrated from the protocol has no event holding it.
 */
function openingQuestion(turnIds: readonly string[], records: readonly RunRecord[]): string | null {
  for (const turnId of turnIds) {
    const record = records.find(entry => entry.runId === turnId)
    if (record && record.continues === undefined)
      return record.args
  }
  return null
}

function Answer({ workspaceId, skill }: { workspaceId: string, skill: SkillManifest }) {
  const { t } = useTranslation()
  const conversation = useConversation(workspaceId, skill.id)
  const { data: runsData } = useRuns(workspaceId)
  const { data: ontology } = useOntology(workspaceId)
  const policy = useWorkspacePolicy(workspaceId)
  const audiences = ontology?.audiences ?? []
  const [view, setView] = useAnswerView(audiences)
  const [question, setQuestion] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const running = conversation.phase === 'streaming' || submitting
  const records = runsData?.items ?? []
  const openedBy = records.find(record => record.sessionId === conversation.sessionId)?.startedBy ?? null
  const share = useSessionShareState(workspaceId, conversation.sessionId, openedBy)
  // A conversation somebody lent you is read-only.
  // The server already refuses the turn,
  // but it refuses by saying the session is absent,
  // which reads as a bug to someone looking at the transcript it names.
  //
  // `workspace.manage` reads every run and may carry any of them on,
  // so a grant adds nothing to what it already holds,
  // and locking it out would be the lie this block exists to avoid.
  const isBorrowed = share.isBorrowed && !policy.can('workspace.manage')
  const turns = collectTurns(conversation.events, carriedOnRuns(records))
  // The transcript is not an audience, so it filters nothing.
  const shownTurns = view === TRANSCRIPT_VIEW
    ? turns
    : turns.map(turn => ({ ...turn, blocks: visibleBlocks(turn.blocks, view) }))
  const stats = readStats(conversation.events)
  const askedQuestion = openingQuestion(conversation.turnIds, records)
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

  // A run that missed its output contract is resumed by the server,
  // so a turn can appear that this client never started.
  // Adopt it, or the correction's blocks never reach the canvas.
  //
  // Keyed on the run ids rather than on the live turn list,
  // because adopting changes that list,
  // and depending on what you mutate re-fires forever.
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
            ? <p className="line-clamp-2 text-sm leading-relaxed text-foreground"><ReferenceText text={askedQuestion} /></p>
            : <p className="text-sm text-muted-foreground">{t('ask.placeholderHeading')}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeRunId && (
            <Button variant="ghost" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              <X />
              {cancel.isPending ? t('common.cancelling') : t('common.cancel')}
            </Button>
          )}
        </div>
      </header>

      <SurfaceBand className="px-4">
        <ViewToggle value={view} onChange={setView} audiences={audiences} toolCalls={toolCalls} />
      </SurfaceBand>

      {view === TRANSCRIPT_VIEW
        ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <SkillTranscript events={[...conversation.events]} error={error} running={running} />
              <RunCost stats={stats} />
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

      {isBorrowed && (
        <div className="flex shrink-0 items-start gap-2 border-t border-border bg-muted/40 px-4 py-2 text-2xs text-muted-foreground">
          <Lock className="mt-0.5 size-3 shrink-0" />
          <span>{t('ask.sharedReadOnlyNotice')}</span>
        </div>
      )}
      <div className="flex shrink-0 items-end gap-2 border-t border-border px-4 py-2.5">
        <MentionTextarea
          id="ask-prompt"
          className="flex-1"
          placeholder={isBorrowed ? t('ask.sharedPlaceholder') : t('ask.inputPlaceholder')}
          value={question}
          onChange={setQuestion}
          disabled={running || isBorrowed}
          onKeyDown={(event) => {
            // An IME confirming a CJK candidate also sends Enter,
            // so composing input must never submit.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !running && !isBorrowed) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <Button size="sm" disabled={running || isBorrowed || !question.trim()} onClick={() => void send()}>
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
      <TabsList variant="line">
        {/* The description rides on `title` rather than a Tooltip wrapper.
            Wrapping a trigger stopped Radix marking it selected, and a tab
            that never looks active is worse than a plainer hover. */}
        {audiences.map((audience) => {
          const label = localize(audience.label, i18n.language as Locale)
          return (
            <TabsTrigger
              key={audience.id}
              value={audience.id}
              // `title` gives the hover description,
              // and would otherwise become the accessible name,
              // so the short label is pinned explicitly.
              aria-label={label}
              {...(audience.description ? { title: audience.description } : {})}
            >
              {label}
            </TabsTrigger>
          )
        })}
        <TabsTrigger value={TRANSCRIPT_VIEW} className="gap-1.5">
          {t('ask.view.transcript')}
          {toolCalls > 0 && <span className="font-mono text-muted-foreground/60">{toolCalls}</span>}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
