import type { Workspace } from '@braidhq/schema'
import type { Surface } from './CommandPalette'
import { Activity, ClipboardCheck, GitGraph, Globe, HelpCircle, Laptop, LogIn, Moon, Network, PanelLeftClose, PanelLeftOpen, Plus, Settings, Sparkles, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import braidLogo from '@/assets/braid-logo.svg'
import { usePendingClarification, usePendingProposals, useRuns, useSkills } from '@/lib/queries'
import { setActiveRemoteId, useActiveRemoteId } from '@/lib/remotes'
import { useTheme } from '@/lib/theme'
import { type RemoteSummary, type RemoteWorkspacesResult, useAllRemoteWorkspaces } from '@/lib/useRemoteWorkspaces'
import { cn } from '@/lib/utils'
import { useWorkspacePolicy } from '@/policy'
import { CreateWorkspaceWizard } from './CreateWorkspaceWizard'
import { ListRow } from './ListRow'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { WorkspaceSwatch, WorkspaceSwatchWithPending } from './WorkspaceSwatch'

const COLLAPSED_KEY = 'braid-sidebar-collapsed'

// Server-stripe palette mirrors the workspace swatch palette,
// but with a stronger left-edge bar tone,
// so it reads as identity even at 2-3px.
// Local always uses the muted token,
// so the embedded sidecar never competes with named remotes for attention.
const REMOTE_STRIPE_PALETTE = [
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-fuchsia-500',
] as const

function remoteStripeClass(remote: RemoteSummary): string {
  if (remote.isLocal)
    return 'bg-sidebar-foreground/30'
  let h = 0
  for (let i = 0; i < remote.id.length; i++)
    h = (h * 31 + remote.id.charCodeAt(i)) >>> 0
  return REMOTE_STRIPE_PALETTE[h % REMOTE_STRIPE_PALETTE.length]!
}

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
  activeWorkspaceId,
  activeSurface,
  onSelect,
  onOpenDetails,
  onGoHome,
  onSelectSurface,
}: SidebarProps) {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [collapsed, setCollapsedState] = useState<boolean>(readStoredCollapsed)
  const activeRemoteId = useActiveRemoteId()
  const remoteResults = useAllRemoteWorkspaces()

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

  function selectWorkspace(remote: RemoteSummary, workspaceId: string): void {
    if (remote.id !== activeRemoteId)
      setActiveRemoteId(remote.id)
    onSelect(workspaceId)
  }

  function openAddWorkspace(remote: RemoteSummary): void {
    if (remote.id !== activeRemoteId)
      setActiveRemoteId(remote.id)
    setWizardOpen(true)
  }

  function startRemoteSignIn(remote: RemoteSummary): void {
    if (typeof window === 'undefined')
      return
    const returnTo = `${window.location.origin}${window.location.pathname}#auth-remote=${encodeURIComponent(remote.id)}`
    window.location.href = `${remote.url}/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`
  }

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
              <span className="text-[11px] italic text-sidebar-foreground/60">braiding intent &amp; code</span>
            </div>
          )}
        </div>
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

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin border-t border-sidebar-border px-2 pb-2 pt-1">
        {remoteResults.map(result => (
          <RemoteSection
            key={result.remote.id}
            result={result}
            showStripe={remoteResults.length > 1}
            collapsed={collapsed}
            activeWorkspaceId={activeWorkspaceId}
            activeRemoteId={activeRemoteId}
            onSelectWorkspace={selectWorkspace}
            onOpenDetails={onOpenDetails}
            onOpenAdd={openAddWorkspace}
            onSignIn={startRemoteSignIn}
          />
        ))}
      </div>

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

