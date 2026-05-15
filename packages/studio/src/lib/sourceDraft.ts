import type { SourceDescriptor } from '@telos/schema'

export interface SourceDraft {
  role: 'intent' | 'code'
  kind: 'filesystem' | 'mcp'
  name: string
  path: string
  loaderKind: '' | 'git' | 'gdrive'
  gitUrl: string
  gitBranch: string
  gdriveFolderId: string
  mcpServerId: string
}

export function nameToId(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
}

export function toSourceDescriptor(draft: SourceDraft): SourceDescriptor {
  const id = nameToId(draft.name)
  if (draft.kind === 'mcp') {
    return {
      kind: 'mcp',
      id: id as never,
      role: draft.role,
      name: draft.name,
      mcpServerId: draft.mcpServerId as never,
    }
  }
  const loader = draft.loaderKind === 'git'
    ? { kind: 'git' as never, config: { url: draft.gitUrl, ...(draft.gitBranch ? { branch: draft.gitBranch } : {}) } }
    : draft.loaderKind === 'gdrive'
      ? { kind: 'gdrive' as never, config: { folderId: draft.gdriveFolderId } }
      : undefined
  return {
    kind: 'filesystem',
    id: id as never,
    role: draft.role,
    name: draft.name,
    path: draft.path as never,
    ...(loader ? { loader } : {}),
  }
}
