import type { Clarification, ClarificationAmbiguityType, NodeId } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queries'

interface SubmitIssueFormProps {
  workspaceId: string
  /** Caller closes the compose surface and may auto-select the new ticket. */
  onSubmitted: (ticket: Clarification) => void
  onCancel: () => void
}

const AMBIGUITY_TYPES: { value: ClarificationAmbiguityType, label: string, hint: string }[] = [
  { value: 'gap', label: 'Gap', hint: 'something missing from the model' },
  { value: 'contradiction', label: 'Contradiction', hint: 'two parts of the model disagree' },
  { value: 'ambiguous', label: 'Ambiguous', hint: 'the model is unclear or open to interpretation' },
  { value: 'assumption', label: 'Assumption', hint: 'verify an implicit assumption the model relies on' },
]

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
        ...(trimmedRelatedNode ? { relatedNode: trimmedRelatedNode as NodeId } : {}),
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
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div>
          <div className="text-sm font-medium text-foreground">Submit an issue for AI to clarify</div>
          <div className="text-2xs text-muted-foreground">
            File a concern; AI fills in candidate answers on its next clarify run.
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel"
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
            Question
            {' '}
            <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="issue-question"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Describe what looks wrong or what you want AI to clarify…"
            rows={5}
            className="resize-y"
            autoFocus
            maxLength={400}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="issue-context">
            Context
            {' '}
            <span className="text-xs text-muted-foreground">optional</span>
          </Label>
          <Textarea
            id="issue-context"
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="Additional background, references, or where you noticed this…"
            rows={3}
            className="resize-y text-xs"
            maxLength={2000}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_180px]">
          <div className="space-y-1.5">
            <Label htmlFor="issue-related">
              Related node
              {' '}
              <span className="text-xs text-muted-foreground">optional</span>
            </Label>
            <input
              id="issue-related"
              type="text"
              value={relatedNode}
              onChange={e => setRelatedNode(e.target.value)}
              placeholder="e.g. cmd.place_order"
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="issue-type">Type</Label>
            <select
              id="issue-type"
              value={ambiguityType}
              onChange={e => setAmbiguityType(e.target.value as ClarificationAmbiguityType)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            >
              {AMBIGUITY_TYPES.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-2xs text-muted-foreground">
          {AMBIGUITY_TYPES.find(t => t.value === ambiguityType)?.hint}
        </p>

        {submit.isError && (
          <p className="text-xs text-destructive">
            {submit.error instanceof Error ? submit.error.message : 'Failed to submit.'}
          </p>
        )}

        <div className="mt-auto flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onCancel} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submit.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            {submit.isPending ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </form>
    </div>
  )
}
