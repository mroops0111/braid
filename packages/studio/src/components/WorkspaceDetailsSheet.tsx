import type { McpServerConfig, SourceDescriptor, User, Workspace, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, Database, GitBranch, HardDrive, MoreHorizontal, Plug, RefreshCw, Trash2, UserMinus, UserRound, UserRoundCheck, UserRoundCog } from 'lucide-react'
import { DropdownMenu as DropdownPrimitive } from 'radix-ui'
import { useState } from 'react'
import { api } from '@/lib/api'
import { humaniseApiError } from '@/lib/errors'
import { queryKeys, useMe, useUsers, useWorkspaceMembers } from '@/lib/queries'
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:!max-w-xl">
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
                    <McpRow key={server.id} workspaceId={workspaceId} server={server} onChange={invalidate} />
                  ))}
                </ul>
              )}
        </section>

        <MembersSection workspaceId={workspaceId} />

        <SkillPermissionsForOwners workspaceId={workspaceId} />

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
      <MarkdownDescriptionField
        id="desc"
        value={description}
        onChange={setDescription}
        placeholder="What is this workspace about? Markdown supported."
      />
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
        emptyHint="Add description"
      />
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

function McpRow({ workspaceId, server, onChange }: {
  workspaceId: string
  server: McpServerConfig
  onChange: () => void
}) {
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
      <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
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
        emptyHint="Add description"
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
  if (!editing) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="mt-1 w-full rounded text-left text-[11px] text-muted-foreground/90 hover:bg-accent/40"
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
        placeholder="Markdown supported."
        rows={2}
      />
      {error !== null && error !== undefined && (
        <p className="text-[10px] text-destructive">{humaniseApiError(error)}</p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" className="h-7 text-[11px]" onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
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
 * Same ordering as the Admin Console's user list: self pinned at the
 * top, then by rank within scope (workspace role here, server role
 * there), then by display name for a predictable scan.
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
        <SectionHeader title="Members" />
        <p className="mt-2 text-[11px] text-muted-foreground">Loading…</p>
      </section>
    )
  }
  if (error) {
    return (
      <section>
        <SectionHeader title="Members" />
        <p className="mt-2 text-[11px] text-destructive">{humaniseApiError(error)}</p>
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
      <SectionHeader title="Members" />
      {sortedMembers.length === 0
        ? <p className="mt-2 text-[11px] text-muted-foreground">Nobody listed yet.</p>
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
  // Owners can't be demoted directly (server forbids; use Transfer
  // Ownership). Self can't be removed (would lock the UI out). Owners
  // are excluded from every kebab action.
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
            {isMe && <span className="text-[10px] text-muted-foreground">(you)</span>}
            <span className="ml-auto shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {member.role}
            </span>
          </div>
          {user?.email && (
            <p className="truncate font-mono text-[10px] text-muted-foreground">{user.email}</p>
          )}
        </div>
        {showKebab && (
          <DropdownPrimitive.Root>
            <DropdownPrimitive.Trigger asChild>
              <Button variant="ghost" size="icon" className="size-6 shrink-0" title="Member actions">
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
                    Promote to Maintainer
                  </DropdownPrimitive.Item>
                )}
                {canChangeRole && member.role === 'maintainer' && (
                  <DropdownPrimitive.Item
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-accent focus:bg-accent"
                    onSelect={() => startArmed('demote')}
                  >
                    <UserRound className="size-3" />
                    Demote to Guest
                  </DropdownPrimitive.Item>
                )}
                {canTransfer && (
                  <DropdownPrimitive.Item
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-accent focus:bg-accent"
                    onSelect={() => startArmed('transfer')}
                  >
                    <Crown className="size-3" />
                    Transfer Ownership
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
                      Remove from Workspace
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
                  Promote
                  <span className="font-medium">{displayName}</span>
                  {' '}
                  to Maintainer? They will be able to submit proposals and apply / reject pending ones.
                </>
              )}
              confirmLabel={promote.isPending ? 'Saving…' : 'Promote to Maintainer'}
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
                  Demote
                  <span className="font-medium">{displayName}</span>
                  {' '}
                  to Guest? They will lose Proposals / Clarify access and can only run skills explicitly granted to them.
                </>
              )}
              confirmLabel={promote.isPending ? 'Saving…' : 'Demote to Guest'}
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
                  Transfer workspace ownership to
                  <span className="font-medium">{displayName}</span>
                  ? The current Owner becomes a Maintainer. This is irreversible by the previous Owner.
                </>
              )}
              confirmLabel={transfer.isPending ? 'Saving…' : 'Transfer Ownership'}
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
                  Remove
                  <span className="font-medium">{displayName}</span>
                  {' '}
                  from this workspace? Their stored member row is deleted; their server account is untouched.
                </>
              )}
              confirmLabel={remove.isPending ? 'Removing…' : 'Remove from Workspace'}
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
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="mt-2 h-6 text-[11px]">
        + Add Member
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
        <option value="">Select user…</option>
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
        <option value="guest">Guest</option>
        <option value="maintainer">Maintainer</option>
      </select>
      {add.error && <p className="text-[10px] text-destructive">{humaniseApiError(add.error)}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" className="flex-1" disabled={!selectedUserId || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? 'Adding…' : 'Add'}
        </Button>
      </div>
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
