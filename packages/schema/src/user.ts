import { z } from 'zod'
import { Timestamp, UserId } from './common.js'

export const ServerRole = z.enum(['admin', 'user'])
export type ServerRole = z.infer<typeof ServerRole>

export const User = z.object({
  id: UserId,
  googleSub: z.string().min(1).optional(),
  email: z.string().email().optional(),
  displayName: z.string().min(1),
  serverRole: ServerRole.default('user'),
  createdAt: Timestamp,
})
export type User = z.infer<typeof User>

export const UserDraft = User.omit({ id: true, createdAt: true }).partial({
  serverRole: true,
})
export type UserDraft = z.infer<typeof UserDraft>

export const UserPatch = User.omit({ id: true, createdAt: true, googleSub: true }).partial()
export type UserPatch = z.infer<typeof UserPatch>
