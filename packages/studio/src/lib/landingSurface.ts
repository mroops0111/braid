import type { Surface } from '../components/CommandPalette'
import { useWorkspacePolicy } from '../policy'
import { useModelSnapshot, useSkills } from './queries'

/**
 * Whether this reader can put a question to this workspace.
 *
 * Shared with the sidebar so the entry and the landing cannot disagree,
 * which would drop an arrival on a surface with no way back to it.
 */
export function useCanAsk(workspaceId: string | null): boolean {
  const policy = useWorkspacePolicy(workspaceId)
  const { data: skills } = useSkills(workspaceId ?? undefined)
  return (skills?.items ?? []).some(skill =>
    skill.frontmatter.braid.category === 'ask'
    && !skill.frontmatter.braid.hidden
    && policy.can('skill.run', { skill: skill.frontmatter, skillId: skill.id }),
  )
}

/**
 * Where a bare workspace url puts a reader.
 *
 * Ask, because a workspace exists to be asked about,
 * and the graph is the apparatus rather than the point.
 * An empty workspace is the exception, since there is nothing to ask yet,
 * and Graph carries the bootstrap entry.
 *
 * Undefined while the answer is still unknown, so a caller waits,
 * rather than landing on Graph and jumping to Ask a moment later.
 */
export function useLandingSurface(workspaceId: string | null): Surface | undefined {
  const canAsk = useCanAsk(workspaceId)
  const { data: skills } = useSkills(workspaceId ?? undefined)
  const { data: snapshot } = useModelSnapshot(workspaceId ?? undefined)
  if (skills === undefined || snapshot === undefined)
    return undefined
  return canAsk && snapshot.nodes.length > 0 ? 'ask' : 'graph'
}
