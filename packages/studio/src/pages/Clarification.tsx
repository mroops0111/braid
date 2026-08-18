import type { Clarification, ClarificationCandidate, ClarificationStatus, ExternalReference, GraphOperation, NodeId, ProposalId } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Inbox, Pencil, Plus, SkipForward, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { PageActions } from '@/components/PageActions'
import { MentionTextarea } from '@/components/references/MentionTextarea'
import { NodeReferenceTag } from '@/components/references/ReferenceTag'
import { ReferenceText } from '@/components/references/ReferenceText'
import { StatusBadge } from '@/components/StatusBadge'
import { SubmitIssueForm } from '@/components/SubmitIssueForm'
import { SurfaceLayout } from '@/components/SurfaceLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FILTER_TAB_TRIGGER, FILTER_TABS_LIST } from '@/components/ui/filterTabs'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { queryKeys, useClarificationByStatus, useClarificationDetail, usePendingClarification, useWorkspaceMembers } from '@/lib/queries'
import { useTabNavigation } from '@/lib/useTabNavigation'
import { useWorkspacePolicy } from '@/policy'

export interface OpsSummary {
  adds: number
  updates: number
  removes: number
  total: number
}

/**
 * Walk a candidate's proposed operations and count adds, updates,
 * and removes, fanning batch ops out into their element counts,
 * so a single `addNodes` of three nodes reads as +3, not +1.
 */
export function summarizeOps(operations: readonly GraphOperation[]): OpsSummary {
  let adds = 0
  let updates = 0
  let removes = 0
  for (const op of operations) {
    switch (op.operation) {
      case 'addNode':
      case 'addEdge':
        adds += 1
        break
      case 'addNodes':
      case 'addEdges':
        adds += op.payloads.length
        break
      case 'removeNode':
      case 'removeEdge':
        removes += 1
        break
      case 'removeNodes':
        removes += op.nodeIds.length
        break
      case 'removeEdges':
        removes += op.edgeIds.length
        break
      case 'updateNode':
      case 'updateEdge':
        updates += 1
        break
      case 'updateNodes':
      case 'updateEdges':
        updates += op.updates.length
        break
      default: {
        const exhaustive: never = op
        throw new Error(`Unhandled GraphOperation: ${JSON.stringify(exhaustive)}`)
      }
    }
  }
  return { adds, updates, removes, total: adds + updates + removes }
}

/**
 * Short rendering of an OpsSummary for inline use, like `+2 / ~1`.
 * Returns the empty-impact phrase when total is 0,
 * so callers can display it as-is.
 */
export function formatOpsSummary(summary: OpsSummary): string {
  if (summary.total === 0)
    return 'no graph impact'
  const parts: string[] = []
  if (summary.adds > 0)
    parts.push(`+${summary.adds}`)
  if (summary.updates > 0)
    parts.push(`~${summary.updates}`)
  if (summary.removes > 0)
    parts.push(`−${summary.removes}`)
  return parts.join(' / ')
}

/** Letter prefix (A, B, C, and so on) for a candidate option index. */
export function candidateLetter(index: number): string {
  return String.fromCharCode(65 + index)
}

/** Short, whitespace-collapsed excerpt of a clarification question, suitable for list rows. */
export function questionExcerpt(question: string, max = 80): string {
  const trimmed = question.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= max)
    return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

interface ClarificationPageProps {
  workspaceId: string
}

type StatusFilter = ClarificationStatus

