import type { AbsolutePath, ClarificationStatus, ProposalStatus, WorkspaceId } from '@braidhq/schema'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ['pending', 'applied', 'rejected']
export const CLARIFY_STATUSES: readonly ClarificationStatus[] = ['pending', 'answered', 'applied', 'skipped']

/**
 * Path-prefix containment check. Both inputs must be absolute.
 * Handles the `/foo/bar-evil` vs `/foo/bar/` aliasing gotcha,
 * normalising the parent with a trailing slash before `startsWith`.
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
  return join(workspaceArtifactsDir(workspaceRoot), 'model.json')
}

export function batchPlanPath(workspaceRoot: AbsolutePath): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'batch-plan.json')
}

export function sourceUnitObservationDir(workspaceRoot: AbsolutePath): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'source-unit-state')
}

export function sourceUnitObservationFilePath(
  workspaceRoot: AbsolutePath,
  sourceId: string,
  relativePath: string,
): string {
  // Drop the trailing slash from folder units,
  // so the file name doesn't end in `/.json`.
  // In the unit name,
  // replace path separators with `__`, so a nested unit maps to one file.
  const trimmed = relativePath.endsWith('/') ? relativePath.slice(0, -1) : relativePath
  const flattened = trimmed.replace(/\//g, '__')
  return join(sourceUnitObservationDir(workspaceRoot), sourceId, `${flattened}.json`)
}

export function sourceUnitObservationSourceDir(
  workspaceRoot: AbsolutePath,
  sourceId: string,
): string {
  return join(sourceUnitObservationDir(workspaceRoot), sourceId)
}

export function sourceSyncStateDir(workspaceRoot: AbsolutePath): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'source-sync-state')
}

export function sourceSyncStateFilePath(workspaceRoot: AbsolutePath, sourceId: string): string {
  return join(sourceSyncStateDir(workspaceRoot), `${sourceId}.json`)
}

export function proposalsDir(workspaceRoot: AbsolutePath, status: ProposalStatus): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'proposals', status)
}

export function clarificationDir(workspaceRoot: AbsolutePath, status: ClarificationStatus): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'clarifications', status)
}

export function viewsDir(workspaceRoot: AbsolutePath, kind: string): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'views', kind)
}

export function runsDir(workspaceRoot: AbsolutePath): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'runs')
}

export function reactorCyclesDir(workspaceRoot: AbsolutePath): string {
  return join(workspaceArtifactsDir(workspaceRoot), 'reactor-cycles')
}

export function reactorCycleFilePath(workspaceRoot: AbsolutePath, cycleId: string): string {
  return join(reactorCyclesDir(workspaceRoot), `${cycleId}.json`)
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

/**
 * claude stores conversation memory keyed by cwd,
 * so resume must spawn from the same dir as the first turn.
 * Keeping it in the workspace, not /tmp, stays derivable from runId,
 * and survives a server restart.
 */
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
