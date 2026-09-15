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
 * Whether this reader may have a document written, or written again.
 *
 * Writing one is the form's generator skill run on a projected subject,
 * so it is the same question asked of the skills that write,
 * rather than of the surface that shows what they wrote.
 * Reading a document asks nothing, since it is a reading of the graph.
 *
 * Hidden skills count here. A generator is hidden because nobody picks it
 * off the Actions list, not because nobody runs it.
 */
export function useCanWriteDocuments(workspaceId: string | null): boolean {
  const policy = useWorkspacePolicy(workspaceId)
  const { data: skills } = useSkills(workspaceId ?? undefined)
  return (skills?.items ?? []).some(skill =>
    skill.frontmatter.braid.category === 'generate'
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

/**
 * Which surfaces this reader may open.
 *
 * The sidebar, the command palette, and the `g` chords all ask this,
 * and a shortcut reaching what the sidebar hides is a hole,
 * rather than a convenience.
 *
 * Build is open to every member, because its board says what the model has
 * made of each document, which is a reading of the graph.
 * What it takes a capability to do there is gated inside the surface.
 */
export function useSurfaceReach(workspaceId: string | null): (surface: Surface | null) => boolean {
  const policy = useWorkspacePolicy(workspaceId)
  const { data: skills } = useSkills(workspaceId ?? undefined)
  const canAsk = useCanAsk(workspaceId)
  const canRunSkills = (skills?.items ?? []).some(skill =>
    !skill.frontmatter.braid.hidden
    && policy.can('skill.run', { skill: skill.frontmatter, skillId: skill.id }),
  )
  const readsHandoffs = policy.can('handoff.read')
  const isMember = policy.effectiveRole !== null

  return (surface) => {
    switch (surface) {
      case 'settings':
        return true
      case null:
      case 'graph':
      case 'history':
      case 'activity':
      case 'build':
      case 'documents':
        return isMember
      case 'ask':
        return canAsk
      case 'batch':
        return canRunSkills
      case 'inbox':
        return readsHandoffs
      default: {
        const exhaustive: never = surface
        throw new Error(`Unhandled surface: ${JSON.stringify(exhaustive)}`)
      }
    }
  }
}
