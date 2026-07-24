import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { humaniseApiError } from '@/lib/errors'
import { useSourceLoaders } from '@/lib/queries'
import { loaderKindLabel, nameToId, rolePathSegment, type SourceDraft, STUDIO_KNOWN_LOADER_KINDS, toSourceDescriptor } from '@/lib/sourceDraft'
import { useGoogleOAuth } from '@/lib/useGoogleOAuth'
import { MarkdownDescriptionField } from './MarkdownDescriptionField'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { UnknownLoaderWarning } from './UnknownLoaderWarning'

interface AddSourceDialogProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded?: () => void
}

export function AddSourceDialog({ workspaceId, open, onOpenChange, onAdded }: AddSourceDialogProps) {
  const sourceLoaders = useSourceLoaders()
  const [role, setRole] = useState<'intent' | 'code'>('intent')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loaderKind, setLoaderKind] = useState<SourceDraft['loaderKind']>(role === 'intent' ? 'gdrive' : 'git')
  const loaderKnown = loaderKind === '' || STUDIO_KNOWN_LOADER_KINDS.has(loaderKind)
  const [gitUrl, setGitUrl] = useState('')
  const [gitBranch, setGitBranch] = useState('master')
  const [gdriveFolderId, setGdriveFolderId] = useState('')
  const [gdriveInclude, setGdriveInclude] = useState('')
  const [gdriveExclude, setGdriveExclude] = useState('')
  const [githubOwner, setGithubOwner] = useState('')
  const [githubRepo, setGithubRepo] = useState('')
  const [githubState, setGithubState] = useState<'open' | 'closed' | 'all'>('all')
  const [githubLabels, setGithubLabels] = useState('')
  const [githubIncludeComments, setGithubIncludeComments] = useState(true)
  /**
   * Set once the user successfully completes the Google OAuth popup.
   * Keyed to the sourceId derived from `name` at the time of consent.
   * If the user changes the name after connecting we invalidate and re-prompt,
   * because tokens are stored under `${workspaceId}--${sourceId}`.
   */
  const [oauthConnectedFor, setOauthConnectedFor] = useState<string | null>(null)

  const sourceId = nameToId(name)
  const oauthConnected = !!oauthConnectedFor && oauthConnectedFor === sourceId

  // Invalidate the OAuth flag if the user edits name after connecting,
  // since tokens were stored under the previous sourceId.
  useEffect(() => {
    if (oauthConnectedFor && oauthConnectedFor !== sourceId)
      setOauthConnectedFor(null)
  }, [sourceId, oauthConnectedFor])

  const startOauth = useGoogleOAuth(workspaceId, sourceId, {
    onConnected: id => setOauthConnectedFor(id),
  })

  const add = useMutation({
    mutationFn: () => {
      const source = toSourceDescriptor({
        role,
        name,
        description,
        loaderKind,
        gitUrl,
        gitBranch,
        gdriveFolderId,
        gdriveInclude,
        gdriveExclude,
        githubOwner,
        githubRepo,
        githubState,
        githubLabels,
        githubIncludeComments,
      })
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
    setDescription('')
    setLoaderKind(role === 'intent' ? 'gdrive' : 'git')
    setGitUrl('')
    setGitBranch('master')
    setGdriveFolderId('')
    setGdriveInclude('')
    setGdriveExclude('')
    setGithubOwner('')
    setGithubRepo('')
    setGithubState('all')
    setGithubLabels('')
    setGithubIncludeComments(true)
    setOauthConnectedFor(null)
    add.reset()
    startOauth.reset()
  }

  function close() {
    onOpenChange(false)
    setTimeout(reset, 200)
  }

  const valid = name.trim().length > 0
    && loaderKnown
    && (loaderKind !== 'git' || gitUrl.trim().length > 0)
    && (loaderKind !== 'gdrive' || (gdriveFolderId.trim().length > 0 && gdriveFolderId.trim() !== 'root' && oauthConnected))
    && (loaderKind !== 'github' || (githubOwner.trim().length > 0 && githubRepo.trim().length > 0))

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
          <DialogDescription>Source rows are appended to PRODUCT.md and provisioned if a loader is set.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Role">
              <select value={role} onChange={e => setRole(e.target.value as typeof role)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                <option value="intent">intent</option>
                <option value="code">code</option>
              </select>
            </Field>
            <Field label="Loader">
              <select value={loaderKind} onChange={e => setLoaderKind(e.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                <option value="">{loaderKindLabel('')}</option>
                {(sourceLoaders.data?.loaders ?? []).map(loader => (
                  <option key={loader.kind} value={loader.kind}>{loaderKindLabel(loader.kind)}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Name">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={role === 'intent' ? 'intent-name' : 'repo-name'} autoFocus />
            <p className="font-mono text-2xs text-muted-foreground">
              ./
              {rolePathSegment(role)}
              /
              {nameToId(name) || '<name>'}
            </p>
          </Field>
          <MarkdownDescriptionField
            id="add-source-desc"
            value={description}
            onChange={setDescription}
            label="What is this source?"
            placeholder={role === 'intent'
              ? 'e.g. Authoritative billing RFC; updated weekly by design team.'
              : 'e.g. Legacy Java monolith; read-only reference.'}
            helperText="Visible to skills via PRODUCT.md."
            rows={2}
          />
          {loaderKind === 'git' && (
            <div className="flex items-end gap-2">
              <Field label="Git URL" className="flex-1">
                <Input value={gitUrl} onChange={e => setGitUrl(e.target.value)} placeholder="https://github.com/org/repo.git" />
              </Field>
              <Field label="Branch" className="w-28 shrink-0">
                <Input value={gitBranch} onChange={e => setGitBranch(e.target.value)} placeholder="master" />
              </Field>
            </div>
          )}
          {loaderKind === 'gdrive' && (
            <>
              <Field label="Google Drive folder ID">
                <Input value={gdriveFolderId} onChange={e => setGdriveFolderId(e.target.value)} placeholder="1abc…" />
                {gdriveFolderId.trim() === 'root' && (
                  <p className="text-2xs text-destructive">
                    "root" mirrors your entire My Drive (rejected by the loader). Create a dedicated subfolder and paste its ID.
                  </p>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Include regex (optional)">
                  <Input value={gdriveInclude} onChange={e => setGdriveInclude(e.target.value)} placeholder="^docs/" />
                </Field>
                <Field label="Exclude regex (optional)">
                  <Input value={gdriveExclude} onChange={e => setGdriveExclude(e.target.value)} placeholder="\\.tmp$" />
                </Field>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium">Google Account</p>
                    <p className="text-2xs text-muted-foreground">
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
                    {startOauth.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
                    {startOauth.isPending ? 'Opening…' : oauthConnected ? 'Reconnect' : 'Connect Google'}
                  </Button>
                </div>
                {startOauth.error && (
                  <p className="mt-2 text-2xs text-destructive">{humaniseApiError(startOauth.error)}</p>
                )}
              </div>
            </>
          )}
          {loaderKind === 'github' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Owner">
                  <Input value={githubOwner} onChange={e => setGithubOwner(e.target.value)} placeholder="anthropics" />
                </Field>
                <Field label="Repo">
                  <Input value={githubRepo} onChange={e => setGithubRepo(e.target.value)} placeholder="claude-code" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="State">
                  <select
                    value={githubState}
                    onChange={e => setGithubState(e.target.value as typeof githubState)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="all">all</option>
                    <option value="open">open</option>
                    <option value="closed">closed</option>
                  </select>
                </Field>
                <Field label="Labels (csv, optional)">
                  <Input value={githubLabels} onChange={e => setGithubLabels(e.target.value)} placeholder="bug, p1" />
                </Field>
              </div>
              <div className="flex flex-col gap-1 rounded-md border border-border p-2">
                <label className="flex items-center gap-2 text-2xs">
                  <input type="checkbox" checked={githubIncludeComments} onChange={e => setGithubIncludeComments(e.target.checked)} />
                  Include comments
                </label>
              </div>
              <p className="text-2xs text-muted-foreground">
                Auth: server reads
                {' '}
                <code className="font-mono">$GH_TOKEN</code>
                {' '}
                at sync time. Without one you get GitHub's 60 req/h anonymous rate limit.
              </p>
            </>
          )}
          {!loaderKnown && (
            <UnknownLoaderWarning
              kind={loaderKind}
              hint={(
                <>
                  This loader plugin is registered on the server but Studio does not ship a per-field config for it. To use it, edit
                  {' '}
                  <code className="rounded bg-muted px-1 font-mono">PRODUCT.md</code>
                  {' '}
                  directly and add the
                  {' '}
                  <code className="rounded bg-muted px-1 font-mono">{loaderKind}</code>
                  {' '}
                  config under this source.
                </>
              )}
            />
          )}
          {add.error && <p className="text-xs text-destructive">{humaniseApiError(add.error)}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
          <Button size="sm" disabled={!valid || add.isPending} onClick={() => add.mutate()}>
            {add.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
            {add.isPending ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children, className }: { label: string, children: React.ReactNode, className?: string }) {
  return (
    <div className={`space-y-1${className ? ` ${className}` : ''}`}>
      <Label className="text-2xs">{label}</Label>
      {children}
    </div>
  )
}
