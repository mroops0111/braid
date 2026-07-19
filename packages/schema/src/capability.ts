import { z } from 'zod'

// The closed catalog of capability ids the platform gates on. The server is the
// authoritative check, Studio reads the same list to show locked affordances.
// Each resource has at most one read and one write, write means change anything
// mutable in that resource. Plugins register their own checks under custom string
// ids, this list is the first-party set.
export const Capability = z.enum([
  // Server scope, no workspace member required.
  'workspace.create', // scaffold a new workspace or register a path

  // Workspace scope.
  'workspace.read', // open the workspace, see settings, sources, members, graph, history
  'workspace.write', // edit PRODUCT.md, sources, plugins, ontology, members, or delete
  'proposal.read', // list and read pending or decided proposals
  'proposal.write', // submit, apply, reject
  'clarification.read', // list and read clarifications
  'clarification.write', // answer, skip
  'history.write', // restore a past commit, manage tags

  // Skill run carries a per-member override matrix on top of the role default,
  // so it stays its own verb rather than a read or write pair.
  'skill.run',
])
export type Capability = z.infer<typeof Capability>

export const CAPABILITY_IDS = Capability.options
