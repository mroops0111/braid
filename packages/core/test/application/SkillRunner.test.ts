import type { SkillId } from '@telos/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ConflictError, NotFoundError, Skill, SkillRunner } from '../../src/index.js'

class EchoSkill extends Skill<{ text: string }, string> {
  readonly id = 'echo' as SkillId
  readonly inputSchema = z.object({ text: z.string() })

  async execute(input: { text: string }): Promise<string> {
    return input.text.toUpperCase()
  }
}

class FailSkill extends Skill<unknown, never> {
  readonly id = 'fail' as SkillId
  readonly inputSchema = z.object({}).passthrough()

  async execute(): Promise<never> {
    throw new Error('intentional')
  }
}

describe('SkillRunner', () => {
  let runner: SkillRunner

  beforeEach(() => {
    runner = new SkillRunner()
  })

  it('registers and runs a skill', async () => {
    runner.register(new EchoSkill())
    const result = await runner.run('echo' as SkillId, { text: 'hi' })
    expect(result).toBe('HI')
  })

  it('throws ConflictError on duplicate registration', () => {
    runner.register(new EchoSkill())
    expect(() => runner.register(new EchoSkill())).toThrow(ConflictError)
  })

  it('throws NotFoundError when running unknown skill', async () => {
    await expect(runner.run('nope' as SkillId, {})).rejects.toThrow(NotFoundError)
  })

  it('validates input via the skill schema', async () => {
    runner.register(new EchoSkill())
    await expect(runner.run('echo' as SkillId, { text: 123 })).rejects.toThrow()
  })

  it('propagates skill execution errors', async () => {
    runner.register(new FailSkill())
    await expect(runner.run('fail' as SkillId, {})).rejects.toThrow('intentional')
  })

  it('lists registered skills', () => {
    runner.register(new EchoSkill())
    expect(runner.list().map(skill => skill.id)).toEqual(['echo'])
  })
})
