import type { ChangeKind, CommitKind, CommitMeta, CommitSha, EdgeId, FileDiff, ModelDiffEnvelope, NodeId, TagMeta } from '@braidhq/schema'
import type { GraphDataSource } from '@/components/graph/GraphDataSource'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Check, GitCommit, History, Plus, RotateCcw, Tag, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { ListRow } from '@/components/ListRow'
import { SurfaceLayout } from '@/components/SurfaceLayout'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { asEdgeId, asNodeId } from '@/lib/brands'
import { queryKeys, useCommitModelDiff, useHistory, useHistoryCommit, useHistoryTags } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useWorkspacePolicy } from '@/policy'

interface HistoryPageProps {
  workspaceId: string
}

const KIND_LABEL: Record<CommitKind, string> = {
  'proposal-submit': 'Propose',
  'proposal-apply': 'Apply',
  'proposal-reject': 'Reject',
  'clarify-submit': 'Ask',
  'clarify-answer': 'Answer',
  'clarify-apply': 'Closed',
  'clarify-skip': 'Skip',
  'config': 'Config',
  'restore': 'Restore',
  'snapshot': 'Snapshot',
  'initial': 'Initial',
  'batch-archive': 'Archive',
}

const KIND_TONE: Record<CommitKind, string> = {
  'proposal-submit': 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  'proposal-apply': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'proposal-reject': 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  'clarify-submit': 'border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300',
  'clarify-answer': 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'clarify-apply': 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'clarify-skip': 'border-zinc-400/40 bg-zinc-400/10 text-zinc-600 dark:text-zinc-400',
  'config': 'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  'restore': 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  'snapshot': 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
  'initial': 'border-zinc-400/40 bg-zinc-400/10 text-zinc-600 dark:text-zinc-400',
  'batch-archive': 'border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300',
}

