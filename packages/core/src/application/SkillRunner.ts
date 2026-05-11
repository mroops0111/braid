import type { SkillId } from '@telos/schema'
import type { Skill } from './Skill.js'
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js'

export class SkillRunner {
  private skills = new Map<SkillId, Skill>()

  register<TInput, TOutput>(skill: Skill<TInput, TOutput>): void {
    if (this.skills.has(skill.id)) {
      throw new ConflictError(`Skill "${skill.id}" already registered`)
    }
    this.skills.set(skill.id, skill as Skill)
  }

  async run<TOutput = unknown>(skillId: SkillId, input: unknown): Promise<TOutput> {
    const skill = this.skills.get(skillId)
    if (!skill)
      throw new NotFoundError(`Skill "${skillId}" not found`)

    const parsed = skill.inputSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(`Skill "${skillId}" rejected input`, parsed.error.issues)
    }

    return skill.execute(parsed.data) as Promise<TOutput>
  }

  list(): Skill[] {
    return [...this.skills.values()]
  }
}
