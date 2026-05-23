import type { McpServerConfig, SourceDescriptor, Workspace } from '@braidhq/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, GitBranch, HardDrive, Plug, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/lib/api'
import { humaniseApiError } from '@/lib/errors'
import { queryKeys } from '@/lib/queries'
import { AddSourceDialog } from './AddSourceDialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet'

interface WorkspaceDetailsSheetProps {
  workspaceId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUnregistered: () => void
  onRenamed: (newId: string) => void
}

export function WorkspaceDetailsSheet({ workspaceId, open, onOpenChange, onUnregistered, onRenamed }: WorkspaceDetailsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[440px] !max-w-none">
        {workspaceId
          ? <Body workspaceId={workspaceId} onUnregistered={onUnregistered} onRenamed={onRenamed} />
          : <p className="p-6 text-sm text-muted-foreground">No workspace selected.</p>}
      </SheetContent>
    </Sheet>
  )
}

function Body({ workspaceId, onUnregistered, onRenamed }: {
  workspaceId: string
  onUnregistered: () => void
  onRenamed: (newId: string) => void
}) {
  const queryClient = useQueryClient()
  const { data: workspace, isLoading, error } = useQuery({
    queryKey: queryKeys.workspaceDetail(workspaceId),
    queryFn: () => api.getWorkspace(workspaceId),
  })
  const [addSourceOpen, setAddSourceOpen] = useState(false)

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() })
    queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'detail'] })
  }

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>
  if (error || !workspace)
    return <p className="p-6 text-sm text-destructive">{error instanceof Error ? error.message : 'Failed to load workspace'}</p>

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SheetHeader className="border-b border-border">
        <SheetTitle className="font-mono">{workspace.id}</SheetTitle>
        <SheetDescription className="font-mono text-[11px]">{workspace.rootPath}</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto p-4 scrollbar-thin">
        <RenameSection
          workspace={workspace}
          onRenamed={(newId) => {
            invalidate()
            onRenamed(newId)
          }}
        />

        <section>
          <SectionHeader title="Sources" onAdd={() => setAddSourceOpen(true)} addLabel="Add Source" />
          {workspace.productManifest.sources.length === 0
            ? <p className="mt-2 text-[11px] text-muted-foreground">None yet. Click "Add Source" to ingest from git, gdrive, or a manual directory.</p>
            : (
                <ul className="mt-2 space-y-1.5">
                  {workspace.productManifest.sources.map(source => (
                    <SourceRow
                      key={source.id}
                      workspaceId={workspaceId}
                      source={source}
                      onChange={invalidate}
                    />
                  ))}
                </ul>
              )}
        </section>

        <section>
          <SectionHeader title="MCP Servers" />
          {workspace.productManifest.mcpServers.length === 0
            ? <p className="mt-2 text-[11px] text-muted-foreground">None.</p>
            : (
                <ul className="mt-2 space-y-1.5">
                  {workspace.productManifest.mcpServers.map(server => (
                    <McpRow key={server.id} server={server} />
                  ))}
                </ul>
              )}
        </section>

        <section className="grid grid-cols-2 gap-3 text-xs">
          <MetaField icon={Database} label="Ontology" value={workspace.productManifest.ontologyId} />
          <MetaField icon={HardDrive} label="Storage" value={workspace.productManifest.storage.kind} />
        </section>
      </div>

      <div className="border-t border-border p-4">
        <UnregisterButton
          workspaceId={workspaceId}
          onUnregistered={() => {
            invalidate()
            onUnregistered()
          }}
        />
      </div>

      <AddSourceDialog
        workspaceId={workspaceId}
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        onAdded={invalidate}
      />
    </div>
  )
}

function SectionHeader({ title, onAdd, addLabel }: { title: string, onAdd?: (() => void) | undefined, addLabel?: string | undefined }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {onAdd && (
        <Button variant="ghost" size="sm" onClick={onAdd} className="h-6 text-[11px]">
          {addLabel}
        </Button>
      )}
    </div>
  )
}

