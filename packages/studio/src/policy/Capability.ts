/**
 * Mirrors packages/server/src/policy/Capability.ts. Keep the two in
 * sync; the server is the authoritative gate, this client copy lets
 * Studio show "Locked"-style affordances without hitting the 403.
 */
export const CAPABILITY_IDS = [
  'workspace.create',
  'workspace.read',
  'workspace.write',
  'proposal.read',
  'proposal.write',
  'clarify.read',
  'clarify.write',
  'history.write',
  'skill.run',
] as const

export type Capability = (typeof CAPABILITY_IDS)[number]
