import type { SourceDescriptor } from '@braidhq/schema'
import { asAbsolutePath, asLoaderKind, asSourceId } from './brands'

export interface SourceDraft {
  role: 'intent' | 'code'
  name: string
  description: string
  // `''` is the "manual / no auto-sync" choice. Non-empty values mirror a
  // registered source-loader plugin's `kind` and may be any string the
  // server reports via `GET /source-loaders` (not a closed union here, so a
  // future plugin's kind survives type-checking without a Studio change).
  loaderKind: string
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
}

export function nameToId(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
}

/**
 * Loader kinds for which Studio ships a per-field config form. Other kinds
 * that the server reports still appear in the dropdown, but the dialog
 * shows a warning instead of a form and disables submit until the kind is
 * configured by editing PRODUCT.md directly.
 */
export const STUDIO_KNOWN_LOADER_KINDS = new Set(['git', 'github', 'gdrive'])

/**
 * Human-friendly label for a loader kind. Falls back to the raw kind so a
 * new plugin without a Studio-side label still renders sensibly in the
 * dropdown.
 */
export function loaderKindLabel(kind: string): string {
  if (kind === '')
    return 'manual (no auto-sync)'
  if (kind === 'github')
    return 'github (issues)'
  return kind
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
