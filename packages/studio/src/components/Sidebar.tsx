import type { Workspace } from '@braidhq/schema'
import type { Surface } from './CommandPalette'
import { ClipboardCheck, GitGraph, Globe, HelpCircle, Laptop, Moon, Network, PanelLeftClose, PanelLeftOpen, Plus, Settings, Sparkles, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import braidLogo from '@/assets/braid-logo.svg'
import { usePendingClarify, usePendingProposals, useRuns, useSkills } from '@/lib/queries'
import { LOCAL_REMOTE_ID, useActiveRemoteId, useRemotes } from '@/lib/remotes'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useWorkspacePolicy } from '@/policy'
import { CreateWorkspaceWizard } from './CreateWorkspaceWizard'
import { ListRow } from './ListRow'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { WorkspaceSwatch, WorkspaceSwatchWithPending } from './WorkspaceSwatch'

const COLLAPSED_KEY = 'braid-sidebar-collapsed'

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true'
  }
  catch {
    return false
  }
}

function writeStoredCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed))
  }
  catch {}
}

interface SidebarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activeSurface: Surface | null
  onSelect: (id: string) => void
  onOpenDetails: (id: string) => void
  onGoHome: () => void
  onSelectSurface: (next: Surface) => void
}

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  activeSurface,
  onSelect,
  onOpenDetails,
  onGoHome,
  onSelectSurface,
}: SidebarProps) {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [collapsed, setCollapsedState] = useState<boolean>(readStoredCollapsed)

  function setCollapsed(next: boolean): void {
    writeStoredCollapsed(next)
    setCollapsedState(next)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        setCollapsed(!collapsed)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapsed])

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        collapsed ? 'w-12' : 'w-60',
      )}
    >
      <div className={cn('flex h-11 shrink-0 items-center', collapsed ? 'justify-center px-2' : 'px-4')}>
        <div className="flex items-center gap-2">
          <img src={braidLogo} alt="" className="size-5 shrink-0" />
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight">Braid</span>
              <span className="text-[10px] italic text-sidebar-foreground/60">braiding intent &amp; code</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
        <ActiveServerLabel collapsed={collapsed} />
        {!collapsed && (
          <div className="flex items-center justify-between pt-1 pb-1 px-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              Workspaces
            </span>
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              title="Open workspace"
              className="flex size-5 items-center justify-center rounded text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        )}
        <ul className="space-y-px">
          {workspaces.length === 0 && !collapsed && (
            <li className="px-2 py-1.5 text-xs text-sidebar-foreground/40">No workspace yet.</li>
          )}
          {workspaces.map(ws => (
            <ListRow
              key={ws.id}
              variant="sidebar"
              active={ws.id === activeWorkspaceId}
              onClick={() => onSelect(ws.id)}
              {...(collapsed ? { title: ws.id, className: 'justify-center px-0 py-1' } : {})}
            >
              {collapsed
                ? (
                    <WorkspaceSwatchWithPending
                      workspaceId={ws.id}
                      active={ws.id === activeWorkspaceId}
                    />
                  )
                : (
                    <>
                      <WorkspaceSwatch workspaceId={ws.id} size="sm" />
                      <span className="truncate font-medium">{ws.id}</span>
                      <WorkspaceBadges workspaceId={ws.id} />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenDetails(ws.id)
                        }}
                        className="ml-1 hidden rounded p-0.5 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:inline-flex"
                        title="Details"
                      >
                        ⋯
                      </button>
                    </>
                  )}
            </ListRow>
          ))}
        </ul>
        {collapsed && (
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              title="Open workspace"
              className="flex size-7 items-center justify-center rounded text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {activeWorkspaceId && (
        <HereSection
          workspaceId={activeWorkspaceId}
          activeSurface={activeSurface}
          collapsed={collapsed}
          onGoHome={onGoHome}
          onSelectSurface={onSelectSurface}
        />
      )}

      <AccountSection
        activeSurface={activeSurface}
        collapsed={collapsed}
        onSelectSurface={onSelectSurface}
      />

      <div className={cn(
        'flex shrink-0 border-t border-sidebar-border',
        collapsed
          ? 'flex-col items-center gap-0.5 py-1.5'
          : 'h-10 items-center justify-between px-3',
      )}
      >
        {collapsed
          ? (
              <>
                <ThemeToggle />
                <SidebarIconButton
                  onClick={() => setCollapsed(false)}
                  title="Expand sidebar (⌘\\)"
                >
                  <PanelLeftOpen className="size-3.5" />
                </SidebarIconButton>
              </>
            )
          : (
              <>
                {/* Empty flex spacer reserves the left of the utility row
                    for a future user / account avatar; without it the
                    icons would drift to centre when account is absent. */}
                <div className="flex-1" />
                <div className="flex items-center gap-0.5">
                  <ThemeToggle />
                  <SidebarIconButton
                    onClick={() => setCollapsed(true)}
                    title="Collapse sidebar (⌘\\)"
                  >
                    <PanelLeftClose className="size-3.5" />
                  </SidebarIconButton>
                </div>
              </>
            )}
      </div>

      <CreateWorkspaceWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={onSelect} />
    </aside>
  )
}

