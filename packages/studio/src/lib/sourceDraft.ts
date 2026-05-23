import type { SourceDescriptor } from '@braidhq/schema'
import { asAbsolutePath, asLoaderKind, asSourceId } from './brands'

export interface SourceDraft {
  role: 'intent' | 'code'
  name: string
  loaderKind: '' | 'git' | 'gdrive'
  gitUrl: string
  gitBranch: string
  gdriveFolderId: string
  /** Optional regex (string). Empty = no filter. Matched against gdrive's posix relative path. */
  gdriveInclude: string
  gdriveExclude: string
}

export function nameToId(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
}

/**
 * Fixed top-level grouping for each source role. Hardcoded (not user
 * editable) so any tool can find sources by walking these dirs.
 */
export function rolePathSegment(role: 'intent' | 'code'): 'intents' | 'codebases' {
  return role === 'intent' ? 'intents' : 'codebases'
}

export function toSourceDescriptor(draft: SourceDraft): SourceDescriptor {
  const id = asSourceId(nameToId(draft.name))
  // Path is fully derived: role decides the grouping dir, source name
  // decides the leaf. Lets you `ls workspaces/x/intents/` to see all
  // intent sources without parsing PRODUCT.md, and matches redoc's
  // layout. The user only ever names the leaf.
  const path = asAbsolutePath(`./${rolePathSegment(draft.role)}/${id}`)
  const loader = draft.loaderKind === 'git'
    ? { kind: asLoaderKind('git'), config: { url: draft.gitUrl, ...(draft.gitBranch ? { branch: draft.gitBranch } : {}) } }
    : draft.loaderKind === 'gdrive'
      ? {
          kind: asLoaderKind('gdrive'),
          config: {
            folderId: draft.gdriveFolderId,
            ...(draft.gdriveInclude ? { include: draft.gdriveInclude } : {}),
            ...(draft.gdriveExclude ? { exclude: draft.gdriveExclude } : {}),
          },
        }
      : undefined
  return {
    kind: 'filesystem',
    id,
    role: draft.role,
    name: draft.name,
    path,
    ...(loader ? { loader } : {}),
  }
}
