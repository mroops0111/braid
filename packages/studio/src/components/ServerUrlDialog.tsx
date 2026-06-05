import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { DEFAULT_SERVER_URL, getServerUrl, setServerUrl } from '@/lib/serverUrl'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface ServerUrlDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ServerUrlDialog({ open, onOpenChange }: ServerUrlDialogProps) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')

  useEffect(() => {
    if (open)
      setValue(getServerUrl())
  }, [open])

  function handleSave() {
    setServerUrl(value)
    queryClient.invalidateQueries()
    onOpenChange(false)
  }

  function handleReset() {
    setValue(DEFAULT_SERVER_URL)
  }

  const trimmed = value.trim().replace(/\/$/, '')
  const disabled = trimmed === '' || trimmed === getServerUrl()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Server URL</DialogTitle>
          <DialogDescription>
            Point Braid at a local or remote server. The change applies
            immediately; all queries refetch against the new host.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="server-url">URL</Label>
          <Input
            id="server-url"
            type="url"
            placeholder={DEFAULT_SERVER_URL}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !disabled)
                handleSave()
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            Default:
            {' '}
            <code className="font-mono">{DEFAULT_SERVER_URL}</code>
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={handleReset}>Reset to Default</Button>
          <Button size="sm" onClick={handleSave} disabled={disabled}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