function SidebarIconButton({ onClick, title, children }: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex size-7 items-center justify-center rounded text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      {children}
    </button>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const Icon = theme === 'dark' ? Moon : Sun
  return (
    <SidebarIconButton
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <Icon className="size-3.5" />
    </SidebarIconButton>
  )
}

function ActiveServerLabel({ collapsed }: { collapsed: boolean }) {
  const remotes = useRemotes()
  const activeId = useActiveRemoteId()
  if (remotes.length === 0 || collapsed)
    return null
  const isLocal = activeId === LOCAL_REMOTE_ID
  const activeName = isLocal
    ? 'Local'
    : remotes.find(r => r.id === activeId)?.name ?? 'Local'
  const Icon = isLocal ? Laptop : Globe
  return (
    <div className="flex items-center gap-1.5 px-2 pt-1 pb-0.5">
      <Icon className="size-3 text-sidebar-foreground/50" />
      <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40">Server:</span>
      <span className="font-mono text-[10px] text-sidebar-foreground/70">{activeName}</span>
    </div>
  )
}

function HereSection({
  workspaceId,
  activeSurface,
  collapsed,
  onGoHome,
  onSelectSurface,
}: {
  workspaceId: string
  activeSurface: Surface | null
  collapsed: boolean
  onGoHome: () => void
  onSelectSurface: (next: Surface) => void
}) {
  const { data: proposals } = usePendingProposals(workspaceId)
  const { data: clarify } = usePendingClarify(workspaceId)
  const policy = useWorkspacePolicy(workspaceId)
  const { data: skills } = useSkills(workspaceId)
  const pendingProposals = proposals?.items.length ?? 0
  const pendingClarify = clarify?.items.length ?? 0
  // HITL tabs are hidden when the viewer can't act on them. The server
  // 403-gates the same routes, so devtools tampering changes nothing.
  const canSeeProposals = policy.can('proposal.read')
  const canSeeClarify = policy.can('clarify.read')
  // Actions tab is visible when the viewer can run at least one
  // workspace skill. Owners/maintainers trivially can; guests get the
  // tab only when a skill's allowedRoles or their per-member override
  // gives them something runnable (e.g. braid-ask in the default
  // catalog).
  const canRunActions = (skills?.items ?? []).some(s =>
    !s.frontmatter.braid.hidden && policy.can('skill.run', { skill: s.frontmatter, skillId: s.id }),
  )
  // History page exposes Tag / Restore actions which are owner-only.
  // Even though the server 403s, showing the buttons to guests is
  // misleading; hide the whole tab for them.
  const canSeeHistory = policy.effectiveRole !== null && policy.effectiveRole !== 'guest'

  return (
    <div className={cn('shrink-0 border-t border-sidebar-border px-2 pb-2', collapsed ? 'pt-1.5' : 'pt-2')}>
      {!collapsed && (
        <div className="px-2 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">Here</span>
        </div>
      )}
      <ul className="space-y-px">
        <HereRow
          collapsed={collapsed}
          icon={Network}
          label="Graph"
          active={activeSurface === null}
          onClick={onGoHome}
        />
        {canRunActions && (
          <HereRow
            collapsed={collapsed}
            icon={Sparkles}
            label="Actions"
            active={activeSurface === 'actions'}
            onClick={() => onSelectSurface('actions')}
          />
        )}
        {canSeeClarify && (
          <HereRow
            collapsed={collapsed}
            icon={HelpCircle}
            label="Clarify"
            active={activeSurface === 'clarify'}
            count={pendingClarify}
            onClick={() => onSelectSurface('clarify')}
          />
        )}
        {canSeeProposals && (
          <HereRow
            collapsed={collapsed}
            icon={ClipboardCheck}
            label="Proposals"
            active={activeSurface === 'proposals'}
            count={pendingProposals}
            onClick={() => onSelectSurface('proposals')}
          />
        )}
        {canSeeHistory && (
          <HereRow
            collapsed={collapsed}
            icon={GitGraph}
            label="History"
            active={activeSurface === 'history'}
            onClick={() => onSelectSurface('history')}
          />
        )}
      </ul>
    </div>
  )
}

