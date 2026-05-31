import type { CommitKind, CommitMeta, CommitSha, FileDiff, TagMeta } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, GitCommit, History, Plus, RotateCcw, Tag, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { queryKeys, useHistory, useHistoryCommit, useHistoryTags } from '@/lib/queries'
import { cn } from '@/lib/utils'

interface HistoryPageProps {
  workspaceId: string
}

const KIND_LABEL: Record<CommitKind, string> = {
  'proposal-apply': 'Apply',
  'proposal-reject': 'Reject',
  'clarify-answer': 'Answer',
  'clarify-apply': 'Closed',
  'clarify-skip': 'Skip',
  'source-sync': 'Sync',
  'bootstrap': 'Bootstrap',
  'restore': 'Restore',
  'snapshot': 'Snapshot',
  'initial': 'Initial',
}

const KIND_TONE: Record<CommitKind, string> = {
  'proposal-apply': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'proposal-reject': 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  'clarify-answer': 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'clarify-apply': 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'clarify-skip': 'border-zinc-400/40 bg-zinc-400/10 text-zinc-600 dark:text-zinc-400',
  'source-sync': 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'bootstrap': 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'restore': 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  'snapshot': 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
  'initial': 'border-zinc-400/40 bg-zinc-400/10 text-zinc-600 dark:text-zinc-400',
}

export function HistoryPage({ workspaceId }: HistoryPageProps) {
  const { data, isLoading } = useHistory(workspaceId)
  const { data: tags } = useHistoryTags(workspaceId)
  const [selectedSha, setSelectedSha] = useState<CommitSha | null>(null)

  const commits = data?.items ?? []
  const tagsBySha = groupTagsBySha(tags?.items ?? [])

  // Auto-select the latest commit on first load, mirroring Proposals
  // and Clarify so the reviewer lands on the most relevant row.
  useEffect(() => {
    if (selectedSha || isLoading || commits.length === 0)
      return
    setSelectedSha(commits[0]!.sha)
  }, [commits, isLoading, selectedSha])

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        {isLoading
          ? <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          : commits.length === 0
            ? <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">No commits yet.</div>
            : (
                <ul className="flex-1 overflow-y-auto scrollbar-thin">
                  {commits.map(commit => (
                    <CommitRow
                      key={commit.sha}
                      commit={commit}
                      tags={tagsBySha.get(commit.sha) ?? []}
                      active={selectedSha === commit.sha}
                      onSelect={() => setSelectedSha(commit.sha)}
                    />
                  ))}
                </ul>
              )}
      </div>
      <div className="flex-1 overflow-hidden">
        {selectedSha
          ? <CommitDetail workspaceId={workspaceId} sha={selectedSha} tags={tagsBySha.get(selectedSha) ?? []} key={selectedSha} />
          : <EmptyState icon={History} title="Pick a commit" description="Select a commit on the left to see its diff, tag it, or restore the workspace to that point." />}
      </div>
    </div>
  )
}

function CommitRow({ commit, tags, active, onSelect }: {
  commit: CommitMeta
  tags: readonly TagMeta[]
  active: boolean
  onSelect: () => void
}) {
  return (
    <ListRow active={active} onClick={onSelect} className="flex-col items-start gap-1">
      <div className="flex w-full items-center gap-1.5">
        <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider', KIND_TONE[commit.message.kind])}>
          {KIND_LABEL[commit.message.kind]}
        </span>
        <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
          {commit.sha.slice(0, 7)}
        </span>
      </div>
      <div className="break-words text-xs text-foreground/90">{commit.message.subject}</div>
      <div className="flex w-full items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>{commit.author.name}</span>
        <span>·</span>
        <span>{relativeTime(commit.committedAt)}</span>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map(tag => (
            <span key={tag.name} className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              <Tag className="size-2.5" />
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </ListRow>
  )
}

function CommitDetail({ workspaceId, sha, tags }: {
  workspaceId: string
  sha: CommitSha
  tags: readonly TagMeta[]
}) {
  const { data, isLoading } = useHistoryCommit(workspaceId, sha)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)

  if (isLoading || !data) {
    return <div className="p-4 text-sm text-muted-foreground">Loading commit…</div>
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <GitCommit className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-sm text-foreground">{sha.slice(0, 12)}</span>
          <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider', KIND_TONE[data.message.kind])}>
            {KIND_LABEL[data.message.kind]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setTagDialogOpen(true)}>
            <Tag className="size-3.5" />
            Tag
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRestoreOpen(true)}>
            <RotateCcw className="size-3.5" />
            Restore
          </Button>
        </div>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
        <section>
          <div className="text-sm font-medium text-foreground">{data.message.subject}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.author.name}
            {' · '}
            {new Date(data.committedAt).toLocaleString()}
          </div>
        </section>

        {tags.length > 0 && (
          <section>
            <SectionHeader title="Tags" />
            <ul className="mt-2 space-y-1">
              {tags.map(tag => (
                <TagRow key={tag.name} workspaceId={workspaceId} tag={tag} />
              ))}
            </ul>
          </section>
        )}

        <section>
          <SectionHeader title="Trailers" />
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            <TrailerRow label="Kind" value={data.message.kind} />
            <TrailerRow label="Author" value={data.message.userId} />
            {data.message.proposalId && <TrailerRow label="Proposal" value={data.message.proposalId} mono />}
            {data.message.clarifyTicketId && <TrailerRow label="Clarify ticket" value={data.message.clarifyTicketId} mono />}
            {data.message.sourceId && <TrailerRow label="Source" value={data.message.sourceId} mono />}
            {data.message.revertedFrom && <TrailerRow label="Reverted from" value={data.message.revertedFrom.slice(0, 12)} mono />}
            {data.message.revertedTo && <TrailerRow label="Reverted to" value={data.message.revertedTo.slice(0, 12)} mono />}
          </dl>
        </section>

        <section>
          <SectionHeader title={`Files changed (${data.diff.length})`} />
          {data.diff.length === 0
            ? <p className="mt-2 text-[11px] text-muted-foreground">No file changes (empty commit).</p>
            : (
                <ul className="mt-2 space-y-1">
                  {data.diff.map(file => (
                    <FileDiffRow key={file.path} file={file} />
                  ))}
                </ul>
              )}
        </section>
      </div>
      <RestoreDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        workspaceId={workspaceId}
        sha={sha}
        subject={data.message.subject}
      />
      <TagDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        workspaceId={workspaceId}
        sha={sha}
      />
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
  )
}

