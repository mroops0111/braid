import type { McpServerConfig, SourceDescriptor, User, Workspace, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, Database, GitBranch, HardDrive, MoreHorizontal, Plug, RefreshCw, Trash2, UserMinus, UserRound, UserRoundCheck, UserRoundCog, Webhook } from 'lucide-react'
import { DropdownMenu as DropdownPrimitive } from 'radix-ui'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { humaniseApiError } from '@/lib/errors'
import { useLocaleFormat } from '@/lib/i18n'
import { queryKeys, useMe, useSourceLoaders, useUsers, useWorkspaceMembers } from '@/lib/queries'
import { useGithubOAuth } from '@/lib/useGithubOAuth'
import { useGoogleOAuth } from '@/lib/useGoogleOAuth'
import { useWorkspacePolicy } from '@/policy'
import { AddSourceDialog } from './AddSourceDialog'
import { ArmedConfirmBar } from './ArmedConfirmBar'
import { MarkdownDescriptionField } from './MarkdownDescriptionField'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet'
import { WorkspaceSkillPermissions } from './WorkspaceSkillPermissions'

interface WorkspaceDetailsSheetProps {
  workspaceId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUnregistered: () => void
  onRenamed: (newId: string) => void
}

export function WorkspaceDetailsSheet({ workspaceId, open, onOpenChange, onUnregistered, onRenamed }: WorkspaceDetailsSheetProps) {
  const { t } = useTranslation()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:!max-w-xl">
        {workspaceId
          ? <Body workspaceId={workspaceId} onUnregistered={onUnregistered} onRenamed={onRenamed} />
          : <p className="p-6 text-sm text-muted-foreground">{t('workspace.details.noWorkspaceSelected')}</p>}
      </SheetContent>
    </Sheet>
  )
}

function Body({ workspaceId, onUnregistered, onRenamed }: {
  workspaceId: string
  onUnregistered: () => void
  onRenamed: (newId: string) => void
}) {
  const { t } = useTranslation()
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
    return <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
  if (error || !workspace)
    return <p className="p-6 text-sm text-destructive">{error instanceof Error ? error.message : t('workspace.details.loadFailed')}</p>

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SheetHeader className="border-b border-border">
        <SheetTitle className="font-mono">{workspace.id}</SheetTitle>
        <SheetDescription className="font-mono text-2xs">{workspace.rootPath}</SheetDescription>
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
          <SectionHeader title={t('workspace.details.sourcesTitle')} onAdd={() => setAddSourceOpen(true)} addLabel={t('workspace.details.addSource')} />
          {workspace.productManifest.sources.length === 0
            ? <p className="mt-2 text-2xs text-muted-foreground">{t('workspace.details.sourcesEmpty')}</p>
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
          <SectionHeader title={t('workspace.details.mcpServersTitle')} />
          {workspace.productManifest.mcpServers.length === 0
            ? <p className="mt-2 text-2xs text-muted-foreground">{t('workspace.details.mcpEmpty')}</p>
            : (
                <ul className="mt-2 space-y-1.5">
                  {workspace.productManifest.mcpServers.map(server => (
                    <McpRow key={server.id} workspaceId={workspaceId} server={server} onChange={invalidate} />
                  ))}
                </ul>
              )}
        </section>

        <MembersSection workspaceId={workspaceId} />

        <SkillPermissionsForOwners workspaceId={workspaceId} />

        <section className="grid grid-cols-2 gap-3 text-xs">
          <MetaField icon={Database} label={t('workspace.details.ontologyLabel')} value={workspace.productManifest.ontologyId} />
          <MetaField icon={HardDrive} label={t('workspace.details.storageLabel')} value={workspace.productManifest.storage.kind} />
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
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {onAdd && (
        <Button variant="ghost" size="sm" onClick={onAdd} className="h-6 text-2xs">
          {addLabel}
        </Button>
      )}
    </div>
  )
}

