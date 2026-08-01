import type { AdminUser } from '@/lib/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Loader2, MoreHorizontal, Plus, Shield, Trash2 } from 'lucide-react'
import { DropdownMenu as DropdownPrimitive } from 'radix-ui'
import { useState } from 'react'
import { ArmedConfirmBar } from '@/components/ArmedConfirmBar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { humaniseApiError } from '@/lib/errors'
import { queryKeys, useAdminInvites, useAdminUsers, useMe } from '@/lib/queries'

function isPlausibleEmail(value: string): boolean {
  if (/\s/.test(value))
    return false
  const at = value.indexOf('@')
  if (at <= 0 || at === value.length - 1)
    return false
  const domain = value.slice(at + 1)
  const dot = domain.indexOf('.')
  return dot > 0 && dot < domain.length - 1
}

export function UsersTab() {
  return (
    <div className="space-y-6">
      <InvitesSection />
      <UsersSection />
    </div>
  )
}

function InvitesSection() {
  const { data, isLoading, error } = useAdminInvites(true)
  return (
    <section className="space-y-2">
      <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        Pending Invites
      </h2>
      {error && <p className="text-2xs text-destructive">{humaniseApiError(error)}</p>}
      {isLoading
        ? <p className="text-2xs text-muted-foreground">Loading…</p>
        : data && data.items.length === 0
          ? <p className="text-2xs text-muted-foreground">No pending invites.</p>
          : (
              <ul className="space-y-1">
                {data?.items.map(invite => (
                  <InviteRow key={invite.email} email={invite.email} role={invite.serverRole} />
                ))}
              </ul>
            )}
      <AddInviteForm />
    </section>
  )
}

function InviteRow({ email, role }: { email: string, role: 'admin' | 'user' }) {
  const qc = useQueryClient()
  const [armed, setArmed] = useState(false)
  const revoke = useMutation({
    mutationFn: () => api.revokeInvite(email),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminInvites() })
    },
  })
  return (
    <li className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
      <span className="truncate font-mono">{email}</span>
      <Badge variant="outline" className="text-2xs uppercase tracking-wider text-muted-foreground">
        {role}
      </Badge>
      <div className="ml-auto flex items-center gap-1">
        {armed
          ? (
              <>
                <Button variant="ghost" size="sm" className="h-7 text-2xs" onClick={() => setArmed(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-2xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => revoke.mutate()}
                  disabled={revoke.isPending}
                >
                  Revoke
                </Button>
              </>
            )
          : (
              <Button
                variant="ghost"
                size="icon"
                title="Revoke invite"
                aria-label="Revoke invite"
                className="text-destructive hover:text-destructive"
                onClick={() => setArmed(true)}
              >
                <Trash2 />
              </Button>
            )}
      </div>
    </li>
  )
}

