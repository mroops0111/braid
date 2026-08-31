import type { McpServerConfig, ProductManifestCreate, SourceRoleDescriptor } from '@braidhq/schema'
import type { ProvisionSummary } from '@/lib/api'
import type { TranslationKey } from '@/lib/i18n'
import type { SourceDraft as SourceDraftBase } from '@/lib/sourceDraft'
import { localize } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { api, workspaceEventsUrl } from '@/lib/api'
import { asMcpServerId, asOntologyId, asStorageKind } from '@/lib/brands'
import { type ErrorCase, humaniseApiError } from '@/lib/errors'
import { useLocale } from '@/lib/i18n'
import { queryKeys, useOntologies, useSourceLoaders } from '@/lib/queries'
import { draftPathSegment, loaderKindLabel, nameToId, STUDIO_KNOWN_LOADER_KINDS, toSourceDescriptor } from '@/lib/sourceDraft'
import { useGithubOAuth } from '@/lib/useGithubOAuth'
import { useGoogleOAuth } from '@/lib/useGoogleOAuth'
import { MarkdownDescriptionField } from './MarkdownDescriptionField'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { UnknownLoaderWarning } from './UnknownLoaderWarning'

type StepKey = 'basics' | 'sources' | 'mcp' | 'advanced' | 'confirm' | 'progress'

type SourceDraft = SourceDraftBase & { uiId: string }

interface McpDraft {
  uiId: string
  id: string
  url: string
  description: string
  /* headers as raw "Key: Value" lines */
  headersText: string
}

interface CreateWorkspaceWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (workspaceId: string) => void
}

const STEP_ORDER: StepKey[] = ['basics', 'sources', 'mcp', 'advanced', 'confirm', 'progress']
const STEP_LABEL_KEYS: Record<StepKey, TranslationKey> = {
  basics: 'workspace.wizard.stepBasics',
  sources: 'workspace.wizard.stepSources',
  mcp: 'workspace.wizard.stepMcp',
  advanced: 'workspace.wizard.stepAdvanced',
  confirm: 'workspace.wizard.stepConfirm',
  progress: 'workspace.wizard.stepProgress',
}