function RenameSection({ workspace, onRenamed }: { workspace: Workspace, onRenamed: (newId: string) => void }) {
  const { t } = useTranslation()
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
        <Label htmlFor="rename">{t('common.name')}</Label>
        <Input id="rename" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <MarkdownDescriptionField
        id="desc"
        value={description}
        onChange={setDescription}
        placeholder={t('workspace.aboutPlaceholder')}
      />
      {patch.error && <p className="text-2xs text-destructive">{humaniseApiError(patch.error)}</p>}
      <div className="flex justify-end">
        <Button size="sm" disabled={!dirty || patch.isPending} onClick={() => patch.mutate()}>
          {patch.isPending ? t('common.saving') : t('common.save')}
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
  const { t } = useTranslation()
  const { formatTime } = useLocaleFormat()
  const [editingDescription, setEditingDescription] = useState(false)
  const [draftDescription, setDraftDescription] = useState(source.description ?? '')
  const sync = useMutation({
    mutationFn: () => api.syncSource(workspaceId, source.id),
    onSuccess: onChange,
  })
  const remove = useMutation({
    mutationFn: () => api.removeSource(workspaceId, source.id),
    onSuccess: onChange,
  })
  const patch = useMutation({
    mutationFn: () => api.patchSource(workspaceId, source.id, { description: draftDescription }),
    onSuccess: () => {
      setEditingDescription(false)
      onChange()
    },
  })

  const loaderKind = source.kind === 'filesystem' ? (source.loader?.kind ?? 'manual') : null
  const detail = source.kind === 'filesystem' ? source.path : `mcp:${source.mcpServerId}`
  const canSync = source.kind === 'filesystem' && !!source.loader
  const canWrite = useWorkspacePolicy(workspaceId).can('workspace.write')

  return (
    <li className="rounded-md border border-border p-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-2xs uppercase tracking-wider text-muted-foreground">{source.role}</Badge>
        <span className="font-mono text-xs">{source.name}</span>
        {loaderKind && (
          <span className="flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 text-2xs text-muted-foreground">
            <GitBranch className="size-2.5" />
            {loaderKind}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {canSync && (
            <Button variant="ghost" size="icon" onClick={() => sync.mutate()} disabled={sync.isPending} title={t('workspace.details.syncButton')} aria-label={t('workspace.details.syncButton')}>
              <RefreshCw className={sync.isPending ? 'animate-spin' : ''} />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => remove.mutate()} disabled={remove.isPending} title={t('common.remove')} aria-label={t('common.remove')}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <p className="mt-1 break-all font-mono text-2xs text-muted-foreground">{detail}</p>
      <InlineDescriptionEditor
        idPrefix={`src-${source.id}`}
        stored={source.description}
        draft={draftDescription}
        onDraftChange={setDraftDescription}
        editing={editingDescription}
        onEdit={() => {
          setDraftDescription(source.description ?? '')
          setEditingDescription(true)
        }}
        onCancel={() => {
          setEditingDescription(false)
          setDraftDescription(source.description ?? '')
        }}
        onSave={() => patch.mutate()}
        saving={patch.isPending}
        error={patch.error}
        emptyHint={t('workspace.details.addDescription')}
      />
      {sync.data && (
        <p className="mt-1 text-2xs text-muted-foreground">
          <SyncSummary report={sync.data} />
          {' · '}
          {formatTime(sync.data.fetchedAt ?? Date.now())}
        </p>
      )}
      {(loaderKind === 'gdrive' || loaderKind === 'github') && (
        <SourceConnectionStatus workspaceId={workspaceId} sourceId={source.id} loaderKind={loaderKind} canWrite={canWrite} />
      )}
      {(sync.error || remove.error) && (
        <p className="mt-1 text-2xs text-destructive">{humaniseApiError(sync.error ?? remove.error)}</p>
      )}
      <WebhookPanelGate workspaceId={workspaceId} source={source} />
    </li>
  )
}

/**
 * Connection state for an OAuth-backed source. Any member sees the status,
 * only an owner (`workspace.write`) gets the connect or reconnect action,
 * so a stale token surfaces here rather than only in the server log.
 */
function SourceConnectionStatus({ workspaceId, sourceId, loaderKind, canWrite }: {
  workspaceId: string
  sourceId: string
  loaderKind: string
  canWrite: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const connection = useQuery({
    queryKey: ['source-connection', workspaceId, sourceId],
    queryFn: () => api.getSourceConnection(workspaceId, sourceId),
  })
  // Refresh this badge and the top banner's list query,
  // so both drop the stale state the moment a connection succeeds.
  const onConnected = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['source-connection', workspaceId, sourceId] })
    void queryClient.invalidateQueries({ queryKey: ['source-connections', workspaceId] })
  }
  const google = useGoogleOAuth(workspaceId, sourceId, { onConnected })
  const github = useGithubOAuth(workspaceId, sourceId, { onConnected })
  const oauth = loaderKind === 'gdrive' ? google : github

  const status = connection.data
  if (!status)
    return null

  const label = status.needsAuth
    ? t('workspace.details.connectionNeedsAuth')
    : status.connected
      ? t('workspace.details.connectionConnected', { name: status.connectedBy?.displayName ?? t('workspace.details.connectionUnknownMember') })
      : t('workspace.details.connectionNotConnected')
  const tone = status.needsAuth ? 'text-destructive' : status.connected ? 'text-muted-foreground' : 'text-amber-500'
  const showAction = canWrite && (status.needsAuth || !status.connected)

  return (
    <div className="mt-1 flex items-center justify-between gap-2">
      <span className={`flex items-center gap-1 text-2xs ${tone}`}>
        <Plug className="size-2.5" />
        {label}
      </span>
      {showAction && (
        <Button variant={status.needsAuth ? 'default' : 'ghost'} size="sm" disabled={oauth.isPending} onClick={() => oauth.mutate()}>
          {oauth.isPending
            ? t('workspace.details.connectOpening')
            : status.connected ? t('workspace.details.reconnect') : t('workspace.details.connect')}
        </Button>
      )}
      {oauth.error && <span className="text-2xs text-destructive">{humaniseApiError(oauth.error)}</span>}
    </div>
  )
}

/**
 * Render the GitHub webhook panel only when the server reports,
 * the source's loader plugin as webhook-capable.
 * Asking the server keeps Studio loader-agnostic.
 * Registering a new loader with a `webhook` field,
 * surfaces the panel automatically, no Studio code change.
 */
function WebhookPanelGate({ workspaceId, source }: { workspaceId: string, source: SourceDescriptor }) {
  const loaders = useSourceLoaders()
  if (source.kind !== 'filesystem' || !source.loader)
    return null
  const loaderKind = source.loader.kind
  const entry = loaders.data?.loaders.find(l => l.kind === loaderKind)
  if (!entry?.webhook)
    return null
  return <GithubWebhookPanel workspaceId={workspaceId} sourceId={source.id} />
}

function GithubWebhookPanel({ workspaceId, sourceId }: { workspaceId: string, sourceId: string }) {
  const { t } = useTranslation()
  const { formatDateTime } = useLocaleFormat()
  const [open, setOpen] = useState(false)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: ['github-webhook-status', workspaceId, sourceId],
    queryFn: () => api.getGithubWebhookStatus(workspaceId, sourceId),
    enabled: open,
  })
  const rotate = useMutation({
    mutationFn: () => api.rotateGithubWebhookSecret(workspaceId, sourceId),
    // Clear any previously-revealed secret before the new rotate request.
    // A transient error during rotation could otherwise leave a stale secret,
    // in the amber callout next to a red error message.
    onMutate: () => {
      setRevealedSecret(null)
    },
    onSuccess: (data) => {
      // The rotate response is the only moment the secret is visible to the UI.
      // Subsequent GETs report `hasSecret` without the value.
      // The user must copy it now or generate another one.
      setRevealedSecret(data.secret)
      queryClient.invalidateQueries({ queryKey: ['github-webhook-status', workspaceId, sourceId] })
    },
  })

  // Clearing on collapse keeps the "shown once" contract honest.
  // Re-opening the panel does not re-display the previously rotated secret.
  // The browser tab is the only place the user can keep it.
  const togglePanel = (): void => {
    setOpen((wasOpen) => {
      if (wasOpen)
        setRevealedSecret(null)
      return !wasOpen
    })
  }

  return (
    <div className="mt-2 rounded border border-dashed border-border/60 p-2 text-2xs">
      <button
        type="button"
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        onClick={togglePanel}
      >
        <Webhook className="size-3" />
        {open ? t('workspace.details.hideGithubWebhook') : t('workspace.details.githubWebhook')}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {status.isLoading && <p className="text-muted-foreground">{t('common.loading')}</p>}
          {status.error && <p className="text-destructive">{humaniseApiError(status.error)}</p>}
          {status.data && (
            <>
              <div>
                <Label className="text-2xs uppercase text-muted-foreground">{t('workspace.details.payloadUrl')}</Label>
                <code className="mt-1 block break-all rounded bg-muted px-1.5 py-1 font-mono text-2xs">
                  {status.data.url}
                </code>
              </div>
              <p className="text-muted-foreground">
                {status.data.hasSecret
                  ? t('workspace.details.secretLastRotated', { date: status.data.createdAt ? formatDateTime(status.data.createdAt) : t('common.unknown') })
                  : t('workspace.details.noSecretConfigured')}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={rotate.isPending} onClick={() => rotate.mutate()}>
                  {rotate.isPending ? t('workspace.details.rotating') : status.data.hasSecret ? t('workspace.details.rotateSecret') : t('workspace.details.generateSecret')}
                </Button>
              </div>
              {revealedSecret && (
                <div className="rounded border border-amber-500/60 bg-amber-50 p-2 text-foreground dark:bg-amber-950/40">
                  <p className="font-medium">{t('workspace.details.copySecretOnce')}</p>
                  <code className="mt-1 block break-all rounded bg-background px-1.5 py-1 font-mono text-2xs">
                    {revealedSecret}
                  </code>
                </div>
              )}
              {rotate.error && <p className="text-destructive">{humaniseApiError(rotate.error)}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SyncSummary({ report }: { report: { changed: boolean, added?: number, updated?: number, removed?: number } }) {
  const { t } = useTranslation()
  // When the loader reports structured counts,
  // use the unified `+a ~u -r` format.
  // Otherwise fall back to a plain changed or unchanged label.
  const hasCounts = report.added !== undefined || report.updated !== undefined || report.removed !== undefined
  if (!hasCounts)
    return <span>{report.changed ? t('workspace.details.updatedLabel') : t('workspace.details.noChangeLabel')}</span>
  const parts: string[] = []
  if ((report.added ?? 0) > 0)
    parts.push(`+${report.added}`)
  if ((report.updated ?? 0) > 0)
    parts.push(`~${report.updated}`)
  if ((report.removed ?? 0) > 0)
    parts.push(`-${report.removed}`)
  return <span className="font-mono">{parts.length === 0 ? t('workspace.details.noChangeLabel') : parts.join(' ')}</span>
}

function McpRow({ workspaceId, server, onChange }: {
  workspaceId: string
  server: McpServerConfig
  onChange: () => void
}) {
  const { t } = useTranslation()
  const [editingDescription, setEditingDescription] = useState(false)
  const [draftDescription, setDraftDescription] = useState(server.description ?? '')
  const patch = useMutation({
    mutationFn: () => api.patchMcpServer(workspaceId, server.id, { description: draftDescription }),
    onSuccess: () => {
      setEditingDescription(false)
      onChange()
    },
  })
  return (
    <li className="rounded-md border border-border p-2">
      <div className="flex items-center gap-2">
        <Plug className="size-3 text-muted-foreground" />
        <span className="font-mono text-xs">{server.id}</span>
      </div>
      <p className="mt-1 break-all font-mono text-2xs text-muted-foreground">
        {server.transport === 'stdio' ? `${server.command}${server.args ? ` ${server.args.join(' ')}` : ''}` : server.url}
      </p>
      <InlineDescriptionEditor
        idPrefix={`mcp-${server.id}`}
        stored={server.description}
        draft={draftDescription}
        onDraftChange={setDraftDescription}
        editing={editingDescription}
        onEdit={() => {
          setDraftDescription(server.description ?? '')
          setEditingDescription(true)
        }}
        onCancel={() => {
          setEditingDescription(false)
          setDraftDescription(server.description ?? '')
        }}
        onSave={() => patch.mutate()}
        saving={patch.isPending}
        error={patch.error}
        emptyHint={t('workspace.details.addDescription')}
      />
    </li>
  )
}

function InlineDescriptionEditor({
  idPrefix,
  stored,
  draft,
  onDraftChange,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
  error,
  emptyHint,
}: {
  idPrefix: string
  stored: string | undefined
  draft: string
  onDraftChange: (next: string) => void
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  saving: boolean
  error: unknown
  emptyHint: string
}) {
  const { t } = useTranslation()
  if (!editing) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="mt-1 w-full rounded text-left text-2xs text-muted-foreground/90 hover:bg-accent/40"
      >
        {stored
          ? <span className="block whitespace-pre-wrap py-0.5">{stored}</span>
          : <span className="block py-0.5 italic text-muted-foreground/60">{emptyHint}</span>}
      </button>
    )
  }
  const dirty = draft !== (stored ?? '')
  return (
    <div className="mt-1 space-y-1.5">
      <MarkdownDescriptionField
        id={`${idPrefix}-desc`}
        value={draft}
        onChange={onDraftChange}
        label=""
        helperText=""
        placeholder={t('workspace.details.markdownSupported')}
        rows={2}
      />
      {error !== null && error !== undefined && (
        <p className="text-2xs text-destructive">{humaniseApiError(error)}</p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" className="h-7 text-2xs" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" className="h-7 text-2xs" onClick={onSave} disabled={!dirty || saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  )
}

function MetaField({ icon: Icon, label, value }: { icon: typeof Database, label: string, value: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <p className="mt-1 font-mono text-xs">{value}</p>
    </div>
  )
}

function SkillPermissionsForOwners({ workspaceId }: { workspaceId: string }) {
  const policy = useWorkspacePolicy(workspaceId)
  if (!policy.can('workspace.write'))
    return null
  return <WorkspaceSkillPermissions workspaceId={workspaceId} />
}

const MEMBER_ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 0,
  maintainer: 1,
  guest: 2,
}

/**
 * Same ordering as the Admin Console's user list.
 * Self is pinned at the top, then by rank within scope,
 * workspace role here, server role there,
 * then by display name for a predictable scan.
 */
function sortMembers(
  members: readonly WorkspaceMember[],
  myId: string | undefined,
  displayNameFor: (userId: string) => string,
): WorkspaceMember[] {
  return [...members].sort((a, b) => {
    if (myId) {
      if (a.userId === myId)
        return -1
      if (b.userId === myId)
        return 1
    }
    if (a.role !== b.role)
      return MEMBER_ROLE_RANK[a.role] - MEMBER_ROLE_RANK[b.role]
    return displayNameFor(a.userId).localeCompare(displayNameFor(b.userId))
  })
}

function MembersSection({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: members, isLoading, error } = useWorkspaceMembers(workspaceId)
  const { data: allUsers } = useUsers()
  const { data: me } = useMe()
  const policy = useWorkspacePolicy(workspaceId)
  const canManageMembers = policy.can('workspace.write')

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaceMembers(workspaceId) })
  }

  if (isLoading) {
    return (
      <section>
        <SectionHeader title={t('workspace.details.membersTitle')} />
        <p className="mt-2 text-2xs text-muted-foreground">{t('common.loading')}</p>
      </section>
    )
  }
  if (error) {
    return (
      <section>
        <SectionHeader title={t('workspace.details.membersTitle')} />
        <p className="mt-2 text-2xs text-destructive">{humaniseApiError(error)}</p>
      </section>
    )
  }

  const memberIds = new Set(members?.items.map(m => m.userId) ?? [])
  const candidates = (allUsers?.items ?? []).filter(u => !memberIds.has(u.id))
  const sortedMembers = sortMembers(
    members?.items ?? [],
    me?.id,
    userId => allUsers?.items.find(u => u.id === userId)?.displayName ?? userId,
  )

  return (
    <section>
      <SectionHeader title={t('workspace.details.membersTitle')} />
      {sortedMembers.length === 0
        ? <p className="mt-2 text-2xs text-muted-foreground">{t('workspace.details.membersEmpty')}</p>
        : (
            <ul className="mt-2 space-y-1.5">
              {sortedMembers.map(member => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  user={allUsers?.items.find(u => u.id === member.userId)}
                  workspaceId={workspaceId}
                  canManage={canManageMembers}
                  isMe={member.userId === me?.id}
                  onChange={invalidate}
                />
              ))}
            </ul>
          )}
      {canManageMembers && candidates.length > 0 && (
        <AddMemberControl workspaceId={workspaceId} candidates={candidates} onAdded={invalidate} />
      )}
    </section>
  )
}

