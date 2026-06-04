import type { AbsolutePath, ClarifyStatus, ProposalStatus, WorkspaceId } from '@braidhq/schema'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ['pending', 'applied', 'rejected']
export const CLARIFY_STATUSES: readonly ClarifyStatus[] = ['pending', 'answered', 'applied', 'skipped']

/**
 * Path-prefix containment check. Both inputs must be absolute. Handles
 * the `/foo/bar-evil` vs `/foo/bar/` aliasing gotcha by normalising the
 * parent with a trailing slash before `startsWith`.
 */
export function isUnder(candidate: string, parent: string): boolean {
  const normalisedParent = parent.endsWith('/') ? parent : `${parent}/`
  return candidate === parent || candidate.startsWith(normalisedParent)
}

/** `true` when `path` resolves to anything (file, dir, symlink). */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  }
  catch {
    return false
  }
}

export function workspaceArtifactsDir(workspaceRoot: AbsolutePath): string {
  return join(workspaceRoot, 'artifacts')
}

export function graphJsonPath(workspaceRoot: AbsolutePath): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'graph.json')
}

export function batchPlanPath(workspaceRoot: AbsolutePath): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'batch-plan.json')
}

export function proposalsDir(workspaceRoot: AbsolutePath, status: ProposalStatus): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'proposals', status)
}

export function clarifyDir(workspaceRoot: AbsolutePath, status: ClarifyStatus): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'clarify', status)
}

export function decisionsDir(workspaceRoot: AbsolutePath): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'decisions')
}

export function viewsDir(workspaceRoot: AbsolutePath, kind: string): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'views', kind)
}

export function runsDir(workspaceRoot: AbsolutePath): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'runs')
}

export function runIndexPath(workspaceRoot: AbsolutePath): string {
  return join(runsDir(workspaceRoot), 'index.jsonl')
}

export function runEventsPath(workspaceRoot: AbsolutePath, runId: string): string {
  return join(runsDir(workspaceRoot), `${runId}.jsonl`)
}

export function runSessionsMetadataPath(workspaceRoot: AbsolutePath): string {
  return join(runsDir(workspaceRoot), 'sessions.jsonl')
}

// claude stores conversation memory keyed by cwd, so resume must spawn from
// the same dir as the first turn. Putting it inside the workspace (not /tmp)
// keeps the path derivable from runId and lets it survive a server restart.
export function sessionsDir(workspaceRoot: AbsolutePath): string {
  return join(workspaceRoot, '.braid-sessions')
}

export function sessionDirPath(workspaceRoot: AbsolutePath, runId: string): string {
  return join(sessionsDir(workspaceRoot), runId)
}

export function workspaceSkillsDir(workspaceRoot: AbsolutePath): string {
  return join(workspaceRoot, 'skills')
}

export function workspaceSkillExtensionsDir(workspaceRoot: AbsolutePath): string {
  return join(workspaceRoot, 'skill-extensions')
}

export function workspaceProductManifestPath(workspaceRoot: AbsolutePath): string {
  return join(workspaceRoot, 'PRODUCT.md')
}

export interface WorkspaceLayout {
  readonly root: AbsolutePath
  readonly workspaceId: WorkspaceId
  readonly manifestPath: string
}