function AccountSection({
  activeSurface,
  collapsed,
  onSelectSurface,
}: {
  activeSurface: Surface | null
  collapsed: boolean
  onSelectSurface: (next: Surface) => void
}) {
  return (
    <div className={cn('shrink-0 border-t border-sidebar-border px-2 pb-2', collapsed ? 'pt-1.5' : 'pt-2')}>
      <ul className="space-y-px">
        <HereRow
          collapsed={collapsed}
          icon={Settings}
          label="Settings"
          active={activeSurface === 'settings'}
          onClick={() => onSelectSurface('settings')}
        />
      </ul>
    </div>
  )
}

function HereRow({ collapsed, icon: Icon, label, active, count = 0, onClick }: {
  collapsed: boolean
  icon: typeof Sparkles
  label: string
  active: boolean
  count?: number
  onClick: () => void
}) {
  return (
    <ListRow
      variant="sidebar"
      active={active}
      onClick={onClick}
      {...(collapsed ? { title: count > 0 ? `${label} (${count})` : label, className: 'justify-center px-0 py-1' } : {})}
    >
      {collapsed
        ? (
            <div className="relative">
              <div className={cn(
                'flex size-7 items-center justify-center rounded-md transition-colors',
                active ? 'text-sidebar-foreground' : 'text-sidebar-foreground/70',
              )}
              >
                <Icon className="size-3.5" />
              </div>
              {count > 0 && (
                <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
              )}
            </div>
          )
        : (
            <>
              {/* size-5 wrapper so the icon column matches the workspace
                  swatch column above (both 20px wide), keeping label
                  x-positions aligned across both sections. */}
              <div className="flex size-5 shrink-0 items-center justify-center text-sidebar-foreground/70">
                <Icon className="size-3.5" />
              </div>
              <span className="flex-1 truncate text-left font-medium">{label}</span>
              {count > 0 && (
                <span
                  className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/80"
                  title={`${count} pending`}
                >
                  {count}
                </span>
              )}
            </>
          )}
    </ListRow>
  )
}

function WorkspaceBadges({ workspaceId }: { workspaceId: string }) {
  // For the active workspace, useWorkspaceEvents keeps these query keys
  // live. For inactive workspaces the counts are slightly stale until
  // the user opens it; acceptable cost to avoid N concurrent SSEs.
  // Three kinds (in-flight runs, pending clarifies, pending proposals)
  // aggregate into a single number; the active workspace's HERE
  // section is where the per-surface breakdown lives. A tooltip keeps
  // the breakdown a hover away for the inactive-workspace case.
  const { data: proposals } = usePendingProposals(workspaceId)
  const { data: clarify } = usePendingClarify(workspaceId)
  const { data: runs } = useRuns(workspaceId)
  const pendingProposals = proposals?.items.length ?? 0
  const pendingClarify = clarify?.items.length ?? 0
  const running = runs?.items.filter(r => !r.completedAt).length ?? 0
  const total = pendingProposals + pendingClarify + running
  if (total === 0)
    return null
  const breakdown = [
    running > 0 ? `${running} run${running === 1 ? '' : 's'} in flight` : null,
    pendingClarify > 0 ? `${pendingClarify} pending clarification${pendingClarify === 1 ? '' : 's'}` : null,
    pendingProposals > 0 ? `${pendingProposals} pending proposal${pendingProposals === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="ml-auto rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/80"
        >
          {total}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">
        <ul className="space-y-0.5">
          {breakdown.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}
