import type { McpServerConfig, ProductManifestDraft } from '@braidhq/schema'
import type { IngestSummary } from '@/lib/api'
import type { SourceDraft as SourceDraftBase } from '@/lib/sourceDraft'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, workspaceEventsUrl } from '@/lib/api'
import { asMcpServerId, asOntologyId, asStorageKind } from '@/lib/brands'
import { type ErrorCase, humaniseApiError } from '@/lib/errors'
import { queryKeys } from '@/lib/queries'
import { nameToId, rolePathSegment, toSourceDescriptor } from '@/lib/sourceDraft'
import { useGoogleOAuth } from '@/lib/useGoogleOAuth'
import { MarkdownDescriptionField } from './MarkdownDescriptionField'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

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

const WIZARD_ERROR_CASES: readonly ErrorCase[] = [
  {
    match: e => e.status === 400 && e.message.includes('already exists'),
    message: 'A workspace with that name already exists. Open it from the sidebar, or delete it first to recreate.',
  },
]

const STEP_ORDER: StepKey[] = ['basics', 'sources', 'mcp', 'advanced', 'confirm', 'progress']
const STEP_LABELS: Record<StepKey, string> = {
  basics: 'Basics',
  sources: 'Sources',
  mcp: 'MCP Servers',
  advanced: 'Advanced',
  confirm: 'Review',
  progress: 'Creating',
}

