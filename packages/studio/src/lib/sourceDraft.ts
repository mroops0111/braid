import type { SourceDescriptor } from '@braidhq/schema'
import { asAbsolutePath, asLoaderKind, asMcpServerId, asSourceId } from './brands'

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
  const id = asSourceId(nameToId(draft.name))
  if (draft.kind === 'mcp') {
    return {
      kind: 'mcp',
      id,
      role: draft.role,
      name: draft.name,
      mcpServerId: asMcpServerId(draft.mcpServerId),
    }
  }
  const loader = draft.loaderKind === 'git'
    ? { kind: asLoaderKind('git'), config: { url: draft.gitUrl, ...(draft.gitBranch ? { branch: draft.gitBranch } : {}) } }
    : draft.loaderKind === 'gdrive'
      ? { kind: asLoaderKind('gdrive'), config: { folderId: draft.gdriveFolderId } }
      : undefined
  return {
    kind: 'filesystem',
    id,
    role: draft.role,
    name: draft.name,
    path: asAbsolutePath(draft.path),
    ...(loader ? { loader } : {}),
  }
}
