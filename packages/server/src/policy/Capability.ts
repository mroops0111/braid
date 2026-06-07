/**
 * Closed enumeration of capability identifiers known to the core
 * platform. Plugins can register their own checks under custom string
 * ids; this list is the central catalog so first-party code has a
 * type-safe handle.
 *
 * New capability = add to CAPABILITY_IDS + write a CapabilityCheck
 * class implementing it. Existing checks don't care about new ids.
 */
export const CAPABILITY_IDS = [
  // Server-scope. No workspace member required; resolveViewer is built
  // with member=undefined so only admins resolve to effectiveRole='owner'.
  'workspace.create', // scaffold a new workspace or register a path

  // Workspace-scope. Each resource has at most one read and one write
  // capability. "Read" means see, "write" means change anything mutable
  // in that resource. We deliberately don't split write into submit /
  // approve / delete sub-verbs. If you can change anything, you can
  // change everything inside that resource.
  'workspace.read', // open the workspace, see settings, sources, members, graph, history
  'workspace.write', // edit PRODUCT.md / sources / plugins / ontology / members / delete
  'proposal.read', // list and read pending or decided proposals
  'proposal.write', // submit, apply, reject
  'clarify.read', // list and read clarify tickets
  'clarify.write', // answer, skip
  'history.write', // restore a past commit, manage tags

  // Skill execution carries a per-(member, skill) override matrix on
  // top of role default, so it can't be collapsed into a plain
  // read/write pair. Kept as its own verb for that reason.
  'skill.run',
] as const

export type Capability = (typeof CAPABILITY_IDS)[number]
