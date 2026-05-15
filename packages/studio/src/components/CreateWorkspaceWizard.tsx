import type { McpServerConfig, ProductManifestDraft } from '@telos/schema'
import type { IngestSummary } from '@/lib/api'
import type { SourceDraft as SourceDraftBase } from '@/lib/sourceDraft'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/lib/api'
import { type ErrorCase, humaniseApiError } from '@/lib/errors'
import { queryKeys } from '@/lib/queries'
import { toSourceDescriptor } from '@/lib/sourceDraft'
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
    match: e => e.status === 400 && e.message.includes('PRODUCT.md already exists'),
    message: 'A PRODUCT.md already exists at that path. Either pick a different path, or close this dialog and use "Register existing workspace" instead.',
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
  const [rootPath, setRootPath] = useState('')
  const [description, setDescription] = useState('')
  const [sources, setSources] = useState<SourceDraft[]>([])
  const [mcpServers, setMcpServers] = useState<McpDraft[]>([])
  const [ontologyId, setOntologyId] = useState('ddd')
  const [storageKind, setStorageKind] = useState('kuzu')
  const [ingestResults, setIngestResults] = useState<IngestSummary[]>([])

  const scaffold = useMutation({
    mutationFn: () => {
      const draft = buildDraft({ name, description, sources, mcpServers, ontologyId, storageKind })
      return api.scaffoldWorkspace(rootPath, draft)
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
    setRootPath('')
    setDescription('')
    setSources([])
    setMcpServers([])
    setOntologyId('ddd')
    setStorageKind('kuzu')
    setIngestResults([])
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

  const canAdvance = canAdvanceFrom(step, { name, rootPath, sources, mcpServers })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o)
          close()
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Workspace</DialogTitle>
          <DialogDescription>
            Telos will write a fresh PRODUCT.md and ingest any loader-backed sources.
          </DialogDescription>
        </DialogHeader>

        <StepIndicator step={step} />

        <div className="min-h-[280px]">
          {step === 'basics' && (
            <BasicsStep
              name={name}
              rootPath={rootPath}
              description={description}
              onName={setName}
              onRootPath={setRootPath}
              onDescription={setDescription}
            />
          )}
          {step === 'sources' && (
            <SourcesStep sources={sources} onChange={setSources} />
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
              rootPath={rootPath}
              description={description}
              sources={sources}
              mcpServers={mcpServers}
              ontologyId={ontologyId}
              storageKind={storageKind}
            />
          )}
          {step === 'progress' && (
            <ProgressStep
              status={scaffold.status}
              error={scaffold.error}
              ingest={ingestResults}
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
          <li key={key} className="flex items-center gap-1.5">
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

function BasicsStep({ name, rootPath, description, onName, onRootPath, onDescription }: {
  name: string
  rootPath: string
  description: string
  onName: (v: string) => void
  onRootPath: (v: string) => void
  onDescription: (v: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ws-name">Workspace name</Label>
        <Input
          id="ws-name"
          autoFocus
          placeholder="my-product"
          value={name}
          onChange={e => onName(e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">Lowercase, no spaces. Used as the workspace ID.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-path">Root path</Label>
        <Input
          id="ws-path"
          placeholder="/abs/path/to/new/workspace"
          value={rootPath}
          onChange={e => onRootPath(e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">Absolute path. Directory is created if missing; PRODUCT.md must not already exist.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-desc">Description (optional)</Label>
        <Input
          id="ws-desc"
          placeholder="One-line description"
          value={description}
          onChange={e => onDescription(e.target.value)}
        />
      </div>
    </div>
  )
}

function SourcesStep({ sources, onChange }: {
  sources: SourceDraft[]
  onChange: (sources: SourceDraft[]) => void
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
        Intent sources hold the rules / specs / docs. Code sources are the implementation. You can also leave this empty and add sources later.
      </p>
      <div className="space-y-2">
        {sources.map(source => (
          <SourceRow key={source.uiId} draft={source} onUpdate={patch => update(source.uiId, patch)} onRemove={() => remove(source.uiId)} />
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

function SourceRow({ draft, onUpdate, onRemove }: {
  draft: SourceDraft
  onUpdate: (patch: Partial<SourceDraft>) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">{draft.role}</span>
        <Input
          placeholder="source name (e.g. intent, src)"
          value={draft.name}
          onChange={e => onUpdate({ name: e.target.value })}
          className="flex-1"
        />
        <select
          value={draft.kind}
          onChange={e => onUpdate({ kind: e.target.value as SourceDraft['kind'] })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="filesystem">filesystem</option>
          <option value="mcp">mcp</option>
        </select>
        <Button variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>

      {draft.kind === 'filesystem'
        ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="path (relative to workspace, e.g. ./intent)"
                  value={draft.path}
                  onChange={e => onUpdate({ path: e.target.value })}
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
              </div>
              {draft.loaderKind === 'git' && (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="git URL (https or local path)"
                    value={draft.gitUrl}
                    onChange={e => onUpdate({ gitUrl: e.target.value })}
                  />
                  <Input
                    placeholder="branch (default: main)"
                    value={draft.gitBranch}
                    onChange={e => onUpdate({ gitBranch: e.target.value })}
                  />
                </div>
              )}
              {draft.loaderKind === 'gdrive' && (
                <Input
                  placeholder="Google Drive folder ID"
                  value={draft.gdriveFolderId}
                  onChange={e => onUpdate({ gdriveFolderId: e.target.value })}
                />
              )}
            </div>
          )
        : (
            <Input
              placeholder="MCP server ID (must match one declared in MCP servers step)"
              value={draft.mcpServerId}
              onChange={e => onUpdate({ mcpServerId: e.target.value })}
            />
          )}
    </div>
  )
}

function McpStep({ servers, onChange }: {
  servers: McpDraft[]
  onChange: (servers: McpDraft[]) => void
}) {
  function add() {
    onChange([...servers, { uiId: crypto.randomUUID(), id: '', url: '', headersText: '' }])
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
        Optional. Only Streamable HTTP transport is supported. Use
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
        <Label htmlFor="ws-storage">Storage kind</Label>
        <Input id="ws-storage" value={storageKind} onChange={e => onStorageKind(e.target.value)} />
      </div>
    </div>
  )
}

function ConfirmStep({ name, rootPath, description, sources, mcpServers, ontologyId, storageKind }: {
  name: string
  rootPath: string
  description: string
  sources: SourceDraft[]
  mcpServers: McpDraft[]
  ontologyId: string
  storageKind: string
}) {
  return (
    <div className="space-y-3 text-xs">
      <Field label="Name" value={name} />
      <Field label="Root path" value={rootPath} mono />
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
                    <span className="text-muted-foreground">{source.kind === 'filesystem' ? `→ ${source.path}${source.loaderKind ? ` (${source.loaderKind})` : ''}` : `→ mcp:${source.mcpServerId}`}</span>
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

function ProgressStep({ status, error, ingest, onClose }: {
  status: 'idle' | 'pending' | 'success' | 'error'
  error: unknown
  ingest: IngestSummary[]
  onClose: () => void
}) {
  if (status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Writing PRODUCT.md and running source ingest…
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="space-y-3 py-2">
        <p className="text-sm text-destructive">Workspace creation failed.</p>
        <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-[11px]">{humaniseApiError(error, WIZARD_ERROR_CASES)}</pre>
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

function canAdvanceFrom(step: StepKey, state: { name: string, rootPath: string, sources: SourceDraft[], mcpServers: McpDraft[] }): boolean {
  if (step === 'basics')
    return state.name.trim().length > 0 && state.rootPath.startsWith('/')
  if (step === 'sources')
    return state.sources.every(source => source.name.trim().length > 0 && (source.kind === 'mcp' ? source.mcpServerId.trim().length > 0 : source.path.trim().length > 0))
  if (step === 'mcp')
    return state.mcpServers.every(server => server.id.trim().length > 0 && /^https?:\/\//.test(server.url))
  return true
}

function defaultSourceDraft(role: 'intent' | 'code'): SourceDraft {
  return {
    uiId: crypto.randomUUID(),
    kind: 'filesystem',
    role,
    name: role === 'intent' ? 'intent' : 'src',
    path: role === 'intent' ? './intent' : './src',
    loaderKind: '',
    gitUrl: '',
    gitBranch: 'main',
    gdriveFolderId: '',
    mcpServerId: '',
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
    ontologyId: input.ontologyId as ProductManifestDraft['ontologyId'],
    sources,
    mcpServers,
    storage: { kind: input.storageKind as never, config: {} },
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
    id: draft.id as never,
    transport: 'streamable-http',
    url: draft.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  }
}
