import type { SkillManifest, SkillPermission, WorkspaceMember } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Minus, X } from 'lucide-react'
import { api } from '@/lib/api'
import { queryKeys, useMe, useSkills, useUsers, useWorkspaceMembers } from '@/lib/queries'
import { bucketByGroup } from '@/pages/Actions'

type CellState = 'allow' | 'deny' | 'inherit'

function cycleState(current: CellState): CellState {
  if (current === 'inherit')
    return 'allow'
  if (current === 'allow')
    return 'deny'
  return 'inherit'
}

interface SectionHeaderProps {
  title: string
}

function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {title}
    </h3>
  )
}

export function WorkspaceSkillPermissions({ workspaceId }: { workspaceId: string }) {
  const { data: members, isLoading: membersLoading } = useWorkspaceMembers(workspaceId)
  const { data: skills, isLoading: skillsLoading } = useSkills(workspaceId)
  const { data: allUsers } = useUsers()
  const { data: me } = useMe()

  if (membersLoading || skillsLoading) {
    return (
      <section>
        <SectionHeader title="Skill Permissions" />
        <p className="mt-2 text-[11px] text-muted-foreground">Loading…</p>
      </section>
    )
  }

  // Owners always pass the ACL gate regardless of overrides — showing
  // a row for them would be misleading. Hidden skills (orchestration-only)
  // are never user-runnable, so they're not actionable here either.
  const visibleMembers = (members?.items ?? []).filter(m => m.role !== 'owner')
  // Mirror the Actions page column order (ask, build by `order`, generate,
  // custom) so members map cells to the page they'll find the skill on.
  const visibleSkills = orderSkillsForGrid((skills?.items ?? []).filter(s => !s.frontmatter.braid.hidden))

  if (visibleMembers.length === 0 || visibleSkills.length === 0) {
    return (
      <section>
        <SectionHeader title="Skill Permissions" />
        <p className="mt-2 text-[11px] text-muted-foreground">
          {visibleMembers.length === 0
            ? 'No Maintainers or Guests to manage. Owners always have full access.'
            : 'No skills available in this workspace.'}
        </p>
      </section>
    )
  }

  return (
    <section>
      <SectionHeader title="Skill Permissions" />
      <p className="mt-1 text-[10px] text-muted-foreground">
        Click a cell to cycle inherit, allow, deny. Inherit uses the skill's role default.
      </p>
      <div className="mt-2 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-card/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="sticky left-0 bg-card/40 px-3 py-1.5">Member</th>
              {visibleSkills.map(skill => (
                <th key={skill.id} className="px-2 py-1.5 text-center" title={skillTooltip(skill)}>
                  <div className="font-mono">{skill.id.replace(/^braid-/, '')}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleMembers.map((member, idx) => (
              <PermissionRow
                key={member.userId}
                workspaceId={workspaceId}
                member={member}
                displayName={
                  allUsers?.items.find(u => u.id === member.userId)?.displayName ?? member.userId
                }
                skills={visibleSkills}
                isMe={me?.id === member.userId}
                isLast={idx === visibleMembers.length - 1}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PermissionRow({ workspaceId, member, displayName, skills, isMe, isLast }: {
  workspaceId: string
  member: WorkspaceMember
  displayName: string
  skills: SkillManifest[]
  isMe: boolean
  isLast: boolean
}) {
  const queryClient = useQueryClient()
  const patch = useMutation({
    mutationFn: (nextOverrides: Record<string, SkillPermission>) =>
      api.patchWorkspaceMember(workspaceId, member.userId, {
        // PATCH replaces skillOverrides wholesale; sending {} clears.
        skillOverrides: Object.keys(nextOverrides).length > 0 ? nextOverrides : {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceMembers(workspaceId) })
    },
  })

  function flip(skillId: string) {
    const overrides = (member.skillOverrides ?? {}) as Record<string, SkillPermission>
    const current = (overrides[skillId] ?? 'inherit') as CellState
    const next = cycleState(current)
    const updated: Record<string, SkillPermission> = { ...overrides }
    if (next === 'inherit')
      delete updated[skillId]
    else
      updated[skillId] = next
    patch.mutate(updated)
  }

  return (
    <tr className={isLast ? '' : 'border-b border-border'}>
      <td className="sticky left-0 bg-background px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-foreground/90">{displayName}</span>
          {isMe && (
            <span className="rounded bg-primary/15 px-1 py-0.5 text-[9px] uppercase tracking-wider text-primary">
              You
            </span>
          )}
          <span className="rounded bg-muted/60 px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
            {member.role}
          </span>
        </div>
      </td>
      {skills.map((skill) => {
        const state = (member.skillOverrides?.[skill.id] ?? 'inherit') as CellState
        const allowedByDefault = skill.frontmatter.braid.allowedRoles.includes(member.role)
        return (
          <td key={skill.id} className="px-2 py-1.5 text-center">
            <button
              type="button"
              onClick={() => flip(skill.id)}
              disabled={patch.isPending}
              className="inline-flex size-6 items-center justify-center rounded transition-colors hover:bg-accent disabled:opacity-50"
              title={cellTooltip(state, allowedByDefault, member.role)}
            >
              <CellIcon state={state} allowedByDefault={allowedByDefault} />
            </button>
          </td>
        )
      })}
    </tr>
  )
}

function CellIcon({ state, allowedByDefault }: { state: CellState, allowedByDefault: boolean }) {
  if (state === 'allow')
    return <Check className="size-3.5 text-emerald-500" />
  if (state === 'deny')
    return <X className="size-3.5 text-destructive" />
  // Inherit: dim the icon, but reflect the underlying default so the
  // cell still communicates effective access at a glance.
  return (
    <Minus className={allowedByDefault ? 'size-3.5 text-emerald-500/40' : 'size-3.5 text-muted-foreground/40'} />
  )
}

function skillTooltip(skill: SkillManifest): string {
  return `Default: ${skill.frontmatter.braid.allowedRoles.join(', ')}`
}

function cellTooltip(state: CellState, allowedByDefault: boolean, role: string): string {
  if (state === 'allow')
    return 'Override: allow'
  if (state === 'deny')
    return 'Override: deny'
  return `Inherit (${allowedByDefault ? 'allowed' : 'denied'} for ${role})`
}

function orderSkillsForGrid(skills: SkillManifest[]): SkillManifest[] {
  const buckets = bucketByGroup(skills)
  return [...buckets.ask, ...buckets.build, ...buckets.generate, ...buckets.custom]
}
