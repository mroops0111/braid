import type { Clarification, ClarificationAmbiguityType } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { asNodeId } from '@/lib/brands'
import { queryKeys } from '@/lib/queries'

interface SubmitIssueFormProps {
  workspaceId: string
  /** Caller closes the compose surface and may auto-select the new ticket. */
  onSubmitted: (ticket: Clarification) => void
  onCancel: () => void
}

// Ambiguity kinds the reviewer can tag. Labels and hints are translated at
// render via `sources.issueForm.ambiguity.<value>`.
const AMBIGUITY_TYPES: ClarificationAmbiguityType[] = ['gap', 'contradiction', 'ambiguous', 'assumption']

/**
 * Compose surface for a human-filed Clarification.
 * Fields are question, context, relatedNode, and ambiguityType.
 * The ticket is persisted with `origin: 'human'` and empty `candidates: []`.
 * The next ddd:clarify run is expected to append candidates,
 * so the standard pending, answered, applied pipeline can resume.
 *
 * Rendered in-place with no modal, in the Clarification page's detail pane,
 * when the reviewer chooses to compose a new issue.
 * The form takes the full pane width so multi-line fields breathe.
 * A narrower call site such as a dropdown would crowd the textareas.
 */
export function SubmitIssueForm({ workspaceId, onSubmitted, onCancel }: SubmitIssueFormProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [question, setQuestion] = useState('')
  const [context, setContext] = useState('')
  const [relatedNode, setRelatedNode] = useState('')
  const [ambiguityType, setAmbiguityType] = useState<ClarificationAmbiguityType>('gap')

  useEffect(() => {
    setQuestion('')
    setContext('')
    setRelatedNode('')
    setAmbiguityType('gap')
  }, [workspaceId])

  const submit = useMutation({
    mutationFn: () => {
      const trimmedQuestion = question.trim()
      const trimmedContext = context.trim()
      const trimmedRelatedNode = relatedNode.trim()
      return api.submitClarification(workspaceId, {
        question: trimmedQuestion,
        candidates: [],
        origin: 'human',
        ...(trimmedContext ? { context: trimmedContext } : {}),
        ...(trimmedRelatedNode ? { relatedNode: asNodeId(trimmedRelatedNode) } : {}),
        ambiguityType,
      })
    },
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clarifications(workspaceId) })
      onSubmitted(ticket)
    },
  })

  const canSubmit = question.trim().length > 0 && !submit.isPending

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div>
          <div className="text-sm font-medium text-foreground">{t('sources.issueForm.title')}</div>
          <div className="text-2xs text-muted-foreground">
            {t('sources.issueForm.subtitle')}
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          title={t('common.cancel')}
          aria-label={t('common.cancel')}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <form
        className="flex flex-1 flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit)
            submit.mutate()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="issue-question">
            {t('sources.issueForm.questionLabel')}
            {' '}
            <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="issue-question"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder={t('sources.issueForm.questionPlaceholder')}
            rows={5}
            className="resize-y"
            autoFocus
            maxLength={400}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="issue-context">
            {t('sources.issueForm.contextLabel')}
            {' '}
            <span className="text-xs text-muted-foreground">{t('sources.issueForm.optionalLabel')}</span>
          </Label>
          <Textarea
            id="issue-context"
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder={t('sources.issueForm.contextPlaceholder')}
            rows={3}
            className="resize-y text-xs"
            maxLength={2000}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_180px]">
          <div className="space-y-1.5">
            <Label htmlFor="issue-related">
              {t('sources.issueForm.relatedNodeLabel')}
              {' '}
              <span className="text-xs text-muted-foreground">{t('sources.issueForm.optionalLabel')}</span>
            </Label>
            <input
              id="issue-related"
              type="text"
              value={relatedNode}
              onChange={e => setRelatedNode(e.target.value)}
              placeholder={t('sources.issueForm.relatedNodePlaceholder')}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="issue-type">{t('common.type')}</Label>
            <select
              id="issue-type"
              value={ambiguityType}
              onChange={e => setAmbiguityType(e.target.value as ClarificationAmbiguityType)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            >
              {AMBIGUITY_TYPES.map(value => (
                <option key={value} value={value}>{t(`sources.issueForm.ambiguity.${value}.label`)}</option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-2xs text-muted-foreground">
          {t(`sources.issueForm.ambiguity.${ambiguityType}.hint`)}
        </p>

        {submit.isError && (
          <p className="text-xs text-destructive">
            {submit.error instanceof Error ? submit.error.message : t('sources.issueForm.submitFailed')}
          </p>
        )}

        <div className="mt-auto flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onCancel} disabled={submit.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submit.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            {submit.isPending ? t('common.submitting') : t('common.submit')}
          </Button>
        </div>
      </form>
    </div>
  )
}
