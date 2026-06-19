import type { SourceDescriptor } from '@braidhq/schema'
import { asAbsolutePath, asLoaderKind, asSourceId } from './brands'

export interface SourceDraft {
  role: 'intent' | 'code'
  name: string
  description: string
  loaderKind: '' | 'git' | 'gdrive' | 'github'
  gitUrl: string
  gitBranch: string
  gdriveFolderId: string
  /** Optional regex (string). Empty = no filter. Matched against gdrive's posix relative path. */
  gdriveInclude: string
  gdriveExclude: string
  githubOwner: string
  githubRepo: string
  githubState: 'open' | 'closed' | 'all'
  /** Comma-separated; trimmed + filtered to non-empty before serialising. */
  githubLabels: string
  githubIncludeComments: boolean
  githubIncludePullRequests: boolean
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
      : draft.loaderKind === 'github'
        ? (() => {
            const labels = draft.githubLabels.split(',').map(s => s.trim()).filter(s => s.length > 0)
            return {
              kind: asLoaderKind('github'),
              config: {
                owner: draft.githubOwner,
                repo: draft.githubRepo,
                state: draft.githubState,
                ...(labels.length > 0 ? { labels } : {}),
                includeComments: draft.githubIncludeComments,
                includePullRequests: draft.githubIncludePullRequests,
              },
            }
          })()
        : undefined
  return {
    kind: 'filesystem',
    id,
    role: draft.role,
    name: draft.name,
    path,
    ...(loader ? { loader } : {}),
    ...(draft.description ? { description: draft.description } : {}),
  }
}
