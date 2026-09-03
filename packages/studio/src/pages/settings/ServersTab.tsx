import { Check, Globe, Laptop, Loader2, LogIn, LogOut, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { startSignIn } from '@/lib/signIn'

export function ServersTab() {
  const { t } = useTranslation()
  const remotes = useRemotes()
  const activeId = useActiveRemoteId()
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.servers.connections')}</h2>
        <ul className="space-y-2">
          <ServerRow
            id={LOCAL_REMOTE_ID}
            name={t('admin.servers.localName')}
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
  const { t } = useTranslation()
  const token = isLocal ? null : getTokenFor(id)
  const connected = isLocal || !!token
  const [armedForRemove, setArmedForRemove] = useState(false)

  function beginSignIn() {
    void startSignIn(url, id)
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
              <Badge variant="outline" className="bg-primary/15 text-2xs uppercase tracking-wider text-primary">
                {t('admin.servers.active')}
              </Badge>
            )}
            {!isActive && connected && (
              <Badge variant="outline" className="bg-emerald-500/15 text-2xs uppercase tracking-wider text-emerald-400">
                {t('admin.servers.connected')}
              </Badge>
            )}
            {!connected && (
              <Badge variant="outline" className="text-2xs uppercase tracking-wider text-muted-foreground">
                {t('admin.servers.notSignedIn')}
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
                {t('admin.servers.useThisButton')}
              </Button>
            )}
            {!isLocal && !connected && (
              <Button variant="default" size="sm" className="h-7 text-2xs" onClick={beginSignIn}>
                <LogIn className="mr-1 size-3" />
                {t('common.signIn')}
              </Button>
            )}
            {!isLocal && connected && (
              <Button variant="ghost" size="sm" className="h-7 text-2xs" onClick={disconnect}>
                <LogOut className="mr-1 size-3" />
                {t('common.signOut')}
              </Button>
            )}
            {!isLocal && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setArmedForRemove(true)}
                title={t('admin.servers.removeServerButton')}
                aria-label={t('admin.servers.removeServerButton')}
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
            {t('admin.servers.removeConfirm', { name })}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => setArmedForRemove(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmRemove}
            >
              {t('admin.servers.removePermanentlyButton')}
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
  const { t } = useTranslation()
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
      setError(t('admin.servers.urlRequired'))
      return
    }
    try {
      const parsed = new URL(trimmedUrl)
      if (!parsed.protocol.startsWith('http')) {
        setError(t('admin.servers.urlMustBeHttp'))
        return
      }
    }
    catch {
      setError(t('admin.servers.invalidUrl'))
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
        <Plus className="mr-1 size-3" />
        {t('admin.servers.addRemoteButton')}
      </Button>
    )
  }
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.servers.newServer')}</h3>
      <div className="space-y-2">
        <Label htmlFor="add-remote-url" className="text-xs">{t('admin.servers.url')}</Label>
        <Input
          id="add-remote-url"
          autoFocus
          placeholder={DEFAULT_SERVER_URL}
          value={url}
          onChange={e => setUrl(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="add-remote-name" className="text-xs">{t('admin.servers.optionalLabel')}</Label>
        <Input
          id="add-remote-name"
          placeholder={t('admin.servers.namePlaceholder')}
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>
      {error && <p className="text-2xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={reset} className="flex-1" disabled={validating}>{t('common.cancel')}</Button>
        <Button size="sm" onClick={save} className="flex-1" disabled={validating}>
          {validating && <Loader2 className="mr-1 size-3 animate-spin" />}
          {validating ? t('admin.servers.verifying') : t('common.save')}
        </Button>
      </div>
    </section>
  )
}
