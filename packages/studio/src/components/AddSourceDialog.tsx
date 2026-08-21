import { localize } from '@braidhq/schema'
import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { humaniseApiError } from '@/lib/errors'
import { useLocale } from '@/lib/i18n'
import { useOntology, useSourceLoaders } from '@/lib/queries'
import { loaderKindLabel, nameToId, type SourceDraft, STUDIO_KNOWN_LOADER_KINDS, toSourceDescriptor } from '@/lib/sourceDraft'
import { useGoogleOAuth } from '@/lib/useGoogleOAuth'
import { MarkdownDescriptionField } from './MarkdownDescriptionField'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { UnknownLoaderWarning } from './UnknownLoaderWarning'

interface AddSourceDialogProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded?: () => void
}

export function AddSourceDialog({ workspaceId, open, onOpenChange, onAdded }: AddSourceDialogProps) {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const sourceLoaders = useSourceLoaders()
  const ontology = useOntology(workspaceId)
  const roles = ontology.data?.sourceRoles ?? []
  const [role, setRole] = useState<string>('')
  // Default to the ontology's first declared role once it loads.
  useEffect(() => {
    if (!role && roles.length > 0)
      setRole(roles[0]!.id)
  }, [role, roles])
  const selectedRole = roles.find(r => r.id === role)
  const pathSegment = selectedRole?.pathSegment ?? role
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loaderKind, setLoaderKind] = useState<SourceDraft['loaderKind']>('')
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
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpAuthorization, setMcpAuthorization] = useState('')
  const [mcpTool, setMcpTool] = useState('')
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
        pathSegment,
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
        mcpUrl,
        mcpAuthorization,
        mcpTool,
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
    setLoaderKind('')
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
    setMcpUrl('')
    setMcpAuthorization('')
    setMcpTool('')
    setOauthConnectedFor(null)
    add.reset()
    startOauth.reset()
  }

  function close() {
    onOpenChange(false)
    setTimeout(reset, 200)
  }

  const valid = name.trim().length > 0
    && role.length > 0
    && loaderKnown
    && (loaderKind !== 'git' || gitUrl.trim().length > 0)
    && (loaderKind !== 'gdrive' || (gdriveFolderId.trim().length > 0 && gdriveFolderId.trim() !== 'root' && oauthConnected))
    && (loaderKind !== 'github' || (githubOwner.trim().length > 0 && githubRepo.trim().length > 0))
    && (loaderKind !== 'mcp' || mcpUrl.trim().length > 0)

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
          <DialogTitle>{t('sources.addDialog.title')}</DialogTitle>
          <DialogDescription>{t('sources.addDialog.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('common.role')}>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map(r => (
                    <SelectItem key={r.id} value={r.id}>{localize(r.label, locale)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('sources.addDialog.loaderLabel')}>
              {/* Radix reserves the empty value, so a "none" sentinel maps to "". */}
              <Select value={loaderKind || 'none'} onValueChange={v => setLoaderKind(v === 'none' ? '' : v)}>
                <SelectTrigger size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{loaderKindLabel('', t)}</SelectItem>
                  {(sourceLoaders.data?.loaders ?? []).map(loader => (
                    <SelectItem key={loader.kind} value={loader.kind}>{loaderKindLabel(loader.kind, t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t('common.name')}>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('sources.addDialog.namePlaceholder', { role: role || 'source' })} autoFocus />
            <p className="font-mono text-2xs text-muted-foreground">
              ./
              {pathSegment}
              /
              {nameToId(name) || '<name>'}
            </p>
          </Field>
          <MarkdownDescriptionField
            id="add-source-desc"
            value={description}
            onChange={setDescription}
            label={t('sources.addDialog.descriptionFieldLabel')}
            placeholder={t('sources.addDialog.descriptionPlaceholder')}
            helperText={t('sources.addDialog.descriptionHint')}
            rows={2}
          />
          {loaderKind === 'git' && (
            <div className="flex items-end gap-2">
              <Field label={t('sources.addDialog.gitUrlLabel')} className="flex-1">
                <Input value={gitUrl} onChange={e => setGitUrl(e.target.value)} placeholder="https://github.com/org/repo.git" />
              </Field>
              <Field label={t('sources.addDialog.branchLabel')} className="w-28 shrink-0">
                <Input value={gitBranch} onChange={e => setGitBranch(e.target.value)} placeholder="master" />
              </Field>
            </div>
          )}
          {loaderKind === 'gdrive' && (
            <>
              <Field label={t('sources.addDialog.googleDriveFolderLabel')}>
                <Input value={gdriveFolderId} onChange={e => setGdriveFolderId(e.target.value)} placeholder="1abc…" />
                {gdriveFolderId.trim() === 'root' && (
                  <p className="text-2xs text-destructive">
                    {t('sources.addDialog.googleDriveRootWarning')}
                  </p>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('sources.addDialog.includeRegexLabel')}>
                  <Input value={gdriveInclude} onChange={e => setGdriveInclude(e.target.value)} placeholder="^docs/" />
                </Field>
                <Field label={t('sources.addDialog.excludeRegexLabel')}>
                  <Input value={gdriveExclude} onChange={e => setGdriveExclude(e.target.value)} placeholder="\\.tmp$" />
                </Field>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium">{t('sources.addDialog.googleAccountTitle')}</p>
                    <p className="text-2xs text-muted-foreground">
                      {oauthConnected
                        ? t('sources.addDialog.googleDriveConnected', { sourceId })
                        : t('sources.addDialog.googleDriveConnectHint')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={oauthConnected ? 'ghost' : 'default'}
                    disabled={!name.trim() || startOauth.isPending}
                    onClick={() => startOauth.mutate()}
                  >
                    {startOauth.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
                    {startOauth.isPending ? t('sources.addDialog.opening') : oauthConnected ? t('sources.addDialog.reconnect') : t('sources.addDialog.connectGoogle')}
                  </Button>
                </div>
                {startOauth.error && (
                  <p className="mt-2 text-2xs text-destructive">{humaniseApiError(startOauth.error)}</p>
                )}
              </div>
            </>
          )}
          {loaderKind === 'mcp' && (
            <>
              <Field label={t('sources.addDialog.mcpUrlLabel')}>
                <Input value={mcpUrl} onChange={e => setMcpUrl(e.target.value)} placeholder="https://gateway.internal/redmine/mcp" />
                <p className="text-2xs text-muted-foreground">{t('sources.addDialog.mcpUrlHint')}</p>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('sources.addDialog.mcpAuthorizationLabel')}>
                  {/* eslint-disable-next-line no-template-curly-in-string -- intentional: shows the literal ${VAR} form */}
                  <Input value={mcpAuthorization} onChange={e => setMcpAuthorization(e.target.value)} placeholder="Bearer ${REDMINE_TOKEN}" />
                </Field>
                <Field label={t('sources.addDialog.mcpToolLabel')}>
                  <Input value={mcpTool} onChange={e => setMcpTool(e.target.value)} placeholder="list_items" />
                </Field>
              </div>
              <p className="text-2xs text-muted-foreground">
                {t('sources.addDialog.mcpShapeHint')}
              </p>
            </>
          )}
          {loaderKind === 'github' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('sources.addDialog.ownerLabel')}>
                  <Input value={githubOwner} onChange={e => setGithubOwner(e.target.value)} placeholder="anthropics" />
                </Field>
                <Field label={t('sources.addDialog.repositoryLabel')}>
                  <Input value={githubRepo} onChange={e => setGithubRepo(e.target.value)} placeholder="claude-code" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('sources.addDialog.stateLabel')}>
                  <Select value={githubState} onValueChange={v => setGithubState(v as typeof githubState)}>
                    <SelectTrigger size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">all</SelectItem>
                      <SelectItem value="open">open</SelectItem>
                      <SelectItem value="closed">closed</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t('sources.addDialog.labelsLabel')}>
                  <Input value={githubLabels} onChange={e => setGithubLabels(e.target.value)} placeholder="bug, p1" />
                </Field>
              </div>
              <div className="flex flex-col gap-1 rounded-md border border-border p-2">
                <label className="flex items-center gap-2 text-2xs">
                  <input type="checkbox" checked={githubIncludeComments} onChange={e => setGithubIncludeComments(e.target.checked)} />
                  {t('sources.addDialog.includeComments')}
                </label>
              </div>
              <p className="text-2xs text-muted-foreground">
                {t('sources.addDialog.githubAuthPrefix')}
                {' '}
                <code className="font-mono">$GH_TOKEN</code>
                {' '}
                {t('sources.addDialog.githubAuthSuffix')}
              </p>
            </>
          )}
          {!loaderKnown && (
            <UnknownLoaderWarning
              kind={loaderKind}
              hint={(
                <>
                  {t('sources.addDialog.unknownLoaderHintPrefix')}
                  {' '}
                  <code className="rounded bg-muted px-1 font-mono">PRODUCT.md</code>
                  {' '}
                  {t('sources.addDialog.unknownLoaderHintMiddle')}
                  {' '}
                  <code className="rounded bg-muted px-1 font-mono">{loaderKind}</code>
                  {' '}
                  {t('sources.addDialog.unknownLoaderHintSuffix')}
                </>
              )}
            />
          )}
          {add.error && <p className="text-xs text-destructive">{humaniseApiError(add.error)}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close}>{t('common.cancel')}</Button>
          <Button size="sm" disabled={!valid || add.isPending} onClick={() => add.mutate()}>
            {add.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
            {add.isPending ? t('common.adding') : t('common.add')}
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
