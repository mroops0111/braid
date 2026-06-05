import { useQueryClient } from '@tanstack/react-query'
import { LogOut, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { clearAuthToken } from '@/lib/authToken'
import { queryKeys, useMe } from '@/lib/queries'
import { useAuthToken } from '@/lib/useAuthToken'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

/**
 * Title-bar identity readout. Local mode has exactly one account
 * (`local-user`); this picker shows its current displayName and lets
 * the user rename it. Phase B (Google OAuth) will replace the picker
 * with a "Sign in" / "Sign out" surface for remote servers.
 */
export function UserPicker() {
  const [open, setOpen] = useState(false)
  const { data: me, isLoading } = useMe()
  const displayName = isLoading ? '…' : me?.displayName ?? 'unknown'

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
        title="Rename account"
      >
        <UserRound className="size-3.5" />
        <span className="max-w-[10rem] truncate">{displayName}</span>
      </Button>
      <RenameDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function RenameDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const token = useAuthToken()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open)
      setValue(me?.displayName ?? '')
  }, [open, me?.displayName])

  async function save() {
    if (!me)
      return
    const next = value.trim()
    if (!next || next === me.displayName) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.updateUser(me.id, { displayName: next })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.me() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.users() }),
      ])
      onOpenChange(false)
    }
    catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err))
    }
    finally {
      setSaving(false)
    }
  }

  async function signOut() {
    try {
      await api.logout()
    }
    catch {
      // Logout is best-effort: a network error shouldn't trap a user
      // in a session they want to leave. We still clear locally.
    }
    clearAuthToken()
    queryClient.clear()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Account name</DialogTitle>
          <DialogDescription>
            Display name shown in audit trails and HITL decisions. Local
            install: this is the single account on this machine; defaults
            to your OS username.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="user-display-name" className="text-xs">Display name</Label>
          <Input
            id="user-display-name"
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !saving)
                save()
            }}
            placeholder={me?.displayName ?? ''}
          />
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
        <DialogFooter className="sm:justify-between">
          {token
            ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={signOut}
                  className="gap-1.5 text-muted-foreground"
                >
                  <LogOut className="size-3.5" />
                  Sign out
                </Button>
              )
            : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || !value.trim() || value.trim() === me?.displayName}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