type ArmedKind = 'promote' | 'demote' | 'transfer' | 'remove'

function MemberRow({ member, user, workspaceId, canManage, isMe, onChange }: {
  member: WorkspaceMember
  user: User | undefined
  workspaceId: string
  canManage: boolean
  isMe: boolean
  onChange: () => void
}) {
  const { t } = useTranslation()
  const [armed, setArmed] = useState<ArmedKind | null>(null)
  const remove = useMutation({
    mutationFn: () => api.removeWorkspaceMember(workspaceId, member.userId),
    onSuccess: () => {
      setArmed(null)
      onChange()
    },
  })
  const promote = useMutation({
    mutationFn: (role: WorkspaceRole) =>
      api.patchWorkspaceMember(workspaceId, member.userId, { role }),
    onSuccess: () => {
      setArmed(null)
      onChange()
    },
  })
  const transfer = useMutation({
    mutationFn: () => api.transferWorkspaceOwnership(workspaceId, member.userId),
    onSuccess: () => {
      setArmed(null)
      onChange()
    },
  })

  const RoleIcon = member.role === 'owner'
    ? UserRoundCheck
    : member.role === 'maintainer'
      ? UserRoundCog
      : UserRound
  const displayName = user?.displayName ?? member.userId
  // Owners cannot be demoted directly, the server forbids it,
  // use Transfer Ownership instead.
  // Self cannot be removed, it would lock the UI out.
  // Owners are excluded from every kebab action.
  const targetIsOwner = member.role === 'owner'
  const canTransfer = canManage && !targetIsOwner
  const canChangeRole = canManage && !targetIsOwner
  const canRemove = canManage && !targetIsOwner && !isMe
  const showKebab = canTransfer || canChangeRole || canRemove

  function startArmed(kind: ArmedKind) {
    setArmed(kind)
  }

  return (
    <li className="rounded-md border border-border p-2">
      <div className="flex items-center gap-2">
        <RoleIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs">{displayName}</span>
            {isMe && <span className="text-2xs text-muted-foreground">{t('workspace.details.currentUserLabel')}</span>}
            <Badge variant="outline" className="ml-auto shrink-0 text-2xs uppercase tracking-wider text-muted-foreground">
              {member.role}
            </Badge>
          </div>
          {user?.email && (
            <p className="truncate font-mono text-2xs text-muted-foreground">{user.email}</p>
          )}
        </div>
        {showKebab && (
          <DropdownPrimitive.Root>
            <DropdownPrimitive.Trigger asChild>
              <Button variant="ghost" size="icon" className="size-6 shrink-0" title={t('workspace.details.memberActions')} aria-label={t('workspace.details.memberActions')}>
                <MoreHorizontal className="size-3" />
              </Button>
            </DropdownPrimitive.Trigger>
            <DropdownPrimitive.Portal>
              <DropdownPrimitive.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-xs shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0"
              >
                {canChangeRole && member.role === 'guest' && (
                  <DropdownPrimitive.Item
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-accent focus:bg-accent"
                    onSelect={() => startArmed('promote')}
                  >
                    <UserRoundCog className="size-3" />
                    {t('workspace.details.promoteToMaintainer')}
                  </DropdownPrimitive.Item>
                )}
                {canChangeRole && member.role === 'maintainer' && (
                  <DropdownPrimitive.Item
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-accent focus:bg-accent"
                    onSelect={() => startArmed('demote')}
                  >
                    <UserRound className="size-3" />
                    {t('workspace.details.demoteToGuest')}
                  </DropdownPrimitive.Item>
                )}
                {canTransfer && (
                  <DropdownPrimitive.Item
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-accent focus:bg-accent"
                    onSelect={() => startArmed('transfer')}
                  >
                    <Crown className="size-3" />
                    {t('workspace.details.transferOwnership')}
                  </DropdownPrimitive.Item>
                )}
                {canRemove && (
                  <>
                    <DropdownPrimitive.Separator className="my-1 h-px bg-border" />
                    <DropdownPrimitive.Item
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-destructive outline-none hover:bg-destructive/10 focus:bg-destructive/10"
                      onSelect={() => startArmed('remove')}
                    >
                      <UserMinus className="size-3" />
                      {t('workspace.details.removeFromWorkspace')}
                    </DropdownPrimitive.Item>
                  </>
                )}
              </DropdownPrimitive.Content>
            </DropdownPrimitive.Portal>
          </DropdownPrimitive.Root>
        )}
      </div>
      {armed && (
        <div className="mt-2 border-t border-border/60 pt-2">
          {armed === 'promote' && (
            <ArmedConfirmBar
              message={(
                <>
                  {t('workspace.details.promoteConfirmPrefix')}
                  {' '}
                  <span className="font-medium">{displayName}</span>
                  {' '}
                  {t('workspace.details.promoteConfirmSuffix')}
                </>
              )}
              confirmLabel={promote.isPending ? t('common.saving') : t('workspace.details.promoteToMaintainer')}
              confirmTone="primary"
              disabled={promote.isPending}
              onCancel={() => setArmed(null)}
              onConfirm={() => promote.mutate('maintainer')}
              errorMessage={promote.error ? humaniseApiError(promote.error) : null}
            />
          )}
          {armed === 'demote' && (
            <ArmedConfirmBar
              message={(
                <>
                  {t('workspace.details.demoteConfirmPrefix')}
                  {' '}
                  <span className="font-medium">{displayName}</span>
                  {' '}
                  {t('workspace.details.demoteConfirmSuffix')}
                </>
              )}
              confirmLabel={promote.isPending ? t('common.saving') : t('workspace.details.demoteToGuest')}
              confirmTone="primary"
              disabled={promote.isPending}
              onCancel={() => setArmed(null)}
              onConfirm={() => promote.mutate('guest')}
              errorMessage={promote.error ? humaniseApiError(promote.error) : null}
            />
          )}
          {armed === 'transfer' && (
            <ArmedConfirmBar
              message={(
                <>
                  {t('workspace.details.transferConfirmPrefix')}
                  {' '}
                  <span className="font-medium">{displayName}</span>
                  {t('workspace.details.transferConfirmSuffix')}
                </>
              )}
              confirmLabel={transfer.isPending ? t('common.saving') : t('workspace.details.transferOwnership')}
              confirmTone="destructive"
              disabled={transfer.isPending}
              onCancel={() => setArmed(null)}
              onConfirm={() => transfer.mutate()}
              errorMessage={transfer.error ? humaniseApiError(transfer.error) : null}
            />
          )}
          {armed === 'remove' && (
            <ArmedConfirmBar
              message={(
                <>
                  {t('workspace.details.removeConfirmPrefix')}
                  {' '}
                  <span className="font-medium">{displayName}</span>
                  {' '}
                  {t('workspace.details.removeConfirmSuffix')}
                </>
              )}
              confirmLabel={remove.isPending ? t('common.removing') : t('workspace.details.removeFromWorkspace')}
              confirmTone="destructive"
              disabled={remove.isPending}
              onCancel={() => setArmed(null)}
              onConfirm={() => remove.mutate()}
              errorMessage={remove.error ? humaniseApiError(remove.error) : null}
            />
          )}
        </div>
      )}
    </li>
  )
}

