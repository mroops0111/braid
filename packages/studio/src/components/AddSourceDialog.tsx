import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { humaniseApiError } from '@/lib/errors'
import { nameToId, toSourceDescriptor } from '@/lib/sourceDraft'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface AddSourceDialogProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded?: () => void
}

export function AddSourceDialog({ workspaceId, open, onOpenChange, onAdded }: AddSourceDialogProps) {
  const [role, setRole] = useState<'intent' | 'code'>('intent')
  const [kind, setKind] = useState<'filesystem' | 'mcp'>('filesystem')
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [loaderKind, setLoaderKind] = useState<'' | 'git' | 'gdrive'>('')
  const [gitUrl, setGitUrl] = useState('')
  const [gitBranch, setGitBranch] = useState('main')
  const [gdriveFolderId, setGdriveFolderId] = useState('')
  const [mcpServerId, setMcpServerId] = useState('')
  /**
   * Set once the user successfully completes the Google OAuth popup. Keyed to
   * the sourceId derived from `name` at the time of consent — if the user
   * changes the name after connecting we invalidate and re-prompt, because
   * tokens are stored under `${workspaceId}--${sourceId}`.
   */
  const [oauthConnectedFor, setOauthConnectedFor] = useState<string | null>(null)

  const sourceId = nameToId(name)
  const oauthConnected = !!oauthConnectedFor && oauthConnectedFor === sourceId

  // Invalidate the OAuth flag if the user edits name after connecting, since
  // tokens were stored under the previous sourceId.
  useEffect(() => {
    if (oauthConnectedFor && oauthConnectedFor !== sourceId)
      setOauthConnectedFor(null)
  }, [sourceId, oauthConnectedFor])

  const startOauth = useMutation({
    mutationFn: () => api.startGoogleOAuth(workspaceId, sourceId),
    onSuccess: (result) => {
      const popup = window.open(result.authorizationUrl, 'telos-oauth-google', 'width=520,height=720')
      if (!popup)
        return
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { source?: string, provider?: string, status?: string } | null
        if (!data || data.source !== 'telos-oauth' || data.provider !== 'google')
          return
        window.removeEventListener('message', onMessage)
        if (data.status === 'success')
          setOauthConnectedFor(sourceId)
      }
      window.addEventListener('message', onMessage)
    },
  })

  const add = useMutation({
    mutationFn: () => {
      const source = toSourceDescriptor({ role, kind, name, path, loaderKind, gitUrl, gitBranch, gdriveFolderId, mcpServerId })
      return api.addSource(workspaceId, source)
    },
    onSuccess: () => {
      onAdded?.()
      onOpenChange(false)
      reset()
    },
  })

  function reset() {
    setName('')
    setPath('')
    setLoaderKind('')
    setGitUrl('')
    setGitBranch('main')
    setGdriveFolderId('')
    setMcpServerId('')
    setOauthConnectedFor(null)
    add.reset()
    startOauth.reset()
  }

  function close() {
    onOpenChange(false)
    setTimeout(reset, 200)
  }

  const valid = name.trim().length > 0
    && (kind === 'mcp' ? mcpServerId.trim().length > 0 : path.trim().length > 0)
    && (loaderKind !== 'git' || gitUrl.trim().length > 0)
    && (loaderKind !== 'gdrive' || (gdriveFolderId.trim().length > 0 && gdriveFolderId.trim() !== 'root' && oauthConnected))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o)
          close()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Source</DialogTitle>
          <DialogDescription>Source rows are appended to PRODUCT.md and ingested if a loader is set.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Role">
              <select value={role} onChange={e => setRole(e.target.value as typeof role)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                <option value="intent">intent</option>
                <option value="code">code</option>
              </select>
            </Field>
            <Field label="Kind">
              <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                <option value="filesystem">filesystem</option>
                <option value="mcp">mcp</option>
              </select>
            </Field>
          </div>
          <Field label="Name">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. intent, src" autoFocus />
          </Field>
          {kind === 'filesystem'
            ? (
                <>
                  <Field label="Path">
                    <Input value={path} onChange={e => setPath(e.target.value)} placeholder="./intent or /abs/path" />
                  </Field>
                  <Field label="Loader">
                    <select value={loaderKind} onChange={e => setLoaderKind(e.target.value as typeof loaderKind)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                      <option value="">manual (no auto-sync)</option>
                      <option value="git">git</option>
                      <option value="gdrive">gdrive</option>
                    </select>
                  </Field>
                  {loaderKind === 'git' && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Git URL">
                        <Input value={gitUrl} onChange={e => setGitUrl(e.target.value)} placeholder="https://… or local path" />
                      </Field>
                      <Field label="Branch">
                        <Input value={gitBranch} onChange={e => setGitBranch(e.target.value)} placeholder="main" />
                      </Field>
                    </div>
                  )}
                  {loaderKind === 'gdrive' && (
                    <>
                      <Field label="Google Drive folder ID">
                        <Input value={gdriveFolderId} onChange={e => setGdriveFolderId(e.target.value)} placeholder="1abc…" />
                        {gdriveFolderId.trim() === 'root' && (
                          <p className="text-[11px] text-destructive">
                            "root" mirrors your entire My Drive (rejected by the loader). Create a dedicated subfolder and paste its ID.
                          </p>
                        )}
                      </Field>
                      <div className="rounded-md border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium">Google Account</p>
                            <p className="text-[11px] text-muted-foreground">
                              {oauthConnected
                                ? `Connected for source "${sourceId}". Re-renaming will require re-connecting.`
                                : 'Connect a Google account that has read access to the folder above.'}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant={oauthConnected ? 'ghost' : 'default'}
                            disabled={!name.trim() || startOauth.isPending}
                            onClick={() => startOauth.mutate()}
                          >
                            {startOauth.isPending ? 'Opening…' : oauthConnected ? 'Reconnect' : 'Connect Google'}
                          </Button>
                        </div>
                        {startOauth.error && (
                          <p className="mt-2 text-[11px] text-destructive">{humaniseApiError(startOauth.error)}</p>
                        )}
                      </div>
                    </>
                  )}
                </>
              )
            : (
                <Field label="MCP server ID">
                  <Input value={mcpServerId} onChange={e => setMcpServerId(e.target.value)} placeholder="must match an MCP server declared in this workspace" />
                </Field>
              )}
          {add.error && <p className="text-xs text-destructive">{humaniseApiError(add.error)}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
          <Button size="sm" disabled={!valid || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      {children}
    </div>
  )
}
