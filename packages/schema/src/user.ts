import { z } from 'zod'
import { Timestamp, UserId } from './common.js'

export const ServerRole = z.enum(['admin', 'user'])
export type ServerRole = z.infer<typeof ServerRole>

// Absent or 'human' is a person who logs in.
// 'service' is an autonomous component acting via its own token,
// seeded by whatever wires it.
export const UserKind = z.enum(['human', 'service'])
export type UserKind = z.infer<typeof UserKind>

export const User = z.object({
  id: UserId,
  googleSub: z.string().min(1).optional(),
  email: z.string().email().optional(),
  displayName: z.string().min(1),
  serverRole: ServerRole.default('user'),
  kind: UserKind.optional(),
  createdAt: Timestamp,
})
export type User = z.infer<typeof User>

export const UserCreate = User.omit({ id: true, createdAt: true }).partial({
  serverRole: true,
})
export type UserCreate = z.infer<typeof UserCreate>

// `.extend` strips serverRole's default, zod 4 keeps defaults through `.partial()`.
// A patch must leave absent fields absent, not reset serverRole to 'user'.
export const UserUpdate = User.omit({ id: true, createdAt: true, googleSub: true }).partial().extend({
  serverRole: ServerRole.optional(),
})
export type UserUpdate = z.infer<typeof UserUpdate>
