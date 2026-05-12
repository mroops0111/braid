import type { Workspace } from '@telos/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderGit2, Plus } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Input } from './ui/input'

interface SidebarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (id: string) => void
}

export function Sidebar({ workspaces, activeWorkspaceId, onSelect }: SidebarProps) {
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
            <li key={ws.id} className="relative">
              {ws.id === activeWorkspaceId && (
                <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
              )}
              <button
                type="button"
                onClick={() => onSelect(ws.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150',
                  'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  ws.id === activeWorkspaceId && 'bg-sidebar-accent text-sidebar-foreground',
                )}
              >
                <FolderGit2 className="size-3.5 shrink-0 text-sidebar-foreground/50" />
                <span className="truncate font-medium">{ws.id}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-sidebar-border p-2">
        <RegisterWorkspaceDialog />
      </div>
    </aside>
  )
}

function RegisterWorkspaceDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [rootPath, setRootPath] = useState('')

  const register = useMutation({
    mutationFn: (path: string) => api.registerWorkspace(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() })
      setOpen(false)
      setRootPath('')
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Plus />
          Register Workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register Workspace</DialogTitle>
          <DialogDescription>
            Provide the absolute path to a directory containing PRODUCT.md.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="/abs/path/to/workspace"
          value={rootPath}
          onChange={e => setRootPath(e.target.value)}
        />
        {register.error && (
          <p className="text-xs text-destructive">{(register.error as Error).message}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            size="sm"
            disabled={!rootPath || register.isPending}
            onClick={() => register.mutate(rootPath)}
          >
            {register.isPending ? 'Registering…' : 'Register'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
