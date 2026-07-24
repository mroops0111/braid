import type { RunRecord, SessionMetadata, SkillCategory, SkillManifest, SourceId } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Check, ChevronDown, ChevronUp, Lock, MessageCircleQuestion, MessageSquare, Pencil, Plus, Send, Sparkles, Trash2, Wand2, Wrench, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ActionInputForm } from '@/components/ActionInputForm'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { SkillTranscript } from '@/components/SkillTranscript'
import { SurfaceLayout } from '@/components/SurfaceLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { queryKeys, useRuns, useSessionMetadata, useSkills } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useConversation } from '@/lib/useRun'
import { useWorkspacePolicy } from '@/policy'

/**
 * Schema `SkillCategory` maps 1:1 to a sidebar group.
 * Skills with no category land in "Custom",
 * which is for workspace one-offs and plugin skills,
 * that do not fit the canonical workflow.
 */
type Group = SkillCategory | 'custom'

const GROUP_ORDER: readonly Group[] = ['ask', 'build', 'generate', 'custom']

const GROUP_META: Record<Group, { title: string, icon: typeof Sparkles }> = {
  ask: { title: 'Ask anytime', icon: MessageCircleQuestion },
  build: { title: 'Build the graph', icon: Wrench },
  generate: { title: 'Generate', icon: Wand2 },
  custom: { title: 'Custom', icon: BookOpen },
}

interface ActionsPageProps {
  workspaceId: string
}

export interface SessionGroup {
  /** Stable id for selection: real sessionId when present, otherwise the runId. */
  groupId: string
  sessionId: string | null
  records: RunRecord[]
  firstPrompt: string
  skillId: string
  lastStartedAt: string
  /** Reviewer-set title via SessionMetadata, null falls back to firstPrompt. */
  title: string | null
}

/**
 * The single tab for everything skill-related.
 * The left panel is split into two independent scroll areas.
 *
 *   - "Skills": the available skill manifests.
 *     Start a new conversation by clicking one.
 *     Caps at ~45vh, scrolls internally.
 *   - "Conversations": past conversations grouped by session,
 *     with per-row rename (pencil) and delete (trash).
 *     Fills the remaining height, scrolls independently of Skills.
 *
 * The right pane always renders the conversation runner.
 * The internal `runStore` decides whether it is an empty new chat,
 * or a hydrated past one, based on the per-skill turn list.
 */
export function ActionsPage({ workspaceId }: ActionsPageProps) {
  const { data: skillsData } = useSkills(workspaceId)
  const { data: runsData } = useRuns(workspaceId)
  const { data: titleData } = useSessionMetadata(workspaceId)
  const policy = useWorkspacePolicy(workspaceId)
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)

  const skills = (skillsData?.items ?? []).filter(s => !s.frontmatter.braid.hidden)
  // Cap visible conversations to keep the bottom drawer compact.
  // groupBySession already orders by recency, newest first,
  // so slicing keeps the most recent N.
  // Older ones live in History if anyone really needs them.
  const groups = groupBySession(runsData?.items ?? [], titleData?.items ?? []).slice(0, 10)
  const selected = skills.find(s => s.id === selectedSkillId) ?? null
  const [conversationsOpen, setConversationsOpen] = useState(false)

  function startFresh(skill: SkillManifest): void {
    runStore.clearTurns(workspaceId, skill.id)
    setSelectedSkillId(skill.id)
  }

  function resume(group: SessionGroup): void {
    const skill = skills.find(s => s.id === group.skillId)
    if (!skill)
      return
    runStore.setTurns(workspaceId, skill.id, group.records.map(r => r.runId))
    setSelectedSkillId(skill.id)
  }

  if (!skillsData)
    return <div className="p-4 text-sm text-muted-foreground">Loading actions…</div>

  const buckets = bucketByGroup(skills)

  return (
    <SurfaceLayout
      list={(
        <>
          {/* Skills take the full sidebar height; conversations live as a
              collapsed-by-default drawer pinned to the bottom so the runner
              list isn't competing for vertical space. */}
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            {skills.length === 0
              ? (
                  <SidebarSection icon={Sparkles} title="Actions">
                    <SidebarEmpty>No actions available.</SidebarEmpty>
                  </SidebarSection>
                )
              : GROUP_ORDER.map((group) => {
                  const bucket = buckets[group]
                  if (!bucket || bucket.length === 0)
                    return null
                  const meta = GROUP_META[group]
                  return (
                    <SidebarSection key={group} icon={meta.icon} title={meta.title}>
                      {bucket.map((skill, index) => (
                        <SkillRow
                          key={skill.id}
                          skill={skill}
                          // Only the Build group gets explicit step numbers,
                          // because it is the only group,
                          // where the order between skills is semantically meaningful,
                          // extract, then clarify, then model.
                          step={group === 'build' ? index + 1 : undefined}
                          active={selectedSkillId === skill.id}
                          locked={!policy.can('skill.run', { skill: skill.frontmatter, skillId: skill.id })}
                          onClick={() => startFresh(skill)}
                        />
                      ))}
                    </SidebarSection>
                  )
                })}
          </div>
          <div className="shrink-0 border-t border-border">
            <button
              type="button"
              onClick={() => setConversationsOpen(o => !o)}
              className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent/40"
            >
              <MessageSquare className="size-3" />
              <span>Conversations</span>
              {groups.length > 0 && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono normal-case text-[11px] text-muted-foreground">
                  {groups.length}
                </span>
              )}
              {conversationsOpen
                ? <ChevronDown className="ml-auto size-3" />
                : <ChevronUp className="ml-auto size-3" />}
            </button>
            {conversationsOpen && (
              <ul className="max-h-[30vh] overflow-y-auto scrollbar-thin border-t border-border">
                {groups.length === 0
                  ? <SidebarEmpty>Past conversations will appear here.</SidebarEmpty>
                  : groups.map(group => (
                      <ConversationRow
                        key={group.groupId}
                        workspaceId={workspaceId}
                        group={group}
                        onResume={() => resume(group)}
                      />
                    ))}
              </ul>
            )}
          </div>
        </>
      )}
    >
      {selected
        ? <Conversation workspaceId={workspaceId} skill={selected} locked={!policy.can('skill.run', { skill: selected.frontmatter, skillId: selected.id })} key={selected.id} />
        : (
            <EmptyState
              icon={Sparkles}
              title="Pick an action"
              description="Choose an action on the left to start, or resume a recent conversation."
            />
          )}
    </SurfaceLayout>
  )
}

