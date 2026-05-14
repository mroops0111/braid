import type { SourceDescriptor } from '@telos/schema'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
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

  const add = useMutation({
    mutationFn: () => {
      const source = buildSource({ role, kind, name, path, loaderKind, gitUrl, gitBranch, gdriveFolderId, mcpServerId })
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
    add.reset()
  }

  function close() {
    onOpenChange(false)
    setTimeout(reset, 200)
  }

  const valid = name.trim().length > 0
    && (kind === 'mcp' ? mcpServerId.trim().length > 0 : path.trim().length > 0)
    && (loaderKind !== 'git' || gitUrl.trim().length > 0)
    && (loaderKind !== 'gdrive' || gdriveFolderId.trim().length > 0)

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
          <DialogTitle>Add source</DialogTitle>
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
                    <Field label="Google Drive folder ID">
                      <Input value={gdriveFolderId} onChange={e => setGdriveFolderId(e.target.value)} placeholder="1abc…" />
                    </Field>
                  )}
                </>
              )
            : (
                <Field label="MCP server ID">
                  <Input value={mcpServerId} onChange={e => setMcpServerId(e.target.value)} placeholder="must match an MCP server declared in this workspace" />
                </Field>
              )}
          {add.error && <p className="text-xs text-destructive">{humanise(add.error)}</p>}
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

function buildSource(input: {
  role: 'intent' | 'code'
  kind: 'filesystem' | 'mcp'
  name: string
  path: string
  loaderKind: '' | 'git' | 'gdrive'
  gitUrl: string
  gitBranch: string
  gdriveFolderId: string
  mcpServerId: string
}): SourceDescriptor {
  const id = input.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  if (input.kind === 'mcp') {
    return {
      kind: 'mcp',
      id: id as never,
      role: input.role,
      name: input.name,
      mcpServerId: input.mcpServerId as never,
    }
  }
  const loader = input.loaderKind === 'git'
    ? { kind: 'git' as never, config: { url: input.gitUrl, ...(input.gitBranch ? { branch: input.gitBranch } : {}) } }
    : input.loaderKind === 'gdrive'
      ? { kind: 'gdrive' as never, config: { folderId: input.gdriveFolderId } }
      : undefined
  return {
    kind: 'filesystem',
    id: id as never,
    role: input.role,
    name: input.name,
    path: input.path as never,
    ...(loader ? { loader } : {}),
  }
}

function humanise(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400 && error.message.includes('already exists'))
      return error.message
    return error.message
  }
  if (error instanceof Error)
    return error.message
  return String(error)
}
