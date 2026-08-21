import type { SourceDescriptor } from '@braidhq/schema'
import type { TFunction } from 'i18next'
import { asAbsolutePath, asLoaderKind, asSourceId, asSourceRole } from './brands'

export interface SourceDraft {
  // An ontology-declared role id. Open set, so no literal union here.
  role: string
  // Workspace subfolder this role provisions into, from the role descriptor.
  pathSegment: string
  name: string
  description: string
  // `''` is the "manual, no auto-sync" choice.
  // A non-empty value mirrors a registered source-loader plugin's `kind`,
  // and may be any string the server reports via `GET /source-loaders`.
  // It is not a closed union here,
  // so a future plugin's kind survives type-checking without a Studio change.
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
  /** Comma-separated, trimmed and filtered to non-empty before serialising. */
  githubLabels: string
  githubIncludeComments: boolean
  /** Streamable HTTP endpoint of the MCP server. */
  mcpUrl: string
  /**
   * Sent as the `Authorization` header, so a token never lands in the path.
   * Supports `${VAR}`, which the server resolves against its own environment.
   */
  mcpAuthorization: string
  /** Empty keeps the loader's own default, which a shaped gateway matches. */
  mcpTool: string
}

export function nameToId(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
}

/**
 * Turns the fields a form collected into the config its loader expects.
 * One entry per loader Studio can configure, so adding one is an entry,
 * rather than an edit to something that already knows every other loader.
 */
const LOADER_CONFIGS: Record<string, (draft: SourceDraft) => Record<string, unknown>> = {
  git: draft => ({
    url: draft.gitUrl,
    ...(draft.gitBranch ? { branch: draft.gitBranch } : {}),
  }),
  gdrive: draft => ({
    folderId: draft.gdriveFolderId,
    ...(draft.gdriveInclude ? { include: draft.gdriveInclude } : {}),
    ...(draft.gdriveExclude ? { exclude: draft.gdriveExclude } : {}),
  }),
  github: (draft) => {
    const labels = draft.githubLabels.split(',').map(s => s.trim()).filter(s => s.length > 0)
    return {
      owner: draft.githubOwner,
      repo: draft.githubRepo,
      state: draft.githubState,
      ...(labels.length > 0 ? { labels } : {}),
      includeComments: draft.githubIncludeComments,
    }
  },
  // Every other field is left to the loader's defaults,
  // which describe the envelope a shaped gateway emits.
  mcp: draft => ({
    url: draft.mcpUrl,
    ...(draft.mcpAuthorization ? { headers: { Authorization: draft.mcpAuthorization } } : {}),
    ...(draft.mcpTool ? { tool: draft.mcpTool } : {}),
  }),
}

/**
 * Loader kinds for which Studio ships a per-field config form.
 * Other kinds the server reports still appear in the dropdown,
 * but the dialog shows a warning instead of a form,
 * and disables submit until the kind is configured,
 * by editing PRODUCT.md directly.
 */
export const STUDIO_KNOWN_LOADER_KINDS = new Set(Object.keys(LOADER_CONFIGS))

// Spelled out rather than derived from the table above,
// because the catalog's keys are typed,
// and a key built at run time is only a string.
// `manual` names the absence of a loader, so it has no config builder.
const LOADER_LABEL_KEYS = {
  '': 'sources.loaderKind.manual',
  'git': 'sources.loaderKind.git',
  'gdrive': 'sources.loaderKind.gdrive',
  'github': 'sources.loaderKind.github',
  'mcp': 'sources.loaderKind.mcp',
} as const

/**
 * Human-friendly label for a loader kind.
 * Falls back to the raw kind,
 * so a new plugin without a Studio-side label still renders sensibly.
 */
export function loaderKindLabel(kind: string, t: TFunction): string {
  const key = LOADER_LABEL_KEYS[kind as keyof typeof LOADER_LABEL_KEYS]
  return key ? t(key) : kind
}

/**
 * Top-level grouping dir for a role, from its descriptor.
 * Falls back to the role id,
 * so a role that declares no pathSegment still provisions into a stable folder.
 */
export function draftPathSegment(draft: Pick<SourceDraft, 'role' | 'pathSegment'>): string {
  return draft.pathSegment || draft.role
}

export function toSourceDescriptor(draft: SourceDraft): SourceDescriptor {
  const id = asSourceId(nameToId(draft.name))
  // Path is fully derived. The role's grouping dir decides the parent,
  // and the source name decides the leaf,
  // so any tool can walk `workspaces/x/<segment>/` without parsing PRODUCT.md.
  const path = asAbsolutePath(`./${draftPathSegment(draft)}/${id}`)
  const buildConfig = LOADER_CONFIGS[draft.loaderKind]
  const loader = buildConfig
    ? { kind: asLoaderKind(draft.loaderKind), config: buildConfig(draft) }
    : undefined
  return {
    kind: 'filesystem',
    id,
    role: asSourceRole(draft.role),
    name: draft.name,
    path,
    ...(loader ? { loader } : {}),
    ...(draft.description ? { description: draft.description } : {}),
  }
}