function AddInviteForm() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [error, setError] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: () => api.addInvite({ email: email.trim().toLowerCase(), serverRole: role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminInvites() })
      reset()
    },
    onError: (err) => {
      setError(humaniseApiError(err))
    },
  })

  function reset() {
    setEmail('')
    setRole('user')
    setError(null)
    setOpen(false)
  }

  function submit() {
    setError(null)
    const trimmed = email.trim()
    if (!isPlausibleEmail(trimmed)) {
      setError('Enter a valid email address.')
      return
    }
    add.mutate()
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="h-7 text-2xs">
        <Plus className="mr-1 size-3" />
        Add Invite
      </Button>
    )
  }
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">New Invite</h3>
      <div className="space-y-2">
        <Label htmlFor="invite-email" className="text-xs">Email</Label>
        <Input
          id="invite-email"
          autoFocus
          placeholder="someone@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-role" className="text-xs">Initial Server Role</Label>
        <select
          id="invite-role"
          value={role}
          onChange={e => setRole(e.target.value as 'user' | 'admin')}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </div>
      {error && <p className="text-2xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={reset} className="flex-1" disabled={add.isPending}>Cancel</Button>
        <Button size="sm" onClick={submit} className="flex-1" disabled={add.isPending}>
          {add.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
          {add.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </section>
  )
}

function UsersSection() {
  const { data, isLoading } = useAdminUsers(true)
  const { data: me } = useMe()
  const sorted = data ? sortUsers(data.items, me?.id) : []
  return (
    <section className="space-y-2">
      <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        Users
      </h2>
      {isLoading
        ? <p className="text-2xs text-muted-foreground">Loading…</p>
        : (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-card/40 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-1.5">User</th>
                    <th className="px-3 py-1.5">Role</th>
                    <th className="px-3 py-1.5">Workspaces</th>
                    <th className="px-3 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((user, idx) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      isMe={me?.id === user.id}
                      isLast={idx === sorted.length - 1}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </section>
  )
}

function WorkspaceList({ workspaces }: { workspaces: AdminUser['workspaces'] }) {
  if (workspaces.length === 0)
    return <span className="text-2xs text-muted-foreground/60">none</span>
  return (
    <ul className="flex flex-wrap gap-1">
      {workspaces.map(w => (
        <li
          key={w.workspaceId}
          className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-2xs"
        >
          <span className="font-mono text-foreground/80">{w.workspaceId}</span>
          <span className="uppercase tracking-wider text-muted-foreground/70">{w.role}</span>
        </li>
      ))}
    </ul>
  )
}

// Self pinned at the top so the admin always sees their own row first,
// they need it to know they cannot demote themselves.
// Admins come next so the privileged accounts cluster.
// Within each tier, sort by displayName for a predictable scan.
function sortUsers(users: AdminUser[], myId: string | undefined): AdminUser[] {
  return [...users].sort((a, b) => {
    if (myId) {
      if (a.id === myId)
        return -1
      if (b.id === myId)
        return 1
    }
    if (a.serverRole !== b.serverRole)
      return a.serverRole === 'admin' ? -1 : 1
    return a.displayName.localeCompare(b.displayName)
  })
}

function UserRow({ user, isMe, isLast }: { user: AdminUser, isMe: boolean, isLast: boolean }) {
  const qc = useQueryClient()
  const [armedAction, setArmedAction] = useState<'role' | 'delete' | null>(null)
  const flip = useMutation({
    mutationFn: (next: 'admin' | 'user') => api.adminUpdateUserRole(user.id, next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminUsers() })
      qc.invalidateQueries({ queryKey: queryKeys.users() })
      setArmedAction(null)
    },
  })
  const remove = useMutation({
    mutationFn: () => api.adminDeleteUser(user.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminUsers() })
      qc.invalidateQueries({ queryKey: queryKeys.users() })
      setArmedAction(null)
    },
  })
  const nextRole = user.serverRole === 'admin' ? 'user' : 'admin'
  const nextRoleLabel = nextRole === 'admin' ? 'Make Admin' : 'Make User'
  const secondary = user.email ?? user.id
  const rowClass = isLast ? 'align-top' : 'border-b border-border align-top'
  return (
    <>
      <tr className={rowClass}>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{user.displayName}</span>
            {isMe && (
              <Badge variant="outline" className="bg-primary/15 text-2xs uppercase tracking-wider text-primary">
                You
              </Badge>
            )}
          </div>
          <div className="truncate font-mono text-2xs text-muted-foreground">{secondary}</div>
        </td>
        <td className="px-3 py-2">
          <Badge
            variant="outline"
            className={`gap-0.5 text-2xs uppercase tracking-wider ${
              user.serverRole === 'admin' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
            }`}
          >
            {user.serverRole === 'admin' && <Shield className="size-2.5" />}
            {user.serverRole}
          </Badge>
        </td>
        <td className="px-3 py-2">
          <WorkspaceList workspaces={user.workspaces} />
        </td>
        <td className="px-3 py-2 text-right">
          {isMe
            ? null
            : (
                <DropdownPrimitive.Root>
                  <DropdownPrimitive.Trigger asChild>
                    <Button variant="ghost" size="icon" className="size-7" title="User actions" aria-label="User actions">
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownPrimitive.Trigger>
                  <DropdownPrimitive.Portal>
                    <DropdownPrimitive.Content
                      align="end"
                      sideOffset={4}
                      className="z-50 min-w-36 rounded-md border border-border bg-popover p-1 text-xs shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0"
                    >
                      <DropdownPrimitive.Item
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-accent focus:bg-accent"
                        onSelect={() => setArmedAction('role')}
                      >
                        <ChevronDown className="size-3" />
                        {nextRoleLabel}
                      </DropdownPrimitive.Item>
                      <DropdownPrimitive.Separator className="my-1 h-px bg-border" />
                      <DropdownPrimitive.Item
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-destructive outline-none hover:bg-destructive/10 focus:bg-destructive/10"
                        onSelect={() => setArmedAction('delete')}
                      >
                        <Trash2 className="size-3" />
                        Delete User
                      </DropdownPrimitive.Item>
                    </DropdownPrimitive.Content>
                  </DropdownPrimitive.Portal>
                </DropdownPrimitive.Root>
              )}
        </td>
      </tr>
      {armedAction && !isMe && (
        <tr className="border-b border-border bg-muted/30">
          <td colSpan={4} className="px-3 py-2">
            {armedAction === 'role'
              ? (
                  <ArmedConfirmBar
                    message={(
                      <>
                        Set
                        {' '}
                        <span className="font-medium">{user.displayName}</span>
                        's server role to
                        {' '}
                        <span className="font-medium">{nextRole}</span>
                        ?
                      </>
                    )}
                    confirmLabel={flip.isPending ? 'Saving…' : nextRoleLabel}
                    confirmTone="primary"
                    disabled={flip.isPending}
                    onCancel={() => setArmedAction(null)}
                    onConfirm={() => flip.mutate(nextRole)}
                    errorMessage={flip.error ? humaniseApiError(flip.error) : null}
                  />
                )
              : (
                  <ArmedConfirmBar
                    message={(
                      <>
                        Delete
                        {' '}
                        <span className="font-medium">{user.displayName}</span>
                        ? Workspace memberships referencing this user are left in place as orphans.
                      </>
                    )}
                    confirmLabel={remove.isPending ? 'Deleting…' : 'Delete Permanently'}
                    confirmTone="destructive"
                    disabled={remove.isPending}
                    onCancel={() => setArmedAction(null)}
                    onConfirm={() => remove.mutate()}
                    errorMessage={remove.error ? humaniseApiError(remove.error) : null}
                  />
                )}
          </td>
        </tr>
      )}
    </>
  )
}
