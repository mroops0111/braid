import type { SkillId } from '@telos/schema'
import type { z } from 'zod'

export abstract class Skill<TInput = unknown, TOutput = unknown> {
  abstract readonly id: SkillId
  abstract readonly inputSchema: z.ZodSchema<TInput>
  abstract execute(input: TInput): Promise<TOutput>
}