function ConversationRow({ workspaceId, group, onResume }: {
  workspaceId: string
  group: SessionGroup
  onResume: () => void
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.title ?? group.firstPrompt)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Whenever the underlying title changes (server invalidation,
  // optimistic update) and we're not actively editing, sync the draft.
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

  const rename = useMutation({
    mutationFn: ({ title }: { title: string | null }) => {
      if (!group.sessionId)
        throw new Error('Orphan runs cannot be renamed (no sessionId).')
      return api.renameSession(workspaceId, group.sessionId, title)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionMetadata(workspaceId) })
    },
  })

  const deleteSession = useMutation({
    mutationFn: () => {
      if (group.sessionId)
        return api.deleteSession(workspaceId, group.sessionId)
      // Orphan run: groupId is the runId for these rows.
      return api.deleteRun(workspaceId, group.groupId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionMetadata(workspaceId) })
    },
  })

  const canRename = group.sessionId !== null

  function commitRename(): void {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === (group.title ?? group.firstPrompt))
      return
    rename.mutate({ title: next })
  }

  if (editing) {
    return (
      <li className="px-2 py-1.5">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitRename()
            }
            else if (e.key === 'Escape') {
              e.preventDefault()
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
      <ListRow
        active={false}
        onClick={onResume}
        className="group/row flex-col items-start gap-1"
      >
        <div className="flex w-full items-center justify-between gap-2">
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            /
            {group.skillId}
          </span>
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-[11px] uppercase">
              {group.records.length}
              {' '}
              turn
              {group.records.length === 1 ? '' : 's'}
            </Badge>
            {canRename && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditing(true)
                }}
                title="Rename"
                className="hidden rounded p-0.5 text-muted-foreground/60 hover:bg-accent hover:text-foreground group-hover/row:inline-flex"
              >
                <Pencil className="size-3" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmOpen(true)
              }}
              title="Delete conversation"
              className="hidden rounded p-0.5 text-muted-foreground/60 hover:bg-destructive/15 hover:text-destructive group-hover/row:inline-flex"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        </div>
        <div className="break-words text-xs text-foreground/90">
          {group.title ?? group.firstPrompt}
        </div>
        <div className="text-[11px] text-muted-foreground">{formatTimestamp(group.lastStartedAt)}</div>
      </ListRow>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this conversation?</DialogTitle>
            <DialogDescription>
              {group.records.length === 1
                ? 'One run will be permanently removed, including its transcript.'
                : `${group.records.length} turns will be permanently removed, including transcripts. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleteSession.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteSession.mutate(undefined, {
                  onSettled: () => setConfirmOpen(false),
                })
              }}
              disabled={deleteSession.isPending}
            >
              <Check />
              {deleteSession.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SidebarSection({ icon: Icon, title, children }: {
  icon: typeof Sparkles
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <header className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {title}
      </header>
      <ul>{children}</ul>
    </section>
  )
}

function SidebarEmpty({ children }: { children: React.ReactNode }) {
  return <li className="px-3 py-1.5 text-[11px] text-muted-foreground/70">{children}</li>
}

function SkillRow({ skill, active, onClick, step, locked }: {
  skill: SkillManifest
  active: boolean
  onClick: () => void
  step?: number | undefined
  locked?: boolean
}) {
  return (
    <ListRow active={active} onClick={onClick} className="items-start gap-2">
      {step !== undefined && (
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground/70">
          {step}
        </span>
      )}
      <div className={`flex-1 min-w-0 ${locked ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-foreground">
            /
            {skill.frontmatter.name}
          </span>
          <Badge variant="outline" className="text-[11px] uppercase">{originLabel(skill)}</Badge>
          {locked && (
            <span
              className="inline-flex items-center gap-1 rounded bg-muted/60 px-1 py-0.5 text-[11px] uppercase tracking-wider text-muted-foreground"
              title="Your role cannot run this skill. Ask an Owner to grant access."
            >
              <Lock className="size-2.5" />
              Locked
            </span>
          )}
        </div>
        <div className="mt-1 break-words text-xs text-muted-foreground">
          {skill.frontmatter.braid.summary ?? skill.frontmatter.description}
        </div>
      </div>
    </ListRow>
  )
}

