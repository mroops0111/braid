import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import { type ErrorCase, humaniseApiError } from '@/lib/errors'
import { queryKeys } from '@/lib/queries'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'

const REGISTER_ERROR_CASES: readonly ErrorCase[] = [
  {
    match: e => e.status === 404 && e.message.includes('PRODUCT.md'),
    message: 'No PRODUCT.md found in that folder. Did you mean to create a new workspace? Cancel and pick "Create workspace" instead.',
  },
]

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
          <p className="text-xs text-destructive">{humaniseApiError(register.error, REGISTER_ERROR_CASES)}</p>
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
