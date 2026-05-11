import { z } from 'zod'

export const TelosProblemJson = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string().min(1),
  detail: z.string().optional(),
})
export type TelosProblemJson = z.infer<typeof TelosProblemJson>
