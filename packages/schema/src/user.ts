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

export const UserCreate = User.omit({ id: true, createdAt: true }).partial({
  serverRole: true,
})
export type UserCreate = z.infer<typeof UserCreate>

export const UserUpdate = User.omit({ id: true, createdAt: true, googleSub: true }).partial()
export type UserUpdate = z.infer<typeof UserUpdate>