export function ClarificationPage({ workspaceId }: ClarificationPageProps) {
  const { t } = useTranslation()
  // Same shape as Proposals. Status drives the list query,
  // and the detail pane reads only from the selected ticket,
  // so it cannot show an item that no longer matches the active filter.
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [showAll, setShowAll] = useState(false)
  const [selected, setSelected] = useState<Clarification | null>(null)
  // When `true`, the detail pane renders the inline SubmitIssueForm,
  // instead of the selected ticket.
  // Mutually exclusive with `selected`,
  // the compose surface fills the same area,
  // so the reviewer is never doing two things at once.
  const [composing, setComposing] = useState(false)
  const { data, isLoading } = useClarificationByStatus(workspaceId, status, showAll)

  // Auto-select the first ticket when entering a list with no selection,
  // on initial mount, after a status switch,
  // or after answer or skip clears the detail pane.
  // Saves the reviewer one click per ticket when working through a queue.
  useEffect(() => {
    if (composing || selected || isLoading || !data?.items.length)
      return
    setSelected(data.items[0]!)
  }, [data, selected, isLoading, composing])

  function changeStatus(next: StatusFilter): void {
    setStatus(next)
    setSelected(null)
    setComposing(false)
  }

  function startComposing(): void {
    setSelected(null)
    setComposing(true)
  }

  // The "submit an issue" affordance is meaningful only on the Pending tab,
  // the other statuses are post-resolution archives.
  // Keeping it pending-only also reduces surprise,
  // you would never expect to file a new issue while browsing rejected ones.
  const canSubmitIssue = status === 'pending'

  return (
    <div className="flex h-full flex-col">
      <PageActions>
        <ClarificationHeaderActions
          workspaceId={workspaceId}
          status={status}
          onChange={changeStatus}
        />
        <ClarificationShowAllToggle
          workspaceId={workspaceId}
          status={status}
          showAll={showAll}
          onToggle={setShowAll}
        />
      </PageActions>
      <SurfaceLayout
        list={(
          <>
            {isLoading
              ? (
                  <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
                )
              : (
                  <>
                    {data && data.items.length > 0 && (
                      <ul className="flex-1 overflow-y-auto scrollbar-thin">
                        {data.items.map(ticket => (
                          <ClarificationListItem
                            key={ticket.id}
                            ticket={ticket}
                            active={selected?.id === ticket.id}
                            onSelect={() => {
                              setComposing(false)
                              setSelected(ticket)
                            }}
                          />
                        ))}
                      </ul>
                    )}
                    {canSubmitIssue && (
                      <button
                        type="button"
                        onClick={startComposing}
                        className="m-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 py-2 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                      >
                        <Plus className="size-3.5" />
                        {t('review.clarify.submitQuestionButton')}
                      </button>
                    )}
                  </>
                )}
          </>
        )}
      >
        <div className="flex-1 overflow-hidden">
          {composing
            ? (
                <SubmitIssueForm
                  workspaceId={workspaceId}
                  onCancel={() => setComposing(false)}
                  onSubmitted={(ticket) => {
                    // SSE clarification.created already invalidates the list.
                    // Selecting the new ticket also dismisses compose mode,
                    // so the reviewer lands on the freshly filed issue.
                    setComposing(false)
                    setStatus('pending')
                    setSelected(ticket)
                  }}
                />
              )
            : selected
              ? (
                  <ClarificationDetail
                    workspaceId={workspaceId}
                    ticket={selected}
                    onComplete={() => setSelected(null)}
                    key={selected.id}
                  />
                )
              : (
                  <EmptyState
                    icon={Inbox}
                    title={data?.items.length ? t('review.clarify.pickTitle') : t(`review.clarify.empty.${status}.title`)}
                    description={
                      data?.items.length
                        ? status === 'pending'
                          ? t('review.clarify.pickPendingDescription')
                          : t('review.clarify.pickTerminalDescription')
                        : t(`review.clarify.empty.${status}.description`)
                    }
                  />
                )}
        </div>
      </SurfaceLayout>
    </div>
  )
}

/**
 * Header strip: status filter with a live badge on pending.
 * The "submit a question" affordance lives inline,
 * at the bottom of the list panel rather than here,
 * so the header stays focused on navigation.
 */
function ClarificationShowAllToggle({
  workspaceId,
  status,
  showAll,
  onToggle,
}: {
  workspaceId: string
  status: StatusFilter
  showAll: boolean
  onToggle: (next: boolean) => void
}) {
  const { t } = useTranslation()
  const { effectiveRole } = useWorkspacePolicy(workspaceId)
  const { data: members } = useWorkspaceMembers(workspaceId)
  // Nothing to disambiguate on a solo workspace, every question is yours.
  const multiMember = (members?.items.length ?? 0) > 1
  if (effectiveRole !== 'owner' || status !== 'pending' || !multiMember)
    return null
  return (
    <Button
      variant={showAll ? 'default' : 'ghost'}
      size="sm"
      className="h-7 text-2xs"
      onClick={() => onToggle(!showAll)}
      title={showAll ? t('review.clarify.showingAllTooltip') : t('review.clarify.mineOnlyTooltip')}
    >
      {showAll ? t('review.clarify.showingAll') : t('review.clarify.mineOnly')}
    </Button>
  )
}