function RenameSection({ workspace, onRenamed }: { workspace: Workspace, onRenamed: (newId: string) => void }) {
  const [name, setName] = useState(workspace.productManifest.name)
  const [description, setDescription] = useState(workspace.productManifest.description ?? '')
  const dirty = name !== workspace.productManifest.name || description !== (workspace.productManifest.description ?? '')

  const patch = useMutation({
    mutationFn: () => api.patchWorkspace(workspace.id, { name, ...(description ? { description } : {}) }),
    onSuccess: (result) => {
      if (result.renamed && result.newId)
        onRenamed(result.newId)
      else
        onRenamed(workspace.id)
    },
  })

  return (
    <section className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor="rename">Name</Label>
        <Input id="rename" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="desc">Description</Label>
        <Input id="desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="(optional)" />
      </div>
      {patch.error && <p className="text-[11px] text-destructive">{humaniseApiError(patch.error)}</p>}
      <div className="flex justify-end">
        <Button size="sm" disabled={!dirty || patch.isPending} onClick={() => patch.mutate()}>
          {patch.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </section>
  )
}

function SourceRow({ workspaceId, source, onChange }: {
  workspaceId: string
  source: SourceDescriptor
  onChange: () => void
}) {
  const sync = useMutation({
    mutationFn: () => api.syncSource(workspaceId, source.id),
    onSuccess: onChange,
  })
  const remove = useMutation({
    mutationFn: () => api.removeSource(workspaceId, source.id),
    onSuccess: onChange,
  })

  const loaderKind = source.kind === 'filesystem' ? (source.loader?.kind ?? 'manual') : null
  const detail = source.kind === 'filesystem' ? source.path : `mcp:${source.mcpServerId}`
  const canSync = source.kind === 'filesystem' && !!source.loader

  return (
    <li className="rounded-md border border-border p-2">
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">{source.role}</span>
        <span className="font-mono text-xs">{source.name}</span>
        {loaderKind && (
          <span className="flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <GitBranch className="size-2.5" />
            {loaderKind}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {canSync && (
            <Button variant="ghost" size="icon" onClick={() => sync.mutate()} disabled={sync.isPending} title="Sync">
              <RefreshCw className={sync.isPending ? 'animate-spin' : ''} />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => remove.mutate()} disabled={remove.isPending} title="Remove">
            <Trash2 />
          </Button>
        </div>
      </div>
      <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{detail}</p>
      {sync.data && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          <SyncSummary report={sync.data} />
          {' · '}
          {new Date(sync.data.fetchedAt ?? Date.now()).toLocaleTimeString()}
        </p>
      )}
      {(sync.error || remove.error) && (
        <p className="mt-1 text-[10px] text-destructive">{humaniseApiError(sync.error ?? remove.error)}</p>
      )}
    </li>
  )
}

function SyncSummary({ report }: { report: { changed: boolean, added?: number, updated?: number, removed?: number } }) {
  // When the loader reports structured counts use the unified `+a ~u -r`
  // format; otherwise fall back to a plain changed/unchanged label.
  const hasCounts = report.added !== undefined || report.updated !== undefined || report.removed !== undefined
  if (!hasCounts)
    return <span>{report.changed ? 'updated' : 'no change'}</span>
  const parts: string[] = []
  if ((report.added ?? 0) > 0)
    parts.push(`+${report.added}`)
  if ((report.updated ?? 0) > 0)
    parts.push(`~${report.updated}`)
  if ((report.removed ?? 0) > 0)
    parts.push(`-${report.removed}`)
  return <span className="font-mono">{parts.length === 0 ? 'no change' : parts.join(' ')}</span>
}

function McpRow({ server }: { server: McpServerConfig }) {
  return (
    <li className="rounded-md border border-border p-2">
      <div className="flex items-center gap-2">
        <Plug className="size-3 text-muted-foreground" />
        <span className="font-mono text-xs">{server.id}</span>
      </div>
      <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{server.url}</p>
    </li>
  )
}

function MetaField({ icon: Icon, label, value }: { icon: typeof Database, label: string, value: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <p className="mt-1 font-mono text-xs">{value}</p>
    </div>
  )
}

function UnregisterButton({ workspaceId, onUnregistered }: { workspaceId: string, onUnregistered: () => void }) {
  const [armed, setArmed] = useState(false)
  const action = useMutation({
    mutationFn: () => api.deleteWorkspace(workspaceId),
    onSuccess: onUnregistered,
  })

  if (!armed) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setArmed(true)} className="w-full text-destructive">
        Delete Workspace
      </Button>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Removes PRODUCT.md, all ingested files, and the workspace folder. You can re-create with the same name afterwards.
      </p>
      {action.error && <p className="text-[11px] text-destructive">{humaniseApiError(action.error)}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1" onClick={() => setArmed(false)}>Cancel</Button>
        <Button size="sm" className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => action.mutate()} disabled={action.isPending}>
          {action.isPending ? 'Deleting…' : 'Delete permanently'}
        </Button>
      </div>
    </div>
  )
}
