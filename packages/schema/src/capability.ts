import { z } from 'zod'

/**
 * The closed catalog of capability ids the platform gates on. The server is the
 * authoritative check, Studio reads the same list to show locked affordances.
 *
 * A capability is named for its resource, never for the surface that shows it,
 * so a page that moves or merges costs no rename here.
 * The verb is one of four, and it says only whether the call changes the
 * resource, never what the call is called.
 * `manage` is the part of a resource that reaches other people,
 * which is a wider scope rather than a stronger write.
 *
 * A resource every member may read needs no id at all,
 * since the membership gate upstream has already answered that.
 * Plugins register their own checks under custom string ids,
 * this list is the first-party set.
 */
export const Capability = z.enum([
  // Server scope, no workspace member required.
  'server.write', // scaffold a workspace
  'server.manage', // manage users and invites, requires the admin serverRole

  // Workspace scope.
  'handoff.read', // list and read what runs have handed over for a person to settle
  'handoff.write', // apply, reject, answer, skip, defer
  'workspace.write', // edit PRODUCT.md, sources, mcp servers, or delete the workspace
  'workspace.manage', // members and roles, plus everyone's handoffs and conversations
  'history.write', // restore a past commit, manage tags

  // Two verbs no role decides on its own.
  // Running carries a per-member override matrix on top of the role default.
  // Sharing a conversation is settled by authorship,
  // so not even `workspace.manage` holds it for a run it did not start.
  'skill.run',
  'run.share', // let another member read one conversation you started
])
export type Capability = z.infer<typeof Capability>

export const CAPABILITY_IDS = Capability.options
