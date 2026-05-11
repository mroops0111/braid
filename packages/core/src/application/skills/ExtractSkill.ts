import type { ProposalDraft, Scope, SkillId } from '@telos/schema'
import type { Source } from '../../domain/source/Source.js'
import type { ExtractionService } from '../ExtractionService.js'
import { z } from 'zod'
import { Skill } from '../Skill.js'

const InputSchema = z.object({
  scope: z.object({
    tokens: z.array(z.string()).default([]),
    pathGlobs: z.array(z.string()).default([]),
  }),
})

type ExtractSkillInput = z.infer<typeof InputSchema> & {
  intentSources: Source[]
  codeSources: Source[]
}

export class ExtractSkill extends Skill<ExtractSkillInput, ProposalDraft> {
  readonly id = 'extract' as SkillId
  readonly inputSchema = InputSchema as unknown as z.ZodSchema<ExtractSkillInput>

  constructor(private readonly extractionService: ExtractionService) {
    super()
  }

  async execute(input: ExtractSkillInput): Promise<ProposalDraft> {
    return this.extractionService.run({
      scope: input.scope as Scope,
      intentSources: input.intentSources,
      codeSources: input.codeSources,
    })
  }
}