function RemoteSection({
  result,
  showStripe,
  collapsed,
  activeWorkspaceId,
  activeRemoteId,
  onSelectWorkspace,
  onOpenDetails,
  onOpenAdd,
  onSignIn,
}: {
  result: RemoteWorkspacesResult
  showStripe: boolean
  collapsed: boolean
  activeWorkspaceId: string | null
  activeRemoteId: string
  onSelectWorkspace: (remote: RemoteSummary, workspaceId: string) => void
  onOpenDetails: (workspaceId: string) => void
  onOpenAdd: (remote: RemoteSummary) => void
  onSignIn: (remote: RemoteSummary) => void
}) {
  const { remote, state } = result
  const isActiveRemote = remote.id === activeRemoteId
  // Server identity stripe only earns its keep with more than one remote.
  // A single local server needs no per-row colour bar.
  const stripe = showStripe ? remoteStripeClass(remote) : ''
  const Icon = remote.isLocal ? Laptop : Globe

  return (
    <div className={cn('pb-1', collapsed ? 'pt-1' : 'pt-2')}>
      {!collapsed && (
        <div className="group/heading flex items-center justify-between px-2 pb-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon className={cn('size-3 shrink-0', isActiveRemote ? 'text-sidebar-foreground/70' : 'text-sidebar-foreground/40')} />
            <span
              className={cn(
                'truncate text-[11px] font-semibold uppercase tracking-wider',
                isActiveRemote ? 'text-sidebar-foreground/70' : 'text-sidebar-foreground/45',
              )}
              title={remote.url}
            >
              {remote.name}
            </span>
          </div>
          {state.kind === 'ok' && (
            <button
              type="button"
              onClick={() => onOpenAdd(remote)}
              title="Open workspace"
              className="flex size-5 items-center justify-center rounded text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {collapsed && (
        <div className="flex justify-center pb-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn('h-0.5 w-6 rounded-full', stripe)} />
            </TooltipTrigger>
            <TooltipContent side="right">{remote.name}</TooltipContent>
          </Tooltip>
        </div>
      )}

      <RemoteContent
        state={state}
        remote={remote}
        stripe={stripe}
        collapsed={collapsed}
        isActiveRemote={isActiveRemote}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={onSelectWorkspace}
        onOpenDetails={onOpenDetails}
        onOpenAdd={onOpenAdd}
        onSignIn={onSignIn}
      />
    </div>
  )
}

function RemoteContent({
  state,
  remote,
  stripe,
  collapsed,
  isActiveRemote,
  activeWorkspaceId,
  onSelectWorkspace,
  onOpenDetails,
  onOpenAdd,
  onSignIn,
}: {
  state: RemoteWorkspacesResult['state']
  remote: RemoteSummary
  stripe: string
  collapsed: boolean
  isActiveRemote: boolean
  activeWorkspaceId: string | null
  onSelectWorkspace: (remote: RemoteSummary, workspaceId: string) => void
  onOpenDetails: (workspaceId: string) => void
  onOpenAdd: (remote: RemoteSummary) => void
  onSignIn: (remote: RemoteSummary) => void
}) {
  if (state.kind === 'loading') {
    if (collapsed)
      return null
    return (
      <div className="px-2 py-1 text-[11px] text-sidebar-foreground/40">Loading…</div>
    )
  }

  if (state.kind === 'unauthenticated') {
    if (collapsed) {
      return (
        <div className="flex justify-center py-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onSignIn(remote)}
                title={`Sign in to ${remote.name}`}
                className="flex size-7 items-center justify-center rounded text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <LogIn className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{`Sign in to ${remote.name}`}</TooltipContent>
          </Tooltip>
        </div>
      )
    }
    return (
      <button
        type="button"
        onClick={() => onSignIn(remote)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        <LogIn className="size-3.5" />
        <span>Sign In</span>
      </button>
    )
  }

  if (state.kind === 'error') {
    if (collapsed)
      return null
    return (
      <div className="px-2 py-1 text-[11px] text-destructive" title={state.message}>
        Unreachable
      </div>
    )
  }

  const workspaces = state.workspaces
  if (workspaces.length === 0) {
    if (collapsed) {
      return (
        <div className="flex justify-center py-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onOpenAdd(remote)}
                title={`Open workspace on ${remote.name}`}
                className="flex size-7 items-center justify-center rounded text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{`Open workspace on ${remote.name}`}</TooltipContent>
          </Tooltip>
        </div>
      )
    }
    return (
      <div className="px-2 py-1 text-[11px] text-sidebar-foreground/40">No workspace yet.</div>
    )
  }

  return (
    <ul className="space-y-px">
      {workspaces.map(ws => (
        <WorkspaceRow
          key={`${remote.id}:${ws.id}`}
          workspace={ws}
          remote={remote}
          stripe={stripe}
          collapsed={collapsed}
          isActiveRemote={isActiveRemote}
          active={isActiveRemote && ws.id === activeWorkspaceId}
          onClick={() => onSelectWorkspace(remote, ws.id)}
          onOpenDetails={() => onOpenDetails(ws.id)}
        />
      ))}
      {collapsed && (
        <li className="flex justify-center py-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onOpenAdd(remote)}
                title={`Open workspace on ${remote.name}`}
                className="flex size-7 items-center justify-center rounded text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{`Open workspace on ${remote.name}`}</TooltipContent>
          </Tooltip>
        </li>
      )}
    </ul>
  )
}

function WorkspaceRow({
  workspace,
  remote,
  stripe,
  collapsed,
  isActiveRemote,
  active,
  onClick,
  onOpenDetails,
}: {
  workspace: Workspace
  remote: RemoteSummary
  stripe: string
  collapsed: boolean
  isActiveRemote: boolean
  active: boolean
  onClick: () => void
  onOpenDetails: () => void
}) {
  // Inactive remotes get a dimmer stripe,
  // so the active server still reads first,
  // while server identity stays visible across all rows.
  return (
    <ListRow
      variant="sidebar"
      active={active}
      onClick={onClick}
      stripeClassName={stripe}
      stripeDim={!isActiveRemote}
      {...(collapsed
        ? { title: `${remote.name} / ${workspace.id}`, className: 'justify-center px-0 py-1 pl-1' }
        : { className: 'pl-3' })}
    >
      {collapsed
        ? (
            isActiveRemote
              ? (
                  <WorkspaceSwatchWithPending
                    workspaceId={workspace.id}
                    active={active}
                  />
                )
              : (
                  <WorkspaceSwatch workspaceId={workspace.id} active={active} />
                )
          )
        : (
            <>
              <WorkspaceSwatch workspaceId={workspace.id} size="sm" />
              <span className="truncate font-medium">{workspace.id}</span>
              {isActiveRemote && <WorkspaceBadges workspaceId={workspace.id} />}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenDetails()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onOpenDetails()
                  }
                }}
                className="ml-1 hidden rounded p-0.5 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:inline-flex"
                title="Details"
              >
                ⋯
              </span>
            </>
          )}
    </ListRow>
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
  const { data: clarifications } = usePendingClarification(workspaceId)
  const policy = useWorkspacePolicy(workspaceId)
  const { data: skills } = useSkills(workspaceId)
  const pendingProposals = proposals?.items.length ?? 0
  const pendingClarification = clarifications?.items.length ?? 0
  const canSeeProposals = policy.can('proposal.read')
  const canSeeClarification = policy.can('clarification.read')
  const canRunActions = (skills?.items ?? []).some(s =>
    !s.frontmatter.braid.hidden && policy.can('skill.run', { skill: s.frontmatter, skillId: s.id }),
  )
  const canSeeHistory = policy.effectiveRole !== null && policy.effectiveRole !== 'guest'

  return (
    <div className={cn('shrink-0 border-t border-sidebar-border px-2 pb-2', collapsed ? 'pt-1.5' : 'pt-2')}>
      {!collapsed && (
        <div className="px-2 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">Here</span>
        </div>
      )}
      <ul className="space-y-px">
        <HereRow
          collapsed={collapsed}
          icon={Network}
          label="Graph"
          active={activeSurface === null}
          shortcut="G G"
          onClick={onGoHome}
        />
        {canRunActions && (
          <HereRow
            collapsed={collapsed}
            icon={Sparkles}
            label="Actions"
            active={activeSurface === 'actions'}
            shortcut="G A"
            onClick={() => onSelectSurface('actions')}
          />
        )}
        {canSeeClarification && (
          <HereRow
            collapsed={collapsed}
            icon={HelpCircle}
            label="Clarifications"
            active={activeSurface === 'clarifications'}
            count={pendingClarification}
            shortcut="G C"
            onClick={() => onSelectSurface('clarifications')}
          />
        )}
        {canSeeProposals && (
          <HereRow
            collapsed={collapsed}
            icon={ClipboardCheck}
            label="Proposals"
            active={activeSurface === 'proposals'}
            count={pendingProposals}
            shortcut="G P"
            onClick={() => onSelectSurface('proposals')}
          />
        )}
        <HereRow
          collapsed={collapsed}
          icon={Activity}
          label="Activity"
          active={activeSurface === 'activity'}
          shortcut="G B"
          onClick={() => onSelectSurface('activity')}
        />
        {canSeeHistory && (
          <HereRow
            collapsed={collapsed}
            icon={GitGraph}
            label="History"
            active={activeSurface === 'history'}
            shortcut="G H"
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
          shortcut="G S"
          onClick={() => onSelectSurface('settings')}
        />
      </ul>
    </div>
  )
}

function HereRow({ collapsed, icon: Icon, label, active, count = 0, shortcut, onClick }: {
  collapsed: boolean
  icon: typeof Sparkles
  label: string
  active: boolean
  count?: number
  shortcut?: string
  onClick: () => void
}) {
  const collapsedTitle = [label, count > 0 ? `(${count})` : null, shortcut].filter(Boolean).join(' ')
  return (
    <ListRow
      variant="sidebar"
      active={active}
      onClick={onClick}
      {...(collapsed ? { title: collapsedTitle, className: 'justify-center px-0 py-1' } : {})}
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
              <div className="flex size-5 shrink-0 items-center justify-center text-sidebar-foreground/70">
                <Icon className="size-4" />
              </div>
              <span className="flex-1 truncate text-left font-medium">{label}</span>
              {count > 0 && (
                <span
                  className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[11px] font-medium text-sidebar-foreground/80"
                  title={`${count} pending`}
                >
                  {count}
                </span>
              )}
              {shortcut && (
                <kbd
                  className="rounded bg-sidebar-accent/40 px-1.5 py-0.5 text-[11px] font-mono text-sidebar-foreground/50"
                  aria-hidden
                >
                  {shortcut}
                </kbd>
              )}
            </>
          )}
    </ListRow>
  )
}

function WorkspaceBadges({ workspaceId }: { workspaceId: string }) {
  const { data: proposals } = usePendingProposals(workspaceId)
  const { data: clarifications } = usePendingClarification(workspaceId)
  const { data: runs } = useRuns(workspaceId)
  const pendingProposals = proposals?.items.length ?? 0
  const pendingClarification = clarifications?.items.length ?? 0
  const running = runs?.items.filter(r => !r.completedAt).length ?? 0
  const total = pendingProposals + pendingClarification + running
  if (total === 0)
    return null
  const breakdown = [
    running > 0 ? `${running} run${running === 1 ? '' : 's'} in flight` : null,
    pendingClarification > 0 ? `${pendingClarification} pending clarification${pendingClarification === 1 ? '' : 's'}` : null,
    pendingProposals > 0 ? `${pendingProposals} pending proposal${pendingProposals === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="ml-auto rounded bg-sidebar-accent px-1.5 py-0.5 text-[11px] font-medium text-sidebar-foreground/80"
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
