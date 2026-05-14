import type { Workspace } from '@telos/schema'
import { FolderGit2, FolderPlus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { CreateWorkspaceWizard } from './CreateWorkspaceWizard'
import { ListRow } from './ListRow'
import { RegisterWorkspaceDialog } from './RegisterWorkspaceDialog'
import { Button } from './ui/button'

interface SidebarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (id: string) => void
  onOpenDetails: (id: string) => void
}

export function Sidebar({ workspaces, activeWorkspaceId, onSelect, onOpenDetails }: SidebarProps) {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-11 items-center px-4">
        <div className="flex items-center gap-2">
          <div className="size-2.5 rounded-full bg-primary" />
          <span className="text-sm font-semibold tracking-tight">Telos</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
        <div className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Workspaces
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
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenDetails(ws.id)
                }}
                className="ml-auto rounded p-0.5 text-sidebar-foreground/40 opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:opacity-100"
                title="Details"
              >
                ⋯
              </button>
            </ListRow>
          ))}
        </ul>
      </div>

      <div className="space-y-0.5 border-t border-sidebar-border p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setWizardOpen(true)}>
          <Sparkles />
          Create Workspace
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setRegisterOpen(true)}>
          <FolderPlus />
          Register Existing
        </Button>
      </div>

      <CreateWorkspaceWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={onSelect} />
      <RegisterWorkspaceDialog open={registerOpen} onOpenChange={setRegisterOpen} onRegistered={onSelect} />
    </aside>
  )
}
