import type { Workspace } from '@braidhq/schema'
import { FolderGit2, Loader2, Moon, PanelLeftClose, PanelLeftOpen, Plus, Server, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import braidLogo from '@/assets/braid-logo.svg'
import { usePendingProposals, useRuns } from '@/lib/queries'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { CreateWorkspaceWizard } from './CreateWorkspaceWizard'
import { ListRow } from './ListRow'

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
  onSelect: (id: string) => void
  onOpenDetails: (id: string) => void
  onOpenServerUrl: () => void
}

export function Sidebar({ workspaces, activeWorkspaceId, onSelect, onOpenDetails, onOpenServerUrl }: SidebarProps) {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [collapsed, setCollapsedState] = useState<boolean>(readStoredCollapsed)

  function setCollapsed(next: boolean): void {
    writeStoredCollapsed(next)
    setCollapsedState(next)
  }

  // Cmd+\ / Ctrl+\ toggles the sidebar collapsed state. Linear / VS Code
  // use the same chord; keeps the muscle memory consistent for users
  // coming from those tools.
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
        'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150',
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
        <div className={cn('flex items-center pt-1 pb-1', collapsed ? 'justify-center' : 'justify-between px-2')}>
          {!collapsed && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              Workspaces
            </span>
          )}
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            title="Open workspace"
            className="flex size-5 items-center justify-center rounded text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
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
              {...(collapsed ? { title: ws.id, className: 'justify-center px-0' } : {})}
            >
              <FolderGit2 className="size-3.5 shrink-0 text-sidebar-foreground/50" />
              {!collapsed && (
                <>
                  <span className="truncate font-medium">{ws.id}</span>
                  <WorkspaceBadges workspaceId={ws.id} />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenDetails(ws.id)
                    }}
                    className="ml-1 rounded p-0.5 text-sidebar-foreground/40 opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:opacity-100"
                    title="Details"
                  >
                    ⋯
                  </button>
                </>
              )}
            </ListRow>
          ))}
        </ul>
      </div>

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
                <SidebarIconButton onClick={onOpenServerUrl} title="Configure server URL">
                  <Server className="size-3.5" />
                </SidebarIconButton>
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
                  <SidebarIconButton onClick={onOpenServerUrl} title="Configure server URL">
                    <Server className="size-3.5" />
                  </SidebarIconButton>
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

function WorkspaceBadges({ workspaceId }: { workspaceId: string }) {
  // For the active workspace, useWorkspaceEvents keeps these query keys
  // live. For inactive workspaces the counts are slightly stale until
  // the user opens it; acceptable cost to avoid N concurrent SSEs.
  const { data: proposals } = usePendingProposals(workspaceId)
  const { data: runs } = useRuns(workspaceId)
  const pending = proposals?.items.length ?? 0
  const running = runs?.items.filter(r => !r.completedAt).length ?? 0
  if (pending === 0 && running === 0)
    return null
  return (
    <span className="ml-auto flex items-center gap-1.5 text-[10px] text-sidebar-foreground/60">
      {running > 0 && (
        <span className="flex items-center gap-0.5" title={`${running} run${running === 1 ? '' : 's'} in flight`}>
          <Loader2 className="size-2.5 animate-spin text-primary" />
          {running}
        </span>
      )}
      {pending > 0 && (
        <span className="rounded bg-sidebar-accent px-1 py-0.5 text-sidebar-foreground/70" title={`${pending} pending proposal${pending === 1 ? '' : 's'}`}>
          {pending}
        </span>
      )}
    </span>
  )
}
