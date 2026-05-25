import type { ClarifyTicket } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queries'
import { candidateLetter } from '@/pages/Clarify'

interface NewClarifyFormProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (ticket: ClarifyTicket) => void
}

interface CandidateDraft {
  /** Stable per-row id so React's reconciliation tracks rows across re-renders. */
  rowId: string
  description: string
}

function newRow(): CandidateDraft {
  return { rowId: crypto.randomUUID(), description: '' }
}

/**
 * "New question" form for human-authored ClarifyTickets. The candidate
 * rows carry only a description; `proposedOperations` is left empty so
 * the resulting ticket follows the documented zero-op resolution path
 * (see packages/core/skills/braid-clarify/SKILL.md). That keeps the form
 * honest about what a human can author without an LLM in the loop.
 */
export function NewClarifyForm({ workspaceId, open, onOpenChange, onCreated }: NewClarifyFormProps) {
  const queryClient = useQueryClient()
  const [question, setQuestion] = useState('')
  const [rows, setRows] = useState<CandidateDraft[]>(() => [newRow(), newRow()])

  // Reset whenever the dialog opens so the previous submission's text
  // doesn't bleed into the next one.
  useEffect(() => {
    if (open) {
      setQuestion('')
      setRows([newRow(), newRow()])
    }
  }, [open])

  const filled = rows.filter(r => r.description.trim().length > 0)
  const canSubmit = question.trim().length > 0 && filled.length >= 1

  const submit = useMutation({
    mutationFn: () => {
      // Candidate ids are server-minted for the human-authored path
      // (the `id?` shape in the wire schema reflects this); the client
      // sends descriptions only.
      const candidates = filled.map(row => ({
        description: row.description.trim(),
        sourceReferences: [],
        proposedOperations: [],
      }))
      return api.submitClarify(workspaceId, {
        question: question.trim(),
        candidates,
      })
    },
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clarify(workspaceId) })
      onCreated?.(ticket)
      onOpenChange(false)
    },
  })

  function updateRow(rowId: string, description: string): void {
    setRows(prev => prev.map(row => (row.rowId === rowId ? { ...row, description } : row)))
  }
  function removeRow(rowId: string): void {
    setRows(prev => prev.length > 1 ? prev.filter(row => row.rowId !== rowId) : prev)
  }
  function addRow(): void {
    setRows(prev => [...prev, newRow()])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New Clarification</DialogTitle>
          <DialogDescription>
            File an open question for the team or your future self. Provide candidate options
            you'd accept as the answer — operations are left blank, so picking one closes the
            ticket without producing a graph mutation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="clarify-question">Question</Label>
            <Textarea
              id="clarify-question"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              rows={3}
              placeholder="What's ambiguous? Example: Should `command.create_user` belong to its own aggregate?"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Candidate answers</Label>
              <Button variant="ghost" size="sm" onClick={addRow} className="h-7 gap-1 px-2 text-xs">
                <Plus className="size-3" />
                Add option
              </Button>
            </div>
            <ul className="space-y-2">
              {rows.map((row, index) => (
                <li key={row.rowId} className="flex items-start gap-2">
                  <span className="mt-2 flex size-5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] font-semibold text-muted-foreground">
                    {candidateLetter(index)}
                  </span>
                  <Textarea
                    value={row.description}
                    onChange={e => updateRow(row.rowId, e.target.value)}
                    rows={2}
                    placeholder={index === 0 ? 'Describe the first candidate answer.' : 'Another option…'}
                    className="flex-1 text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(row.rowId)}
                    disabled={rows.length === 1}
                    title={rows.length === 1 ? 'At least one candidate is required.' : 'Remove option'}
                    className="mt-1 size-7 text-muted-foreground hover:text-foreground"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>

          {submit.error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {(submit.error as Error).message}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? 'Filing…' : 'File question'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