function AddMemberControl({ workspaceId, candidates, onAdded }: {
  workspaceId: string
  candidates: readonly User[]
  onAdded: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [role, setRole] = useState<WorkspaceRole>('guest')
  const add = useMutation({
    mutationFn: () => api.addWorkspaceMember(workspaceId, { userId: selectedUserId, role }),
    onSuccess: () => {
      onAdded()
      setSelectedUserId('')
      setOpen(false)
    },
  })

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="mt-2 h-6 text-2xs">
        {t('workspace.details.addMember')}
      </Button>
    )
  }
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border p-2">
      <select
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
        value={selectedUserId}
        onChange={e => setSelectedUserId(e.target.value)}
      >
        <option value="">{t('workspace.details.selectUser')}</option>
        {candidates.map(user => (
          <option key={user.id} value={user.id}>
            {user.displayName}
            {user.email ? ` (${user.email})` : ''}
          </option>
        ))}
      </select>
      <select
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
        value={role}
        onChange={e => setRole(e.target.value as WorkspaceRole)}
      >
        <option value="guest">{t('workspace.details.roleGuest')}</option>
        <option value="maintainer">{t('workspace.details.roleMaintainer')}</option>
      </select>
      {add.error && <p className="text-2xs text-destructive">{humaniseApiError(add.error)}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
        <Button size="sm" className="flex-1" disabled={!selectedUserId || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? t('common.adding') : t('common.add')}
        </Button>
      </div>
    </div>
  )
}

function UnregisterButton({ workspaceId, onUnregistered }: { workspaceId: string, onUnregistered: () => void }) {
  const { t } = useTranslation()
  const [armed, setArmed] = useState(false)
  const action = useMutation({
    mutationFn: () => api.deleteWorkspace(workspaceId),
    onSuccess: onUnregistered,
  })

  if (!armed) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setArmed(true)} className="w-full text-destructive">
        {t('workspace.details.deleteWorkspace')}
      </Button>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-2xs text-muted-foreground">
        {t('workspace.details.deleteWarning')}
      </p>
      {action.error && <p className="text-2xs text-destructive">{humaniseApiError(action.error)}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1" onClick={() => setArmed(false)}>{t('common.cancel')}</Button>
        <Button size="sm" className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => action.mutate()} disabled={action.isPending}>
          {action.isPending ? t('workspace.details.deleting') : t('workspace.details.deletePermanently')}
        </Button>
      </div>
    </div>
  )
}
