import type { Workspace } from '@telos/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Plus } from 'lucide-react'
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
    <aside className="flex w-60 flex-col border-r border-zinc-800 bg-zinc-925" style={{ backgroundColor: 'oklch(0.16 0 0)' }}>
      <div className="flex h-11 items-center border-b border-zinc-800 px-4">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full border border-zinc-600" />
          <span className="text-sm font-semibold tracking-tight">Telos</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
        <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Workspaces
        </div>
        <ul className="space-y-px">
          {workspaces.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-zinc-600">No workspace yet.</li>
          )}
          {workspaces.map(ws => (
            <li key={ws.id}>
              <button
                type="button"
                onClick={() => onSelect(ws.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800',
                  ws.id === activeWorkspaceId && 'bg-zinc-800 text-zinc-100',
                )}
              >
                <Check
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    ws.id === activeWorkspaceId ? 'text-blue-400' : 'text-transparent',
                  )}
                />
                <span className="truncate font-medium">{ws.id}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-zinc-800 p-2">
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
          <Plus className="h-3.5 w-3.5" />
          Register workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register workspace</DialogTitle>
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
          <p className="text-xs text-red-400">{(register.error as Error).message}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
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