export function CreateWorkspaceWizard({ open, onOpenChange, onCreated }: CreateWorkspaceWizardProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<StepKey>('basics')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sources, setSources] = useState<SourceDraft[]>([])
  const [mcpServers, setMcpServers] = useState<McpDraft[]>([])
  const [ontologyId, setOntologyId] = useState('ddd')
  const ontologies = useOntologies()
  const sourceRoles = ontologies.data?.ontologies.find(o => o.ontologyId === ontologyId)?.sourceRoles ?? []
  const [storageKind, setStorageKind] = useState('kuzu')
  const [provisionResults, setProvisionResults] = useState<ProvisionSummary[]>([])
  // sourceIds whose Google OAuth flow completed in this wizard session.
  // The server stores tokens keyed by `${workspaceId}--${sourceId}`.
  // Since `workspaceId === name` (PRODUCT.md name == folder name),
  // we can run OAuth before the workspace actually exists.
  const [oauthConnectedFor, setOauthConnectedFor] = useState<Set<string>>(new Set())

  const scaffold = useMutation({
    mutationFn: () => {
      const draft = buildDraft({ name, description, sources, mcpServers, ontologyId, storageKind })
      return api.scaffoldWorkspace(name, draft)
    },
    onSuccess: (result) => {
      setProvisionResults(result.provision)
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() })
      // Sidebar reads per-remote via `['workspaces-at', remoteId]`,
      // a different cache entry from the single-server `['workspaces']` key.
      // Without this the newly-scaffolded workspace doesn't appear until reload.
      queryClient.invalidateQueries({ queryKey: ['workspaces-at'], exact: false })
      onCreated?.(result.workspace.id)
    },
  })

  function reset() {
    setStep('basics')
    setName('')
    setDescription('')
    setSources([])
    setMcpServers([])
    setOntologyId('ddd')
    setStorageKind('kuzu')
    setProvisionResults([])
    setOauthConnectedFor(new Set())
    scaffold.reset()
  }

  function close() {
    onOpenChange(false)
    setTimeout(reset, 200)
  }

  function next() {
    const index = STEP_ORDER.indexOf(step)
    if (index < STEP_ORDER.length - 1)
      setStep(STEP_ORDER[index + 1]!)
  }
  function back() {
    const index = STEP_ORDER.indexOf(step)
    if (index > 0)
      setStep(STEP_ORDER[index - 1]!)
  }

  const canAdvance = canAdvanceFrom(step, { name, sources, mcpServers, oauthConnectedFor })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o)
          return
        // Don't let an outside-click or Escape kill the wizard mid-flight.
        // Scaffold and provision can take minutes for gdrive sources.
        // Closing would orphan the request and lose the progress shown.
        if (scaffold.isPending)
          return
        // A finished run holds nothing worth reopening, so discard it.
        if (step === 'progress') {
          close()
          return
        }
        // Anything else is a draft the user typed,
        // so Escape and outside-click keep it for the next open.
        // Only Cancel discards it.
        onOpenChange(false)
      }}
    >
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{t('workspace.wizard.createTitle')}</DialogTitle>
          <DialogDescription>
            {t('workspace.wizard.createDescription')}
          </DialogDescription>
        </DialogHeader>

        <StepIndicator step={step} />

        <div className="min-h-[280px]">
          {step === 'basics' && (
            <BasicsStep
              name={name}
              description={description}
              onName={setName}
              onDescription={setDescription}
            />
          )}
          {step === 'sources' && (
            <SourcesStep
              workspaceName={name}
              roles={sourceRoles}
              sources={sources}
              oauthConnectedFor={oauthConnectedFor}
              onChange={setSources}
              onOauthConnected={(sourceId) => {
                setOauthConnectedFor((prev) => {
                  const next = new Set(prev)
                  next.add(sourceId)
                  return next
                })
              }}
            />
          )}
          {step === 'mcp' && (
            <McpStep servers={mcpServers} onChange={setMcpServers} />
          )}
          {step === 'advanced' && (
            <AdvancedStep
              ontologyId={ontologyId}
              storageKind={storageKind}
              onOntologyId={setOntologyId}
              onStorageKind={setStorageKind}
            />
          )}
          {step === 'confirm' && (
            <ConfirmStep
              name={name}
              description={description}
              sources={sources}
              mcpServers={mcpServers}
              ontologyId={ontologyId}
              storageKind={storageKind}
            />
          )}
          {step === 'progress' && (
            <ProgressStep
              workspaceName={name}
              status={scaffold.status}
              error={scaffold.error}
              provision={provisionResults}
              expectedSources={sources
                .filter(s => s.loaderKind !== '')
                .map(s => ({ id: nameToId(s.name), name: s.name, loaderKind: s.loaderKind }))}
              onClose={close}
            />
          )}
        </div>

        {step !== 'progress' && (
          <div className="flex items-center justify-between border-t border-border pt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={back}
              disabled={STEP_ORDER.indexOf(step) === 0}
            >
              <ChevronLeft />
              {t('common.back')}
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={close}>{t('common.cancel')}</Button>
              {step === 'confirm'
                ? (
                    <Button
                      size="sm"
                      disabled={!canAdvance || scaffold.isPending}
                      onClick={() => {
                        setStep('progress')
                        scaffold.mutate()
                      }}
                    >
                      {t('common.create')}
                    </Button>
                  )
                : (
                    <Button size="sm" disabled={!canAdvance} onClick={next}>
                      {t('common.next')}
                      <ChevronRight />
                    </Button>
                  )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StepIndicator({ step }: { step: StepKey }) {
  const { t } = useTranslation()
  const current = STEP_ORDER.indexOf(step)
  return (
    <ol className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider">
      {STEP_ORDER.slice(0, -1).map((key, index) => {
        const active = index === current
        const done = index < current
        return (
          <li key={key} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className={`flex size-5 items-center justify-center rounded-full border text-2xs ${
                done ? 'border-primary bg-primary text-primary-foreground' : active ? 'border-primary text-primary' : 'border-border text-muted-foreground'
              }`}
            >
              {index + 1}
            </span>
            <span className={active ? 'text-foreground' : 'text-muted-foreground/70'}>{t(STEP_LABEL_KEYS[key])}</span>
            {index < STEP_ORDER.length - 2 && <span className="text-muted-foreground/30">›</span>}
          </li>
        )
      })}
    </ol>
  )
}

const WORKSPACE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

function BasicsStep({ name, description, onName, onDescription }: {
  name: string
  description: string
  onName: (v: string) => void
  onDescription: (v: string) => void
}) {
  const { t } = useTranslation()
  const invalid = name.length > 0 && !WORKSPACE_NAME_PATTERN.test(name)
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ws-name">{t('workspace.wizard.nameLabel')}</Label>
        <Input
          id="ws-name"
          autoFocus
          placeholder={t('workspace.wizard.namePlaceholder')}
          value={name}
          onChange={e => onName(e.target.value)}
        />
        <p className="text-2xs text-muted-foreground">{t('workspace.wizard.nameHint')}</p>
        <code className="block truncate rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
          {t('workspace.wizard.workspacesRootPlaceholder')}
          /
          {name || '<name>'}
        </code>
        {invalid && (
          <p className="text-2xs text-destructive">{t('workspace.wizard.nameInvalid')}</p>
        )}
      </div>
      <MarkdownDescriptionField
        id="ws-desc"
        value={description}
        onChange={onDescription}
        placeholder={t('workspace.aboutPlaceholder')}
      />
    </div>
  )
}

function SourcesStep({ workspaceName, roles, sources, oauthConnectedFor, onChange, onOauthConnected }: {
  workspaceName: string
  roles: readonly SourceRoleDescriptor[]
  sources: SourceDraft[]
  oauthConnectedFor: ReadonlySet<string>
  onChange: (sources: SourceDraft[]) => void
  onOauthConnected: (sourceId: string) => void
}) {
  const { t } = useTranslation()
  const { locale } = useLocale()
  function add(role: SourceRoleDescriptor) {
    onChange([...sources, defaultSourceDraft(role)])
  }
  function update(uiId: string, patch: Partial<SourceDraft>) {
    onChange(sources.map(s => (s.uiId === uiId ? { ...s, ...patch } : s)))
  }
  function remove(uiId: string) {
    onChange(sources.filter(s => s.uiId !== uiId))
  }

  return (
    <div className="space-y-3">
      <p className="text-2xs text-muted-foreground">
        {t('workspace.wizard.sourcesDescriptionPrefix')}
        {' '}
        <code className="rounded bg-muted px-1">manual</code>
        {' '}
        {t('workspace.wizard.sourcesDescriptionSuffix')}
      </p>
      <div className="space-y-2">
        {sources.map(source => (
          <SourceRow
            key={source.uiId}
            workspaceName={workspaceName}
            draft={source}
            oauthConnected={oauthConnectedFor.has(nameToId(source.name))}
            onUpdate={patch => update(source.uiId, patch)}
            onRemove={() => remove(source.uiId)}
            onOauthConnected={onOauthConnected}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {roles.map(role => (
          <Button key={role.id} variant="ghost" size="sm" onClick={() => add(role)}>
            <Plus />
            {t('workspace.wizard.sourceRoleButton', { label: localize(role.label, locale) })}
          </Button>
        ))}
      </div>
    </div>
  )
}

function SourceRow({ workspaceName, draft, oauthConnected, onUpdate, onRemove, onOauthConnected }: {
  workspaceName: string
  draft: SourceDraft
  oauthConnected: boolean
  onUpdate: (patch: Partial<SourceDraft>) => void
  onRemove: () => void
  onOauthConnected: (sourceId: string) => void
}) {
  const { t } = useTranslation()
  const id = nameToId(draft.name)
  const targetPath = `./${draftPathSegment(draft)}/${id || '<name>'}`
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-2xs uppercase tracking-wider text-muted-foreground">{draft.role}</Badge>
        <Input
          placeholder={t('workspace.wizard.sourceNamePlaceholder', { role: draft.role })}
          value={draft.name}
          onChange={e => onUpdate({ name: e.target.value })}
          className="flex-1"
        />
        <LoaderSelect value={draft.loaderKind} onChange={k => onUpdate({ loaderKind: k })} />
        <Button variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>

      <p className="font-mono text-2xs text-muted-foreground">{targetPath}</p>

      <MarkdownDescriptionField
        id={`src-desc-${draft.uiId}`}
        value={draft.description}
        onChange={next => onUpdate({ description: next })}
        label={t('workspace.wizard.sourceDescriptionLabel')}
        placeholder={t('workspace.wizard.sourceDescriptionPlaceholder')}
        helperText={t('workspace.wizard.sourceDescriptionHint')}
        rows={2}
      />

      <div className="space-y-2">
        {draft.loaderKind === 'git' && (
          <div className="flex gap-2">
            <Input
              placeholder="https://github.com/org/repo.git"
              value={draft.gitUrl}
              onChange={e => onUpdate({ gitUrl: e.target.value })}
              className="flex-1"
            />
            <Input
              placeholder={t('workspace.wizard.gitBranchPlaceholder')}
              value={draft.gitBranch}
              onChange={e => onUpdate({ gitBranch: e.target.value })}
              className="w-28"
            />
          </div>
        )}
        {draft.loaderKind === 'gdrive' && (
          <>
            <Input
              placeholder={t('workspace.wizard.googleDriveFolderPlaceholder')}
              value={draft.gdriveFolderId}
              onChange={e => onUpdate({ gdriveFolderId: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder={t('workspace.wizard.googleDriveIncludePlaceholder')}
                value={draft.gdriveInclude}
                onChange={e => onUpdate({ gdriveInclude: e.target.value })}
              />
              <Input
                placeholder={t('workspace.wizard.googleDriveExcludePlaceholder')}
                value={draft.gdriveExclude}
                onChange={e => onUpdate({ gdriveExclude: e.target.value })}
              />
            </div>
            <GdriveOauthBlock
              workspaceName={workspaceName}
              sourceName={draft.name}
              connected={oauthConnected}
              onConnected={onOauthConnected}
            />
          </>
        )}
        {draft.loaderKind === 'github' && (
          <GithubOauthBlock
            workspaceName={workspaceName}
            sourceName={draft.name}
            connected={oauthConnected}
            onConnected={onOauthConnected}
          />
        )}
        {draft.loaderKind !== '' && !STUDIO_KNOWN_LOADER_KINDS.has(draft.loaderKind) && (
          <UnknownLoaderWarning
            kind={draft.loaderKind}
            hint={(
              <>
                {t('workspace.wizard.unknownLoaderHintBefore')}
                {' '}
                <code className="rounded bg-muted px-1 font-mono">manual</code>
                {' '}
                {t('workspace.wizard.unknownLoaderHintMiddle')}
                {' '}
                <code className="rounded bg-muted px-1 font-mono">{draft.loaderKind}</code>
                {' '}
                {t('workspace.wizard.unknownLoaderHintAfter')}
              </>
            )}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Loader dropdown for the wizard.
 * Reads the server's `/source-loaders` list,
 * so any newly-registered plugin appears here without a Studio code change.
 * The `manual` option is always offered first,
 * because it is not backed by a plugin.
 * It just tells the workspace the source has no auto-sync.
 */
function LoaderSelect({ value, onChange }: { value: string, onChange: (kind: string) => void }) {
  const { t } = useTranslation()
  const { data } = useSourceLoaders()
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded-md border border-border bg-background px-2 py-1 text-xs"
    >
      <option value="">{loaderKindLabel('', t)}</option>
      {(data?.loaders ?? []).map(loader => (
        <option key={loader.kind} value={loader.kind}>{loaderKindLabel(loader.kind, t)}</option>
      ))}
    </select>
  )
}

function GdriveOauthBlock({ workspaceName, sourceName, connected, onConnected }: {
  workspaceName: string
  sourceName: string
  connected: boolean
  onConnected: (sourceId: string) => void
}) {
  const { t } = useTranslation()
  // Token storage key is `${workspaceId}--${sourceId}`.
  // Workspace id is the typed name, the PRODUCT.md name,
  // source id is derived from the source name.
  // Both come from the wizard's current state,
  // so we authorise before scaffold.
  const workspaceId = workspaceName.trim()
  const sourceId = nameToId(sourceName)
  const canStart = workspaceId.length > 0 && sourceId.length > 0

  const startOauth = useGoogleOAuth(workspaceId, sourceId, { onConnected })

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">{t('workspace.wizard.googleAccount')}</p>
          <p className="text-2xs text-muted-foreground">
            {!canStart
              ? t('workspace.wizard.googleAccountSetNames')
              : connected
                ? t('workspace.wizard.googleAccountConnected', { workspaceId, sourceId })
                : t('workspace.wizard.googleAccountAuthorise')}
          </p>
        </div>
        <Button
          size="sm"
          variant={connected ? 'ghost' : 'default'}
          disabled={!canStart || startOauth.isPending}
          onClick={() => startOauth.mutate()}
        >
          {startOauth.isPending ? t('workspace.wizard.opening') : connected ? t('workspace.wizard.reconnect') : t('workspace.wizard.connectGoogle')}
        </Button>
      </div>
      {startOauth.error && (
        <p className="mt-2 text-2xs text-destructive">{humaniseApiError(startOauth.error)}</p>
      )}
    </div>
  )
}

function GithubOauthBlock({ workspaceName, sourceName, connected, onConnected }: {
  workspaceName: string
  sourceName: string
  connected: boolean
  onConnected: (sourceId: string) => void
}) {
  const { t } = useTranslation()
  // Same pre-scaffold token stashing as gdrive,
  // the key is `${workspaceId}--${sourceId}`, both from the wizard state.
  const workspaceId = workspaceName.trim()
  const sourceId = nameToId(sourceName)
  const canStart = workspaceId.length > 0 && sourceId.length > 0

  const startOauth = useGithubOAuth(workspaceId, sourceId, { onConnected })

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">{t('workspace.wizard.githubAccount')}</p>
          <p className="text-2xs text-muted-foreground">
            {!canStart
              ? t('workspace.wizard.githubAccountSetNames')
              : connected
                ? t('workspace.wizard.githubAccountConnected', { workspaceId, sourceId })
                : t('workspace.wizard.githubAccountAuthorise')}
          </p>
        </div>
        <Button
          size="sm"
          variant={connected ? 'ghost' : 'default'}
          disabled={!canStart || startOauth.isPending}
          onClick={() => startOauth.mutate()}
        >
          {startOauth.isPending ? t('workspace.wizard.opening') : connected ? t('workspace.wizard.reconnect') : t('workspace.wizard.connectGithub')}
        </Button>
      </div>
      {startOauth.error && (
        <p className="mt-2 text-2xs text-destructive">{humaniseApiError(startOauth.error)}</p>
      )}
    </div>
  )
}

function McpStep({ servers, onChange }: {
  servers: McpDraft[]
  onChange: (servers: McpDraft[]) => void
}) {
  const { t } = useTranslation()
  function add() {
    onChange([...servers, { uiId: crypto.randomUUID(), id: '', url: '', description: '', headersText: '' }])
  }
  function update(uiId: string, patch: Partial<McpDraft>) {
    onChange(servers.map(s => (s.uiId === uiId ? { ...s, ...patch } : s)))
  }
  function remove(uiId: string) {
    onChange(servers.filter(s => s.uiId !== uiId))
  }

  return (
    <div className="space-y-3">
      <p className="text-2xs text-muted-foreground">
        {t('workspace.wizard.mcpDescriptionPrefix')}
        {' '}
        <code className="rounded bg-muted px-1">
          $
          {'{ENV_VAR}'}
        </code>
        {' '}
        {t('workspace.wizard.mcpDescriptionSuffix')}
      </p>
      <div className="space-y-2">
        {servers.map(server => (
          <div key={server.uiId} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex gap-2">
              <Input
                placeholder={t('workspace.wizard.mcpServerIdPlaceholder')}
                value={server.id}
                onChange={e => update(server.uiId, { id: e.target.value })}
                className="w-40"
              />
              <Input
                placeholder="https://example.com/mcp"
                value={server.url}
                onChange={e => update(server.uiId, { url: e.target.value })}
                className="flex-1"
              />
              <Button variant="ghost" size="icon" onClick={() => remove(server.uiId)}>
                <Trash2 />
              </Button>
            </div>
            <MarkdownDescriptionField
              id={`mcp-desc-${server.uiId}`}
              value={server.description}
              onChange={next => update(server.uiId, { description: next })}
              label={t('workspace.wizard.mcpDescriptionLabel')}
              placeholder={t('workspace.wizard.mcpDescriptionPlaceholder')}
              helperText={t('workspace.wizard.sourceDescriptionHint')}
              rows={2}
            />
            <textarea
              // eslint-disable-next-line no-template-curly-in-string
              placeholder={'Authorization: Bearer ${LINEAR_TOKEN}\nX-Workspace-Id: ${WORKSPACE_ID}'}
              value={server.headersText}
              onChange={e => update(server.uiId, { headersText: e.target.value })}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
            />
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={add}>
        <Plus />
        {t('workspace.wizard.addMcpServer')}
      </Button>
    </div>
  )
}

function AdvancedStep({ ontologyId, storageKind, onOntologyId, onStorageKind }: {
  ontologyId: string
  storageKind: string
  onOntologyId: (v: string) => void
  onStorageKind: (v: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <p className="text-2xs text-muted-foreground">{t('workspace.wizard.advancedDescription')}</p>
      <div className="space-y-1.5">
        <Label htmlFor="ws-ontology">{t('workspace.wizard.ontologyLabel')}</Label>
        <Input id="ws-ontology" value={ontologyId} onChange={e => onOntologyId(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-storage">{t('workspace.wizard.storageKindLabel')}</Label>
        <Input id="ws-storage" value={storageKind} onChange={e => onStorageKind(e.target.value)} />
      </div>
    </div>
  )
}

function ConfirmStep({ name, description, sources, mcpServers, ontologyId, storageKind }: {
  name: string
  description: string
  sources: SourceDraft[]
  mcpServers: McpDraft[]
  ontologyId: string
  storageKind: string
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3 text-xs">
      <Field label={t('common.name')} value={name} />
      <Field label={t('workspace.wizard.folderLabel')} value={`${t('workspace.wizard.workspacesRootPlaceholder')}/${name}`} mono />
      {description && <Field label={t('common.description')} value={description} />}
      <Field label={t('workspace.wizard.ontologyLabel')} value={ontologyId} />
      <Field label={t('workspace.wizard.storageLabel')} value={storageKind} />
      <div>
        <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{t('workspace.wizard.sourcesTitle')}</div>
        {sources.length === 0
          ? <p className="text-muted-foreground/70">{t('workspace.wizard.sourcesEmpty')}</p>
          : (
              <ul className="mt-1 space-y-1">
                {sources.map(source => (
                  <li key={source.uiId} className="font-mono">
                    <span className="text-muted-foreground">
                      [
                      {source.role}
                      ]
                    </span>
                    {' '}
                    {source.name}
                    {' '}
                    <span className="text-muted-foreground">
                      {source.loaderKind ? `(${source.loaderKind})` : '(manual)'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
      </div>
      <div>
        <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{t('workspace.wizard.mcpServersTitle')}</div>
        {mcpServers.length === 0
          ? <p className="text-muted-foreground/70">{t('workspace.wizard.mcpEmpty')}</p>
          : (
              <ul className="mt-1 space-y-1">
                {mcpServers.map(server => (
                  <li key={server.uiId} className="font-mono">
                    {server.id}
                    {' '}
                    <span className="text-muted-foreground">{server.url}</span>
                  </li>
                ))}
              </ul>
            )}
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string, value: string, mono?: boolean }) {
  return (
    <div>
      <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        :
        {' '}
      </span>
      <span className={mono ? 'font-mono' : ''}>{value}</span>
    </div>
  )
}

interface ExpectedSource {
  id: string
  name: string
  loaderKind: SourceDraft['loaderKind']
}

function ProgressStep({ workspaceName, status, error, provision, expectedSources, onClose }: {
  workspaceName: string
  status: 'idle' | 'pending' | 'success' | 'error'
  error: unknown
  provision: ProvisionSummary[]
  expectedSources: readonly ExpectedSource[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const errorCases: readonly ErrorCase[] = [
    {
      match: e => e.status === 400 && e.message.includes('already exists'),
      message: t('workspace.wizard.nameConflict'),
    },
  ]
  // Live per-source progress via SSE.
  // The workspace is not in the registry yet when we open this stream.
  // `source.synced` events flow off the event bus by string key,
  // so the wizard's typed name catches every event provisionAll fires.
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (status !== 'pending' || !workspaceName)
      return
    const source = new EventSource(workspaceEventsUrl(workspaceName))
    const onSynced = (event: MessageEvent): void => {
      try {
        const data = JSON.parse(event.data) as { sourceId?: string }
        if (data.sourceId)
          setSyncedIds(prev => new Set(prev).add(data.sourceId!))
      }
      catch {}
    }
    source.addEventListener('source.synced', onSynced as EventListener)
    return () => source.close()
  }, [status, workspaceName])

  if (status === 'pending') {
    return (
      <div className="space-y-3 py-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="size-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          {t('workspace.wizard.creatingWorkspace')}
          {expectedSources.length > 0 && t('workspace.wizard.provisioningSources', { count: expectedSources.length })}
          …
        </div>
        {expectedSources.length > 0 && (
          <ul className="space-y-1 rounded-md border border-border p-2 text-2xs">
            {expectedSources.map(s => (
              <li key={s.id} className="flex items-center gap-2 font-mono">
                {syncedIds.has(s.id)
                  ? <span className="text-primary">✓</span>
                  : <span className="size-2.5 animate-pulse rounded-full bg-muted-foreground/40" />}
                <span className={syncedIds.has(s.id) ? 'text-foreground' : 'text-muted-foreground'}>{s.name}</span>
                <span className="text-muted-foreground">
                  (
                  {s.loaderKind || 'manual'}
                  )
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-2xs text-muted-foreground">
          {t('workspace.wizard.progressWarning')}
        </p>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="space-y-3 py-2">
        <p className="text-sm text-destructive">{t('workspace.wizard.creationFailed')}</p>
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-2xs">{humaniseApiError(error, errorCases)}</pre>
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    )
  }
  if (status === 'success') {
    return (
      <div className="space-y-3 py-2">
        <p className="text-sm text-foreground">{t('workspace.wizard.creationSucceeded')}</p>
        {provision.length > 0 && (
          <ul className="space-y-1 text-2xs">
            {provision.map(entry => (
              <li key={entry.sourceId} className="flex items-center gap-2 font-mono">
                <span className="size-1.5 rounded-full bg-green-500" />
                {entry.sourceId}
                <span className="text-muted-foreground">{t('workspace.wizard.provisionedLabel')}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>{t('common.done')}</Button>
        </div>
      </div>
    )
  }
  return null
}

function canAdvanceFrom(
  step: StepKey,
  state: { name: string, sources: SourceDraft[], mcpServers: McpDraft[], oauthConnectedFor: ReadonlySet<string> },
): boolean {
  if (step === 'basics')
    return WORKSPACE_NAME_PATTERN.test(state.name)
  if (step === 'sources') {
    return state.sources.every((source) => {
      if (source.name.trim().length === 0)
        return false
      if (source.loaderKind === 'gdrive') {
        if (source.gdriveFolderId.trim().length === 0)
          return false
        // OAuth is mandatory for gdrive.
        // Otherwise provisionAll fails server-side with "not connected",
        // and the user gets an opaque error after the remaining steps.
        if (!state.oauthConnectedFor.has(nameToId(source.name)))
          return false
      }
      if (source.loaderKind === 'git' && source.gitUrl.trim().length === 0)
        return false
      // GitHub reads issues over the API,
      // so it needs a connected token before scaffold, else sync fails opaquely.
      if (source.loaderKind === 'github' && !state.oauthConnectedFor.has(nameToId(source.name)))
        return false
      return true
    })
  }
  if (step === 'mcp')
    return state.mcpServers.every(server => server.id.trim().length > 0 && /^https?:\/\//.test(server.url))
  return true
}

function defaultSourceDraft(role: SourceRoleDescriptor): SourceDraft {
  return {
    uiId: crypto.randomUUID(),
    role: role.id,
    pathSegment: role.pathSegment ?? role.id,
    name: '',
    description: '',
    loaderKind: '',
    gitUrl: '',
    gitBranch: 'master',
    gdriveFolderId: '',
    gdriveInclude: '',
    gdriveExclude: '',
    githubOwner: '',
    githubRepo: '',
    githubState: 'all',
    githubLabels: '',
    githubIncludeComments: true,
    mcpUrl: '',
    mcpAuthorization: '',
    mcpTool: '',
  }
}

function buildDraft(input: {
  name: string
  description: string
  sources: SourceDraft[]
  mcpServers: McpDraft[]
  ontologyId: string
  storageKind: string
}): ProductManifestCreate {
  const sources = input.sources.map(toSourceDescriptor)
  const mcpServers = input.mcpServers.map(toMcpServerConfig)
  return {
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ontologyId: asOntologyId(input.ontologyId),
    sources,
    mcpServers,
    storage: { kind: asStorageKind(input.storageKind), config: {} },
  }
}

function toMcpServerConfig(draft: McpDraft): McpServerConfig {
  const headers: Record<string, string> = {}
  for (const line of draft.headersText.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed)
      continue
    const colon = trimmed.indexOf(':')
    if (colon === -1)
      continue
    headers[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim()
  }
  return {
    id: asMcpServerId(draft.id),
    transport: 'streamable-http',
    url: draft.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(draft.description ? { description: draft.description } : {}),
  }
}