export function CreateWorkspaceWizard({ open, onOpenChange, onCreated }: CreateWorkspaceWizardProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<StepKey>('basics')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sources, setSources] = useState<SourceDraft[]>([])
  const [mcpServers, setMcpServers] = useState<McpDraft[]>([])
  const [ontologyId, setOntologyId] = useState('ddd')
  const [storageKind, setStorageKind] = useState('kuzu')
  const [ingestResults, setIngestResults] = useState<IngestSummary[]>([])
  // sourceIds whose Google OAuth flow completed in this wizard session.
  // The server stores tokens keyed by `${workspaceId}--${sourceId}` and
  // since `workspaceId === name` (PRODUCT.md name == folder name) we can
  // run OAuth before the workspace actually exists.
  const [oauthConnectedFor, setOauthConnectedFor] = useState<Set<string>>(new Set())

  const scaffold = useMutation({
    mutationFn: () => {
      const draft = buildDraft({ name, description, sources, mcpServers, ontologyId, storageKind })
      return api.scaffoldWorkspace(name, draft)
    },
    onSuccess: (result) => {
      setIngestResults(result.ingest)
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() })
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
    setIngestResults([])
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
        if (!o) {
          // Don't let outside-click / Escape kill the wizard mid-flight.
          // Scaffold + ingest can take minutes for gdrive sources; closing
          // would orphan the request and lose the progress we're showing.
          if (scaffold.isPending)
            return
          close()
        }
      }}
    >
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Create Workspace</DialogTitle>
          <DialogDescription>
            Scaffolds a fresh workspace under
            {' '}
            <code className="rounded bg-muted px-1">~/.braid/workspaces/</code>
            . To open an existing one, pick it from the sidebar.
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
              ingest={ingestResults}
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
              Back
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
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
                      Create
                    </Button>
                  )
                : (
                    <Button size="sm" disabled={!canAdvance} onClick={next}>
                      Next
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
  const current = STEP_ORDER.indexOf(step)
  return (
    <ol className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider">
      {STEP_ORDER.slice(0, -1).map((key, index) => {
        const active = index === current
        const done = index < current
        return (
          <li key={key} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className={`flex size-5 items-center justify-center rounded-full border text-[10px] ${
                done ? 'border-primary bg-primary text-primary-foreground' : active ? 'border-primary text-primary' : 'border-border text-muted-foreground'
              }`}
            >
              {index + 1}
            </span>
            <span className={active ? 'text-foreground' : 'text-muted-foreground/70'}>{STEP_LABELS[key]}</span>
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
  const invalid = name.length > 0 && !WORKSPACE_NAME_PATTERN.test(name)
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ws-name">Workspace Name</Label>
        <Input
          id="ws-name"
          autoFocus
          placeholder="my-product"
          value={name}
          onChange={e => onName(e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">Lowercase letters, digits, and dashes. Name conflicts are rejected; delete the existing workspace first to reuse a name.</p>
        <code className="block truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          ~/.braid/workspaces/
          {name || '<name>'}
        </code>
        {invalid && (
          <p className="text-[11px] text-destructive">Name must start with a letter or digit and use only lowercase letters, digits, or dashes.</p>
        )}
      </div>
      <MarkdownDescriptionField
        id="ws-desc"
        value={description}
        onChange={onDescription}
        placeholder="What is this workspace about? Markdown supported."
      />
    </div>
  )
}

function SourcesStep({ workspaceName, sources, oauthConnectedFor, onChange, onOauthConnected }: {
  workspaceName: string
  sources: SourceDraft[]
  oauthConnectedFor: ReadonlySet<string>
  onChange: (sources: SourceDraft[]) => void
  onOauthConnected: (sourceId: string) => void
}) {
  function add(role: 'intent' | 'code') {
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
      <p className="text-[11px] text-muted-foreground">
        Intent sources hold the rules / specs / docs (default loader:
        {' '}
        <code className="rounded bg-muted px-1">gdrive</code>
        ). Code sources are the implementation (default:
        {' '}
        <code className="rounded bg-muted px-1">git</code>
        ). Loaders place files under the workspace folder; pick
        {' '}
        <code className="rounded bg-muted px-1">manual</code>
        {' '}
        to manage that path yourself. You can also skip this step and add sources later.
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
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => add('intent')}>
          <Plus />
          Intent Source
        </Button>
        <Button variant="ghost" size="sm" onClick={() => add('code')}>
          <Plus />
          Code Source
        </Button>
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
  const id = nameToId(draft.name)
  const targetPath = `./${rolePathSegment(draft.role)}/${id || '<name>'}`
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">{draft.role}</span>
        <Input
          placeholder={draft.role === 'intent' ? 'intent-name' : 'repo-name'}
          value={draft.name}
          onChange={e => onUpdate({ name: e.target.value })}
          className="flex-1"
        />
        <select
          value={draft.loaderKind}
          onChange={e => onUpdate({ loaderKind: e.target.value as SourceDraft['loaderKind'] })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">manual</option>
          <option value="git">git</option>
          <option value="gdrive">gdrive</option>
        </select>
        <Button variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>

      <p className="font-mono text-[10px] text-muted-foreground">{targetPath}</p>

      <MarkdownDescriptionField
        id={`src-desc-${draft.uiId}`}
        value={draft.description}
        onChange={next => onUpdate({ description: next })}
        label="What is this source?"
        placeholder={draft.role === 'intent'
          ? 'e.g. Authoritative billing RFC; updated weekly by design team.'
          : 'e.g. Legacy Java monolith; read-only reference.'}
        helperText="Visible to skills via PRODUCT.md."
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
              placeholder="branch"
              value={draft.gitBranch}
              onChange={e => onUpdate({ gitBranch: e.target.value })}
              className="w-28"
            />
          </div>
        )}
        {draft.loaderKind === 'gdrive' && (
          <>
            <Input
              placeholder="Google Drive folder ID"
              value={draft.gdriveFolderId}
              onChange={e => onUpdate({ gdriveFolderId: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="include regex (optional, e.g. ^docs/)"
                value={draft.gdriveInclude}
                onChange={e => onUpdate({ gdriveInclude: e.target.value })}
              />
              <Input
                placeholder="exclude regex (optional)"
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
      </div>
    </div>
  )
}

function GdriveOauthBlock({ workspaceName, sourceName, connected, onConnected }: {
  workspaceName: string
  sourceName: string
  connected: boolean
  onConnected: (sourceId: string) => void
}) {
  // Token storage key is `${workspaceId}--${sourceId}`. Workspace id is
  // the typed workspace name (PRODUCT.md name); source id is derived from
  // source name. Both come from the wizard's current state so we can
  // authorise *before* scaffold runs.
  const workspaceId = workspaceName.trim()
  const sourceId = nameToId(sourceName)
  const canStart = workspaceId.length > 0 && sourceId.length > 0

  const startOauth = useGoogleOAuth(workspaceId, sourceId, { onConnected })

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">Google Account</p>
          <p className="text-[11px] text-muted-foreground">
            {!canStart
              ? 'Set workspace name and source name first.'
              : connected
                ? `Connected for "${workspaceId}/${sourceId}".`
                : 'Authorise read access to the folder above. Required before the workspace is created.'}
          </p>
        </div>
        <Button
          size="sm"
          variant={connected ? 'ghost' : 'default'}
          disabled={!canStart || startOauth.isPending}
          onClick={() => startOauth.mutate()}
        >
          {startOauth.isPending ? 'Opening…' : connected ? 'Reconnect' : 'Connect Google'}
        </Button>
      </div>
      {startOauth.error && (
        <p className="mt-2 text-[11px] text-destructive">{humaniseApiError(startOauth.error)}</p>
      )}
    </div>
  )
}

function McpStep({ servers, onChange }: {
  servers: McpDraft[]
  onChange: (servers: McpDraft[]) => void
}) {
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
      <p className="text-[11px] text-muted-foreground">
        Optional. MCP endpoints the agent can call during extract / validate (e.g. Linear, Redmine, Jira) to fill gaps in your intent / code sources; they are not ingested as content sources themselves. Only Streamable HTTP transport is supported. Use
        {' '}
        <code className="rounded bg-muted px-1">
          $
          {'{ENV_VAR}'}
        </code>
        {' '}
        in header values for secrets (resolved at runtime, never written to PRODUCT.md).
      </p>
      <div className="space-y-2">
        {servers.map(server => (
          <div key={server.uiId} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex gap-2">
              <Input
                placeholder="server id (e.g. linear)"
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
              label="What does this MCP serve?"
              placeholder="e.g. Linear, source of truth for tickets."
              helperText="Visible to skills via PRODUCT.md."
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
        Add MCP Server
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
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">Defaults work for most projects. Change these only if you've registered a custom ontology or storage plugin.</p>
      <div className="space-y-1.5">
        <Label htmlFor="ws-ontology">Ontology</Label>
        <Input id="ws-ontology" value={ontologyId} onChange={e => onOntologyId(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-storage">Storage Kind</Label>
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
  return (
    <div className="space-y-3 text-xs">
      <Field label="Name" value={name} />
      <Field label="Folder" value={`~/.braid/workspaces/${name}`} mono />
      {description && <Field label="Description" value={description} />}
      <Field label="Ontology" value={ontologyId} />
      <Field label="Storage" value={storageKind} />
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sources</div>
        {sources.length === 0
          ? <p className="text-muted-foreground/70">None. You can add sources later from the workspace panel.</p>
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
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">MCP Servers</div>
        {mcpServers.length === 0
          ? <p className="text-muted-foreground/70">None.</p>
          : (
              <ul className="mt-1 space-y-1">
                {mcpServers.map(server => (
                  <li key={server.uiId} className="font-mono">
                    {server.id}
                    {' '}
                    <span className="text-muted-foreground">
                      →
                      {server.url}
                    </span>
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
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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

function ProgressStep({ workspaceName, status, error, ingest, expectedSources, onClose }: {
  workspaceName: string
  status: 'idle' | 'pending' | 'success' | 'error'
  error: unknown
  ingest: IngestSummary[]
  expectedSources: readonly ExpectedSource[]
  onClose: () => void
}) {
  // Live per-source progress via SSE. The workspace doesn't exist in the
  // registry when we open this stream. `source.synced` events flow
  // straight off the event bus by string key, so subscribing on the
  // wizard's typed name catches every event ingestAll publishes during
  // scaffold.
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
          Creating workspace
          {expectedSources.length > 0 && ` (ingesting ${expectedSources.length} source${expectedSources.length === 1 ? '' : 's'})`}
          …
        </div>
        {expectedSources.length > 0 && (
          <ul className="space-y-1 rounded-md border border-border p-2 text-[11px]">
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
        <p className="text-[11px] text-muted-foreground">
          Don't close this window. Gdrive sources can take a few minutes for the first ingest.
        </p>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="space-y-3 py-2">
        <p className="text-sm text-destructive">Workspace creation failed.</p>
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-[11px]">{humaniseApiError(error, WIZARD_ERROR_CASES)}</pre>
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    )
  }
  if (status === 'success') {
    return (
      <div className="space-y-3 py-2">
        <p className="text-sm text-foreground">Workspace created.</p>
        {ingest.length > 0 && (
          <ul className="space-y-1 text-[11px]">
            {ingest.map(entry => (
              <li key={entry.sourceId} className="flex items-center gap-2 font-mono">
                <span className={`size-1.5 rounded-full ${entry.changed ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                {entry.sourceId}
                <span className="text-muted-foreground">{entry.changed ? 'ingested' : 'no change'}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>Done</Button>
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
        // OAuth is mandatory for gdrive; otherwise scaffold's ingestAll
        // will fail server-side with "not connected" and the user gets
        // an opaque error after walking through all remaining steps.
        if (!state.oauthConnectedFor.has(nameToId(source.name)))
          return false
      }
      if (source.loaderKind === 'git' && source.gitUrl.trim().length === 0)
        return false
      return true
    })
  }
  if (step === 'mcp')
    return state.mcpServers.every(server => server.id.trim().length > 0 && /^https?:\/\//.test(server.url))
  return true
}

function defaultSourceDraft(role: 'intent' | 'code'): SourceDraft {
  return {
    uiId: crypto.randomUUID(),
    role,
    name: '',
    description: '',
    loaderKind: role === 'intent' ? 'gdrive' : 'git',
    gitUrl: '',
    gitBranch: 'master',
    gdriveFolderId: '',
    gdriveInclude: '',
    gdriveExclude: '',
  }
}

function buildDraft(input: {
  name: string
  description: string
  sources: SourceDraft[]
  mcpServers: McpDraft[]
  ontologyId: string
  storageKind: string
}): ProductManifestDraft {
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
