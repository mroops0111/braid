import type { RunRecord, SkillCategory, SkillManifest } from '@braidhq/schema'
import { BookOpen, FileQuestion, History, Plus, Send, Sparkles, Wrench } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { SkillTranscript } from '@/components/SkillTranscript'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { useRuns, useSkills } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useConversation } from '@/lib/useRun'

/**
 * Schema `SkillCategory` maps 1:1 to a sidebar group. Skills with no
 * category land in "Custom", which is for workspace one-offs and plugin
 * skills that don't fit the canonical workflow.
 */
type Group = SkillCategory | 'custom'

const GROUP_ORDER: readonly Group[] = ['ask', 'build', 'generate', 'custom']

const GROUP_META: Record<Group, { title: string, icon: typeof Sparkles }> = {
  ask: { title: 'Ask anytime', icon: Sparkles },
  build: { title: 'Build the graph', icon: Wrench },
  generate: { title: 'Generate', icon: FileQuestion },
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
}

/**
 * The single tab for everything skill-related. Sidebar shows:
 *   - "Actions" section: the available skill manifests (start a new
 *     conversation by clicking one).
 *   - "Recent" section: past conversations grouped by session (resume
 *     by clicking one; the runner picks up sessionId so the next prompt
 *     continues the same agent session).
 *
 * The right pane always renders the conversation runner. The internal
 * `runStore` decides whether it's an empty new chat or a hydrated past
 * one based on the per-skill turn list.
 */
export function ActionsPage({ workspaceId }: ActionsPageProps) {
  const { data: skillsData } = useSkills(workspaceId)
  const { data: runsData } = useRuns(workspaceId)
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)

  const skills = skillsData?.items ?? []
  const groups = groupBySession(runsData?.items ?? [])
  const selected = skills.find(s => s.id === selectedSkillId) ?? null

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
    <div className="flex h-full">
      <div className="w-72 shrink-0 overflow-y-auto scrollbar-thin border-r border-border">
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
                      // because it's the only group where the order between
                      // skills is semantically meaningful (extract -> clarify -> model).
                      step={group === 'build' ? index + 1 : undefined}
                      active={selectedSkillId === skill.id}
                      onClick={() => startFresh(skill)}
                    />
                  ))}
                </SidebarSection>
              )
            })}
        <div className="my-2 border-t border-border" aria-hidden />
        <SidebarSection icon={History} title="Recent">
          {groups.length === 0
            ? <SidebarEmpty>Past conversations will appear here.</SidebarEmpty>
            : groups.map(group => (
                <ListRow
                  key={group.groupId}
                  active={false}
                  onClick={() => resume(group)}
                  className="flex-col gap-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-foreground">
                      /
                      {group.skillId}
                    </span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {group.records.length}
                      {' '}
                      turn
                      {group.records.length === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  <div className="line-clamp-2 text-xs text-foreground/90">{group.firstPrompt}</div>
                  <div className="text-[10px] text-muted-foreground">{formatTimestamp(group.lastStartedAt)}</div>
                </ListRow>
              ))}
        </SidebarSection>
      </div>
      {selected
        ? <Conversation workspaceId={workspaceId} skill={selected} key={selected.id} />
        : (
            <div className="flex-1">
              <EmptyState
                icon={Sparkles}
                title="Pick an action"
                description="Choose an action on the left to start, or resume a recent conversation."
              />
            </div>
          )}
    </div>
  )
}

function SidebarSection({ icon: Icon, title, children }: {
  icon: typeof Sparkles
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <header className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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

function SkillRow({ skill, active, onClick, step }: {
  skill: SkillManifest
  active: boolean
  onClick: () => void
  step?: number | undefined
}) {
  return (
    <ListRow active={active} onClick={onClick} className="items-start gap-2">
      {step !== undefined && (
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground/70">
          {step}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-foreground">
            /
            {skill.frontmatter.name}
          </span>
          <Badge variant="outline" className="text-[10px] uppercase">{originLabel(skill)}</Badge>
        </div>
        <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
          {skill.frontmatter.description}
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
  // Sort the Build group by `order` so the numbered steps line up with
  // the workflow. Sparse numbering (100, 200, 300 by convention) lets
  // plugins slot between built-ins by picking e.g. 150 without anyone
  // renumbering. The UI displays sequential rank (1, 2, 3) so users
  // never see the raw sort keys.
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
}

function Conversation({ workspaceId, skill }: ConversationProps) {
  const conversation = useConversation(workspaceId, skill.id)
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const running = conversation.phase === 'streaming' || submitting
  const isFollowUp = conversation.sessionId !== null
  const turnCount = conversation.events.filter(e => e.type === 'started').length

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

  async function send(): Promise<void> {
    if (!prompt.trim() || running)
      return
    const promptToSend = prompt
    setPrompt('')
    setSubmitting(true)
    setLocalError(null)
    try {
      const { runId } = await api.startSkillRun(
        workspaceId,
        skill.id,
        promptToSend,
        conversation.sessionId ?? undefined,
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
        {turnCount > 0 && (
          <Button variant="ghost" size="sm" onClick={reset} disabled={running}>
            <Plus />
            New conversation
          </Button>
        )}
      </div>
      <SkillTranscript events={[...conversation.events]} error={transcriptError} running={running} />
      <div className="flex items-end gap-2 border-t border-border px-4 py-2.5">
        <Textarea
          placeholder={
            isFollowUp
              ? 'Ask a follow-up… (Enter to send, Shift+Enter for newline)'
              : (skill.frontmatter.argumentHint ?? 'Describe what you want… (Enter to send, Shift+Enter for newline)')
          }
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !running) {
              e.preventDefault()
              void send()
            }
          }}
          disabled={running}
          rows={2}
          className="flex-1 font-mono"
          autoFocus
        />
        <Button size="sm" onClick={send} disabled={running || !prompt.trim()}>
          <Send />
          {running ? 'Sending…' : isFollowUp ? 'Send' : 'Start'}
        </Button>
      </div>
    </div>
  )
}

export function groupBySession(records: readonly RunRecord[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>()
  const orphans: SessionGroup[] = []
  // records arrive newest-first from the API; we want oldest-first inside a
  // session so the replay reads top-to-bottom in chronological order.
  for (const rec of [...records].reverse()) {
    if (!rec.sessionId) {
      orphans.push({
        groupId: rec.runId,
        sessionId: null,
        records: [rec],
        firstPrompt: rec.args,
        skillId: rec.skillId,
        lastStartedAt: rec.startedAt,
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
      })
    }
  }
  return [...groups.values(), ...orphans].sort((a, b) => b.lastStartedAt.localeCompare(a.lastStartedAt))
}

export function originLabel(skill: SkillManifest): string {
  // Plugin skills surface their plugin id (e.g. `redoc-ddd`) so the user
  // can tell at a glance which plugin shipped the action; everything else
  // shows the origin value directly (`builtin` / `workspace` / `extension`).
  if (skill.origin === 'plugin' && skill.pluginId)
    return skill.pluginId
  return skill.origin
}

export function formatTimestamp(value: string): string {
  // ISO 8601: `YYYY-MM-DDTHH:mm` local time. T-separator (not space) is
  // the distinguishing ISO marker. Seconds dropped because the sidebar
  // is narrow; full precision lives in the run record itself.
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
