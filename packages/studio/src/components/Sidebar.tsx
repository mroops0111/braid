import type { Workspace } from '@braidhq/schema'
import { FolderGit2, Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import braidLogo from '@/assets/braid-logo.svg'
import { usePendingProposals, useRuns } from '@/lib/queries'
import { CreateWorkspaceWizard } from './CreateWorkspaceWizard'
import { ListRow } from './ListRow'

interface SidebarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (id: string) => void
  onOpenDetails: (id: string) => void
}

export function Sidebar({ workspaces, activeWorkspaceId, onSelect, onOpenDetails }: SidebarProps) {
  const [wizardOpen, setWizardOpen] = useState(false)

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-11 items-center px-4">
        <div className="flex items-center gap-2">
          <img src={braidLogo} alt="" className="size-5 shrink-0" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">Braid</span>
            <span className="text-[10px] italic text-sidebar-foreground/60">braiding intent &amp; code</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
        <div className="flex items-center justify-between px-2 pt-1 pb-1">
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
        <ul className="space-y-px">
          {workspaces.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-sidebar-foreground/40">No workspace yet.</li>
          )}
          {workspaces.map(ws => (
            <ListRow
              key={ws.id}
              variant="sidebar"
              active={ws.id === activeWorkspaceId}
              onClick={() => onSelect(ws.id)}
            >
              <FolderGit2 className="size-3.5 shrink-0 text-sidebar-foreground/50" />
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
            </ListRow>
          ))}
        </ul>
      </div>

      <CreateWorkspaceWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={onSelect} />
    </aside>
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
