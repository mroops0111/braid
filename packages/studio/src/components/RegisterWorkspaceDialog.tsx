import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queries'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'

interface RegisterWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRegistered?: (workspaceId: string) => void
}

export function RegisterWorkspaceDialog({ open, onOpenChange, onRegistered }: RegisterWorkspaceDialogProps) {
  const queryClient = useQueryClient()
  const [rootPath, setRootPath] = useState('')

  const register = useMutation({
    mutationFn: (path: string) => api.registerWorkspace(path),
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() })
      onRegistered?.(workspace.id)
      onOpenChange(false)
      setRootPath('')
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o)
          return
        onOpenChange(false)
        setRootPath('')
        register.reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register Existing Workspace</DialogTitle>
          <DialogDescription>
            Point Telos at a directory that already contains a PRODUCT.md.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="/abs/path/to/workspace"
          value={rootPath}
          onChange={e => setRootPath(e.target.value)}
        />
        {register.error && (
          <p className="text-xs text-destructive">{humanise(register.error)}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
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

function humanise(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404 && error.message.includes('PRODUCT.md'))
      return 'No PRODUCT.md found in that folder. Did you mean to create a new workspace? Cancel and pick "Create workspace" instead.'
    return error.message
  }
  if (error instanceof Error)
    return error.message
  return String(error)
}