export function bucketByGroup(skills: readonly SkillManifest[]): Record<Group, SkillManifest[]> {
  const out: Record<Group, SkillManifest[]> = { ask: [], build: [], generate: [], custom: [] }
  for (const skill of skills) {
    const category = skill.frontmatter.braid?.category
    out[category ?? 'custom'].push(skill)
  }
  // Sort the Build group by `order` so the numbered steps line up,
  // with the workflow.
  // Sparse numbering (100, 200, 300 by convention),
  // lets plugins slot between built-ins by picking e.g. 150,
  // without anyone renumbering.
  // The UI displays sequential rank (1, 2, 3),
  // so users never see the raw sort keys.
  out.build.sort((a, b) => {
    const ao = a.frontmatter.braid?.order ?? Number.POSITIVE_INFINITY
    const bo = b.frontmatter.braid?.order ?? Number.POSITIVE_INFINITY
    return ao - bo
  })
  return out
}

interface ConversationProps {
  workspaceId: string
  skill: SkillManifest
  locked?: boolean
}

function Conversation({ workspaceId, skill, locked = false }: ConversationProps) {
  const conversation = useConversation(workspaceId, skill.id)
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const running = conversation.phase === 'streaming' || submitting
  const isFollowUp = conversation.sessionId !== null
  const turnCount = conversation.events.filter(e => e.type === 'started').length
  // Cancel targets the in-flight turn (the last runId),
  // only meaningful while the runner is actively streaming.
  // During `submitting` we do not have a runId yet,
  // so the button is hidden in that window.
  const activeRunId = conversation.phase === 'streaming' ? conversation.turnIds.at(-1) ?? null : null
  const cancel = useMutation({
    mutationFn: () => {
      if (!activeRunId)
        return Promise.resolve()
      return api.cancelRun(workspaceId, activeRunId)
    },
  })

  function reset(): void {
    const sessionToForget = conversation.sessionId
    runStore.clearTurns(workspaceId, skill.id)
    setPrompt('')
    setLocalError(null)
    if (sessionToForget) {
      // Fire-and-forget: server reclaims the per-session cwd.
      void api.forgetSession(workspaceId, sessionToForget)
    }
  }

  async function sendWith(
    promptToSend: string,
    sourceUnit?: { sourceId: SourceId, path: string },
  ): Promise<void> {
    if (running)
      return
    setSubmitting(true)
    setLocalError(null)
    try {
      const { runId } = await api.startSkillRun(
        workspaceId,
        skill.id,
        promptToSend,
        conversation.sessionId ?? undefined,
        sourceUnit,
      )
      runStore.pushTurn(workspaceId, skill.id, runId)
    }
    catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
    finally {
      setSubmitting(false)
    }
  }

  async function send(): Promise<void> {
    if (!prompt.trim() || running)
      return
    const promptToSend = prompt
    setPrompt('')
    await sendWith(promptToSend)
  }

  const transcriptError = localError ?? conversation.error ?? null

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm text-foreground">
            /
            {skill.frontmatter.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">{skill.frontmatter.description}</span>
        </div>
        <div className="flex items-center gap-2">
          {activeRunId && (
            <Button
              variant="ghost"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              <X />
              {cancel.isPending ? 'Cancelling…' : 'Cancel'}
            </Button>
          )}
          {turnCount > 0 && (
            <Button variant="ghost" size="sm" onClick={reset} disabled={running}>
              <Plus />
              New conversation
            </Button>
          )}
        </div>
      </div>
      <SkillTranscript events={[...conversation.events]} error={transcriptError} running={running} />
      {locked && (
        <div className="flex items-start gap-2 border-t border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
          <Lock className="mt-0.5 size-3 shrink-0" />
          <span>
            Your role cannot run this skill. Ask an Owner to grant access via Workspace Settings, Skill Permissions.
          </span>
        </div>
      )}
      {!isFollowUp && skill.frontmatter.braid.inputs && skill.frontmatter.braid.inputs.length > 0
        ? (
            <ActionInputForm
              workspaceId={workspaceId}
              inputs={skill.frontmatter.braid.inputs}
              disabled={running || locked}
              onSubmit={(runs) => {
                // Fire all batch runs in parallel.
                // Each becomes its own runId and turn under one conversation key,
                // so the transcript will interleave them.
                // `sourceUnit` is set for runs from a source-intent picker.
                for (const run of runs) void sendWith(run.args, run.sourceUnit)
              }}
            />
          )
        : (
            <div className="flex items-end gap-2 border-t border-border px-4 py-2.5">
              <Textarea
                placeholder={
                  locked
                    ? 'Locked for your role.'
                    : isFollowUp
                      ? 'Ask a follow-up… (Enter to send, Shift+Enter for newline)'
                      : (skill.frontmatter.argumentHint ?? 'Describe what you want… (Enter to send, Shift+Enter for newline)')
                }
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  // While the user composes CJK or accented input through an IME,
                  // Enter confirms the candidate character and must not submit.
                  // `nativeEvent.isComposing` is the only reliable signal,
                  // across browsers.
                  // `e.keyCode === 229` is the legacy fallback,
                  // for older Safari that we no longer support.
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !running && !locked) {
                    e.preventDefault()
                    void send()
                  }
                }}
                disabled={running || locked}
                rows={2}
                className="flex-1 font-mono"
                autoFocus
              />
              <Button size="sm" onClick={send} disabled={running || locked || !prompt.trim()}>
                <Send />
                {running ? 'Sending…' : isFollowUp ? 'Send' : 'Start'}
              </Button>
            </div>
          )}
    </div>
  )
}