export function HistoryPage({ workspaceId }: HistoryPageProps) {
  const { data, isLoading } = useHistory(workspaceId)
  const { data: tags } = useHistoryTags(workspaceId)
  const [selectedSha, setSelectedSha] = useState<CommitSha | null>(null)
  const [compareSha, setCompareSha] = useState<CommitSha | null>(null)
  const [pickingCompare, setPickingCompare] = useState(false)

  const commits = data?.items ?? []
  const tagsBySha = groupTagsBySha(tags?.items ?? [])

  // Mirror Proposals / Clarification: land the reviewer on the most recent row.
  useEffect(() => {
    if (selectedSha || isLoading || commits.length === 0)
      return
    setSelectedSha(commits[0]!.sha)
  }, [commits, isLoading, selectedSha])

  const handleRowClick = (sha: CommitSha): void => {
    if (pickingCompare && sha !== selectedSha) {
      setCompareSha(sha)
      setPickingCompare(false)
      return
    }
    // Re-selecting the primary exits compare mode so the diff can't drift.
    setSelectedSha(sha)
    setCompareSha(null)
    setPickingCompare(false)
  }

  const exitCompare = (): void => {
    setCompareSha(null)
    setPickingCompare(false)
  }

  return (
    <div className="flex h-full flex-col">
      <SurfaceLayout
        list={(
          <>
            {pickingCompare && (
              <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-2xs text-muted-foreground">
                <ArrowLeftRight className="size-3" />
                <span>Pick a commit to compare against</span>
                <button
                  type="button"
                  onClick={() => setPickingCompare(false)}
                  className="ml-auto rounded p-0.5 hover:bg-background/80"
                  title="Cancel"
                  aria-label="Cancel"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
            {isLoading
              ? <div className="p-4 text-sm text-muted-foreground">Loading…</div>
              : commits.length === 0
                ? null
                : (
                    <ul className="flex-1 overflow-y-auto scrollbar-thin">
                      {commits.map(commit => (
                        <CommitRow
                          key={commit.sha}
                          commit={commit}
                          tags={tagsBySha.get(commit.sha) ?? []}
                          active={selectedSha === commit.sha}
                          compareActive={compareSha === commit.sha}
                          dimmed={pickingCompare && commit.sha === selectedSha}
                          onSelect={() => handleRowClick(commit.sha)}
                        />
                      ))}
                    </ul>
                  )}
          </>
        )}
      >
        <div className="flex-1 overflow-hidden">
          {selectedSha && compareSha
            ? (
                <CompareDetail
                  workspaceId={workspaceId}
                  selectedSha={selectedSha}
                  compareSha={compareSha}
                  commits={commits}
                  onExit={exitCompare}
                  key={`${selectedSha}:${compareSha}`}
                />
              )
            : selectedSha
              ? (
                  <CommitDetail
                    workspaceId={workspaceId}
                    sha={selectedSha}
                    tags={tagsBySha.get(selectedSha) ?? []}
                    onStartCompare={() => setPickingCompare(true)}
                    key={selectedSha}
                  />
                )
              : commits.length === 0
                ? <EmptyState icon={History} title="No Commits Yet" description="History records each applied proposal, clarify answer, and restore as a commit." />
                : <EmptyState icon={History} title="Pick a Commit" description="Select a commit on the left to see its diff, tag it, or restore the workspace to that point." />}
        </div>
      </SurfaceLayout>
    </div>
  )
}

function CommitRow({ commit, tags, active, compareActive, dimmed, onSelect }: {
  commit: CommitMeta
  tags: readonly TagMeta[]
  active: boolean
  compareActive?: boolean
  dimmed?: boolean
  onSelect: () => void
}) {
  return (
    <ListRow
      active={active}
      onClick={onSelect}
      className={cn(
        'flex-col items-start gap-1',
        compareActive && 'ring-2 ring-amber-500/60',
        dimmed && 'opacity-50',
      )}
    >
      <div className="flex w-full items-center gap-1.5">
        <span className={cn('rounded border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider', KIND_TONE[commit.message.kind])}>
          {KIND_LABEL[commit.message.kind]}
        </span>
        {compareActive && (
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">
            Compare
          </span>
        )}
        <span className="ml-auto truncate font-mono text-2xs text-muted-foreground">
          {commit.sha.slice(0, 7)}
        </span>
      </div>
      <div className="break-words text-xs text-foreground/90">{commit.message.subject}</div>
      <div className="flex w-full items-center gap-1.5 text-2xs text-muted-foreground">
        <span>{commit.author.name}</span>
        <span>·</span>
        <span>{relativeTime(commit.committedAt)}</span>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map(tag => (
            <span key={tag.name} className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-2xs text-primary">
              <Tag className="size-2.5" />
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </ListRow>
  )
}

function CommitDetail({ workspaceId, sha, tags, onStartCompare }: {
  workspaceId: string
  sha: CommitSha
  tags: readonly TagMeta[]
  onStartCompare: () => void
}) {
  const { data, isLoading } = useHistoryCommit(workspaceId, sha)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const canWriteHistory = useWorkspacePolicy(workspaceId).can('history.write')

  if (isLoading || !data) {
    return <div className="p-4 text-sm text-muted-foreground">Loading commit…</div>
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <GitCommit className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-sm text-foreground">{sha.slice(0, 12)}</span>
          <span className={cn('rounded border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider', KIND_TONE[data.message.kind])}>
            {KIND_LABEL[data.message.kind]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onStartCompare}>
            <ArrowLeftRight className="size-3.5" />
            Compare
          </Button>
          {canWriteHistory && (
            <>
              <Button size="sm" variant="outline" onClick={() => setTagDialogOpen(true)}>
                <Tag className="size-3.5" />
                Tag
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRestoreOpen(true)}>
                <RotateCcw className="size-3.5" />
                Restore
              </Button>
            </>
          )}
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
            {data.message.clarificationId && <TrailerRow label="Clarification" value={data.message.clarificationId} mono />}
            {data.message.sourceId && <TrailerRow label="Source" value={data.message.sourceId} mono />}
            {data.message.revertedFrom && <TrailerRow label="Reverted from" value={data.message.revertedFrom.slice(0, 12)} mono />}
            {data.message.revertedTo && <TrailerRow label="Reverted to" value={data.message.revertedTo.slice(0, 12)} mono />}
          </dl>
        </section>

        <section>
          <SectionHeader title={`Files changed (${data.diff.length})`} />
          {data.diff.length === 0
            ? <p className="mt-2 text-2xs text-muted-foreground">No file changes (empty commit).</p>
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

function CompareDetail({ workspaceId, selectedSha, compareSha, commits, onExit }: {
  workspaceId: string
  selectedSha: CommitSha
  compareSha: CommitSha
  commits: readonly CommitMeta[]
  onExit: () => void
}) {
  const { from, to } = useMemo(() => orderByAge(commits, selectedSha, compareSha), [selectedSha, compareSha, commits])
  const { data, isLoading, error } = useCommitModelDiff(workspaceId, from, to)

  const groups = useMemo(() => buildDiffGroups(data ?? null), [data])
  const source = useMemo(() => envelopeToSource(data ?? null, isLoading), [data, isLoading])

  const fromCommit = commits.find(c => c.sha === from)
  const toCommit = commits.find(c => c.sha === to)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <CompareHeader from={from} to={to} groups={groups} onExit={onExit} />
      <CompareSubjectBar fromCommit={fromCommit} toCommit={toCommit} />
      <div className="flex flex-1 overflow-hidden">
        {error
          ? (
              <div className="flex h-full flex-1 items-center justify-center p-6 text-center text-sm text-destructive">
                {error instanceof Error ? error.message : 'Failed to load graph diff.'}
              </div>
            )
          : (
              <>
                <div className="flex-1 overflow-hidden">
                  <GraphCanvas
                    workspaceId={workspaceId}
                    source={source}
                    dimUnchanged
                    emphasizeAdded
                  />
                </div>
                <DiffSummary groups={groups} hasEnvelope={data != null} isLoading={isLoading} />
              </>
            )}
      </div>
    </div>
  )
}

function CompareHeader({ from, to, groups, onExit }: {
  from: CommitSha
  to: CommitSha
  groups: readonly DiffGroupModel[]
  onExit: () => void
}) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <ArrowLeftRight className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">{from.slice(0, 7)}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-mono text-xs text-foreground">{to.slice(0, 7)}</span>
        <DiffStatsInline groups={groups} />
      </div>
      <Button size="sm" variant="outline" onClick={onExit}>
        <X className="size-3.5" />
        Exit Compare
      </Button>
    </header>
  )
}

function CompareSubjectBar({ fromCommit, toCommit }: {
  fromCommit: CommitMeta | undefined
  toCommit: CommitMeta | undefined
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted/30 px-4 py-2 text-2xs text-muted-foreground">
      {fromCommit && toCommit
        ? (
            <>
              <SubjectChip label="from" subject={fromCommit.message.subject} />
              <span>·</span>
              <SubjectChip label="to" subject={toCommit.message.subject} />
            </>
          )
        : <span>Loading commit metadata…</span>}
    </div>
  )
}

function SubjectChip({ label, subject }: { label: string, subject: string }) {
  return (
    <span>
      <span className="text-muted-foreground/70">
        {label}
        :
      </span>
      {' '}
      <span className="text-foreground/90">{subject}</span>
    </span>
  )
}

function DiffStatsInline({ groups }: { groups: readonly DiffGroupModel[] }) {
  const counts = countByKind(groups)
  if (counts.total === 0)
    return null
  return (
    <span className="ml-3 text-xs text-muted-foreground">
      {counts.added > 0 && (
        <span className="text-emerald-600 dark:text-emerald-400">
          +
          {counts.added}
        </span>
      )}
      {counts.added > 0 && counts.removed > 0 && ' '}
      {counts.removed > 0 && (
        <span className="text-rose-600 dark:text-rose-400">
          −
          {counts.removed}
        </span>
      )}
      {counts.updated > 0 && (
        <>
          {' '}
          <span className="text-amber-600 dark:text-amber-400">
            ~
            {counts.updated}
          </span>
        </>
      )}
    </span>
  )
}

function DiffSummary({ groups, hasEnvelope, isLoading }: {
  groups: readonly DiffGroupModel[]
  hasEnvelope: boolean
  isLoading: boolean
}) {
  const empty = hasEnvelope && groups.every(g => g.entries.length === 0)
  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l border-border bg-card/40">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        Changes
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 scrollbar-thin">
        {!hasEnvelope && isLoading && <p className="text-xs text-muted-foreground">Loading diff…</p>}
        {empty && <p className="text-xs text-muted-foreground">No changes between these commits.</p>}
        {hasEnvelope && !empty && groups.map(group => group.entries.length > 0 && (
          <DiffGroup key={group.title} group={group} />
        ))}
      </div>
    </aside>
  )
}

interface DiffEntry {
  id: string
  label: string
  type: string
}

interface DiffGroupModel {
  title: string
  kind: ChangeKind
  category: 'node' | 'edge'
  entries: readonly DiffEntry[]
}

const KIND_DOT: Record<ChangeKind, string> = {
  added: 'bg-emerald-500',
  updated: 'bg-amber-500',
  removed: 'bg-rose-500',
}

const KIND_TEXT: Record<ChangeKind, string> = {
  added: 'text-emerald-700 dark:text-emerald-300',
  updated: 'text-amber-700 dark:text-amber-300',
  removed: 'text-rose-700 dark:text-rose-300',
}

function DiffGroup({ group }: { group: DiffGroupModel }) {
  return (
    <section>
      <div className="flex items-center gap-1.5">
        <span className={cn('size-1.5 rounded-full', KIND_DOT[group.kind])} />
        <h4 className={cn('text-2xs font-semibold uppercase tracking-wider', KIND_TEXT[group.kind])}>
          {group.title}
          <span className="ml-1 text-muted-foreground/70">
            (
            {group.entries.length}
            )
          </span>
        </h4>
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {group.entries.map(entry => (
          <li key={entry.id} className="rounded-md px-1.5 py-1 text-xs hover:bg-muted/50">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-foreground/90">{entry.label}</span>
              <span className="ml-auto shrink-0 rounded border border-border/60 bg-background/60 px-1 py-0.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                {entry.type}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Newest-first commits list means a higher index == older commit.
function orderByAge(commits: readonly CommitMeta[], a: CommitSha, b: CommitSha): { from: CommitSha, to: CommitSha } {
  const aIdx = commits.findIndex(c => c.sha === a)
  const bIdx = commits.findIndex(c => c.sha === b)
  return aIdx > bIdx ? { from: a, to: b } : { from: b, to: a }
}

function buildDiffGroups(envelope: ModelDiffEnvelope | null): DiffGroupModel[] {
  if (!envelope)
    return []
  const nodesById = indexById([...envelope.snapshot.nodes, ...envelope.removed.nodes])
  const edgesById = indexById([...envelope.snapshot.edges, ...envelope.removed.edges])

  const nodeEntry = (id: string): DiffEntry => {
    const node = nodesById.get(asNodeId(id))
    return { id, label: node?.name ?? id, type: node?.type ?? '?' }
  }
  const edgeEntry = (id: string): DiffEntry => {
    const edge = edgesById.get(asEdgeId(id))
    if (!edge)
      return { id, label: id, type: '?' }
    const fromName = nodesById.get(edge.fromNodeId)?.name ?? edge.fromNodeId
    const toName = nodesById.get(edge.toNodeId)?.name ?? edge.toNodeId
    return { id, label: `${fromName} → ${toName}`, type: edge.type }
  }

  const collect = (changes: Record<string, ChangeKind>, kind: ChangeKind, project: (id: string) => DiffEntry): DiffEntry[] =>
    Object.entries(changes)
      .filter(([, k]) => k === kind)
      .map(([id]) => project(id))
      .sort((a, b) => a.label.localeCompare(b.label))

  return [
    { title: 'Nodes added', kind: 'added', category: 'node', entries: collect(envelope.changes.nodes, 'added', nodeEntry) },
    { title: 'Nodes updated', kind: 'updated', category: 'node', entries: collect(envelope.changes.nodes, 'updated', nodeEntry) },
    { title: 'Nodes removed', kind: 'removed', category: 'node', entries: collect(envelope.changes.nodes, 'removed', nodeEntry) },
    { title: 'Edges added', kind: 'added', category: 'edge', entries: collect(envelope.changes.edges, 'added', edgeEntry) },
    { title: 'Edges updated', kind: 'updated', category: 'edge', entries: collect(envelope.changes.edges, 'updated', edgeEntry) },
    { title: 'Edges removed', kind: 'removed', category: 'edge', entries: collect(envelope.changes.edges, 'removed', edgeEntry) },
  ]
}

function countByKind(groups: readonly DiffGroupModel[]): { added: number, updated: number, removed: number, total: number } {
  let added = 0
  let updated = 0
  let removed = 0
  for (const group of groups) {
    if (group.kind === 'added')
      added += group.entries.length
    else if (group.kind === 'updated')
      updated += group.entries.length
    else if (group.kind === 'removed')
      removed += group.entries.length
  }
  return { added, updated, removed, total: added + updated + removed }
}

function envelopeToSource(envelope: ModelDiffEnvelope | null, isLoading: boolean): GraphDataSource {
  if (!envelope) {
    return {
      nodes: [],
      edges: [],
      isLoading,
      isEmpty: !isLoading,
      diff: { nodes: new Map(), edges: new Map() },
    }
  }
  return {
    nodes: envelope.snapshot.nodes,
    edges: envelope.snapshot.edges,
    isLoading: false,
    isEmpty: envelope.snapshot.nodes.length === 0,
    diff: {
      nodes: new Map(Object.entries(envelope.changes.nodes) as [NodeId, ChangeKind][]),
      edges: new Map(Object.entries(envelope.changes.edges) as [EdgeId, ChangeKind][]),
    },
  }
}

function indexById<T extends { id: K }, K extends string>(items: readonly T[]): Map<K, T> {
  const out = new Map<K, T>()
  for (const item of items)
    out.set(item.id, item)
  return out
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
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
      <span className={cn('rounded border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider', badge)}>
        {file.status[0]}
      </span>
      <span className="truncate font-mono text-xs text-foreground/90">{file.path}</span>
      {file.previousPath && (
        <span className="ml-auto font-mono text-2xs text-muted-foreground">
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
  const canWrite = useWorkspacePolicy(workspaceId).can('history.write')
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
      {canWrite && (
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          title="Remove tag"
          aria-label="Remove tag"
          className="ml-auto hidden rounded p-0.5 text-muted-foreground/60 hover:bg-destructive/15 hover:text-destructive group-hover/tag:inline-flex"
        >
          <Trash2 className="size-3" />
        </button>
      )}
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
    mutationFn: () => api.restoreCommit(workspaceId, sha),
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
            The graph, proposals, clarifications, and decisions will all roll back to "
            {subject}
            ". A new
            {' '}
            <code className="rounded bg-muted px-1 font-mono text-2xs">restore</code>
            {' '}
            commit will be appended to history. Nothing is lost, but everything after this point will no longer apply.
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
          <DialogTitle>Tag This Commit</DialogTitle>
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
              {create.isPending ? 'Tagging…' : 'Create Tag'}
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