function ClarificationHeaderActions({
  workspaceId,
  status,
  onChange,
}: {
  workspaceId: string
  status: StatusFilter
  onChange: (next: StatusFilter) => void
}) {
  const { t } = useTranslation()
  const { data: pending } = usePendingClarification(workspaceId)
  const pendingCount = pending?.items.length ?? 0
  return (
    <Tabs value={status} onValueChange={value => onChange(value as StatusFilter)}>
      <TabsList className={FILTER_TABS_LIST}>
        <TabsTrigger value="pending" className={FILTER_TAB_TRIGGER}>
          {t('review.clarify.tabPending')}
          {pendingCount > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-px text-2xs font-medium leading-none text-primary">
              {pendingCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="answered" className={FILTER_TAB_TRIGGER}>{t('review.clarify.tabAnswered')}</TabsTrigger>
        <TabsTrigger value="applied" className={FILTER_TAB_TRIGGER}>{t('review.clarify.tabApplied')}</TabsTrigger>
        <TabsTrigger value="skipped" className={FILTER_TAB_TRIGGER}>{t('review.clarify.tabSkipped')}</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

function ClarificationListItem({
  ticket,
  active,
  onSelect,
}: {
  ticket: Clarification
  active: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  return (
    <ListRow active={active} onClick={onSelect} className="flex-col gap-1">
      <div className="flex w-full items-start justify-between gap-2">
        <span className="break-words text-xs text-foreground/90">
          {questionExcerpt(ticket.question, 90)}
        </span>
        <StatusBadge status={ticket.status} />
      </div>
      <div className="flex w-full items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span>
          {t('review.clarify.candidateCount', { count: ticket.candidates.length })}
        </span>
        {ticket.proposalId && (
          <span className="font-mono text-muted-foreground/80" title={t('review.clarify.linkedToProposal', { id: ticket.proposalId })}>
            →
            {' '}
            {ticket.proposalId}
          </span>
        )}
      </div>
    </ListRow>
  )
}

function ClarificationDetail({
  workspaceId,
  ticket,
  onComplete,
}: {
  workspaceId: string
  ticket: Clarification
  onComplete: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const canWrite = useWorkspacePolicy(workspaceId).can('clarification.write')
  const isPending = ticket.status === 'pending'
  // The two answer paths are mutually exclusive.
  // Picking an existing candidate closes the custom-answer form,
  // and vice versa.
  // Keeping them separated avoids a hidden "picked B but also typed" state,
  // where the user cannot tell what will be submitted.
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customDescription, setCustomDescription] = useState('')
  const [note, setNote] = useState('')
  const [skipOpen, setSkipOpen] = useState(false)
  const [skipReason, setSkipReason] = useState('')

  function invalidateClarification(): void {
    // The 3-element prefix matches every status sub-key,
    // so the freshly-moved ticket disappears from the current list,
    // and re-appears in its new tab without manual reconciliation.
    queryClient.invalidateQueries({ queryKey: queryKeys.clarifications(workspaceId) })
  }

  const answer = useMutation({
    mutationFn: (input: { selection: { candidateId: string } | { customCandidate: { description: string } }, note?: string }) =>
      api.answerClarification(workspaceId, ticket.id, input.selection, input.note),
    onSuccess: () => {
      invalidateClarification()
      onComplete()
    },
  })

  const skip = useMutation({
    mutationFn: (reason: string) =>
      api.skipClarification(workspaceId, ticket.id, reason),
    onSuccess: () => {
      invalidateClarification()
      onComplete()
    },
  })

  const trimmedCustom = customDescription.trim()
  const trimmedNote = note.trim()
  const customReady = customOpen && trimmedCustom.length > 0
  const existingReady = !customOpen && selectedCandidateId !== null
  const canAnswer = (customReady || existingReady) && !answer.isPending

  // For terminal states, fetch the projected answerNote and skipReason,
  // once, and thread them down.
  // Lets the answered candidate row show the rationale inline,
  // the same anchor as the editable rationale on pending,
  // instead of dumping it in the footer.
  const detail = useClarificationDetail(workspaceId, isPending ? null : ticket.id)
  const terminalAnswerNote = !isPending ? detail.data?.answerNote : undefined
  const projectedSkipReason = ticket.status === 'skipped' ? detail.data?.skipReason : undefined

  function pickExisting(id: string): void {
    setSelectedCandidateId(id)
    setCustomOpen(false)
    setCustomDescription('')
  }
  function openCustom(): void {
    setCustomOpen(true)
    setSelectedCandidateId(null)
  }
  function closeCustom(): void {
    setCustomOpen(false)
    setCustomDescription('')
  }

  function submitAnswer(): void {
    const optionalNote = trimmedNote.length > 0 ? trimmedNote : undefined
    if (customReady) {
      answer.mutate({
        selection: { customCandidate: { description: trimmedCustom } },
        ...(optionalNote ? { note: optionalNote } : {}),
      })
      return
    }
    if (existingReady && selectedCandidateId) {
      answer.mutate({
        selection: { candidateId: selectedCandidateId },
        ...(optionalNote ? { note: optionalNote } : {}),
      })
    }
  }

  const answerButtonLabel = (() => {
    if (customReady)
      return t('review.clarify.answerWithCustomButton')
    if (selectedCandidateId !== null) {
      const idx = ticket.candidates.findIndex(c => c.id === selectedCandidateId)
      if (idx >= 0)
        return t('review.clarify.answerWithButton', { letter: candidateLetter(idx) })
    }
    return t('review.clarify.answerButton')
  })()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-2xs text-muted-foreground">{ticket.id}</div>
          <p className="mt-0.5 text-sm leading-relaxed text-foreground" title={ticket.question}>
            <ReferenceText text={ticket.question} />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={ticket.status} />
        </div>
      </header>

      {ticket.externalReferences && ticket.externalReferences.length > 0 && (
        <ExternalRefs refs={ticket.externalReferences} />
      )}

      <FiledContext ticket={ticket} />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <CandidatesList
          candidates={ticket.candidates}
          isPending={isPending}
          selectedCandidateId={selectedCandidateId}
          appliedCandidateId={ticket.selectedCandidateId ?? null}
          onSelect={pickExisting}
          note={note}
          onNoteChange={setNote}
          terminalAnswerNote={terminalAnswerNote ?? null}
        />
        {isPending && (
          <CustomAnswerSection
            open={customOpen}
            value={customDescription}
            onOpen={openCustom}
            onClose={closeCustom}
            onChange={setCustomDescription}
            letter={candidateLetter(ticket.candidates.length)}
            note={note}
            onNoteChange={setNote}
          />
        )}
      </div>

      {isPending && canWrite && (
        <div className="shrink-0 space-y-3 border-t border-border bg-background/80 px-4 py-3">
          {!skipOpen
            ? (
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSkipOpen(true)}
                    disabled={answer.isPending}
                  >
                    <SkipForward />
                    {t('review.clarify.skipButton')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!canAnswer}
                    onClick={submitAnswer}
                  >
                    <Check />
                    {answerButtonLabel}
                  </Button>
                </div>
              )
            : (
                <SkipForm
                  value={skipReason}
                  onChange={setSkipReason}
                  onCancel={() => {
                    setSkipOpen(false)
                    setSkipReason('')
                  }}
                  onSubmit={() => skip.mutate(skipReason.trim())}
                  isPending={skip.isPending}
                />
              )}
          {(answer.error || skip.error) && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {((answer.error ?? skip.error) as Error).message}
            </p>
          )}
        </div>
      )}

      {!isPending && (
        <TerminalFooter ticket={ticket} skipReason={projectedSkipReason ?? null} />
      )}
    </div>
  )
}

/**
 * Inline "+ Add my own answer" form.
 * When the reviewer's actual answer matches no candidate,
 * they author one here.
 * The server appends it to the ticket on submit,
 * so it shows up in the candidates list afterwards.
 */
function CustomAnswerSection({
  open,
  value,
  onOpen,
  onClose,
  onChange,
  letter,
  note,
  onNoteChange,
}: {
  open: boolean
  value: string
  onOpen: () => void
  onClose: () => void
  onChange: (next: string) => void
  letter: string
  note: string
  onNoteChange: (next: string) => void
}) {
  const { t } = useTranslation()
  if (!open) {
    return (
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          <Pencil className="size-3" />
          {t('review.clarify.addOwnAnswer')}
        </button>
      </div>
    )
  }
  return (
    <div className="px-3 pb-3">
      <div className="rounded-md border border-primary/40 bg-primary/5">
        <div className="space-y-2 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="flex size-5 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground">
                {letter}
              </span>
              {t('review.clarify.customAnswer')}
            </span>
            <button
              type="button"
              onClick={onClose}
              title={t('review.clarify.discardButton')}
              aria-label={t('review.clarify.discardButton')}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <MentionTextarea
            id="clarification-custom-answer"
            autoFocus
            value={value}
            onChange={onChange}
            rows={3}
            compact
            placeholder={t('review.clarify.customAnswerPlaceholder')}
          />
          <p className="text-2xs text-muted-foreground">
            {t('review.clarify.customAnswerHint')}
          </p>
        </div>
        <div className="border-t border-primary/20 px-3 py-2">
          <InlineRationale
            slot={{ mode: 'edit', value: note, onChange: onNoteChange }}
            candidateLetter={letter}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Background a human attached when filing the issue.
 * Skill-authored tickets leave both fields empty, so the section hides itself,
 * which keeps the AI-authored detail pane exactly as it was.
 */
function FiledContext({ ticket }: { ticket: Clarification }) {
  const { t } = useTranslation()
  if (!ticket.context && !ticket.relatedNode)
    return null
  return (
    <section className="shrink-0 space-y-1.5 border-b border-border/60 bg-muted/20 px-4 py-2">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('review.clarify.contextTitle')}
      </h3>
      {ticket.relatedNode && (
        <div className="flex items-baseline gap-1.5 text-2xs text-muted-foreground">
          <span>{t('review.clarify.relatedNodeLabel')}</span>
          <NodeReferenceTag nodeId={ticket.relatedNode} />
        </div>
      )}
      {ticket.context && (
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
          <ReferenceText text={ticket.context} />
        </p>
      )}
    </section>
  )
}

function ExternalRefs({ refs }: { refs: readonly ExternalReference[] }) {
  const { t } = useTranslation()
  return (
    <div className="shrink-0 border-b border-border/60 bg-muted/20 px-4 py-2">
      <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('review.clarify.externalSources')}
      </div>
      <ul className="mt-1.5 space-y-1">
        {refs.map((ref, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-2xs uppercase tracking-wider text-muted-foreground">
              {ref.kind}
            </Badge>
            <a
              href={ref.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
            >
              {ref.label ?? ref.url}
              <ExternalLink className="size-3 shrink-0 text-muted-foreground/50" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CandidatesList({
  candidates,
  isPending,
  selectedCandidateId,
  appliedCandidateId,
  onSelect,
  note,
  onNoteChange,
  terminalAnswerNote,
}: {
  candidates: readonly ClarificationCandidate[]
  isPending: boolean
  selectedCandidateId: string | null
  appliedCandidateId: string | null
  onSelect: (id: string) => void
  note: string
  onNoteChange: (next: string) => void
  /**
   * Read-only rationale from the GET projection.
   * Surfaced inline under the answered candidate,
   * so the visual anchor matches the editable rationale on pending.
   */
  terminalAnswerNote: string | null
}) {
  const { t } = useTranslation()
  if (candidates.length === 0) {
    return (
      <p className="m-4 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        {t('review.clarify.noCandidates')}
      </p>
    )
  }
  return (
    <ul className="space-y-1 p-3" role={isPending ? 'radiogroup' : undefined}>
      {candidates.map((candidate, index) => {
        const isSelected = isPending
          ? selectedCandidateId === candidate.id
          : appliedCandidateId === candidate.id
        // Editable on pending and active, read-only on terminal and active,
        // if a note exists, null otherwise.
        // The card layout stays the same, only the inner control changes.
        const inlineNote = isPending && isSelected
          ? { mode: 'edit' as const, value: note, onChange: onNoteChange }
          : !isPending && isSelected && terminalAnswerNote
              ? { mode: 'view' as const, value: terminalAnswerNote }
              : null
        return (
          <CandidateRow
            key={candidate.id}
            candidate={candidate}
            letter={candidateLetter(index)}
            isPending={isPending}
            active={isSelected}
            dimmed={!isPending && appliedCandidateId !== null && appliedCandidateId !== candidate.id}
            onSelect={() => onSelect(candidate.id)}
            inlineNote={inlineNote}
          />
        )
      })}
    </ul>
  )
}

type InlineNote =
  | { mode: 'edit', value: string, onChange: (next: string) => void }
  | { mode: 'view', value: string }
  | null

function CandidateRow({
  candidate,
  letter,
  isPending,
  active,
  dimmed,
  onSelect,
  inlineNote,
}: {
  candidate: ClarificationCandidate
  letter: string
  isPending: boolean
  active: boolean
  dimmed: boolean
  onSelect: () => void
  /**
   * Anchored rationale slot, identical visual position across statuses.
   * `edit` renders a textarea when pending and selected.
   * `view` renders a read-only quote,
   * when answered or applied and selected and a projection note exists.
   * `null` hides the slot entirely.
   */
  inlineNote: InlineNote
}) {
  const { t } = useTranslation()
  const summary = summarizeOps(candidate.proposedOperations)
  const nodeIds = collectNodeIds(candidate)

  const cardClass = `rounded-md border transition-colors ${
    active
      ? 'border-primary/40 bg-primary/5'
      : isPending
        ? 'border-border hover:border-border/80 hover:bg-accent/40'
        : 'border-border'
  } ${dimmed ? 'opacity-60' : ''}`

  // Inner row layout: letter chip, then description and impact.
  // Always rendered, only the wrapping element flips,
  // between an interactive <button> (pending) and a passive <div> (terminal).
  const innerRow = (
    <div className="flex w-full items-start gap-3 px-3 py-2 text-left">
      <span
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold ${
          active ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 text-muted-foreground'
        }`}
      >
        {letter}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{candidate.description}</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t('review.clarify.impact')}
          </span>
          <span>{summary.total === 0 ? t('review.clarify.noGraphImpact') : formatOpsSummary(summary)}</span>
        </p>
      </div>
    </div>
  )

  // Same reason as the rationale below, a tag is a button,
  // and a button inside the radio button would be invalid HTML.
  const references = nodeIds.length > 0
    ? (
        <div className="flex flex-wrap gap-1 px-3 pb-2 text-2xs">
          {nodeIds.map(id => <NodeReferenceTag key={id} nodeId={id} />)}
        </div>
      )
    : null

  // Rationale lives in the same card as the row,
  // but as a sibling of the click target,
  // so it is not a textarea-inside-button, which is invalid HTML,
  // and clicks inside it do not bubble to the radio.
  const rationale = inlineNote !== null
    ? (
        <div className="border-t border-primary/20 px-3 py-2">
          <InlineRationale slot={inlineNote} candidateLetter={letter} />
        </div>
      )
    : null

  return (
    <li className={cardClass}>
      {isPending
        ? (
            <button
              type="button"
              role="radio"
              aria-checked={active}
              onClick={onSelect}
              className="block w-full"
            >
              {innerRow}
            </button>
          )
        : innerRow}
      {references}
      {rationale}
    </li>
  )
}

/**
 * Rationale slot rendered inline under the active candidate.
 * Same position and label whether the row is editable,
 * pending and selected, or read-only with a projection note.
 * The consistency lets reviewers form one mental model,
 * that rationale lives under the chosen answer across the lifetime.
 */
function InlineRationale({
  slot,
  candidateLetter,
}: {
  slot: Exclude<InlineNote, null>
  candidateLetter: string
}) {
  const { t } = useTranslation()
  if (slot.mode === 'view') {
    return (
      <div>
        <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('review.clarify.rationale')}
        </div>
        <p className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground/85">
          {slot.value}
        </p>
      </div>
    )
  }
  return (
    <div>
      <label
        htmlFor={`clarification-rationale-${candidateLetter}`}
        className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {t('review.clarify.rationale')}
        <span className="ml-1 normal-case tracking-normal text-muted-foreground/60">{t('review.clarify.optionalLabel')}</span>
      </label>
      <div className="mt-1">
        <MentionTextarea
          id={`clarification-rationale-${candidateLetter}`}
          value={slot.value}
          onChange={slot.onChange}
          rows={2}
          compact
          placeholder={t('review.clarify.rationalePlaceholder', { letter: candidateLetter })}
        />
      </div>
    </div>
  )
}

function collectNodeIds(candidate: ClarificationCandidate): NodeId[] {
  const ids = new Set<NodeId>()
  for (const op of candidate.proposedOperations) {
    switch (op.operation) {
      case 'addNode':
        if (op.payload.id)
          ids.add(op.payload.id)
        break
      case 'addNodes':
        for (const n of op.payloads) {
          if (n.id)
            ids.add(n.id)
        }
        break
      case 'removeNode':
        ids.add(op.nodeId)
        break
      case 'removeNodes':
        for (const id of op.nodeIds)
          ids.add(id)
        break
      case 'updateNode':
        ids.add(op.nodeId)
        break
      case 'updateNodes':
        for (const u of op.updates)
          ids.add(u.nodeId)
        break
      // Edge ops are intentionally no-ops here,
      // GraphNavigation has no edge-side selection yet.
      // Enumerating them keeps the switch exhaustive,
      // so adding a 13th discriminant compile-errors.
      case 'addEdge':
      case 'addEdges':
      case 'removeEdge':
      case 'removeEdges':
      case 'updateEdge':
      case 'updateEdges':
        break
      default: {
        const exhaustive: never = op
        throw new Error(`Unhandled GraphOperation: ${JSON.stringify(exhaustive)}`)
      }
    }
  }
  return [...ids]
}

function SkipForm({ value, onChange, onCancel, onSubmit, isPending }: {
  value: string
  onChange: (v: string) => void
  onCancel: () => void
  onSubmit: () => void
  isPending: boolean
}) {
  const { t } = useTranslation()
  const hasReason = value.trim().length > 0
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
      <label className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('review.clarify.skipReasonLabel')}
      </label>
      <textarea
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        placeholder={t('review.clarify.skipReasonPlaceholder')}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>{t('common.cancel')}</Button>
        <Button size="sm" disabled={!hasReason || isPending} onClick={onSubmit}>
          {isPending ? t('review.clarify.skipping') : t('review.clarify.confirmSkipButton')}
        </Button>
      </div>
    </div>
  )
}

function TerminalFooter({ ticket, skipReason }: { ticket: Clarification, skipReason: string | null }) {
  const { t } = useTranslation()
  // The reviewer's rationale (answerNote) for answered or applied tickets,
  // is rendered inline under the selected candidate, not here,
  // so the visual anchor matches the editable rationale on pending.
  // The footer is reserved for status-action info only,
  // such as "Run /ddd:clarify", "to Proposal #abc", or a skip reason,
  // which has no candidate to anchor to.
  if (ticket.status === 'answered') {
    return (
      <footer className="shrink-0 border-t border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        {ticket.answeredBy ? t('review.clarify.answeredActor', { name: ticket.answeredBy }) : t('review.clarify.answeredNoActor')}
        {' '}
        {t('review.clarify.answeredRunPrefix')}
        {' '}
        <code className="rounded bg-muted px-1 font-mono text-2xs text-foreground/90">/ddd:clarify</code>
        {' '}
        {t('review.clarify.answeredRunSuffix')}
      </footer>
    )
  }
  if (ticket.status === 'applied') {
    return (
      <footer className="shrink-0 border-t border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        {ticket.proposalId
          ? (
              <>
                {t('review.clarify.appliedMaterialisedPrefix')}
                {' '}
                <AppliedProposalChip proposalId={ticket.proposalId} />
                {t('review.clarify.appliedMaterialisedSuffix')}
              </>
            )
          : <span>{t('review.clarify.appliedNoProposal')}</span>}
      </footer>
    )
  }
  // Skipped tickets have no selectedCandidate to anchor the reason under,
  // so the footer is the right home for it.
  return (
    <footer className="shrink-0 space-y-1 border-t border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
      <div>
        {ticket.answeredBy ? t('review.clarify.skippedActor', { name: ticket.answeredBy }) : t('review.clarify.skippedNoActor')}
      </div>
      {skipReason && (
        <p className="whitespace-pre-wrap rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-700 dark:text-amber-300">
          {skipReason}
        </p>
      )}
    </footer>
  )
}

/**
 * Click-through chip linking an applied ticket to the Proposal,
 * it materialised.
 * Switches to the Proposals tab and asks it to focus the target.
 * ProposalsPage handles the cross-status lookup.
 */
function AppliedProposalChip({ proposalId }: { proposalId: ProposalId }) {
  const { t } = useTranslation()
  const nav = useTabNavigation()
  if (!nav) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground/90">
        →
        {' '}
        {proposalId}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => nav.focusProposal(proposalId)}
      className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground/90 transition-colors hover:bg-accent hover:text-foreground"
      title={t('review.clarify.openInProposalsButton')}
    >
      →
      {' '}
      {proposalId}
    </button>
  )
}