export function groupBySession(
  records: readonly RunRecord[],
  sessionTitles: readonly SessionMetadata[] = [],
): SessionGroup[] {
  const titleMap = new Map<string, string | null>(sessionTitles.map(m => [m.sessionId, m.title]))
  const groups = new Map<string, SessionGroup>()
  const orphans: SessionGroup[] = []
  // Records arrive newest-first from the API.
  // We want oldest-first inside a session,
  // so the replay reads top-to-bottom in chronological order.
  for (const rec of [...records].reverse()) {
    if (!rec.sessionId) {
      orphans.push({
        groupId: rec.runId,
        sessionId: null,
        records: [rec],
        firstPrompt: rec.args,
        skillId: rec.skillId,
        lastStartedAt: rec.startedAt,
        title: null,
      })
      continue
    }
    const existing = groups.get(rec.sessionId)
    if (existing) {
      existing.records.push(rec)
      existing.lastStartedAt = rec.startedAt
    }
    else {
      groups.set(rec.sessionId, {
        groupId: rec.sessionId,
        sessionId: rec.sessionId,
        records: [rec],
        firstPrompt: rec.args,
        skillId: rec.skillId,
        lastStartedAt: rec.startedAt,
        title: titleMap.get(rec.sessionId) ?? null,
      })
    }
  }
  return [...groups.values(), ...orphans].sort((a, b) => b.lastStartedAt.localeCompare(a.lastStartedAt))
}

export function originLabel(skill: SkillManifest): string {
  // Plugin skills surface their plugin id, such as `ontology-ddd`,
  // so the user can tell at a glance which plugin shipped the action.
  // Everything else shows the origin value directly,
  // `builtin`, `workspace`, or `extension`.
  if (skill.origin === 'plugin' && skill.pluginId)
    return skill.pluginId
  return skill.origin
}

export function formatTimestamp(value: string): string {
  // ISO 8601: `YYYY-MM-DDTHH:mm` local time.
  // The T-separator, not a space, is the distinguishing ISO marker.
  // Seconds dropped because the sidebar is narrow.
  // Full precision lives in the run record itself.
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime()))
      return value
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  catch {
    return value
  }
}
