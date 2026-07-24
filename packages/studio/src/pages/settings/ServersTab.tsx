import { Check, CircleDashed, Globe, Laptop, LogIn, LogOut, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { clearAuthToken } from '@/lib/authToken'
import {
  addRemote,
  getTokenFor,
  LOCAL_REMOTE_ID,
  removeRemote,
  setActiveRemoteId,
  useActiveRemoteId,
  useRemotes,
} from '@/lib/remotes'
import { DEFAULT_SERVER_URL, getServerUrlFor } from '@/lib/serverUrl'
import { cn } from '@/lib/utils'

export function ServersTab() {
  const remotes = useRemotes()
  const activeId = useActiveRemoteId()
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Connections</h2>
        <ul className="space-y-2">
          <ServerRow
            id={LOCAL_REMOTE_ID}
            name="Local"
            url={getServerUrlFor(LOCAL_REMOTE_ID)}
            isLocal
            isActive={activeId === LOCAL_REMOTE_ID}
          />
          {remotes.map(remote => (
            <ServerRow
              key={remote.id}
              id={remote.id}
              name={remote.name}
              url={remote.url}
              isActive={activeId === remote.id}
            />
          ))}
        </ul>
      </section>
      <AddRemoteForm />
    </div>
  )
}

interface ServerRowProps {
  id: string
  name: string
  url: string
  isLocal?: boolean
  isActive: boolean
}

function ServerRow({ id, name, url, isLocal, isActive }: ServerRowProps) {
  const token = isLocal ? null : getTokenFor(id)
  const connected = isLocal || !!token
  const [armedForRemove, setArmedForRemove] = useState(false)

  function startSignIn() {
    const returnTo = `${window.location.origin}${window.location.pathname}#auth-remote=${encodeURIComponent(id)}`
    window.location.href = `${url}/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`
  }

  function disconnect() {
    clearAuthToken(id)
    if (isActive)
      setActiveRemoteId(LOCAL_REMOTE_ID)
  }

  function activate() {
    setActiveRemoteId(id)
  }

  function confirmRemove() {
    removeRemote(id)
    setArmedForRemove(false)
  }

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          {isLocal
            ? <Laptop className="size-4 text-muted-foreground" />
            : <Globe className="size-4 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm">{name}</span>
            {isActive && (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-2xs uppercase tracking-wider text-primary">
                Active
              </span>
            )}
            {!isActive && connected && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-2xs uppercase tracking-wider text-emerald-400">
                Connected
              </span>
            )}
            {!connected && (
              <Badge variant="outline" className="text-2xs uppercase tracking-wider text-muted-foreground">
                Not signed in
              </Badge>
            )}
          </div>
          <p className="truncate font-mono text-2xs text-muted-foreground">{url}</p>
        </div>
        {!armedForRemove && (
          <div className="flex shrink-0 items-center gap-1">
            {!isActive && connected && (
              <Button variant="ghost" size="sm" className="h-7 text-2xs" onClick={activate}>
                <Check className="mr-1 size-3" />
                Use This
              </Button>
            )}
            {!isLocal && !connected && (
              <Button variant="default" size="sm" className="h-7 text-2xs" onClick={startSignIn}>
                <LogIn className="mr-1 size-3" />
                Sign In
              </Button>
            )}
            {!isLocal && connected && (
              <Button variant="ghost" size="sm" className="h-7 text-2xs" onClick={disconnect}>
                <LogOut className="mr-1 size-3" />
                Sign Out
              </Button>
            )}
            {!isLocal && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setArmedForRemove(true)}
                title="Remove server"
                aria-label="Remove server"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </div>
      {armedForRemove && (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          <p className="text-2xs text-muted-foreground">
            Remove
            {' '}
            <span className="font-medium">{name}</span>
            ? Stored token is cleared. Workspaces on the remote stay
            untouched; you can add this server back later.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => setArmedForRemove(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmRemove}
            >
              Remove Permanently
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

async function probeBraidServer(url: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${url}/auth/config`, { method: 'GET' })
  }
  catch (err) {
    throw new Error(`Could not reach ${url}: ${err instanceof Error ? err.message : 'network error'}`)
  }
  if (!response.ok)
    throw new Error(`Server replied ${response.status}. Is this a Braid instance?`)
  let body: unknown
  try {
    body = await response.json()
  }
  catch {
    throw new Error('Server replied with non-JSON. Is this a Braid instance?')
  }
  if (typeof body !== 'object' || body === null || !('requiresAuth' in body) || !('googleEnabled' in body))
    throw new Error('Response did not match a Braid `/auth/config` shape')
}

function AddRemoteForm() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)

  function reset() {
    setName('')
    setUrl('')
    setError(null)
    setValidating(false)
    setOpen(false)
  }

  async function save() {
    setError(null)
    const trimmedUrl = url.trim().replace(/\/$/, '')
    if (!trimmedUrl) {
      setError('URL is required')
      return
    }
    try {
      const parsed = new URL(trimmedUrl)
      if (!parsed.protocol.startsWith('http')) {
        setError('URL must be http or https')
        return
      }
    }
    catch {
      setError('Invalid URL')
      return
    }
    setValidating(true)
    try {
      await probeBraidServer(trimmedUrl)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setValidating(false)
      return
    }
    const finalName = name.trim() || new URL(trimmedUrl).host
    addRemote({ name: finalName, url: trimmedUrl })
    reset()
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="h-7 text-2xs">
        + Add Remote
      </Button>
    )
  }
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">New Server</h3>
      <div className="space-y-2">
        <Label htmlFor="add-remote-url" className="text-xs">URL</Label>
        <Input
          id="add-remote-url"
          autoFocus
          placeholder={DEFAULT_SERVER_URL}
          value={url}
          onChange={e => setUrl(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="add-remote-name" className="text-xs">Name (optional)</Label>
        <Input
          id="add-remote-name"
          placeholder="Defaults to the host"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>
      {error && <p className="text-2xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={reset} className="flex-1" disabled={validating}>Cancel</Button>
        <Button size="sm" onClick={save} className="flex-1" disabled={validating}>
          <CircleDashed className={cn('mr-1 size-3', validating && 'animate-spin')} />
          {validating ? 'Verifying…' : 'Save'}
        </Button>
      </div>
    </section>
  )
}