function TrailerRow({ label, value, mono }: { label: string, value: string, mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-foreground/90', mono && 'font-mono break-all')}>{value}</dd>
    </>
  )
}

function FileDiffRow({ file }: { file: FileDiff }) {
  const badge = file.status === 'added'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : file.status === 'removed'
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
      : file.status === 'renamed'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider', badge)}>
        {file.status[0]}
      </span>
      <span className="truncate font-mono text-xs text-foreground/90">{file.path}</span>
      {file.previousPath && (
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          from
          {' '}
          {file.previousPath}
        </span>
      )}
    </li>
  )
}

function TagRow({ workspaceId, tag }: { workspaceId: string, tag: TagMeta }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api.deleteHistoryTag(workspaceId, tag.name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.historyTags(workspaceId) })
    },
  })
  return (
    <li className="group/tag flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs">
      <Tag className="size-3 shrink-0 text-primary" />
      <span className="font-medium text-foreground">{tag.name}</span>
      {tag.note && <span className="truncate text-muted-foreground">{tag.note}</span>}
      <button
        type="button"
        onClick={() => remove.mutate()}
        disabled={remove.isPending}
        title="Remove tag"
        className="ml-auto hidden rounded p-0.5 text-muted-foreground/60 hover:bg-destructive/15 hover:text-destructive group-hover/tag:inline-flex"
      >
        <Trash2 className="size-3" />
      </button>
    </li>
  )
}

function RestoreDialog({ open, onOpenChange, workspaceId, sha, subject }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  sha: CommitSha
  subject: string
}) {
  const queryClient = useQueryClient()
  const restore = useMutation({
    mutationFn: () => api.restoreCommit(workspaceId, sha, 'studio-user'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId] })
      onOpenChange(false)
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore workspace to this commit?</DialogTitle>
          <DialogDescription>
            The graph, proposals, clarify tickets, and decisions will all roll back to "
            {subject}
            ". A new
            {' '}
            <code className="rounded bg-muted px-1 font-mono text-[11px]">restore</code>
            {' '}
            commit will be appended to history; nothing is lost, but everything after this point will no longer apply.
          </DialogDescription>
        </DialogHeader>
        {restore.isError && (
          <p className="text-xs text-destructive">
            {restore.error instanceof Error ? restore.error.message : 'Restore failed.'}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={restore.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => restore.mutate()} disabled={restore.isPending}>
            <Check />
            {restore.isPending ? 'Restoring…' : 'Restore'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TagDialog({ open, onOpenChange, workspaceId, sha }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  sha: CommitSha
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const create = useMutation({
    mutationFn: () =>
      api.createHistoryTag(workspaceId, { sha, name: name.trim(), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.historyTags(workspaceId) })
      setName('')
      setNote('')
      onOpenChange(false)
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tag this commit</DialogTitle>
          <DialogDescription>Give this point in history a memorable name.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim())
              create.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Name</Label>
            <Input id="tag-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. before-refactor" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tag-note">
              Note
              {' '}
              <span className="text-xs text-muted-foreground">optional</span>
            </Label>
            <Textarea id="tag-note" value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </div>
          {create.isError && (
            <p className="text-xs text-destructive">
              {create.error instanceof Error ? create.error.message : 'Tag failed.'}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              <X />
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              <Plus />
              {create.isPending ? 'Tagging…' : 'Create tag'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function groupTagsBySha(tags: readonly TagMeta[]): Map<string, TagMeta[]> {
  const out = new Map<string, TagMeta[]>()
  for (const tag of tags) {
    const list = out.get(tag.sha) ?? []
    list.push(tag)
    out.set(tag.sha, list)
  }
  return out
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1)
    return 'just now'
  if (minutes < 60)
    return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30)
    return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
