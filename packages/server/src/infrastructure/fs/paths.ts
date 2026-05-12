import type { AbsolutePath, ClarifyStatus, ProposalStatus, WorkspaceId } from '@telos/schema'
import { join } from 'node:path'

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ['pending', 'applied', 'rejected']
export const CLARIFY_STATUSES: readonly ClarifyStatus[] = ['pending', 'answered', 'applied', 'skipped']

export function workspaceArtifactsDir(workspaceRoot: AbsolutePath): string {
  return join(workspaceRoot, 'artifacts')
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
